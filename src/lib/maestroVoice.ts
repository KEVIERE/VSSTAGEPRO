// Maestro por IA: o usuário marca um trecho na faixa Maestro, escreve o que quer que seja falado
// e o app gera a voz.
// - Voz Maestro IA (id pronta:felipe): as falas prontas gravadas em estúdio (src/lib/maestroCues.ts),
//   oferecida no "+" e na contagem. Fala ainda sem gravação sai na voz do Mac do mesmo gênero. A
//   antiga Bianca (pronta:moca) saiu das telas, mas marcações antigas continuam tocando.
// - Vozes clonadas ("clone:<pasta>", com os modos "clone:<pasta>:calma" e "clone:<pasta>:forte"):
//   geradas pelo mesmo motor de IA, com a gravação do próprio diretor como referência.
// - Feminina e Masculina saíram das telas: marcações antigas mantêm o áudio e o rótulo. O motor de
//   IA (Qwen3-TTS) roda no próprio Mac, sem custo por uso; a voz do sistema é só reserva interna.
// - Vozes online (src/lib/onlineVoices.ts): pacotes de vozes GRATUITAS da internet, geradas pelo app
//   do Mac. Precisam de internet. Nada pago: as vozes pagas saíram em 02/11/2026.
//
// O tamanho da marcação manda na velocidade: a fala que não cabe acelera; na contagem, a velocidade
// é a escolhida. O áudio vira um clipe na faixa "Maestro IA" (dentro do Maestro): sai na mesma saída
// do Maestro, não muda de tom com a música e é salvo junto com o projeto. Toda fala começa JUSTO no
// primeiro som (src/lib/speechTrim.ts), para cair na linha da grade junto com o click.
import { useStore } from '@/store';
import { forgetOnlineStatus, synthesizeOnline } from '@/lib/maestroCloud';
import { ONLINE_DEFAULT, ONLINE_PACKS, isOnlineVoice, onlineVoiceById, onlineVoiceLabel } from '@/lib/onlineVoices';
import { attackOffset, monoMix, trimSpeechChannels } from '@/lib/speechTrim';
import { clipPlayLength, getClipSource, putClipAudio, registerClipSource, toClipAudio, toClipAudioAsync } from '@/lib/audioLibrary';
import { processClipAudioAsync } from '@/lib/timeStretch';
import { audioEngine } from '@/lib/audioEngine';
import { engineLatencyHint } from '@/lib/engineLatency';
import { masterAudioClip } from '@/lib/clipMastering';
import { encodeWavInt16 } from '@/lib/wavEncoder';
import { deviceSampleRate, generateMarkers } from '@/lib/audioDecoder';
import { friendlyError } from '@/lib/friendlyError';
import { FALLBACK_MARK, beatTimesFrom, clipPlacement, countWords, crossesTempoChange, currentSignature, fitTempo, isCountPackWord, narrationSignature, pitchCents, sortedNarrations, wpmForSpan } from '@/lib/narrations';
import type { AudioClip, MaestroNarration, Song, VoicePitch } from '@/types';
import type { MaestroVoiceStatus } from '@/lib/localNetwork';
import { DEFAULT_READY_VOICE, READY_INTENSITIES, findReadyCue, offeredReadyVoices, readyCueSource, setVoicePacks, voiceHasCue, voicePackRevision, voiceSampleTexts, wordsMissingInVoice, readyVoice, voiceFromOldChoice, type ReadyCue, type ReadyVoiceChoice } from '@/lib/maestroCues';

/** Voz pronta padrão (a da contagem): o Maestro, id pronta:felipe. */
export const DEFAULT_VOICE = DEFAULT_READY_VOICE;

/** Voz das marcações novas do "+" quando nada foi escolhido ainda: o Maestro IA. */
export const DEFAULT_PLUS_VOICE = DEFAULT_READY_VOICE;

/** Nome curto de uma voz ("Eddy (Português (Brasil))" → "Eddy"). */
export function shortVoiceName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '').trim() || name;
}

/** A voz é uma das padrão (os botões Feminina/Masculina)? */
export function isPresetVoice(voice: string | undefined): boolean {
  // 'henrique' foi apagada: marcação antiga nela fala com a Masculina, como uma voz padrão
  return voice === 'feminina' || voice === 'masculina' || voice === 'henrique';
}

/** Voz clonada pelo diretor ("clone:<pasta>", "clone:<pasta>:calma" ou "clone:<pasta>:forte")? */
export function isCloneVoice(voice: string | undefined): boolean {
  return typeof voice === 'string' && /^clone:[^:]+(:(normal|calma|forte))?$/.test(voice);
}

/** Modo de fala de uma voz clonada (cada um gravado à parte). */
export type CloneMode = 'normal' | 'calma' | 'forte';

/** Id da voz clonada sem o modo ("clone:ana:forte" vira "clone:ana"). */
export function cloneBaseId(voice: string): string {
  const [, slug] = voice.split(':');
  return `clone:${slug ?? ''}`;
}

/** Modo pedido no id da voz clonada (sem modo é o normal). */
export function cloneMode(voice: string): CloneMode {
  const level = voice.split(':')[2];
  return level === 'calma' || level === 'forte' ? level : 'normal';
}

/** Id da voz clonada num modo ("clone:ana" + forte = "clone:ana:forte"; normal fica sem sufixo). */
export function cloneVoiceId(base: string, mode: CloneMode): string {
  const id = cloneBaseId(base);
  return mode === 'normal' ? id : `${id}:${mode}`;
}

/** Voz que fala pelo motor de IA (as padrão e as clonadas): sem ele, sai com a voz do sistema. */
export function isIaVoice(voice: string | undefined): boolean {
  return isPresetVoice(voice) || isCloneVoice(voice);
}

/** Nome das vozes clonadas, para o rótulo das marcações (a tela atualiza ao abrir o seletor). */
const cloneNames = new Map<string, string>();
/** Vozes clonadas que existem hoje (null até a lista chegar): a última voz não volta para uma apagada. */
let existingClones: Set<string> | null = null;
export function rememberCloneNames(list: Array<{ id: string; name: string }>): void {
  for (const v of list) cloneNames.set(cloneBaseId(v.id), v.name);
  existingClones = new Set(list.map((v) => cloneBaseId(v.id)));
}

/** A voz aparece nas telas de escolha? (Maestro IA nas três intensidades e as vozes clonadas) */
export function isOfferedVoice(voice: string | undefined): boolean {
  // voz clonada apagada deixa de ser oferecida assim que a lista chega: a marcação mantém o áudio
  if (isCloneVoice(voice)) return !existingClones || existingClones.has(cloneBaseId(voice as string));
  const ready = readyVoice(voice);
  return !!ready && offeredReadyVoices().some((v) => v.dir === ready.dir);
}

/** Pode ser a voz inicial: oferecida e, se for clonada, ainda existe. */
function usableVoice(voice: string | null | undefined): voice is string {
  return !!voice && isOfferedVoice(voice);
}
if (typeof window !== 'undefined' && window.vsDesktop?.maestroCloneList) {
  void window.vsDesktop.maestroCloneList().then(rememberCloneNames).catch(() => {});
}

/** Pede ao programa do computador os pacotes de voz instalados (só listas, nenhum áudio). */
export async function refreshVoicePacks(changedVoice?: string): Promise<void> {
  if (changedVoice) packsChanged.add(changedVoice);
  const status = window.vsDesktop?.maestroPackStatus;
  if (!status) return;
  const mine = ++packsRead;
  try {
    const list = await status();
    // chegou uma leitura mais nova enquanto esta voltava: ela é que vale
    if (mine !== packsRead) return;
    setVoicePacks(list, [...packsChanged]);
    packsChanged.clear();
  } catch { /* sem status: ficam as vozes embutidas */ }
}
const packsChanged = new Set<string>();
let packsRead = 0;
if (typeof window !== 'undefined') {
  void refreshVoicePacks();
  // o avanço do download não relê nada: só quando a voz fica pronta (ou deixa de estar)
  const packStates = new Map<string, string>();
  window.vsDesktop?.onMaestroPackProgress?.((p) => {
    const before = packStates.get(p.voice);
    packStates.set(p.voice, p.state);
    if (p.state === 'pronto' || before === 'pronto') void refreshVoicePacks(p.voice);
  });
}

