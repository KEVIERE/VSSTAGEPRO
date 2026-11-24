// Resumo detalhado da onda de cada faixa, feito uma vez e guardado no disco do app (como os
// arquivos de picos de uma DAW).
//
// O resumo que vai no projeto tem no máximo 24.000 pontos por faixa: numa música de 8 minutos é
// um ponto a cada ~20 ms, e com zoom aproximado o ataque de cada batida aparecia antes da linha
// da grade. A leitura exata do disco (wavePrecise) acertava, mas só depois de abrir a música: a
// onda aparecia de um jeito e "pulava" para o lugar certo toda vez. Com este resumo (um pico a cada
// 64 quadros, 1,3 ms a 48 kHz), a onda já abre certa. Ele é feito na primeira vez que a música
// aparece com zoom aproximado (com a música parada, lendo o áudio em segundo plano) e fica no
// disco para as próximas aberturas, deste e de qualquer outro projeto com a mesma faixa.
import { deviceSampleRate } from '@/lib/audioDecoder';
import { getClipAudio, getClipSource } from '@/lib/audioLibrary';
import { entryExists, fullCopyName, hash, markUsed, openEntryRange, readyDir, sourceIdentity } from '@/lib/readyStore';
import { readWavPeaks } from '@/lib/wavReader';
import { encodeFineChunk, FINE_FRAMES_PER_PEAK, type FinePeaks } from '@/lib/waveColumns';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';

const MAGIC = 0x56535750;
const HEADER_INTS = 4;
/** Quanto do resumo detalhado fica na memória (de várias músicas), em bytes. */
const MEMORY_BUDGET = 64 * 1024 * 1024;
/**
 * Leitura do áudio para montar o resumo: pedaços múltiplos de 64 quadros, pequenos (~1 ms de
 * tela cada) para nunca segurar a tela.
 */
const BUILD_CHUNK_FRAMES = 1 << 17;
/** Falha passageira (cópia ainda não pronta, arquivo religado): tenta de novo depois disso. */
const RETRY_FAILED_MS = 60_000;

type ClipLike = Pick<AudioClip, 'id' | 'songId' | 'duration' | 'sampleRate' | 'waveformPeaks'>;

// ---------------------------------------------------------------------------------------------
// nome do arquivo: muda quando o áudio da faixa muda (o resumo do projeto muda junto)

const names = new WeakMap<number[], string>();

/** Marca do resumo do projeto: o mesmo áudio dá sempre a mesma marca, mesmo depois de salvar (4 casas). */
export function peaksFingerprint(peaks: number[] | undefined): string {
  if (!peaks || peaks.length === 0) return '0';
  // todos os pontos (até 24.000, uma vez por resumo: fica guardado pelo array)
  let a = 0x811c9dc5;
  let b = 7;
  for (let i = 0; i < peaks.length; i++) {
    const v = Math.round((peaks[i] || 0) * 10_000);
    a = Math.imul(a ^ v, 16777619);
    b = (b * 31 + v) % 2_147_483_647;
  }
  return `${peaks.length}:${(a >>> 0).toString(16)}:${b}`;
}

const fingerprints = new WeakMap<number[], string>();

/** Nome do resumo: muda quando o áudio da faixa muda (outra fonte ou outro resumo do projeto). */
export function finePeaksName(clip: ClipLike): string {
  const peaks = clip.waveformPeaks;
  let fp = peaks ? fingerprints.get(peaks) : undefined;
  if (!fp) {
    fp = peaksFingerprint(peaks);
    if (peaks) fingerprints.set(peaks, fp);
  }
  const src = getClipSource(clip.id);
  const source = src ? sourceIdentity(clip.songId, clip.id, src) : 'sem-fonte';
  const key = `${clip.id}|${clip.duration}|${clip.sampleRate}|${source}|${fp}`;
  const cached = peaks ? names.get(peaks) : undefined;
  if (cached?.startsWith(key + '#')) return cached.slice(key.length + 1);
  const name = `w_${hash(key)}`;
  if (peaks) names.set(peaks, `${key}#${name}`);
  return name;
}

// ---------------------------------------------------------------------------------------------
// memória e avisos para a tela

