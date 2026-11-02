// Maestro por IA: o usuário marca um trecho na faixa Maestro, escreve o que quer que seja falado
// e o app gera a voz. No app do Mac a voz é a brasileira de IA (Qwen3-TTS: uma feminina e uma
// masculina, criadas por IA), gerada no próprio Mac, sem custo por uso. O modelo é baixado uma vez,
// em silêncio; até lá, em Mac Intel ou se ela falhar, o app usa a voz do sistema. No navegador não
// há como gerar (a tela avisa).
//
// O tamanho da marcação manda na velocidade: o mesmo texto falado num trecho mais curto sai mais
// rápido e num trecho mais longo, mais devagar — é assim que o maestro "segura" ou "acelera".
// O áudio vira um clipe na faixa "Maestro IA" (dentro do Maestro): sai na mesma saída do Maestro,
// não muda de tom com a música e é salvo junto com o projeto.
import { useStore } from '@/store';
import { getClipSource, putClipAudio, registerClipSource, toClipAudio, toClipAudioAsync } from '@/lib/audioLibrary';
import { processClipAudioAsync } from '@/lib/timeStretch';
import { audioEngine } from '@/lib/audioEngine';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { deviceSampleRate, generateMarkers } from '@/lib/audioDecoder';
import { friendlyError } from '@/lib/friendlyError';
import { FALLBACK_MARK, beatTimesFrom, clipPlacement, countWords, currentSignature, narrationSignature, pitchCents, sortedNarrations, wpmForSpan } from '@/lib/narrations';
import type { AudioClip, MaestroNarration, Song, VoicePitch } from '@/types';
import type { MaestroVoiceStatus } from '@/lib/localNetwork';

export interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  locale: string;
  /** 'qwen' = voz brasileira de IA; 'mac' = voz do sistema. */
  engine?: 'qwen' | 'mac';
}

/** Rótulo das vozes de IA padrão de cada gênero (a tela mostra junto do botão). */
export const IA_VOICE_NAMES: Record<'feminina' | 'masculina', string> = { feminina: 'IA', masculina: 'IA' };

/** Nome curto de uma voz ("Eddy (Português (Brasil))" → "Eddy"). */
export function shortVoiceName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim() || name;
}

/** Rótulo da voz escolhida numa marcação. */
export function voiceLabel(voice: string | undefined): string {
  if (!voice) return '—';
  if (voice === 'feminina') return 'Feminina';
  if (voice === 'masculina') return 'Masculina';
  if (voice === 'qwen:feminina') return 'Feminina';
  if (voice === 'qwen:masculina') return 'Masculina';
  return shortVoiceName(voice);
}

/**
 * Aviso sobre a voz brasileira de IA para a tela (null quando ela está pronta ou fora do app do
 * Mac). Enquanto o modelo baixa, a fala sai com a voz do Mac.
 */
export function iaStatusText(st: MaestroVoiceStatus | null): string | null {
  if (!st || st.ready) return null;
  if (!st.supported) return 'Neste Mac (Intel) a fala usa a voz do Mac: a voz brasileira de IA precisa de chip Apple.';
  if (!st.engine) return 'A voz brasileira de IA não veio completa nesta instalação: a fala usa a voz do Mac.';
  const pct = Math.round((st.model.progress ?? 0) * 100);
  switch (st.model.state) {
    case 'paused': return `Voz brasileira de IA: download pausado em ${pct}% enquanto a música toca. Até lá, a fala usa a voz do Mac.`;
    case 'error': return `Voz brasileira de IA: o download parou (${st.model.error ?? 'sem internet'}). O app tenta de novo sozinho; até lá, a fala usa a voz do Mac.`;
    case 'verifying': return 'Voz brasileira de IA: conferindo o download…';
    case 'missing': return 'Voz brasileira de IA: o download começa sozinho logo depois de abrir o app. Até lá, a fala usa a voz do Mac.';
    default: return `Voz brasileira de IA: baixando (${pct}%), uma vez só. Até lá, a fala usa a voz do Mac.`;
  }
}

// O download da voz pausa enquanto alguma música toca (não disputa a rede e o disco no show).
if (typeof window !== 'undefined' && window.vsDesktop?.maestroVoicePlaying) {
  let lastPlaying: boolean | null = null;
  const tell = (playing: boolean) => {
    if (playing === lastPlaying) return;
    lastPlaying = playing;
    void window.vsDesktop?.maestroVoicePlaying?.(playing).catch(() => {});
  };
  tell(useStore.getState().transport.isPlaying);
  useStore.subscribe((s) => tell(s.transport.isPlaying));
}