/** Rótulo da voz escolhida numa marcação. */
export function voiceLabel(voice: string | undefined): string {
  if (!voice) return '—';
  if (isCloneVoice(voice)) {
    const name = cloneNames.get(cloneBaseId(voice)) ?? 'Voz clonada';
    const mode = cloneMode(voice);
    return mode === 'normal' ? name : `${name} ${mode}`;
  }
  if (voice === 'feminina') return 'Feminina';
  if (voice === 'masculina') return 'Masculina';
  const ready = readyVoice(voice);
  if (ready) {
    const level = READY_INTENSITIES.find((x) => x.id === ready.intensity);
    return ready.intensity === 'normal' || !level ? ready.label : `${ready.label} ${level.label.toLowerCase()}`;
  }
  // vozes que saíram do seletor: marcações antigas continuam mostrando o nome que tinham
  // Cubas, Keven e Henrique foram apagadas: marcação antiga nelas fala com a Masculina
  if (/^(qwen:)?(cubas|keven|henrique)$/.test(voice)) return 'Masculina';
  if (voice === 'qwen:feminina') return 'Feminina';
  if (voice === 'qwen:masculina') return 'Masculina';
  const online = onlineVoiceLabel(voice);
  if (online) return online;
  return shortVoiceName(voice);
}

/**
 * Aviso sobre a voz brasileira de IA para a tela (null quando ela está pronta ou fora do app do
 * Mac). Enquanto o modelo baixa, a fala sai com a voz do Mac.
 */