const loaded = new Map<string, FinePeaks>();
let loadedBytes = 0;
/** Conferido no disco e não existe (ainda): a tela usa o caminho antigo enquanto é montado. */
const missing = new Set<string>();
/** Não deu para montar agora (arquivo que não lê, cópia ainda não pronta): espera antes de tentar de novo. */
const failedAt = new Map<string, number>();
const failed = {
  has: (name: string) => {
    const t = failedAt.get(name);
    if (t === undefined) return false;
    if (Date.now() - t < RETRY_FAILED_MS) return true;
    failedAt.delete(name);
    return false;
  },
  add: (name: string) => { failedAt.set(name, Date.now()); },
};
/** Pediram montagem enquanto o disco ainda era conferido: monta quando a conferência terminar. */
const wantBuild = new Set<string>();
const loading = new Map<string, Promise<void>>();
/** Já conferidos no disco (o arquivo existe): a pré-carga depois de cada edição não confere de novo. */
const onDisk = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
/**
 * Versão de cada resumo (a global de quando ele mudou): cada onda da tela só redesenha quando muda
 * o resumo dela. Antes, cada resumo que chegava re-renderizava todas as ondas da timeline.
 */
const changedAt = new Map<string, number>();

// Vários resumos chegando juntos (troca de música): um aviso só por quadro para a tela.
let notifyFrame = 0;
function notify(name: string) {
  version++;
  changedAt.set(name, version);
  if (notifyFrame) return;
  const flush = () => {
    notifyFrame = 0;
    listeners.forEach((fn) => fn());
  };
  notifyFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
}

export function subscribeFinePeaks(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function finePeaksVersion(): number {
  return version;
}

/**
 * Marca do resumo detalhado desta faixa para a tela (useSyncExternalStore): muda quando muda o
 * resumo dela ou o nome dele (outra fonte, outro áudio), e não quando chega o de outra faixa.
 */
export function finePeaksSnapshot(clip: ClipLike): string {
  const name = finePeaksName(clip);
  return `${name}#${changedAt.get(name) ?? 0}`;
}

function keep(name: string, fine: FinePeaks) {
  const old = loaded.get(name);
  if (old) { loadedBytes -= old.data.byteLength; loaded.delete(name); }
  loaded.set(name, fine);
  loadedBytes += fine.data.byteLength;
  while (loadedBytes > MEMORY_BUDGET && loaded.size > 1) {
    const oldest = loaded.keys().next().value;
    if (oldest === undefined || oldest === name) break;
    loadedBytes -= loaded.get(oldest)!.data.byteLength;
    loaded.delete(oldest);
  }
}

/**
 * O resumo detalhado da faixa, sem esperar: o resumo, `null` quando não há (e a tela segue sem ele)
 * ou `undefined` enquanto ainda não conferiu o disco.
 */
export function peekFinePeaks(clip: ClipLike): FinePeaks | null | undefined {
  const name = finePeaksName(clip);
  const hit = loaded.get(name);
  if (hit) {
    // mais recente no fim da fila
    loaded.delete(name);
    loaded.set(name, hit);
    return hit;
  }
  if (missing.has(name) || failed.has(name)) return null;
  return undefined;
}

/**
 * Carrega do disco o resumo detalhado da faixa; se ainda não existe e `build` for true, monta em
 * segundo plano (com a música parada) e guarda para as próximas vezes.
 */
export function requestFinePeaks(clip: ClipLike, build: boolean): void {
  const name = finePeaksName(clip);
  if (loaded.has(name) || failed.has(name)) return;
  if (missing.has(name)) {
    if (build) enqueueBuild(clip, name);
    return;
  }
  if (build) wantBuild.add(name);
  if (loading.has(name)) return;
  const job = (async () => {
    const fine = await readFine(name);
    if (fine) {
      keep(name, fine);
      onDisk.add(name);
      markUsed(name);
    } else {
      missing.add(name);
    }
  })()
    .catch(() => { missing.add(name); })
    .finally(() => {
      loading.delete(name);
      if (!loaded.has(name) && wantBuild.has(name)) enqueueBuild(clip, name);
      wantBuild.delete(name);
      notify(name);
    });
  loading.set(name, job);
}

async function readFine(name: string): Promise<FinePeaks | null> {
  const dir = await readyDir();
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size < HEADER_INTS * 4) return null;
    const buf = await file.arrayBuffer();
    const [magic, sampleRate, framesPer, frames] = new Int32Array(buf, 0, HEADER_INTS);
    const bins = Math.ceil(frames / Math.max(1, framesPer));
    if (magic !== MAGIC || !(sampleRate > 0) || !(framesPer > 0) || buf.byteLength !== HEADER_INTS * 4 + bins) return null;
    return { sampleRate, framesPer, frames, data: new Uint8Array(buf, HEADER_INTS * 4, bins) };
  } catch {
    return null;
  }
}