/** Situação da voz de IA no app do Mac (null no navegador). */
export async function voiceEngineStatus(): Promise<MaestroVoiceStatus | null> {
  const bridge = window.vsDesktop?.maestroVoiceStatus;
  if (!bridge) return null;
  try { return await bridge(); } catch { return null; }
}

let voiceCache: VoiceOption[] | null = null;

/** Vozes em português instaladas no Mac (vazio no navegador). */
export async function availableVoices(): Promise<VoiceOption[]> {
  if (voiceCache) return voiceCache;
  const bridge = window.vsDesktop?.maestroVoices;
  if (!bridge) return [];
  try {
    voiceCache = (await bridge()).filter((v) => /^pt/i.test(v.locale));
    return voiceCache;
  } catch {
    return [];
  }
}

/** Diz se dá para gerar voz neste ambiente. */
export function hasVoiceEngine(): boolean {
  return !!window.vsDesktop?.maestroSpeak;
}

/**
 * Onde o cursor está nesta música (segundos), como a linha do tempo mostra: tocando, anda com o
 * motor; parado, fica onde o usuário deixou. Null quando outra música está tocando.
 */
export function cursorTime(songId: string): number | null {
  const { transport } = useStore.getState();
  if (transport.isPlaying) {
    if (transport.currentSongId && transport.currentSongId !== songId) return null;
    return Math.max(0, audioEngine.getCurrentTime());
  }
  return Math.max(0, transport.currentTime);
}

/** A última voz escolhida vira o padrão das próximas marcações. */
const LAST_VOICE_KEY = 'vs-maestro-ia-voz';
export function lastVoice(): string {
  try { return localStorage.getItem(LAST_VOICE_KEY) || 'feminina'; } catch { return 'feminina'; }
}
export function rememberVoice(voice: string): void {
  try { localStorage.setItem(LAST_VOICE_KEY, voice); } catch { /* sem armazenamento: fica a padrão */ }
}

/** O último tom escolhido (grave, padrão, agudo) vira o padrão das próximas marcações. */
const LAST_PITCH_KEY = 'vs-maestro-ia-tom';
export function lastPitch(): VoicePitch | undefined {
  try {
    const v = localStorage.getItem(LAST_PITCH_KEY);
    return v === 'grave' || v === 'agudo' ? v : undefined;
  } catch { return undefined; }
}
export function rememberPitch(pitch: VoicePitch | undefined): void {
  try { localStorage.setItem(LAST_PITCH_KEY, pitch ?? 'padrao'); } catch { /* fica o padrão */ }
}

/**
 * Tira o pedacinho quieto que o esticador (SoundTouch) deixa na frente (até ~15 ms): o som tem de
 * começar justo na linha da grade.
 */
function trimLeadingSilence(buffer: AudioBuffer): AudioBuffer {
  const ch0 = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch0.length; i++) peak = Math.max(peak, Math.abs(ch0[i]));
  if (peak <= 0) return buffer;
  const limit = peak * 0.015;
  let first = 0;
  while (first < ch0.length && Math.abs(ch0[first]) < limit) first++;
  const from = Math.max(0, first - Math.round(buffer.sampleRate * 0.001));
  if (from < buffer.sampleRate * 0.002 || from >= buffer.length) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, 1, buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length - from, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(from), c);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bytes do WAV → AudioBuffer, já na taxa de amostragem da saída de áudio.
 * O tocador da faixa lê as amostras na taxa da placa, sem converter: a fala guardada em 44,1 kHz
 * numa saída de 48 kHz tocava 9% mais rápida e 1,5 semitom mais aguda (o "Padrão" não soava como
 * a voz original). A pré-escuta convertia certo, por isso só a faixa saía diferente.
 */
async function decodeWavBytes(bytes: Uint8Array): Promise<AudioBuffer> {
  // cópia em ArrayBuffer próprio: o decodificador exige ArrayBuffer, não a view
  const raw = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(raw).set(bytes);
  // contexto offline: decodifica (e converte a taxa) sem abrir a placa de som
  const rate = audioEngine.currentSampleRate() ?? deviceSampleRate();
  const ctx = new OfflineAudioContext(1, 1, rate);
  return ctx.decodeAudioData(raw);
}

/** Tira o "Error invoking remote method..." que o app do Mac põe na frente da mensagem. */
function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return friendlyError(new Error(msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/i, '')), 'Não foi possível gerar a voz.');
}

