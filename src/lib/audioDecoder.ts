import type { Marker } from '@/types';

export interface DecodedAudio {
  audioBuffer: AudioBuffer;
  sampleRate: number;
  channels: number;
  duration: number;
  /** First 5 seconds of mono data for AI classification */
  sample5s: Float32Array;
}

// Reaproveita um único AudioContext "offline-ish" para decodificar todos os
// arquivos, em vez de abrir e fechar um por arquivo (operação cara).
let decodeCtx: AudioContext | null = null;
function getDecodeContext(): AudioContext {
  if (!decodeCtx || decodeCtx.state === 'closed') {
    // 'playback': bloco máximo. Nunca toca, então não pode pedir à placa bloco menor que o motor
    decodeCtx = new AudioContext({ latencyHint: 'playback' });
    // Este contexto só decodifica e informa a taxa da saída: nunca toca som. Parado, ele não deixa
    // uma saída de bloco curto aberta para sempre, encurtando também o bloco das músicas (Modo
    // estável). decodeAudioData e sampleRate funcionam com o contexto parado.
    void decodeCtx.suspend().catch(() => { /* fica rodando em silêncio, como antes */ });
  }
  return decodeCtx;
}

export async function decodeFile(file: File): Promise<DecodedAudio> {
  const audioBuffer = await decodeBlob(file);

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;

  const fiveSeconds = Math.min(5, duration);
  const sampleLength = Math.floor(fiveSeconds * sampleRate);
  const sample5s = new Float32Array(sampleLength);

  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < sampleLength; i++) {
      sample5s[i] += channelData[i] / channels;
    }
  }

  return { audioBuffer, sampleRate, channels, duration, sample5s };
}

export async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return getDecodeContext().decodeAudioData(arrayBuffer);
}

/** Taxa da saída de áudio: é nela que o áudio aberto precisa estar para tocar sem conversão. */
export function deviceSampleRate(): number {
  return getDecodeContext().sampleRate;
}

// ---------------------------------------------------------------------------------------------
// Importação: a conversão para 16 bits e os picos da onda saem da tela.
//
// Antes a importação fazia na tela, por arquivo, a conta inteira dos picos (síncrona) e a
// conversão do Float32 do navegador para 16 bits. Agora um worker faz as duas. O WAV na taxa da
// saída chega já em 16 bits pelo leitor em segundo plano (o mesmo da reabertura) e vai ao worker
// só para os picos; o resto (WAV em outra taxa, MP3, M4A) vem do navegador, como antes.

/** Picos guardados no clipe importado: 100 por segundo, entre 8 mil e 24 mil (como sempre foi). */
export function importPeakCount(duration: number): number {
  return Math.min(24000, Math.max(8000, Math.round(duration * 100)));
}

/**
 * Código do worker da importação. Fica em texto (worker por endereço `blob:`, como os worklets
 * do motor): este lote não cria arquivo novo, e texto não passa pelo minificador nem pelo
 * `keepNames` do build de medição. As contas são as de `waveformPeaks.ts` (picos) e de
 * `toClipAudio` em `audioLibrary.ts` (16 bits): tests/lote12-importar.test.mjs confere que dão o
 * mesmo resultado, número por número.
 * - kind 'float': canais Float32 do navegador; devolve os mesmos canais em 16 bits e os picos.
 * - kind 'int16': canais já em 16 bits (WAV); devolve os mesmos canais e os picos (amostra / 32768).
 */
export const IMPORT_WORKER_SOURCE = `'use strict';
function peakColumns(chs, numPeaks, scale) {
  var out = new Float32Array(numPeaks);
  var dataLen = chs[0].length;
  for (var i = 0; i < numPeaks; i++) {
    var max = 0;
    var start = Math.floor((i / numPeaks) * dataLen);
    var end = Math.min(Math.ceil(((i + 1) / numPeaks) * dataLen), dataLen);
    for (var j = start; j < end; j++) {
      for (var c = 0; c < chs.length; c++) {
        var abs = Math.abs(chs[c][j]);
        if (abs > max) max = abs;
      }
    }
    out[i] = max * scale;
  }
  return out;
}
function toInt16(src) {
  var out = new Int16Array(src.length);
  for (var i = 0; i < src.length; i++) {
    var v = src[i];
    out[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
  }
  return out;
}
self.onmessage = function (ev) {
  var d = ev.data;
  try {
    var chs = d.channels;
    var peaks = peakColumns(chs, d.numPeaks, d.kind === 'int16' ? 1 / 32768 : 1);
    var out = d.kind === 'int16' ? chs : chs.map(toInt16);
    var transfer = [peaks.buffer];
    for (var k = 0; k < out.length; k++) if (transfer.indexOf(out[k].buffer) < 0) transfer.push(out[k].buffer);
    self.postMessage({ id: d.id, ok: true, channels: out, peaks: peaks }, transfer);
  } catch (err) {
    self.postMessage({ id: d.id, ok: false });
  }
};
`;

