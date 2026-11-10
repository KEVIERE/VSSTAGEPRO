// "Separar stems" no clique direito de um áudio da timeline.
//
// - Áudio de bateria: vira Bumbo, Caixa, Pratos, Tons e Sala, cada peça na sua faixa da pasta
//   Bateria. A Sala é o que sobra da bateria depois de tirar as 4 peças (ambiência e vazamento):
//   somando as 5 faixas dá exatamente a bateria original.
// - Qualquer outro áudio: o Demucs separa voz, baixo, bateria, guitarra, piano e outros; só entram
//   as partes que têm som de verdade, cada uma na pasta certa (a guitarra vai para Violões ou
//   Guitarras conforme o que a IA de instrumentos ouvir).
// - O clipe original fica no lugar, mudo, para nada se perder.
//
// Roda só no app do Mac (IA local); nada passa pelo servidor.
import { audioEngine } from '@/lib/audioEngine';
import { clipAudioToBuffer, getClipAudio, getClipSource, putClipAudio, registerClipSource, toClipAudioAsync } from '@/lib/audioLibrary';
import { decodeBlob, deviceSampleRate, generateMarkers } from '@/lib/audioDecoder';
import { encodeWavPcm24 } from '@/lib/wavEncoder';
import { cancelStemSeparation, classifyStem, trackForStem } from '@/lib/stemSeparator';
import { useStore } from '@/store';
import type { AudioClip } from '@/types';

export type StemSplitProgress = { percent: number; message: string };

/** Separação local disponível (só no app do Mac). */
export function canSplitClipStems(): boolean {
  return typeof window !== 'undefined' && !!window.vsDesktop?.separateStemsLocal;
}

/** O clipe está numa faixa de bateria? (pasta Bateria ou faixa com "bateria"/"drum" no nome) */
export function isDrumClip(clip: AudioClip): boolean {
  const tracks = useStore.getState().tracks;
  const track = tracks.find((t) => t.id === clip.trackId);
  if (!track) return false;
  if (track.id === 'track-bateria' || track.parentId === 'track-bateria') return true;
  return /bateria|drum/i.test(track.name);
}

let running = false;
let cancelled = false;
export function isSplittingStems(): boolean { return running; }
export function cancelClipStemSplit(): void {
  cancelled = true;
  void cancelStemSeparation();
}

const CANCELLED = 'stem_split_cancelled';

export async function clipInput(clip: AudioClip): Promise<AudioBuffer> {
  const source = getClipSource(clip.id);
  if (source) return decodeBlob(source);
  const raw = getClipAudio(clip.id);
  if (raw) return clipAudioToBuffer(raw);
  throw new Error('o áudio deste clipe não foi encontrado');
}