async function writeFine(name: string, fine: FinePeaks): Promise<void> {
  const dir = await readyDir();
  if (!dir) return;
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(new Int32Array([MAGIC, fine.sampleRate, fine.framesPer, fine.frames]));
    await writable.write(fine.data.buffer.slice(fine.data.byteOffset, fine.data.byteOffset + fine.data.byteLength) as ArrayBuffer);
    // só grava de verdade no close(): interrompido no meio, não fica arquivo pela metade
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => { /* ignore */ });
    await dir.removeEntry(name).catch(() => { /* ignore */ });
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// montagem em segundo plano: uma faixa por vez, só com a música parada

const queue: Array<{ clip: ClipLike; name: string }> = [];
const queued = new Set<string>();
let building = false;
let currentBuild: string | null = null;

function enqueueBuild(clip: ClipLike, name: string) {
  if (failed.has(name) || loaded.has(name)) return;
  if (queued.has(name)) {
    // já estava na fila (montagem do projeto inteiro): a música da tela passa na frente
    const at = queue.findIndex((q) => q.name === name);
    if (at > 0) queue.unshift(...queue.splice(at, 1));
    return;
  }
  queued.add(name);
  // a música que acabou de aparecer na tela vem antes das pedidas antes
  queue.unshift({ clip, name });
  void drain();
}

// a montagem só anda com a música parada e nenhuma música abrindo (a da tela e o Play vêm primeiro)
const busy = (s = useStore.getState()) => s.transport.isPlaying || s.loadingSongIds.length > 0;
const isPlaying = () => busy();

function whenStopped(): Promise<void> {
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = useStore.subscribe((s) => {
      if (busy(s)) return;
      off();
      resolve();
    });
  });
}

async function drain() {
  if (building) return;
  building = true;
  try {
    while (queue.length > 0) {
      const { clip, name } = queue.shift()!;
      queued.delete(name);
      if (loaded.has(name)) continue;
      currentBuild = name;
      // só a onda desta faixa: passa a esperar o resumo que está sendo montado (antes ela via isso
      // de carona no aviso global da faixa anterior)
      notify(name);
      try {
        const fine = await build(clip);
        // a faixa mudou de áudio durante a montagem: o resumo é do áudio antigo, descarta
        const now = useStore.getState().clips.find((c) => c.id === clip.id);
        if (fine && (!now || finePeaksName(now) !== name)) {
          missing.delete(name);
        } else if (!fine) {
          failed.add(name);
        } else {
          keep(name, fine);
          missing.delete(name);
          markUsed(name);
          await writeFine(name, fine).then(() => { onDisk.add(name); }, () => { /* sem espaço: fica só na memória */ });
        }
      } catch {
        failed.add(name);
      }
      currentBuild = null;
      notify(name);
    }
  } finally {
    building = false;
    currentBuild = null;
  }
}

interface FrameSource {
  sampleRate: number;
  frames: number;
  read(start: number, n: number): Promise<Int16Array[] | null>;
}

async function openFrames(clip: ClipLike): Promise<FrameSource | null> {
  // 1. o áudio já na memória (música aberta inteira)
  const audio = getClipAudio(clip.id);
  if (audio && audio.length > 0 && audio.channels.length > 0) {
    return {
      sampleRate: audio.sampleRate,
      frames: audio.length,
      read: async (s, n) => audio.channels.map((ch) => ch.subarray(s, Math.min(audio.length, s + n))),
    };
  }
  const src = getClipSource(clip.id);
  if (!src || !(clip.sampleRate > 0) || !(clip.duration > 0)) return null;
  // 2. a cópia pronta do app (MP3/M4A e WAV em outra taxa), na taxa da saída
  const rate = deviceSampleRate();
  const dir = await readyDir().catch(() => null);
  const copy = dir ? await openEntryRange(dir, fullCopyName(clip.songId, clip.id, src, rate)) : null;
  if (copy && copy.frames === copy.fullFrames && copy.sampleRate > 0) {
    return { sampleRate: copy.sampleRate, frames: copy.frames, read: (s, n) => copy.read(s, n) };
  }
  // MP3/M4A sem cópia pronta ainda: tenta de novo mais tarde
  return null;
}