export function iaStatusText(st: MaestroVoiceStatus | null): string | null {
  if (!st || st.ready) return null;
  if (!st.supported) {
    return 'Neste Mac (Intel) as vozes clonadas não são geradas: a fala usa a voz do Mac, que soa robótica.';
  }
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

/** O mesmo aviso para fala clonada, que nunca troca pela voz do Mac: fica só o motivo. */
export function iaBlockedText(st: MaestroVoiceStatus | null): string | null {
  return iaStatusText(st)?.replace(/(?:[:;.]\s*)?(?:até lá, )?a fala usa a voz do Mac(?:, que soa robótica)?\./i, '.') ?? null;
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

/** Situação da voz de IA do próprio Mac (as vozes padrão). Null no navegador. */
export async function voiceEngineStatus(): Promise<MaestroVoiceStatus | null> {
  const bridge = window.vsDesktop?.maestroVoiceStatus;
  if (!bridge) return null;
  try { return await bridge(); } catch { return null; }
}

/** Esquece o que está guardado (depois de entrar ou sair da conta): as vozes online são conferidas de novo. */
export function forgetVoices(): void {
  forgetOnlineStatus();
}

/** Diz se dá para gerar as vozes padrão neste ambiente (só no app do Mac). */
export function hasVoiceEngine(): boolean {
  return !!window.vsDesktop?.maestroSpeak;
}

/** Dá para gerar esta voz aqui? As online funcionam em qualquer lugar com internet e conta. */
export function canGenerate(voice: string | undefined): boolean {
  return isOnlineVoice(voice) || !!readyVoice(voice) || hasVoiceEngine();
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

/**
 * A última voz escolhida vira o padrão das próximas marcações. A chave mudou quando as vozes
 * prontas viraram as padrão: a escolha guardada antes passa por voiceFromOldChoice. A contagem
 * guarda a voz dela à parte (lastCountVoice).
 */
const LAST_VOICE_KEY = 'vs-maestro-ia-voz-2';
const OLD_VOICE_KEY = 'vs-maestro-ia-voz';
function storedVoice(): string {
  let v: string | null = null;
  let old: string | null = null;
  try {
    v = localStorage.getItem(LAST_VOICE_KEY);
    if (!v) old = localStorage.getItem(OLD_VOICE_KEY);
  } catch { /* sem armazenamento: fica a padrão */ }
  if (v) return v;
  return voiceFromOldChoice(old, (x) => !!onlineVoiceById(x));
}

/** A voz é oferecida no "+"? (Maestro IA e as clonadas) */
export function isPlusVoice(voice: string | undefined): boolean {
  return isOfferedVoice(voice);
}

/** Voz inicial do "+": a última escolhida, se ainda é oferecida; senão, o Maestro IA. */
export function lastVoice(): string {
  const v = storedVoice();
  return usableVoice(v) ? v : DEFAULT_PLUS_VOICE;
}
export function rememberVoice(voice: string): void {
  try { localStorage.setItem(LAST_VOICE_KEY, voice); } catch { /* sem armazenamento: fica a padrão */ }
}

/** Voz da contagem: a última escolhida (Maestro IA numa intensidade ou voz clonada que ainda existe). */
const LAST_COUNT_VOICE_KEY = 'vs-maestro-ia-voz-contagem';
export function lastCountVoice(): string {
  let v: string | null = null;
  try { v = localStorage.getItem(LAST_COUNT_VOICE_KEY); } catch { /* fica a padrão */ }
  return usableVoice(v) ? v : DEFAULT_READY_VOICE;
}
export function rememberCountVoice(voice: string): void {
  try { localStorage.setItem(LAST_COUNT_VOICE_KEY, voice); } catch { /* fica a padrão */ }
}

/**
 * Deixa o motor de voz de IA quente para esta voz (abre o programa e lê a referência), para a
 * próxima fala sair na hora. Vale por 5 minutos a partir do último aviso. Nunca dá erro.
 */
export function warmVoice(voice: string | undefined): void {
  if (!voice || !isCloneVoice(voice)) return;
  try { void window.vsDesktop?.maestroWarm?.(voice)?.catch?.(() => {}); } catch { /* sem motor: nada a fazer */ }
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
 * Último passo de toda fala, de qualquer voz: o clipe passa a começar na amostra em que a palavra
 * começa (sem silêncio, respiração ou resto da palavra anterior na frente) e termina com um respiro
 * curto. É isso que faz a contagem cair junto com o click. `singleWord`: um número da contagem.
 */
function tightenSpeech(buffer: AudioBuffer, singleWord: boolean): AudioBuffer {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const trimmed = trimSpeechChannels(channels, buffer.sampleRate, { singleWord });
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, 1, buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, Math.max(1, trimmed[0].length), buffer.sampleRate);
  trimmed.forEach((ch, c) => out.getChannelData(c).set(ch));
  return out;
}

/**
 * Tira só o silêncio real que o esticador deixa na frente (abaixo de -60 dB). Não usa o corte da
 * fala, que olha a força da voz e cortaria uma consoante fraca já aparada pelo motor.
 */
function dropLeadingSilence(buffer: AudioBuffer): AudioBuffer {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  let start = 0;
  while (start < buffer.length && channels.every((ch) => Math.abs(ch[start]) < 0.001)) start++;
  if (start === 0 || start >= buffer.length) return buffer;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, 1, buffer.sampleRate);
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length - start, buffer.sampleRate);
  channels.forEach((ch, c) => out.getChannelData(c).set(ch.subarray(start)));
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Bytes do áudio (WAV ou MP3) → AudioBuffer, já na taxa de amostragem da saída de áudio.
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
  /** Qual motor falou: a voz de IA do Mac, uma voz online, a voz do Mac (reserva) ou uma fala pronta. */
  engine: 'qwen' | 'online' | 'mac' | 'pronta';
  /** A voz de IA está sendo gerada em segundo plano (processador): esta é a de reserva. */
  preparing?: boolean;
  /** Contagem: segundos do começo do áudio até o ataque do número (o clipe recua esse tanto). */
  lead?: number;
}

/**
 * Falas prontas já abertas nesta sessão (por taxa da placa, voz, intensidade e fala). O limite em
 * bytes protege o Mac de 8 GB: as menos usadas saem da memória e voltam do arquivo em milissegundos.
 */
const READY_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const readyCache = new Map<string, AudioBuffer>();
let readyCacheBytes = 0;
const bufferBytes = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;

function readyCacheGet(key: string): AudioBuffer | undefined {
  const hit = readyCache.get(key);
  if (hit) { readyCache.delete(key); readyCache.set(key, hit); }
  return hit;
}

function readyCachePut(key: string, buffer: AudioBuffer): void {
  const old = readyCache.get(key);
  if (old) { readyCacheBytes -= bufferBytes(old); readyCache.delete(key); }
  readyCache.set(key, buffer);
  readyCacheBytes += bufferBytes(buffer);
  for (const [k, b] of readyCache) {
    if (readyCacheBytes <= READY_CACHE_MAX_BYTES || k === key) break;
    readyCache.delete(k);
    readyCacheBytes -= bufferBytes(b);
  }
}

const readyRate = () => audioEngine.currentSampleRate() ?? deviceSampleRate();

// a chave é o arquivo de verdade: pacote novo ou modo que chegou não reaproveita o áudio antigo
const readyFileKey = (voice: ReadyVoiceChoice, cue: ReadyCue) => `${readyRate()}|${readyCueSource(voice, cue).key}`;

/** Abre o arquivo gravado da fala pronta, na taxa da saída de áudio (sem guardar). */
async function openReadyCue(voice: ReadyVoiceChoice, cue: ReadyCue): Promise<AudioBuffer> {
  const source = readyCueSource(voice, cue, import.meta.env.BASE_URL);
  if (source.pack) {
    const data = await window.vsDesktop?.maestroPackFile?.({ voice: source.voice, mode: source.mode, id: source.id });
    if (!data) {
      void refreshVoicePacks();
      throw new Error('Não encontrei o áudio desta fala nesta voz. O pacote será conferido de novo.');
    }
    return decodeWavBytes(new Uint8Array(data));
  }
  const res = await fetch(source.url);
  if (!res.ok) throw new Error('Não encontrei o áudio desta fala pronta. Reinstale o VS Stage.');
  return decodeWavBytes(new Uint8Array(await res.arrayBuffer()));
}

/** O arquivo do modo pedido; se ele não abrir, o Normal da MESMA voz. Nunca outra voz. */
async function openReadyCueOrNormal(voice: ReadyVoiceChoice, cue: ReadyCue): Promise<AudioBuffer> {
  try {
    return await openReadyCue(voice, cue);
  } catch (err) {
    const normal: ReadyVoiceChoice = { ...voice, intensity: 'normal' };
    if (!voiceHasCue(normal, cue, 'normal') || readyCueSource(normal, cue).key === readyCueSource(voice, cue).key) throw err;
    return openReadyCue(normal, cue);
  }
}

/** O arquivo gravado da fala pronta, guardado na memória. */
async function readyCueBuffer(voice: ReadyVoiceChoice, cue: ReadyCue): Promise<AudioBuffer> {
  const key = readyFileKey(voice, cue);
  const hit = readyCacheGet(key);
  if (hit) return hit;
  const buffer = await openReadyCueOrNormal(voice, cue);
  readyCachePut(key, buffer);
  return buffer;
}

/** Só o canal 0: a escuta é mono, e o esticador devolve estéreo (dobraria a memória). */
function monoCopy(buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels === 1) return buffer;
  const out = new OfflineAudioContext(1, 1, buffer.sampleRate).createBuffer(1, buffer.length, buffer.sampleRate);
  out.getChannelData(0).set(buffer.getChannelData(0));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Toque direto das falas do Maestro IA: clicou, tocou. Não passa pela fila de geração, pelo motor
// de IA nem pela gravação do clipe; a timeline só recebe a fala no OK.

const listenInflight = new Map<string, Promise<AudioBuffer | null>>();

function listenKey(voice: ReadyVoiceChoice, cue: ReadyCue, pitch?: VoicePitch): string {
  return `ouvir|${readyRate()}|${readyCueSource(voice, cue).key}|${pitch ?? 'padrao'}`;
}

/** A fala já aberta na memória, para tocar no mesmo clique (null se ainda precisa abrir o arquivo). */
export function readyCueCached(voiceId: string, text: string, pitch?: VoicePitch): AudioBuffer | null {
  const voice = readyVoice(voiceId);
  const cue = findReadyCue(text);
  if (!voice || !cue || !voiceHasCue(voice, cue, voice.intensity)) return null;
  return readyCacheGet(listenKey(voice, cue, pitch)) ?? null;
}

/** Abre a fala para ouvir, no tom escolhido. Null quando ela não tem gravação. */
export function readyCueListen(voiceId: string, text: string, pitch?: VoicePitch): Promise<AudioBuffer | null> {
  const voice = readyVoice(voiceId);
  const cue = findReadyCue(text);
  if (!voice || !cue || !voiceHasCue(voice, cue, voice.intensity)) return Promise.resolve(null);
  const key = listenKey(voice, cue, pitch);
  const hit = readyCacheGet(key);
  if (hit) return Promise.resolve(hit);
  const running = listenInflight.get(key);
  if (running) return running;
  const task = (async () => {
    // para ouvir guarda só o resultado final: a cópia bruta ocuparia o lugar de outra fala
    let buffer = tightenSpeech(readyCacheGet(readyFileKey(voice, cue)) ?? await openReadyCueOrNormal(voice, cue), false);
    const cents = pitchCents(pitch);
    if (cents !== 0) {
      const ctx = new OfflineAudioContext(1, 1, buffer.sampleRate);
      buffer = tightenSpeech(await processClipAudioAsync(ctx, toClipAudio(buffer), 1, cents), false);
    }
    buffer = monoCopy(buffer);
    readyCachePut(key, buffer);
    return buffer;
  })().finally(() => { listenInflight.delete(key); });
  listenInflight.set(key, task);
  return task;
}

/** Quantas falas entram na pré-carga: a atual e as que cabem na área visível da lista. */
const PRELOAD_MAX = 40;

/**
 * Deixa as falas visíveis prontas na memória, uma de cada vez e só com a música parada. Devolve a
 * função que cancela (trocou de assunto, de voz ou fechou a janela).
 */
export function preloadReadyCues(voiceId: string, texts: readonly string[], pitch?: VoicePitch): () => void {
  let alive = true;
  let timer = 0;
  const list = texts.slice(0, PRELOAD_MAX);
  const step = (i: number) => {
    if (!alive || i >= list.length) return;
    if (useStore.getState().transport.isPlaying) return;
    void readyCueListen(voiceId, list[i], pitch).catch(() => null).then(() => {
      if (alive) timer = window.setTimeout(() => step(i + 1), 0);
    });
  };
  timer = window.setTimeout(() => step(0), 60);
  return () => { alive = false; window.clearTimeout(timer); };
}

/**
 * Falas online já geradas nesta sessão, na velocidade e no tom naturais e já sem silêncio nas
 * pontas. Mudar o tamanho da marcação, a velocidade ou o tom só reprocessa aqui: não paga (nem
 * espera) outra geração no servidor.
 */
const onlineCache = new Map<string, AudioBuffer>();
/** Quando o serviço online falhou pela última vez: por 2 minutos as vozes padrão nem tentam de novo. */
let onlineFailedAt = 0;
function onlineAllowed(): boolean {
  return Date.now() - onlineFailedAt > 120_000;
}
const ONLINE_CACHE_MAX = 200;

async function onlineNatural(text: string, voice: string): Promise<{ buffer: AudioBuffer; voiceName: string }> {
  // a taxa entra na chave: trocar de placa de som (44,1 → 48 kHz) pede o áudio convertido de novo
  const key = `${audioEngine.currentSampleRate() ?? deviceSampleRate()}|${voice}|${text}`;
  const hit = onlineCache.get(key);
  const name = onlineVoiceById(voice)?.name ?? voice;
  if (hit) return { buffer: hit, voiceName: name };
  let out;
  try {
    out = await synthesizeOnline(text, voice);
  } catch (err) {
    throw new Error(cleanError(err));
  }
  const buffer = tightenSpeech(await decodeWavBytes(out.bytes), false);
  onlineCache.set(key, buffer);
  if (onlineCache.size > ONLINE_CACHE_MAX) onlineCache.delete(onlineCache.keys().next().value as string);
  return { buffer, voiceName: out.voiceName };
}

// ---------------------------------------------------------------------------------------------
// Pacote de contagem da voz clonada: os números ficam gravados de uma vez (desktop/maestroQwen.js)
// e entram na grade na hora, sem chamar o modelo. Cada número aberto fica na memória já sem silêncio.

export interface CountPackStatus {
  state: 'pronta' | 'gerando' | 'na-fila' | 'parcial' | 'nao' | 'falhou';
  done: number;
  total: number;
  error?: string | null;
}

const packKey = (voice: string, word: string) => `pacote|${readyRate()}|${voice}|${word}`;
const packInflight = new Map<string, Promise<AudioBuffer | null>>();

/** Este programa tem o pacote de contagem? (no site não há) */
export function hasCountPack(): boolean {
  return !!window.vsDesktop?.maestroCountWord;
}

/** Pede o pacote desta voz em segundo plano (retoma de onde parou). Nunca dá erro. */
export async function ensureCountPack(voice: string): Promise<boolean> {
  if (!isCloneVoice(voice)) return false;
  try { return !!(await window.vsDesktop?.maestroCountPackEnsure?.(voice)); } catch { return false; }
}

export async function countPackStatus(voice: string): Promise<CountPackStatus | null> {
  try { return (await window.vsDesktop?.maestroCountPackStatus?.(voice)) ?? null; } catch { return null; }
}

/** Avisa o andamento do pacote de qualquer voz. */
export function subscribeCountPack(cb: (p: { voice: string; state: string; done: number; total: number }) => void): () => void {
  return window.vsDesktop?.onMaestroCountPackProgress?.(cb) ?? (() => {});
}

/** Sobe quando uma voz é regravada ou apagada: quem mostra "pronta" confere de novo. */
let packVersion = 0;
const packVersionListeners = new Set<() => void>();
export function countPackVersion(): number {
  return packVersion;
}
export function subscribeCountPackVersion(fn: () => void): () => void {
  packVersionListeners.add(fn);
  return () => { packVersionListeners.delete(fn); };
}

/** O id é desta voz, em qualquer modo? Compara inteiro: "clone:ana" não pega "clone:ana2". */
const sameCloneVoice = (id: string | undefined, base: string) => !!id && isCloneVoice(id) && cloneBaseId(id) === base;

/** A voz foi regravada ou apagada: os números guardados na memória não valem mais. */
export function forgetCountPack(voice: string): void {
  const base = cloneBaseId(voice);
  for (const [k, b] of [...readyCache]) {
    if (!k.startsWith('pacote|') || !sameCloneVoice(k.split('|')[2], base)) continue;
    readyCache.delete(k);
    readyCacheBytes -= bufferBytes(b);
  }
  for (const k of [...packInflight.keys()]) if (sameCloneVoice(k.split('|')[2], base)) packInflight.delete(k);
  packVersion++;
  for (const fn of packVersionListeners) fn();
}

/** Regravou ou apagou a voz: nada do áudio antigo dela (números, prévias, exemplo) toca de novo. */
export function forgetVoiceAudio(voice: string): void {
  const base = cloneBaseId(voice);
  forgetCountPack(voice);
  // chave da prévia: versão|voz|tamanho|texto...
  const ofPreview = (k: string) => sameCloneVoice(k.split('|')[1], base);
  for (const k of [...previewDone.keys()]) if (ofPreview(k)) previewDone.delete(k);
  for (const k of [...previewRunning.keys()]) if (ofPreview(k)) previewRunning.delete(k);
  for (const [k, id] of [...previewRequests]) {
    if (!ofPreview(k)) continue;
    previewRequests.delete(k);
    try { void window.vsDesktop?.maestroSpeakCancel?.(id)?.catch?.(() => {}); } catch { /* sem motor */ }
  }
  for (const k of [...engineHas]) if (sameCloneVoice(k.split('|')[0], base)) engineHas.delete(k);
  for (const k of [...demoCache.keys()]) if (sameCloneVoice(k.split('|')[0], base)) demoCache.delete(k);
  for (const k of [...demoInflight.keys()]) if (sameCloneVoice(k.split('|')[0], base)) demoInflight.delete(k);
}

/** A fala está gravada no disco nesta voz clonada? Só consulta, nunca gera. */
async function isPinned(text: string, voice: string): Promise<boolean> {
  try { return (await window.vsDesktop?.maestroPinnedStates?.({ texts: [text], voice }))?.[text] === 'gravada'; } catch { return false; }
}

/** A marcação de voz clonada pode ser recolocada sem chamar o modelo? */
export async function speechRecorded(n: Pick<MaestroNarration, 'text' | 'voice' | 'countGroup'>): Promise<boolean> {
  const text = n.text.trim();
  if (!text || !isCloneVoice(n.voice)) return false;
  if (n.countGroup && isCountPackWord(text) && await countPackHas(n.voice, [text])) return true;
  return isPinned(text, n.voice);
}

/** O número gravado, sem silêncio na frente (null se ainda não foi preparado). */
function countPackBuffer(voice: string, word: string): Promise<AudioBuffer | null> {
  const key = packKey(voice, word);
  const hit = readyCacheGet(key);
  if (hit) return Promise.resolve(hit);
  const running = packInflight.get(key);
  if (running) return running;
  const version = packVersion;
  const task: Promise<AudioBuffer | null> = (async () => {
    const got = await window.vsDesktop?.maestroCountWord?.({ voice, word }).catch(() => null);
    if (!got) return null;
    // o motor já cortou no ataque preservando consoante chiada ("S", "T"): cortar de novo aqui
    // comia o começo de "Seis" e "Sete"
    const buffer = await decodeWavBytes(base64ToBytes(got.wavBase64));
    // a voz foi regravada enquanto abria: este áudio é da gravação antiga
    if (version === packVersion) readyCachePut(key, buffer);
    return buffer;
  })().catch(() => null).finally(() => { if (packInflight.get(key) === task) packInflight.delete(key); });
  packInflight.set(key, task);
  return task;
}

/** Todos estes números já estão gravados nesta voz? Deixa eles abertos para a colocação ser na hora. */
export async function countPackHas(voice: string, words: readonly string[]): Promise<boolean> {
  if (!isCloneVoice(voice) || !hasCountPack() || words.length === 0) return false;
  const got = await Promise.all([...new Set(words)].map((w) => countPackBuffer(voice, w)));
  return got.every(Boolean);
}

/** O número sai do pacote, ou null para seguir o caminho comum (marcação antiga, pacote incompleto). */
async function countPackSpeech(text: string, voice: string, span: number, pace?: number, group?: string[], pitch?: VoicePitch): Promise<SpeechResult | null> {
  if (!isCloneVoice(voice) || !group?.length || !hasCountPack() || !isCountPackWord(text)) return null;
  // palavra própria no grupo ("Vai!") vem da gravação dela e não segura os números
  const words = [...new Set(group)].filter(isCountPackWord);
  const index = words.indexOf(text);
  if (index < 0) return null;
  const buffers = await Promise.all(words.map((w) => countPackBuffer(voice, w)));
  if (buffers.some((b) => !b)) return null;
  // mesma velocidade em todos os números (a do que mais precisa), como na contagem falada de uma vez
  const tempo = Math.max(...buffers.map((b) => fitTempo(b!.duration, span, pace).tempo));
  const natural = buffers[index]!;
  const cents = pitchCents(pitch);
  let buffer = natural;
  // só passa pelo esticador quando a velocidade ou o tom pedem: o número fica como foi gravado
  if (Math.abs(tempo - 1) > 0.005 || cents !== 0) {
    const ctx = new OfflineAudioContext(1, 1, natural.sampleRate);
    buffer = dropLeadingSilence(await processClipAudioAsync(ctx, toClipAudio(natural), 1 / tempo, cents));
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const lead = Math.round(attackOffset(monoMix(channels), buffer.sampleRate) * 1e4) / 1e4;
  return {
    buffer,
    wpm: Math.round((1 / Math.max(0.3, buffer.duration)) * 60),
    voiceName: voiceLabel(voice),
    note: null,
    overflow: span > 0 && buffer.duration > span * 1.02,
    engine: 'qwen',
    lead,
  };
}

/**
 * Gera o áudio de uma fala (sem gravar nada no projeto).
 * `pace`: velocidade fixa (contagem); sem ele, o tamanho da marcação define a velocidade.
 * `group`: as palavras da contagem a que esta fala pertence.
 */
export async function synthesize(text: string, voice: string, span: number, pace?: number, group?: string[], pitch?: VoicePitch, request?: { requestId?: string; fallback: false }): Promise<SpeechResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Escreva o texto que o maestro deve falar.');
  const packed = await countPackSpeech(trimmed, voice, span, pace, group, pitch);
  if (packed) return packed;
  // palavra própria da contagem já gravada: abre a gravação dela, sem pedir a frase inteira ao modelo
  const engineGroup = group?.length && isCloneVoice(voice) && !isCountPackWord(trimmed) && await isPinned(trimmed, voice) ? undefined : group;
  if (isOnlineVoice(voice) && !onlineVoiceById(voice)) throw new Error('Essa voz online não existe mais. Escolha outra.');

  let buffer: AudioBuffer | null = null;
  let tempo = 1;
  let result: Omit<SpeechResult, 'buffer'> | null = null;
  let fallbackNote: string | null = null;

  // Falas prontas (Maestro e a antiga Bianca): a frase da lista sai do arquivo gravado, e passa pelo mesmo
  // acerto das outras vozes (começa na amostra da palavra, estica para a marcação ou a contagem).
  // Texto antigo fora da lista ou fala ainda sem gravação saem na voz do Mac do mesmo gênero, com
  // aviso. Arquivo gravado que não abriu (nem no Normal da mesma voz) dá erro e mantém o áudio.
  const ready = readyVoice(voice);
  if (ready) {
    const cue = findReadyCue(trimmed);
    let missingFile = false;
    if (cue && voiceHasCue(ready, cue, ready.intensity)) {
      try {
        buffer = await readyCueBuffer(ready, cue);
      } catch {
        buffer = null;
        missingFile = true;
      }
    }
    if (cue && buffer) {
      const fit = fitTempo(buffer.duration, span, pace);
      tempo = fit.tempo;
      result = {
        wpm: Math.round((trimmed.split(/\s+/).length / Math.max(0.3, fit.seconds)) * 60),
        voiceName: ready.label,
        note: null,
        overflow: fit.overflow,
        engine: 'pronta',
      };
    } else {
      if (missingFile) throw new Error(`Não encontrei o áudio desta fala na voz ${ready.label}. O áudio anterior da marcação foi mantido.`);
      // voz que só existe em pacote nunca sai em outra voz
      if (!ready.embedded) throw new Error(`Esta fala não está disponível na voz ${ready.label} neste computador.`);
      fallbackNote = !cue
        ? 'Essa fala não está nas falas prontas: saiu na voz reserva do sistema.'
        : `Essa fala pronta ainda não foi gravada na voz ${ready.label}: saiu na voz reserva do sistema.`;
      voice = ready.fallback;
    }
  }

  // Voz online (Microsoft): vem na velocidade natural, como a voz de IA do Mac; o ajuste é o mesmo.
  // Feminina e Masculina também a usam quando há internet (Francisca e Antônio, com sotaque do
  // Brasil); sem internet ou se o serviço falhar, caem na voz de IA do próprio Mac.
  const preset = isPresetVoice(voice);
  const onlineVoice = isOnlineVoice(voice)
    ? voice
    : (voice === 'feminina' || voice === 'masculina') && ONLINE_PACKS.length > 0 && window.vsDesktop?.maestroOnlineSpeak && onlineAllowed()
      ? ONLINE_DEFAULT[voice]
      : null;
  if (onlineVoice && !buffer) {
    try {
      const natural = await onlineNatural(trimmed, onlineVoice);
      buffer = natural.buffer;
      const fit = fitTempo(buffer.duration, span, pace);
      tempo = fit.tempo;
      result = {
        wpm: Math.round((trimmed.split(/\s+/).length / Math.max(0.3, fit.seconds)) * 60),
        voiceName: natural.voiceName,
        // voz pronta que caiu aqui: o aviso de por que não saiu a fala gravada vai junto
        note: fallbackNote,
        overflow: fit.overflow,
        engine: 'online',
      };
    } catch (err) {
      if (!preset) throw err; // voz online escolhida pelo nome: avisa o erro
      onlineFailedAt = Date.now(); // por 2 minutos nem tenta (não fica esperando a cada fala)
      fallbackNote = ready
        ? fallbackNote
        : 'Sem internet ou o serviço de voz não respondeu: usei a voz do próprio Mac.';
    }
  }

  if (!buffer || !result) {
    const speak = window.vsDesktop?.maestroSpeak;
    if (!speak) {
      throw new Error(ready
        ? 'Essa fala não tem áudio gravado nas falas prontas, e a voz do Mac que fala no lugar só existe no app do Mac.'
        : 'As vozes de IA só são geradas no app do computador.');
    }
    let out;
    try {
      out = await speak({ text: trimmed, voice, wpm: wpmForSpan(trimmed, span), span, pace, group: engineGroup, ...request });
    } catch (err) {
      // o IPC só transporta a mensagem: os dois casos que a prévia trata são reconhecidos por ela
      const raw = err instanceof Error ? err.message : String(err ?? '');
      if (raw.includes('fala_cancelada')) throw Object.assign(new Error('fala_cancelada'), { canceled: true });
      if (/preparando esta fala/i.test(raw)) throw Object.assign(new Error(cleanError(err)), { preparing: true });
      throw new Error(cleanError(err));
    }
    buffer = await decodeWavBytes(base64ToBytes(out.wavBase64));
    // A voz de IA vem na velocidade natural (`tempo` diz quanto esticar); a voz do Mac já vem no ritmo.
    tempo = Number(out.tempo) || 1;
    result = {
      wpm: out.rate, voiceName: out.voice, overflow: !!out.overflow, engine: out.engine ?? 'mac', preparing: !!out.preparing,
      note: [fallbackNote, out.note].filter(Boolean).join(' ') || null,
    };
  }

  // A frente da palavra é limpa ANTES de esticar: acelerada, a pausa entre o resto da palavra
  // anterior e o número encolhe e se mistura (48 ms viravam 14 ms) e já não dá para separar.
  const singleWord = Array.isArray(group) && group.length > 0;
  buffer = tightenSpeech(buffer, singleWord);
  // Estica (sem mudar o tom) para caber na marcação ou na velocidade da contagem, e muda o tom
  // (grave/agudo) sem mudar a velocidade.
  const cents = pitchCents(pitch);
  if (Math.abs(tempo - 1) > 0.005 || cents !== 0) {
    const ctx = new OfflineAudioContext(1, 1, buffer.sampleRate);
    buffer = await processClipAudioAsync(ctx, toClipAudio(buffer), 1 / tempo, cents);
    // e de novo depois: o esticador pode deixar um pedacinho quieto na frente
    buffer = tightenSpeech(buffer, singleWord);
  }
  // Contagem: o que tem de cair na batida é o ataque do número, não o primeiro som. Medido no áudio
  // final (já esticado), para o clipe recuar exatamente esse tanto.
  if (singleWord) {
    const final = buffer;
    const channels = Array.from({ length: final.numberOfChannels }, (_, c) => final.getChannelData(c));
    const lead = Math.round(attackOffset(monoMix(channels), final.sampleRate) * 1e4) / 1e4;
    return { buffer, ...result, lead };
  }
  return { buffer, ...result };
}

// ---------------------------------------------------------------------------------------------
// Exemplo de cada voz (o ▶ ao lado do nome): ouvir antes de gerar. É uma fala curta com
// contagem, no tom escolhido. Fica guardado na sessão: ouvir de novo não gera outra vez (nas
// vozes online, não gasta outra geração).

/** O que o exemplo fala: uma chamada e uma contagem, como no show. */
export const DEMO_TEXT = 'Atenção, banda! Um, dois, três, quatro.';
/**
 * Exemplo das vozes clonadas: só a contagem. Cada fala nova da voz clonada leva dezenas de
 * segundos neste Mac; o texto curto sai bem mais rápido e mostra a voz do mesmo jeito.
 */
export const CLONE_DEMO_TEXT = 'Um, dois, três, quatro.';

const demoCache = new Map<string, AudioBuffer>();
/** Exemplo sendo gerado: clicar de novo (ou fechar e abrir a janela) espera o mesmo, sem gerar outro. */
const demoInflight = new Map<string, Promise<VoiceDemo>>();

export interface VoiceDemo {
  buffer: AudioBuffer;
  /** Aviso quando o exemplo saiu com a voz de reserva do Mac (a de IA ainda baixando). */
  note: string | null;
}

/** O exemplo já está pronto (toca na hora, sem passar pelo motor de voz)? */
export function voiceDemoReady(voice: string, pitch?: VoicePitch): boolean {
  return !!readyVoice(voice) || demoCache.has(`${voice}|${pitch ?? 'padrao'}`);
}

/**
 * O exemplo da voz, no tom escolhido. Voz pronta (Maestro e intensidades): as falas gravadas,
 * na hora, sem motor. Feminina, Masculina e clonadas: geradas pelo motor (pode levar dezenas de
 * segundos); sem prazo curto, e o exemplo pronto fica guardado na sessão.
 */
export function voiceDemo(voice: string, pitch?: VoicePitch): Promise<VoiceDemo> {
  const ready = readyVoice(voice);
  // voz pronta: no cache limitado das falas, e a chave muda quando o pacote da voz muda
  const key = ready
    ? `exemplo|${readyRate()}|${voice}|${pitch ?? 'padrao'}|${voicePackRevision(ready.dir)}`
    : `${voice}|${pitch ?? 'padrao'}`;
  const hit = ready ? readyCacheGet(key) : demoCache.get(key);
  if (hit) return Promise.resolve({ buffer: hit, note: null });
  const running = demoInflight.get(key);
  if (running) return running;
  const task = makeVoiceDemo(voice, key, pitch).finally(() => { demoInflight.delete(key); });
  demoInflight.set(key, task);
  return task;
}

async function makeVoiceDemo(voice: string, key: string, pitch?: VoicePitch): Promise<VoiceDemo> {
  const version = packVersion;
  const ready = readyVoice(voice);
  if (ready) {
    // fala pronta: "Atenção" e a contagem (o que a voz tiver), uma de cada vez e só com a música parada
    const parts: AudioBuffer[] = [];
    for (const w of voiceSampleTexts(ready)) {
      if (useStore.getState().transport.isPlaying) throw new Error('Com a música tocando o exemplo não sai, para não cair no PA.');
      parts.push((await synthesize(w, voice, 0, undefined, undefined, pitch)).buffer);
    }
    if (!parts.length) throw new Error(`A voz ${ready.label} ainda não tem falas neste computador.`);
    const rate = parts[0].sampleRate;
    const gap = (i: number) => Math.round(rate * (i === 0 ? 0.45 : 0.22));
    const total = parts.reduce((n, b, i) => n + b.length + (i < parts.length - 1 ? gap(i) : 0), 0);
    const ctx = new OfflineAudioContext(1, 1, rate);
    const out = ctx.createBuffer(1, total, rate);
    let at = 0;
    parts.forEach((b, i) => { out.getChannelData(0).set(b.getChannelData(0), at); at += b.length + gap(i); });
    readyCachePut(key, out);
    return { buffer: out, note: null };
  }
  const out = await synthesize(isCloneVoice(voice) ? CLONE_DEMO_TEXT : DEMO_TEXT, voice, 0, undefined, undefined, pitch);
  // saiu com a voz do Mac no lugar da de IA: não guarda (na próxima, a de IA já pode estar pronta)
  if (out.engine === 'mac' && isIaVoice(voice)) {
    return { buffer: out.buffer, note: out.preparing ? out.note : 'A voz de IA ainda está sendo baixada: este exemplo saiu com a voz do Mac.' };
  }
  // regravada enquanto gerava: toca este, mas não guarda o exemplo da voz antiga
  if (version === packVersion) demoCache.set(key, out.buffer);
  return { buffer: out.buffer, note: null };
}

// ---------------------------------------------------------------------------------------------
// Pré-escuta: toca a fala sem passar pelo mixer.

let previewCtx: AudioContext | null = null;
/** Bloco pedido quando a prévia abriu. */
let previewHint: AudioContextLatencyCategory | null = null;
/** Placa em que a prévia abriu ('' = saída padrão do Mac). */
let previewSink: string | null = null;
let previewSource: AudioBufferSourceNode | null = null;
/** Último áudio gerado de cada marcação (para ouvir sem decodificar de novo). */
const lastBuffers = new Map<string, AudioBuffer>();
const LAST_BUFFERS_MAX = 24;

function keepLastBuffer(clipId: string, buffer: AudioBuffer): void {
  lastBuffers.delete(clipId);
  lastBuffers.set(clipId, buffer);
  if (lastBuffers.size > LAST_BUFFERS_MAX) lastBuffers.delete(lastBuffers.keys().next().value as string);
}

/** Dono da prévia: só quem pediu por último pode tocar. Vale para a janela e para o seletor de voz. */
let previewOwner = 0;
const previewWatchers = new Set<() => void>();

function haltPreview(): void {
  if (previewSource) {
    const src = previewSource;
    previewSource = null;
    try { src.stop(); } catch { /* já parou */ }
  }
}

/** Para o que toca e invalida quem ainda estava carregando para tocar. */
export function stopPreview(): void {
  haltPreview();
  previewOwner++;
  previewWatchers.forEach((cb) => cb());
}

/** Vira o dono da prévia (para o que estava tocando) e devolve o número para conferir depois. */
export function claimPreview(): number {
  stopPreview();
  return previewOwner;
}

export function isPreviewCurrent(owner: number): boolean {
  return owner === previewOwner;
}

/** Avisa quando a prévia troca de dono ou é parada. */
export function subscribePreview(cb: () => void): () => void {
  previewWatchers.add(cb);
  return () => { previewWatchers.delete(cb); };
}

/**
 * Contexto da prévia, já na placa em que a música toca. Antes ele abria sempre na saída padrão
 * do Mac: com a placa de som escolhida no programa, o ▶ das vozes "não tocava" (saía no alto-
 * falante do Mac, ou em lugar nenhum).
 */
function newPreviewContext(hint: AudioContextLatencyCategory, sink: string): AudioContext {
  if (sink) {
    try {
      const ctx = new AudioContext({ latencyHint: hint, sinkId: sink } as AudioContextOptions);
      if ((ctx as unknown as { sinkId?: unknown }).sinkId === sink) return ctx;
      const sinkable = ctx as unknown as { setSinkId?: (id: string) => Promise<void> };
      void sinkable.setSinkId?.(sink).catch(() => { /* placa recusada: fica na saída padrão */ });
      return ctx;
    } catch { /* construtor não aceita a placa: abre na padrão */ }
  }
  return new AudioContext({ latencyHint: hint });
}

/**
 * Abre a saída da prévia antes do primeiro clique, para a primeira fala não esperar a placa de som.
 * Só com a música parada: abrir um contexto na placa durante o show engasga o áudio.
 */
export function warmPreview(): void {
  if (useStore.getState().transport.isPlaying) return;
  try {
    const hint = engineLatencyHint();
    const sink = audioEngine.getOutputSinkId();
    if (previewCtx && previewCtx.state !== 'closed' && previewHint === hint && previewSink === sink) return;
    if (previewCtx) void previewCtx.close().catch(() => { /* já fechou */ });
    previewCtx = newPreviewContext(hint, sink);
    previewHint = hint;
    previewSink = sink;
  } catch { /* sem saída agora: o primeiro toque tenta de novo */ }
}

/**
 * Toca o áudio e avisa quando acabar. `owner`: quem reivindicou a prévia antes de carregar; se outro
 * toque começou nesse meio tempo, este não sai. Com a música no ar a prévia nunca sai: a saída
 * padrão do Mac pode ser a própria placa do show, e aí a fala cairia no PA.
 */
export function playPreview(buffer: AudioBuffer, onEnd?: () => void, owner?: number): void {
  if (owner !== undefined && owner !== previewOwner) { onEnd?.(); return; }
  if (owner === undefined) claimPreview();
  else haltPreview();
  if (useStore.getState().transport.isPlaying) { onEnd?.(); return; }
  try {
    // bloco do motor, nunca menor. O motor trocou de modo (ou de placa) depois que a prévia abriu:
    // fecha e abre de novo (o que tocava nela acabou de parar)
    const hint = engineLatencyHint();
    const sink = audioEngine.getOutputSinkId();
    if (previewCtx && previewHint !== hint) {
      void previewCtx.close().catch(() => { /* já fechou */ });
      previewCtx = null;
    }
    // a placa da música mudou (ou o contexto fechou): a prévia vai junto para a placa nova
    if (previewCtx && (previewCtx.state === 'closed' || previewSink !== sink)) {
      void previewCtx.close().catch(() => { /* já fechou */ });
      previewCtx = null;
    }
    if (!previewCtx) {
      previewCtx = newPreviewContext(hint, sink);
      previewHint = hint;
      previewSink = sink;
    }
    const ctx = previewCtx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    let finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      if (previewSource === src) previewSource = null;
      onEnd?.();
    };
    src.onended = end;
    previewSource = src;
    // Contexto suspenso (aberto fora de um clique, ou o Mac suspendeu o áudio): só começa depois de
    // voltar a rodar. Começando antes, o tempo de início já tinha passado e a fala saía cortada ou muda.
    // o contexto não voltou a rodar em alguns segundos: encerra, para o ▶ não ficar preso tocando
    const giveUp = ctx.state === 'running' ? 0
      : window.setTimeout(() => { if (previewSource === src) { stopPreview(); end(); } }, 4000);
    const begin = () => {
      window.clearTimeout(giveUp);
      if (previewSource !== src) return; // parado enquanto o contexto voltava
      try { src.start(); } catch { end(); }
    };
    if (ctx.state === 'running') begin();
    else void ctx.resume().then(begin, () => begin());
  } catch {
    onEnd?.();
  }
}