export interface SpeechResult {
  buffer: AudioBuffer;
  wpm: number;
  voiceName: string;
  note: string | null;
  /** A fala não coube na marcação nem no ritmo máximo do motor. */
  overflow: boolean;
  /** Qual motor falou: a voz de IA ou a voz do Mac (reserva). */
  engine: 'qwen' | 'mac';
}

/**
 * Gera o áudio de uma fala (sem gravar nada no projeto).
 * `pace`: velocidade fixa (contagem); sem ele, o tamanho da marcação define a velocidade.
 */
export async function synthesize(text: string, voice: string, span: number, pace?: number, group?: string[], pitch?: VoicePitch): Promise<SpeechResult> {
  const speak = window.vsDesktop?.maestroSpeak;
  if (!speak) throw new Error('A voz do Maestro por IA só funciona no app do Mac.');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Escreva o texto que o maestro deve falar.');
  let out;
  try {
    out = await speak({ text: trimmed, voice, wpm: wpmForSpan(trimmed, span), span, pace, group });
  } catch (err) {
    throw new Error(cleanError(err));
  }
  let buffer = await decodeWavBytes(base64ToBytes(out.wavBase64));
  // A voz de IA vem na velocidade natural: aqui ela é esticada (sem mudar o tom) para caber na
  // marcação ou na velocidade da contagem.
  // O tom (grave/agudo) muda junto, sem mudar a velocidade.
  const tempo = Number(out.tempo) || 1;
  const cents = pitchCents(pitch);
  if (Math.abs(tempo - 1) > 0.005 || cents !== 0) {
    const ctx = new OfflineAudioContext(1, 1, buffer.sampleRate);
    buffer = trimLeadingSilence(await processClipAudioAsync(ctx, toClipAudio(buffer), 1 / tempo, cents));
  }
  return {
    buffer, wpm: out.rate, voiceName: out.voice, note: out.note ?? null, overflow: !!out.overflow,
    engine: out.engine ?? 'mac',
  };
}

// ---------------------------------------------------------------------------------------------
// Pré-escuta: toca a fala sem passar pelo mixer.

let previewCtx: AudioContext | null = null;
let previewSource: AudioBufferSourceNode | null = null;
/** Último áudio gerado de cada marcação (para ouvir sem decodificar de novo). */
const lastBuffers = new Map<string, AudioBuffer>();

export function stopPreview(): void {
  if (previewSource) {
    try { previewSource.stop(); } catch { /* já parou */ }
    previewSource = null;
  }
}

/** Toca o áudio e avisa quando acabar. */
export function playPreview(buffer: AudioBuffer, onEnd?: () => void): void {
  stopPreview();
  try {
    if (!previewCtx) previewCtx = new AudioContext();
    void previewCtx.resume();
    const src = previewCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(previewCtx.destination);
    src.onended = () => {
      if (previewSource === src) previewSource = null;
      onEnd?.();
    };
    src.start();
    previewSource = src;
  } catch {
    onEnd?.();
  }
}