const WAV_SLICE_FRAMES = FINE_FRAMES_PER_PEAK * 65536;

async function buildFromWav(src: Blob): Promise<FinePeaks | null> {
  let data: Uint8Array | null = null;
  let frames = 0;
  let sampleRate = 0;
  for (let start = 0; data === null || start < frames; ) {
    await whenStopped();
    const part = await readWavPeaks(src, FINE_FRAMES_PER_PEAK, start, WAV_SLICE_FRAMES);
    if (!part) return null;
    // deram Play ou abriram uma música durante a leitura: lê esta fatia de novo depois
    if (busy()) continue;
    if (data === null) {
      frames = part.frames;
      sampleRate = part.sampleRate;
      data = new Uint8Array(Math.ceil(frames / FINE_FRAMES_PER_PEAK));
    }
    data.set(part.data.subarray(0, Math.max(0, data.length - start / FINE_FRAMES_PER_PEAK)), start / FINE_FRAMES_PER_PEAK);
    start += WAV_SLICE_FRAMES;
  }
  return data ? { sampleRate, framesPer: FINE_FRAMES_PER_PEAK, frames, data } : null;
}

async function build(clip: ClipLike): Promise<FinePeaks | null> {
  await whenStopped();
  // WAV (o caso comum): o leitor em segundo plano devolve os picos prontos, uma fatia por vez,
  // e entre as fatias a montagem para se derem Play ou abrirem uma música
  if (!getClipAudio(clip.id)) {
    const src = getClipSource(clip.id);
    const fromWav = src ? await buildFromWav(src).catch(() => null) : null;
    if (fromWav) return fromWav;
  }
  const source = await openFrames(clip);
  if (!source || source.frames <= 0) return null;
  const framesPer = FINE_FRAMES_PER_PEAK;
  const data = new Uint8Array(Math.ceil(source.frames / framesPer));
  for (let start = 0; start < source.frames; start += BUILD_CHUNK_FRAMES) {
    // tocou no meio: espera parar (a música no ar vem primeiro)
    await whenStopped();
    const n = Math.min(BUILD_CHUNK_FRAMES, source.frames - start);
    const channels = await source.read(start, n);
    if (!channels || channels.length === 0) return null;
    // deram Play durante a leitura: não processa agora, espera parar e lê este pedaço de novo
    if (isPlaying()) { start -= BUILD_CHUNK_FRAMES; continue; }
    encodeFineChunk(channels, start, framesPer, data);
    // solta a tela entre um pedaço e outro
    await new Promise((r) => setTimeout(r, 0));
  }
  return { sampleRate: source.sampleRate, framesPer, frames: source.frames, data };
}

/**
 * Projeto aberto: confere no disco o resumo detalhado de todas as faixas e monta (com a música
 * parada) as que faltam, para que nenhuma música abra com a onda fora do lugar. Só confere a
 * existência do arquivo; o resumo só vai para a memória quando a faixa aparece na tela.
 */
export function prefetchFinePeaks(clips: ClipLike[]): void {
  void (async () => {
    const dir = await readyDir();
    if (!dir) return;
    for (const clip of clips) {
      if (!(clip.sampleRate > 0) || !(clip.duration > 0) || !clip.waveformPeaks?.length || !getClipSource(clip.id)) continue;
      const name = finePeaksName(clip);
      // já conferido (nesta ou numa pré-carga anterior): a edição seguinte não confere tudo de novo
      if (onDisk.has(name) || loaded.has(name) || loading.has(name) || queued.has(name) || failed.has(name)) continue;
      if (await entryExists(dir, name)) { onDisk.add(name); markUsed(name); continue; }
      missing.add(name);
      if (queued.has(name)) continue;
      queued.add(name);
      // depois das faixas da música que está na tela (que entram na frente)
      queue.push({ clip, name });
    }
    void drain();
  })();
}

/**
 * Conferindo o disco ou montando agora: a tela espera um instante em vez de desenhar o aproximado.
 * Só na fila (atrás de outras faixas, ou esperando a música parar) não conta: ia esperar à toa.
 */
export function finePeaksPending(clip: ClipLike): boolean {
  const name = finePeaksName(clip);
  return loading.has(name) || (currentBuild === name && !busy());
}

/** Para teste. */
export function clearFinePeaksMemory(): void {
  loaded.clear();
  loadedBytes = 0;
  missing.clear();
  failedAt.clear();
  wantBuild.clear();
  onDisk.clear();
  changedAt.clear();
}