// ---------------------------------------------------------------------------------------------
// Prévia do texto escrito: gera e toca SEM mexer na marcação nem na timeline. O Gerar reaproveita
// o mesmo áudio; o motor também guarda a fala em disco, então mudar só o tamanho não gera de novo.

export interface SpeechDraft {
  text: string;
  voice: string;
  span: number;
  pace?: number;
  pitch?: VoicePitch;
  group?: string[];
}

const PREVIEW_KEEP = 8;
const previewDone = new Map<string, SpeechResult>();
const previewRunning = new Map<string, Promise<SpeechResult>>();
/** Pedido ao motor de cada prévia em andamento (rascunho → requestId), para poder cancelar. */
const previewRequests = new Map<string, string>();
let previewSeq = 0;
/** Falas que o motor de IA já gerou nesta sessão: refazer só muda o tamanho, sem esperar. */
const engineHas = new Set<string>();

const engineKey = (text: string, voice: string, group?: string[]) => `${voice}|${text.trim()}|${(group ?? []).join(',')}`;

function draftKey(d: SpeechDraft): string {
  return `${narrationSignature(d.text, d.voice, d.span, d.pace, d.pitch)}|${(d.group ?? []).join(',')}`;
}

/** Este rascunho já foi ouvido na prévia (o Gerar usa o mesmo áudio, na hora)? */
export function draftPreviewed(d: SpeechDraft): boolean {
  return previewDone.has(draftKey(d));
}