/** Os modelos de IA pedem 44,1 kHz estéreo. */
async function toStereo44k(input: AudioBuffer): Promise<AudioBuffer> {
  if (input.sampleRate === 44100 && input.numberOfChannels === 2) return input;
  const length = Math.max(1, Math.ceil(input.duration * 44100));
  const ctx = new OfflineAudioContext(2, length, 44100);
  const src = ctx.createBufferSource();
  src.buffer = input;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/**
 * Converte um buffer para a taxa de saída do dispositivo.
 *
 * O worklet de reprodução lê UMA amostra do áudio por frame de saída, sem reamostrar: um buffer
 * a 44,1 kHz dentro de um contexto de 48 kHz toca 8,8% mais rápido (4.875 ms de deriva por
 * minuto). Era esse o "peças vs música": as peças separadas nasciam a 44,1 kHz pelo modelo e
 * eram guardadas com `putClipAudio`, que — ao contrário de `openClipAudio`/`readWav` — não
 * converte para a taxa do dispositivo.
 */
export async function toDeviceRate(input: AudioBuffer): Promise<AudioBuffer> {
  const rate = deviceSampleRate();
  if (input.sampleRate === rate) return input;
  const length = Math.max(1, Math.round(input.duration * rate));
  const ctx = new OfflineAudioContext(2, length, rate);
  const src = ctx.createBufferSource();
  src.buffer = input;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

function rms(buffer: AudioBuffer): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i += 16) { sum += d[i] * d[i]; n++; }
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/**
 * Sala = bateria original menos as peças (o que o modelo não pôs em nenhuma peça).
 *
 * A subtração só funciona amostra por amostra se as duas gravações estiverem na
 * MESMA taxa e no mesmo instante. As peças vêm do modelo em 44,1 kHz, enquanto a
 * bateria aqui já está na taxa do dispositivo — subtrair uma da outra desalinha
 * tudo e o resto vira chiado. Por isso cada peça é reamostrada para a taxa da
 * bateria antes de entrar na conta.
 */
function roomResidual(drums: AudioBuffer, pieces: AudioBuffer[]): AudioBuffer {
  const out = new AudioBuffer({ length: drums.length, numberOfChannels: drums.numberOfChannels, sampleRate: drums.sampleRate });
  for (let c = 0; c < drums.numberOfChannels; c++) {
    const res = new Float32Array(drums.getChannelData(c));
    for (const p of pieces) {
      const pc = p.getChannelData(Math.min(c, p.numberOfChannels - 1));
      // Fator de conversão quando a peça não está na taxa da bateria.
      const step = p.sampleRate / drums.sampleRate;
      const n = res.length;
      for (let i = 0; i < n; i++) {
        const pos = i * step;
        const idx = Math.floor(pos);
        if (idx >= pc.length) break;
        // Interpolação linear: sem ela, mexer na taxa trocaria o desalinhamento
        // por degraus audíveis.
        const frac = pos - idx;
        const a = pc[idx];
        const b = idx + 1 < pc.length ? pc[idx + 1] : a;
        res[i] -= a + (b - a) * frac;
      }
    }
    out.copyToChannel(res, c);
  }
  return out;
}

type Part = { stem: string; parent: string; child: string; buffer: AudioBuffer };

async function decodeWav(raw: ArrayBuffer | null | undefined): Promise<AudioBuffer | null> {
  if (!raw) return null;
  try { return await decodeBlob(new Blob([raw], { type: 'audio/wav' })); } catch { return null; }
}

async function drumParts(input: AudioBuffer, onProgress: (p: StemSplitProgress) => void): Promise<Part[]> {
  const bridge = window.vsDesktop?.separateDrumPieces;
  if (!bridge) throw new Error('a separação da bateria não está disponível neste Mac');
  const status = await window.vsDesktop?.drumPiecesStatus?.().catch(() => null);
  if (status && !status.ready) {
    throw new Error(status.state === 'downloading'
      ? `o modelo da bateria ainda está sendo baixado (${Math.round(status.progress)}%). Tente de novo em alguns minutos`
      : 'o modelo da bateria ainda não foi baixado. Conecte o Mac à internet e tente de novo');
  }
  // A ordem importa: é a ordem que o script grava os WAVs, e cada peça vai para a sua faixa.
  onProgress({ percent: 20, message: 'Separando a bateria em bumbo, caixa, pratos e tons...' });
  const drums = await toStereo44k(input);
  const result = await bridge(encodeWavPcm24(drums) as ArrayBuffer);
  if (cancelled) throw new Error(CANCELLED);
  const ids = [['bumbo', 'Bumbo'], ['caixa', 'Caixa'], ['pratos', 'Pratos'], ['tons', 'Tons']] as const;
  const decoded = await Promise.all(ids.map(([id]) => decodeWav(result[id])));
  const parts: Part[] = [];
  decoded.forEach((buffer, i) => { if (buffer) parts.push({ stem: ids[i][0], parent: 'track-bateria', child: ids[i][1], buffer }); });
  if (!parts.length) throw new Error(result.why ? `a IA não separou a bateria (${result.why})` : 'a IA não separou a bateria');
  const room = roomResidual(drums, parts.map((p) => p.buffer));
  // só cria a Sala quando sobra som de verdade (acima de -30 dB da bateria)
  if (rms(room) > rms(drums) * 0.03) parts.push({ stem: 'sala', parent: 'track-bateria', child: 'Sala', buffer: room });
  return parts;
}

async function mixParts(clip: AudioClip, input: AudioBuffer, onProgress: (p: StemSplitProgress) => void): Promise<Part[]> {
  const bridge = window.vsDesktop?.separateStemsLocal;
  if (!bridge) throw new Error('a separação por IA é só do app do Mac');
  onProgress({ percent: 10, message: 'Separando os instrumentos com a IA...' });
  const unbind = window.vsDesktop?.onSeparationProgress?.((d) => {
    onProgress({ percent: Math.min(90, Math.max(10, d.percent || 0)), message: d.message || 'Separando os instrumentos com a IA...' });
  });
  let raw;
  try {
    const wav = encodeWavPcm24(await toStereo44k(input)) as ArrayBuffer;
    raw = await bridge(`${clip.name || 'audio'}.wav`, wav).catch((err) => {
      if (cancelled || /separation_cancelled/.test(String((err as Error)?.message ?? err))) throw new Error(CANCELLED);
      throw err;
    });
  } finally {
    unbind?.();
  }
  if (cancelled) throw new Error(CANCELLED);
  onProgress({ percent: 92, message: 'Conferindo o que cada parte tem...' });
  const [vocals, bass, drums, other, guitar, piano] = await Promise.all([
    decodeWav(raw.vocals), decodeWav(raw.bass), decodeWav(raw.drums), decodeWav(raw.other), decodeWav(raw.guitar), decodeWav(raw.piano),
  ]);
  const found: Array<{ stem: string; buffer: AudioBuffer | null }> = [
    { stem: 'vocals', buffer: vocals }, { stem: 'bass', buffer: bass }, { stem: 'drums', buffer: drums },
    { stem: 'guitar', buffer: guitar }, { stem: 'piano', buffer: piano }, { stem: 'other', buffer: other },
  ];
  // Só entram as partes com som de verdade: acima de -26 dB do áudio original. O resto é só
  // vazamento da IA (ex.: "voz" quase muda num áudio de guitarra).
  const floor = rms(input) * 0.05;
  const loud = found.filter((f): f is { stem: string; buffer: AudioBuffer } => !!f.buffer && rms(f.buffer) > floor);
  if (!loud.length) {
    const best = found.filter((f) => f.buffer).sort((a, b) => rms(b.buffer!) - rms(a.buffer!))[0];
    if (best?.buffer) loud.push({ stem: best.stem, buffer: best.buffer });
  }
  const parts: Part[] = [];
  for (const f of loud) {
    if (f.stem === 'vocals') parts.push({ ...f, parent: 'track-guia', child: 'Guia' });
    else if (f.stem === 'bass') parts.push({ ...f, parent: 'track-contrabaixo', child: 'Baixo' });
    else if (f.stem === 'drums') parts.push({ ...f, parent: 'track-bateria', child: 'Bateria' });
    else if (f.stem === 'piano') parts.push({ ...f, parent: 'track-teclados', child: 'Teclados' });
    else if (f.stem === 'other') parts.push({ ...f, parent: 'track-outros', child: 'Outros Instrumentos' });
    else if (f.stem === 'guitar') {
      if (cancelled) throw new Error(CANCELLED);
      onProgress({ percent: 95, message: 'Ouvindo se é guitarra ou violão...' });
      const heard = await classifyStem(f.buffer, `${clip.id}-split-guitar`);
      const acoustic = heard?.target === 'track-violoes';
      parts.push({ ...f, parent: acoustic ? 'track-violoes' : 'track-guitarras', child: acoustic ? 'Violões' : 'Guitarras' });
    }
  }
  return parts;
}

/** Nome base do clipe, sem o "- Bateria", "- Guitarras"... do fim. */
function baseName(name: string): string {
  return name.replace(/\s*\((original|Masterizado)[^)]*\)\s*$/i, '')
    .replace(/\s+-\s+(Bateria|Guitarras?|Violões|Viol[aã]o|Baixo|Teclados|Outros Instrumentos|Guia(?: \(Voz\))?)$/i, '')
    .trim() || 'Áudio';
}