/** O áudio que já está na faixa para esta marcação (da memória ou do arquivo salvo). */
export async function narrationBuffer(n: MaestroNarration): Promise<AudioBuffer | null> {
  const cached = lastBuffers.get(n.id);
  if (cached && n.clipId) return cached;
  const src = n.clipId ? getClipSource(n.clipId) : null;
  if (!src) return null;
  try {
    const buffer = await decodeWavBytes(new Uint8Array(await src.arrayBuffer()));
    lastBuffers.set(n.id, buffer);
    return buffer;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Estado de cada marcação

/**
 * 'fresh' = o áudio na faixa é exatamente o que a marcação pede (texto, voz e tamanho);
 * 'stale' = falta gerar ou mudou algo; 'missing' = foi gerado mas o áudio sumiu do projeto.
 */
export function narrationState(n: MaestroNarration): 'fresh' | 'stale' | 'missing' {
  if (n.status !== 'ready' || !n.clipId) return 'stale';
  if (!useStore.getState().clips.some((c) => c.id === n.clipId) || !getClipSource(n.clipId)) return 'missing';
  return n.sig === currentSignature(n) ? 'fresh' : 'stale';
}

/** Quanto (s) a voz gerada passa do fim da marcação (texto longo demais para o espaço). */
export function narrationOverflows(n: MaestroNarration): number {
  const extra = (n.audioDuration ?? 0) - (n.end - n.start);
  return extra > 0.05 ? extra : 0;
}

// ---------------------------------------------------------------------------------------------
// Geração: uma por marcação de cada vez. Pediu de novo no meio, gera outra vez no fim
// (com o texto, a voz e o tamanho que estiverem valendo). Quem está gerando fica só na memória:
// não entra no projeto salvo nem no desfazer.

const running = new Map<string, Promise<SpeechResult | null>>();
const again = new Set<string>();
const timers = new Map<string, number>();
const listeners = new Set<() => void>();
let generatingVersion = 0;

function notify() {
  generatingVersion++;
  listeners.forEach((cb) => cb());
}

/** Para a tela acompanhar quais falas estão sendo geradas (useSyncExternalStore). */
export function subscribeGenerating(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function generatingSnapshot(): number {
  return generatingVersion;
}
export function isGenerating(narrationId: string): boolean {
  return running.has(narrationId) || timers.has(narrationId);
}

function findNarration(songId: string, narrationId: string): MaestroNarration | undefined {
  return useStore.getState().songs.find((s) => s.id === songId)?.narrations?.find((n) => n.id === narrationId);
}

/** Gera a fala da marcação e coloca o áudio na faixa Maestro IA. */
export function generateNarration(songId: string, narrationId: string): Promise<SpeechResult | null> {
  const timer = timers.get(narrationId);
  if (timer) { window.clearTimeout(timer); timers.delete(narrationId); }
  const current = running.get(narrationId);
  if (current) { again.add(narrationId); return current; }
  const job = (async () => {
    try {
      return await generateOnce(songId, narrationId);
    } finally {
      running.delete(narrationId);
      notify();
      if (again.delete(narrationId)) {
        const n = findNarration(songId, narrationId);
        if (n && n.text.trim() && narrationState(n) !== 'fresh') void generateNarration(songId, narrationId).catch(() => {});
      }
    }
  })();
  running.set(narrationId, job);
  notify();
  return job;
}

/**
 * Gera daqui a pouco (depois de arrastar a borda ou fechar o editor): várias mudanças seguidas
 * viram uma geração só.
 */
export function scheduleGeneration(songId: string, narrationId: string, delayMs = 400): void {
  if (!hasVoiceEngine()) return;
  const n = findNarration(songId, narrationId);
  if (!n || !n.text.trim() || narrationState(n) === 'fresh') return;
  const old = timers.get(narrationId);
  if (old) window.clearTimeout(old);
  timers.set(narrationId, window.setTimeout(() => {
    timers.delete(narrationId);
    const now = findNarration(songId, narrationId);
    if (now && now.text.trim() && narrationState(now) !== 'fresh') void generateNarration(songId, narrationId).catch(() => {});
    else notify();
  }, delayMs));
  notify();
}

/** As palavras de uma contagem, na ordem em que tocam ("Um!", "Dois!"...). */
function countGroupWords(songId: string, group: string): string[] {
  const song = useStore.getState().songs.find((s) => s.id === songId);
  return sortedNarrations((song?.narrations ?? []).filter((x) => x.countGroup === group)).map((x) => x.text.trim()).filter(Boolean);
}

async function generateOnce(songId: string, narrationId: string): Promise<SpeechResult | null> {
  const n = findNarration(songId, narrationId);
  if (!n || !n.text.trim()) return null;
  const text = n.text.trim();
  const voice = n.voice;
  const span = n.end - n.start;
  const pace = n.pace;
  // contagem: as palavras do grupo vão juntas (a voz fala a contagem de uma vez, no mesmo tom)
  const group = n.countGroup ? countGroupWords(songId, n.countGroup) : undefined;
  const pitch = n.pitch;
  let result: SpeechResult;
  try {
    result = await synthesize(text, voice, span, pace, group, pitch);
  } catch (err) {
    if (findNarration(songId, narrationId)) {
      useStore.getState().updateNarration(songId, narrationId, { status: 'error', error: friendlyError(err, 'Não foi possível gerar a voz.') });
    }
    throw err;
  }
  // a marcação pode ter sido apagada enquanto a voz era gerada: aí não grava nada
  if (!findNarration(songId, narrationId)) return null;
  // feita com a voz do Mac no lugar da de IA: fica marcada para gerar de novo quando a de IA puder
  const fallback = result.engine === 'mac' && (voice === 'feminina' || voice === 'masculina');
  await applyNarration(songId, narrationId, result, narrationSignature(text, voice, span, pace, pitch) + (fallback ? FALLBACK_MARK : ''));
  lastBuffers.set(narrationId, result.buffer);
  return result;
}

/**
 * Grava a fala na faixa Maestro IA como um clipe no início da marcação (onde ela estiver agora:
 * se foi arrastada durante a geração, o áudio entra no lugar novo). O clipe antigo sai no mesmo
 * passo, para regerar não duplicar o áudio.
 */
async function applyNarration(songId: string, narrationId: string, result: SpeechResult, sig: string): Promise<void> {
  const { buffer } = result;
  const clipAudio = await toClipAudioAsync(buffer);
  const store = useStore.getState();
  const n = findNarration(songId, narrationId);
  if (!n) return;
  const trackId = store.ensureMaestroIaTrack();
  const duration = Math.max(0.1, buffer.duration);
  const wavBlob = new Blob([encodeWavInt16(clipAudio)], { type: 'audio/wav' });
  const clipId = `clip-maestro-ia-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

  const clip: AudioClip = {
    id: clipId,
    trackId,
    name: `Maestro IA: ${n.text.trim().slice(0, 50)}`,
    fileName: `maestro_ia_${Date.now()}.wav`,
    filePath: URL.createObjectURL(wavBlob),
    songId,
    ...clipPlacement(n.start),
    duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    bpm: null,
    markers: generateMarkers(duration),
    routingMethod: 'manual',
    routingConfidence: 1,
    waveformPeaks: audioEngine.generateWaveformPeaks(buffer, 400),
    gain: 1,
    mute: false,
    solo: false,
  };

  registerClipSource(clipId, songId, wavBlob);
  putClipAudio(clipId, songId, clipAudio);
  useStore.getState().setNarrationAudio(songId, narrationId, clip, {
    status: 'ready',
    error: undefined,
    sig,
    audioDuration: duration,
    voiceName: result.voiceName,
    rate: result.wpm,
    note: result.note ?? undefined,
  });
  audioEngine.invalidatePrepared(songId);
}

// ---------------------------------------------------------------------------------------------
// Mexer nas marcações sem perder o encaixe na grade (cada ação é um passo só do desfazer)

/** Move (ou estica) a marcação; o áudio vai junto, começando no início dela. */
export function moveNarration(songId: string, narrationId: string, patch: { start?: number; end?: number }): void {
  useStore.setState((s) => {
    const song = s.songs.find((sg) => sg.id === songId);
    const n = song?.narrations?.find((x) => x.id === narrationId);
    if (!song || !n) return s;
    const next = { ...n, ...patch };
    const place = n.clipId && patch.start !== undefined ? clipPlacement(next.start) : null;
    return {
      songs: s.songs.map((sg) => (sg.id === songId
        ? { ...sg, narrations: sortedNarrations((sg.narrations ?? []).map((x) => (x.id === narrationId ? next : x))) }
        : sg)),
      ...(place ? { clips: s.clips.map((c) => (c.id === n.clipId ? { ...c, ...place } : c)) } : {}),
    };
  });
}

/** Gera várias falas uma depois da outra (uma contagem inteira, por exemplo). */
export async function generateMany(songId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    try { await generateNarration(songId, id); } catch { /* o erro fica na marcação */ }
  }
}

export interface CountInOptions {
  /** Onde a contagem começa (é encaixado no tempo da grade). */
  start: number;
  /** Quantos tempos (um número por tempo). */
  total: number;
  /** 1-2-3-4, 1-2-3-4 em vez de 1 a 8. */
  restartEachBar: boolean;
  voice: string;
  /** Velocidade da voz (1 = natural). */
  pace: number;
  /** Tom da voz (sem valor = padrão). */
  pitch?: VoicePitch;
}

/** As marcações de uma contagem, em ordem. */
export function countGroupItems(song: Song, group: string): MaestroNarration[] {
  return sortedNarrations((song.narrations ?? []).filter((n) => n.countGroup === group));
}

/**
 * Cria a contagem: uma marcação por tempo da grade ("Um!", "Dois!"...), cada uma começando
 * exatamente no click. Uma contagem antiga no mesmo trecho é trocada pela nova; falas comuns
 * no caminho impedem (para não apagar o que o usuário escreveu).
 */
export function createCountIn(song: Song, opts: CountInOptions): { ids: string[] } | { error: string } {
  const times = beatTimesFrom(song, opts.start, opts.total + 1);
  if (times.length < opts.total + 1) return { error: 'A música precisa ter BPM (a grade) para fazer a contagem.' };
  const from = times[0];
  const to = times[opts.total];
  if (to > song.duration + 1e-6) return { error: 'A contagem passaria do fim da música. Comece mais cedo ou use menos tempos.' };
  const inRange = (song.narrations ?? []).filter((n) => n.end > from + 1e-6 && n.start < to - 1e-6);
  const blocking = inRange.filter((n) => !n.countGroup);
  if (blocking.length > 0) {
    return { error: `Já há ${blocking.length === 1 ? 'uma fala' : `${blocking.length} falas`} nesse trecho. Mova ou apague antes de pôr a contagem.` };
  }
  const group = `contagem-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const words = countWords(opts.total, song.beatsPerBar ?? 4, opts.restartEachBar);
  const items: MaestroNarration[] = words.map((text, i) => ({
    id: `${group}-${i + 1}`,
    text,
    voice: opts.voice,
    start: times[i],
    end: times[i + 1],
    status: 'pending',
    pace: opts.pace,
    ...(opts.pitch ? { pitch: opts.pitch } : {}),
    countGroup: group,
  }));
  const replaced = new Set(inRange.map((n) => n.id));
  const oldClips = new Set(inRange.map((n) => n.clipId).filter((id): id is string => !!id));
  useStore.setState((s) => ({
    songs: s.songs.map((sg) => (sg.id === song.id
      ? { ...sg, narrations: sortedNarrations([...(sg.narrations ?? []).filter((n) => !replaced.has(n.id)), ...items]) }
      : sg)),
    clips: oldClips.size ? s.clips.filter((c) => !oldClips.has(c.id)) : s.clips,
  }));
  return { ids: items.map((n) => n.id) };
}

/** Troca a voz e/ou a velocidade da contagem inteira (depois é só gerar de novo). */
export function updateCountGroup(songId: string, group: string, patch: { voice?: string; pace?: number; pitch?: VoicePitch }): string[] {
  const ids: string[] = [];
  useStore.setState((s) => ({
    songs: s.songs.map((sg) => (sg.id !== songId ? sg : {
      ...sg,
      narrations: (sg.narrations ?? []).map((n) => {
        if (n.countGroup !== group) return n;
        ids.push(n.id);
        return { ...n, ...patch };
      }),
    })),
  }));
  return ids;
}

/** Apaga a contagem inteira (as marcações e o áudio delas). */
export function removeCountGroup(songId: string, group: string): void {
  useStore.setState((s) => {
    const song = s.songs.find((sg) => sg.id === songId);
    const members = (song?.narrations ?? []).filter((n) => n.countGroup === group);
    const clips = new Set(members.map((n) => n.clipId).filter((id): id is string => !!id));
    return {
      songs: s.songs.map((sg) => (sg.id !== songId ? sg : { ...sg, narrations: (sg.narrations ?? []).filter((n) => n.countGroup !== group) })),
      clips: s.clips.filter((c) => !clips.has(c.id)),
      selectedClipIds: s.selectedClipIds.filter((id) => !clips.has(id)),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Falas desatualizadas da música aberta (feitas com outra voz: Kokoro, voz do Mac de reserva)
// são geradas de novo sozinhas, uma de cada vez, para tudo sair no mesmo tom. Só quando a voz de
// IA está pronta e nenhuma música toca; uma fala que deu erro não é tentada de novo nesta sessão.

const refreshFailed = new Set<string>();
let refreshing = false;

function nextStale(): { songId: string; id: string } | null {
  const st = useStore.getState();
  if (st.transport.isPlaying) return null;
  const song = st.songs.find((s) => s.id === st.selectedSongId);
  for (const n of sortedNarrations(song?.narrations ?? [])) {
    if (!n.text.trim() || refreshFailed.has(n.id) || isGenerating(n.id)) continue;
    if (narrationState(n) !== 'fresh') return { songId: song!.id, id: n.id };
  }
  return null;
}

async function refreshStale(): Promise<void> {
  if (refreshing || !nextStale()) return;
  const st = await voiceEngineStatus();
  if (!st?.ready) return;
  refreshing = true;
  try {
    for (let next = nextStale(); next; next = nextStale()) {
      try {
        await generateNarration(next.songId, next.id);
      } catch {
        refreshFailed.add(next.id);
      }
      const n = findNarration(next.songId, next.id);
      if (n && narrationState(n) !== 'fresh') refreshFailed.add(next.id); // não ficou boa: não insiste
    }
  } finally {
    refreshing = false;
  }
}

if (typeof window !== 'undefined' && window.vsDesktop?.maestroSpeak) {
  window.setInterval(() => { void refreshStale(); }, 10_000);
}