export function isSpeechCanceled(err: unknown): boolean {
  return !!(err as { canceled?: boolean } | null)?.canceled;
}
export function isSpeechPreparing(err: unknown): boolean {
  return !!(err as { preparing?: boolean } | null)?.preparing;
}

/**
 * Desiste das prévias em andamento (menos a de `keep`, que o Gerar vai aproveitar). O que estava
 * na fila sai dela; a fala que o motor já começou termina e fica guardada.
 */
export function cancelPreviewSpeech(keep?: SpeechDraft): void {
  const keepKey = keep ? draftKey(keep) : null;
  for (const [key, id] of [...previewRequests]) {
    if (key === keepKey) continue;
    previewRequests.delete(key);
    previewRunning.delete(key);
    try { void window.vsDesktop?.maestroSpeakCancel?.(id)?.catch?.(() => {}); } catch { /* sem motor */ }
  }
}

/**
 * Gera a prévia do rascunho, sempre na voz pedida: se o motor não puder falar, dá erro em vez de
 * tocar a voz do sistema. A fala que o motor já começou termina e fica guardada.
 */
export function previewSpeech(d: SpeechDraft): Promise<SpeechResult> {
  const key = draftKey(d);
  const hit = previewDone.get(key);
  if (hit) return Promise.resolve(hit);
  const current = previewRunning.get(key);
  if (current) return current;
  const requestId = `previa-${Date.now()}-${++previewSeq}`;
  const version = packVersion;
  previewRequests.set(key, requestId);
  const task: Promise<SpeechResult> = synthesize(d.text, d.voice, d.span, d.pace, d.group, d.pitch, { requestId, fallback: false }).then((out) => {
    // a voz foi regravada enquanto esta prévia saía: o áudio é da gravação antiga
    if (version !== packVersion) return out;
    if (out.engine === 'qwen') engineHas.add(engineKey(d.text, d.voice, d.group));
    // voz de reserva do Mac não é a fala pedida: não vale para o Gerar
    if (out.engine !== 'mac') {
      previewDone.set(key, out);
      if (previewDone.size > PREVIEW_KEEP) previewDone.delete(previewDone.keys().next().value as string);
    }
    return out;
  }).finally(() => {
    if (previewRunning.get(key) === task) previewRunning.delete(key);
    if (previewRequests.get(key) === requestId) previewRequests.delete(key);
  });
  previewRunning.set(key, task);
  return task;
}