/** O worker da importação recebeu o áudio e falhou: quem chamou abre o arquivo de novo, na tela. */
export class ImportWorkerError extends Error {}

type ImportReply = { id: number; ok: boolean; channels?: Int16Array[]; peaks?: Float32Array };
interface ImportJob {
  resolve: (r: { channels: Int16Array[]; peaks: number[] }) => void;
  reject: (err: Error) => void;
  worker: Worker;
}

const IMPORT_IDLE_MS = 30_000;
let importWorkers: Worker[] = [];
let importBroken = false;
let importUrl: string | null = null;
let importSeq = 0;
let importTurn = 0;
let importIdle: ReturnType<typeof setTimeout> | null = null;
const importJobs = new Map<number, ImportJob>();

function stopImportWorkers() {
  importWorkers.forEach((w) => w.terminate());
  importWorkers = [];
}

function scheduleImportIdle() {
  if (importIdle !== null) clearTimeout(importIdle);
  importIdle = null;
  if (importJobs.size > 0) return;
  // ocioso: os workers saem e devolvem a memória (voltam na próxima importação)
  importIdle = setTimeout(() => {
    importIdle = null;
    if (importJobs.size === 0) stopImportWorkers();
  }, IMPORT_IDLE_MS);
}

function makeImportWorker(url: string): Worker {
  const w = new Worker(url);
  w.onmessage = (ev: MessageEvent<ImportReply>) => {
    const job = importJobs.get(ev.data?.id);
    if (!job) return;
    importJobs.delete(ev.data.id);
    if (ev.data.ok && ev.data.channels?.length && ev.data.peaks) job.resolve({ channels: ev.data.channels, peaks: Array.from(ev.data.peaks) });
    else job.reject(new ImportWorkerError('conversão da importação falhou'));
    scheduleImportIdle();
  };
  const broken = () => {
    // worker que nem carrega (ou quebra): daqui em diante a importação faz tudo na tela, como antes
    importBroken = true;
    if (importIdle !== null) { clearTimeout(importIdle); importIdle = null; }
    for (const [id, job] of importJobs) {
      importJobs.delete(id);
      job.reject(new ImportWorkerError('worker da importação parou'));
    }
    stopImportWorkers();
  };
  w.onerror = (ev) => { ev.preventDefault?.(); broken(); };
  w.onmessageerror = broken;
  return w;
}

function pickImportWorker(): Worker | null {
  if (importBroken || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
  if (importWorkers.length === 0) {
    try {
      importUrl ??= URL.createObjectURL(new Blob([IMPORT_WORKER_SOURCE], { type: 'text/javascript' }));
      const size = Math.min(2, Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 2));
      for (let i = 0; i < size; i++) importWorkers.push(makeImportWorker(importUrl));
    } catch {
      importBroken = true;
      stopImportWorkers();
      return null;
    }
  }
  return importWorkers[importTurn++ % importWorkers.length];
}

/**
 * Converte para 16 bits (kind 'float') e calcula os picos num worker. Os canais são transferidos:
 * depois da chamada eles ficam vazios para quem chamou. Devolve null quando não há worker (nada
 * foi enviado: quem chamou faz a conta na tela). Rejeita com ImportWorkerError se o worker falhar
 * depois de receber o áudio.
 */