/**
 * Separa o clipe em stems e põe cada um na faixa certa. Devolve os nomes das faixas que
 * receberam uma parte. Lança Error com mensagem em português; cancelado devolve [].
 */
export async function splitClipStems(clipId: string, onProgress: (p: StemSplitProgress) => void): Promise<string[]> {
  if (running) throw new Error('já há uma separação em andamento');
  const clip = useStore.getState().clips.find((c) => c.id === clipId);
  if (!clip) throw new Error('o clipe não foi encontrado');
  running = true;
  cancelled = false;
  try {
    onProgress({ percent: 3, message: `Preparando "${clip.name}"...` });
    const input = await clipInput(clip);
    const drum = isDrumClip(clip);
    const parts = drum ? await drumParts(input, onProgress) : await mixParts(clip, input, onProgress);
    if (cancelled) throw new Error(CANCELLED);

    onProgress({ percent: 97, message: 'Colocando cada parte na sua faixa...' });
    const name = baseName(clip.name);
    const store = useStore.getState();
    let created = 0;
    const names: string[] = [];
    for (const part of parts) {
      const trackId = trackForStem(part.parent, part.child);
      const id = `clip-${clip.songId}-split-${Date.now()}-${created}`;
      // Tudo — WAV, picos, áudio guardado e o campo do clipe — sai na taxa do dispositivo.
      // Antes o WAV e o áudio ficavam a 44,1 kHz enquanto o clipe dizia 48 kHz, e o worklet
      // tocava 8,8% rápido (deriva de 4.875 ms por minuto).
      const peca = await toDeviceRate(part.buffer);
      const wavBlob = new Blob([encodeWavPcm24(peca)], { type: 'audio/wav' });
      const peaks = audioEngine.generateWaveformPeaks(peca, Math.min(24000, Math.max(8000, Math.round(peca.duration * 100))));
      const newClip: AudioClip = {
        // mesma posição, cortes, fades e volume do original: a soma das partes toca igual a ele
        ...clip,
        id,
        trackId,
        name: `${name} - ${part.child}`,
        fileName: `${name} - ${part.child}.wav`,
        filePath: URL.createObjectURL(wavBlob),
        sampleRate: peca.sampleRate,
        channels: peca.numberOfChannels,
        markers: clip.markers?.length ? clip.markers : generateMarkers(clip.duration),
        routingMethod: 'ai',
        routingConfidence: 1,
        waveformPeaks: peaks,
        mute: false,
        solo: false,
        groupId: undefined,
      };
      registerClipSource(id, clip.songId, wavBlob);
      putClipAudio(id, clip.songId, await toClipAudioAsync(peca));
      store.addClip(newClip);
      names.push(part.child);
      created++;
    }
    // O original fica mudo (dá para apagar depois ou desligar o mudo para comparar). Se uma parte
    // caiu na mesma faixa dele (ex.: guitarra separada de um áudio de Guitarras), o original vai
    // para uma faixa "(original)" ao lado, na mesma pasta, para não ficar um clipe sobre o outro.
    const tracks = useStore.getState().tracks;
    const own = tracks.find((t) => t.id === clip.trackId);
    const sharesTrack = useStore.getState().clips.some((c) => c.id !== clip.id && c.trackId === clip.trackId
      && c.songId === clip.songId && c.id.includes('-split-') && c.startTime < clip.startTime + clip.duration && clip.startTime < c.startTime + c.duration);
    let originalTrack = clip.trackId;
    if (sharesTrack && own?.parentId) originalTrack = trackForStem(own.parentId, `${own.name} (original)`);
    store.updateClip(clip.id, { mute: true, trackId: originalTrack, name: `${baseName(clip.name)} (original)` });
    audioEngine.invalidatePrepared(clip.songId);
    return names;
  } catch (err) {
    if ((err as Error)?.message === CANCELLED || cancelled) return [];
    throw err;
  } finally {
    running = false;
  }
}