/** A fala de IA do rascunho, que estava sendo preparada no processador, já pode tocar? */
export async function draftReady(d: SpeechDraft): Promise<boolean> {
  const ready = window.vsDesktop?.maestroSpeechReady;
  if (!ready) return true;
  try { return await ready({ text: d.text, voice: d.voice, group: d.group }); } catch { return true; }
}

/** As palavras da contagem a que a marcação pertence (a prévia fala igual ao Gerar). */
export function draftGroup(songId: string, group: string | undefined, narrationId?: string, text?: string): string[] | undefined {
  return group ? countGroupWords(songId, group, narrationId, text) : undefined;
}

/** O áudio que já está na faixa para esta marcação (da memória ou do arquivo salvo). */
export async function narrationBuffer(n: MaestroNarration): Promise<AudioBuffer | null> {
  if (!n.clipId) return null;
  const cached = lastBuffers.get(n.clipId);
  if (cached) return cached;
  const src = getClipSource(n.clipId);
  if (!src) return null;
  try {
    const buffer = await decodeWavBytes(new Uint8Array(await src.arrayBuffer()));
    keepLastBuffer(n.clipId, buffer);
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
/** Marcações do Adicionar fala: só entra a fala pronta, nunca a voz do sistema. */
const noFallback = new Set<string>();
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
/** Alguma fala sendo gerada (ou esperando para gerar): o preparo da música espera terminar. */
export function anyGenerating(): boolean {
  return running.size > 0 || timers.size > 0;
}

export function isGenerating(narrationId: string): boolean {
  return running.has(narrationId) || timers.has(narrationId);
}

function findNarration(songId: string, narrationId: string): MaestroNarration | undefined {
  return useStore.getState().songs.find((s) => s.id === songId)?.narrations?.find((n) => n.id === narrationId);
}

/** Gera a fala da marcação e coloca o áudio na faixa Maestro IA. */
export function generateNarration(songId: string, narrationId: string, opts?: { fallback?: false }): Promise<SpeechResult | null> {
  const timer = timers.get(narrationId);
  if (timer) { window.clearTimeout(timer); timers.delete(narrationId); }
  // voz que saiu do programa: a marcação fica com o áudio que tem, nada é gerado nela
  const target = findNarration(songId, narrationId);
  if (target && !isOfferedVoice(target.voice)) { notify(); return Promise.resolve(null); }
  if (opts?.fallback === false) noFallback.add(narrationId);
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
        else noFallback.delete(narrationId);
      } else {
        noFallback.delete(narrationId);
      }
    }
  })();
  running.set(narrationId, job);
  notify();
  return job;
}