export function convertForImport(kind: 'float' | 'int16', channels: Array<Float32Array | Int16Array>, numPeaks: number): Promise<{ channels: Int16Array[]; peaks: number[] }> | null {
  const worker = pickImportWorker();
  if (!worker) return null;
  if (importIdle !== null) { clearTimeout(importIdle); importIdle = null; }
  const id = ++importSeq;
  const chs = channels.slice(0, 2);
  return new Promise((resolve, reject) => {
    importJobs.set(id, { resolve, reject, worker });
    const msg = { id, kind, numPeaks, channels: chs };
    try {
      worker.postMessage(msg, Array.from(new Set(chs.map((c) => c.buffer as ArrayBuffer))));
    } catch {
      // memória que não pode ser transferida (a do próprio AudioBuffer, por exemplo): vai copiada
      try {
        worker.postMessage(msg);
      } catch {
        importJobs.delete(id);
        reject(new ImportWorkerError('não deu para enviar o áudio ao worker da importação'));
        scheduleImportIdle();
      }
    }
  });
}

/** Mesma conta dos picos do worker para canais em 16 bits, em pedaços na tela (quando não há worker). */
export async function int16PeaksAsync(channels: Int16Array[], numPeaks: number): Promise<number[]> {
  const chs = channels.slice(0, 2);
  const peaks: number[] = new Array(numPeaks);
  const dataLen = chs[0].length;
  for (let from = 0; from < numPeaks; from += 2000) {
    const to = Math.min(numPeaks, from + 2000);
    for (let i = from; i < to; i++) {
      let max = 0;
      const start = Math.floor((i / numPeaks) * dataLen);
      const end = Math.min(Math.ceil(((i + 1) / numPeaks) * dataLen), dataLen);
      for (let j = start; j < end; j++) {
        for (const ch of chs) {
          const abs = Math.abs(ch[j]);
          if (abs > max) max = abs;
        }
      }
      peaks[i] = max * (1 / 32768);
    }
    if (to < numPeaks) await new Promise((r) => setTimeout(r, 0));
  }
  return peaks;
}

/**
 * Bytes que um arquivo ocupa aberto em 16 bits (estimativa sem abrir o arquivo). WAV: perto do
 * tamanho do arquivo (16 bits) com folga para a troca de taxa; MP3, M4A e outros comprimidos:
 * 12 vezes o arquivo (um MP3 de 128 kbps aberto em estéreo a 48 kHz). Estimar a mais só faz a
 * importação soltar como antes.
 */
export function importFileBytes(file: { name: string; size: number }): number {
  return /\.wav$/i.test(file.name) ? Math.ceil(file.size * 1.1) : file.size * 12;
}

/**
 * Orçamento da importação quando a função de orçamento da biblioteca (`audioMemoryBudget`) não
 * existe: 15% da RAM (a do computador, se o programa expõe, senão a do navegador, que para em
 * 8 GB), entre 0,6 GB e 3 GB. Num Mac de 8 GB dá cerca de 1,2 GB.
 */
export function importBudgetFallback(totalMemory?: number, deviceMemoryGb?: number): number {
  const GIB = 1024 ** 3;
  const ram = Number.isFinite(totalMemory) && (totalMemory as number) > 0 ? (totalMemory as number) : (deviceMemoryGb && deviceMemoryGb > 0 ? deviceMemoryGb : 8) * GIB;
  return Math.max(0.6 * GIB, Math.min(3 * GIB, ram * 0.15));
}

/**
 * Músicas que a importação não solta. A do ar sempre fica. A selecionada e a próxima (nessa
 * ordem) ficam só se cabem no orçamento junto com o que já está em uso (a do ar e a música que
 * está entrando); a que não cabe é solta, como antes.
 */
export function songsKeptDuringImport(opts: {
  playingId: string | null;
  candidates: Array<{ id: string | null | undefined; bytes: number }>;
  usedBytes: number;
  budget: number;
}): string[] {
  const keep: string[] = opts.playingId ? [opts.playingId] : [];
  let used = opts.usedBytes;
  for (const c of opts.candidates) {
    if (!c.id || keep.includes(c.id)) continue;
    if (!(used + c.bytes <= opts.budget)) continue;
    used += c.bytes;
    keep.push(c.id);
  }
  return keep;
}

export function extractChannelData(audioBuffer: AudioBuffer): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  return channelData;
}

export function generateMarkers(duration: number): Marker[] {
  return [
    {
      id: `marker-start-${Date.now()}`,
      name: 'Início',
      position: 0,
      type: 'start',
    },
    {
      id: `marker-end-${Date.now()}`,
      name: 'Fim',
      position: duration,
      type: 'end',
    },
  ];
}