// ---------- Situação para a tela (painel de progresso) ----------

export type StemSplitStatus = {
  state: 'idle' | 'working' | 'done' | 'error';
  clipName: string;
  percent: number;
  message: string;
};

let status: StemSplitStatus = { state: 'idle', clipName: '', percent: 0, message: '' };
const listeners = new Set<() => void>();
function setStatus(next: StemSplitStatus) {
  status = next;
  listeners.forEach((l) => l());
}
export function subscribeStemSplit(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getStemSplitStatus(): StemSplitStatus { return status; }
export function dismissStemSplit(): void { setStatus({ ...status, state: 'idle' }); }

function listNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** Botão "Separar stems" do clique direito: roda a separação e mostra o andamento no painel. */
export async function startClipStemSplit(clipId: string): Promise<void> {
  const clip = useStore.getState().clips.find((c) => c.id === clipId);
  if (!clip || running) return;
  setStatus({ state: 'working', clipName: clip.name, percent: 0, message: 'Preparando o áudio...' });
  try {
    const names = await splitClipStems(clipId, (p) => setStatus({ ...status, percent: p.percent, message: p.message }));
    if (!names.length) { setStatus({ ...status, state: 'idle' }); return; }
    setStatus({
      state: 'done', clipName: clip.name, percent: 100,
      message: `Separado em ${names.length} ${names.length === 1 ? 'parte' : 'partes'}: ${listNames(names)}. O áudio original continua no projeto, mudo.`,
    });
  } catch (err) {
    setStatus({ state: 'error', clipName: clip.name, percent: 0, message: `Não deu para separar: ${(err as Error)?.message ?? String(err)}.` });
  }
}