/**
 * Refaz sem espera só o que não custa geração nova: fala gravada do Maestro IA, ou voz clonada que
 * o motor já gerou nesta sessão. Voz que saiu das telas, ou fala clonada nova, fica com o áudio que
 * tem até o usuário pedir "Gerar".
 */
function regeneratesAlone(n: MaestroNarration & { songId: string }): boolean {
  if (!isOfferedVoice(n.voice)) return false;
  const ready = readyVoice(n.voice);
  if (ready) {
    const cue = findReadyCue(n.text);
    return !!cue && voiceHasCue(ready, cue, ready.intensity);
  }
  const group = n.countGroup ? countGroupWords(n.songId, n.countGroup) : undefined;
  // número do pacote já aberto: ajustar o tamanho não chama o modelo
  if (group?.length && group.every((w) => readyCache.has(packKey(n.voice, w)))) return true;
  return engineHas.has(engineKey(n.text, n.voice, group));
}

/**
 * Ajusta daqui a pouco (depois de arrastar a borda ou no OK): várias mudanças seguidas viram uma
 * vez só. Nunca dispara uma geração de IA que o usuário não pediu.
 */
export function scheduleGeneration(songId: string, narrationId: string, delayMs = 400): void {
  const n = findNarration(songId, narrationId);
  if (!n || !canGenerate(n.voice) || !n.text.trim() || narrationState(n) === 'fresh') return;
  if (!regeneratesAlone({ ...n, songId })) return;
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
function countGroupWords(songId: string, group: string, narrationId?: string, text?: string): string[] {
  const song = useStore.getState().songs.find((s) => s.id === songId);
  return sortedNarrations((song?.narrations ?? []).filter((x) => x.countGroup === group))
    .map((x) => (x.id === narrationId && text !== undefined ? text : x.text).trim())
    .filter(Boolean);
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
  // Gera mesmo com a música tocando (a pessoa quer ouvir a fala no ar). O motor de voz roda com
  // prioridade de fundo (taskpolicy em desktop/maestroQwen.js), então o áudio e a tela vêm primeiro,
  // e a fala que fica pronta entra no tempo certo (o reprodutor desconta a largada atrasada).
  let result: SpeechResult;
  try {
    // a prévia deste mesmo texto, voz e tom já está pronta (ou gerando): usa ela
    const draft: SpeechDraft = { text, voice, span, pace, pitch, group };
    const key = draftKey(draft);
    // prévia cancelada ou que falhou não derruba o Gerar: aí gera pelo caminho normal
    const strict = noFallback.has(narrationId);
    const reused = previewDone.get(key) ?? await previewRunning.get(key)?.catch(() => null);
    result = reused ?? await synthesize(text, voice, span, pace, group, pitch, strict ? { fallback: false } : undefined);
    // no processador a reserva volta marcada como preparando: no Adicionar fala ela não entra
    if (strict && result.engine === 'mac') throw new Error('Esta fala ainda não está pronta nesta voz.');
    if (result.engine === 'qwen') engineHas.add(engineKey(text, voice, group));
  } catch (err) {
    if (findNarration(songId, narrationId)) {
      useStore.getState().updateNarration(songId, narrationId, { status: 'error', error: friendlyError(err, 'Não foi possível gerar a voz.') });
    }
    throw err;
  }
  // a marcação pode ter sido apagada enquanto a voz era gerada: aí não grava nada
  if (!findNarration(songId, narrationId)) return null;
  // feita com a voz do Mac no lugar da de IA: fica marcada para gerar de novo quando a de IA puder
  const fallback = result.engine === 'mac' && isIaVoice(voice);
  // no processador a fala de IA está sendo gerada: a tela troca quando ela ficar pronta
  if (result.preparing) iaWaiting.set(narrationId, { songId, text, voice, group });
  else iaWaiting.delete(narrationId);
  await applyNarration(songId, narrationId, result, narrationSignature(text, voice, span, pace, pitch) + (fallback ? FALLBACK_MARK : ''));
  const clipId = findNarration(songId, narrationId)?.clipId;
  if (clipId) keepLastBuffer(clipId, result.buffer);
  return result;
}

/**
 * Onde termina o último clipe da faixa que acaba até `start` (sem contar o próprio clipe da fala):
 * o número da contagem só recua até ali, para não ficar por cima do anterior.
 */
function prevClipEnd(clips: AudioClip[], songId: string, trackId: string, start: number, ownId?: string): number {
  let end = -Infinity;
  for (const c of clips) {
    if (c.id === ownId || c.songId !== songId || c.trackId !== trackId) continue;
    if (c.startTime >= start) continue;
    const e = c.startTime + clipPlayLength(c);
    if (e <= start + 1e-6) end = Math.max(end, e);
    else end = Math.max(end, start); // já cobre o início: não recua nada
  }
  return end;
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
    ...clipPlacement(n.start, result.lead, prevClipEnd(useStore.getState().clips, songId, trackId, n.start, n.clipId)),
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
    lead: result.lead,
  });
  audioEngine.invalidatePrepared(songId);
  // fala masterizada: a voz nova recebe a mesma masterização
  const master = findNarration(songId, narrationId)?.master;
  if (master) void masterAudioClip(clipId, master);
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
    const own = n.clipId ? s.clips.find((c) => c.id === n.clipId) : undefined;
    const place = own && patch.start !== undefined
      ? clipPlacement(next.start, n.lead, prevClipEnd(s.clips, songId, own.trackId, next.start, own.id))
      : null;
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
  if (crossesTempoChange(song, times)) return { error: 'A contagem passaria da troca de andamento. Comece mais cedo, para terminar na troca, ou use menos tempos.' };
  const inRange = (song.narrations ?? []).filter((n) => n.end > from + 1e-6 && n.start < to - 1e-6);
  const blocking = inRange.filter((n) => !n.countGroup);
  if (blocking.length > 0) {
    return { error: `Já há ${blocking.length === 1 ? 'uma fala' : `${blocking.length} falas`} nesse trecho. Mova ou apague antes de pôr a contagem.` };
  }
  const group = `contagem-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const words = countWords(opts.total, song.beatsPerBar ?? 4, opts.restartEachBar);
  const lacking = wordsMissingInVoice(opts.voice, words);
  if (lacking.length) return { error: `Esta voz ainda não tem: ${lacking.join(', ')}. Use menos tempos ou recomece a cada compasso.` };
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
// Troca da voz de reserva: quando o usuário pediu uma fala e ela saiu na voz do Mac porque a de IA
// ainda estava sendo preparada, a fala de IA entra assim que ficar pronta. Nada além disso é gerado
// sozinho: marcação desatualizada ou de voz antiga fica como está até o usuário clicar em Gerar.

/** Marcações esperando a fala de IA que o usuário pediu. */
const iaWaiting = new Map<string, { songId: string; text: string; voice: string; group?: string[] }>();
let swapping = false;

async function swapReadySpeech(): Promise<void> {
  const ready = window.vsDesktop?.maestroSpeechReady;
  if (swapping || !ready || iaWaiting.size === 0 || useStore.getState().transport.isPlaying) return;
  swapping = true;
  try {
    for (const [id, wait] of [...iaWaiting]) {
      const n = findNarration(wait.songId, id);
      // mudou o texto ou a voz depois do pedido: a fala esperada não vale mais
      if (!n || n.text.trim() !== wait.text || n.voice !== wait.voice) { iaWaiting.delete(id); continue; }
      let done = false;
      try { done = await ready({ text: wait.text, voice: wait.voice, group: wait.group }); } catch { iaWaiting.delete(id); continue; }
      if (!done) continue;
      iaWaiting.delete(id);
      try { await generateNarration(wait.songId, id); } catch { /* o erro fica na marcação */ }
    }
  } finally {
    swapping = false;
  }
}

if (typeof window !== 'undefined' && window.vsDesktop?.maestroSpeak) {
  // Só trabalha quando há uma fala pedida à espera, e com a tela visível.
  window.setInterval(() => {
    if (iaWaiting.size > 0 && document.visibilityState === 'visible') void swapReadySpeech();
  }, 10_000);
}
