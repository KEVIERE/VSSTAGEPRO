// VS Stage Remote: o que o programa do Mac manda para o celular (estado) e o que o celular manda
// de volta (comandos). O mesmo formato vale para a Rede Local e para o Show Online.
// Código puro (sem store, sem React), para rodar nos testes e nos dois lados.

import type { PlayFlow } from '@/types';

export const REMOTE_VERSION = 1;

export interface RemoteRegion {
  id: string;
  name: string;
  color: string;
  start: number;
  end: number;
  loop: boolean;
  repeat: number | null;
}

/** Uma música dentro de um medley. */
export interface RemotePart {
  id: string;
  name: string;
  start: number;
  duration: number;
  enabled: boolean;
  /** ajuste mostrado (BPM real acima/abaixo do original, ou meios-tons) */
  bpmShown: number;
  tunerShown: number;
  /** sem ajuste próprio: segue o da música */
  bpmInherited: boolean;
  tunerInherited: boolean;
}

export interface RemoteSong {
  id: string;
  name: string;
  /** duração que toca no show (sem as partes puladas do medley) */
  duration: number;
  /** hora de início dentro do show */
  start: number;
  bpm: string;
  /** "Original" ou "+2", como na coluna de tom da lista */
  tone: string;
  tuner: number;
  bpmShown: number;
  blockId: string | null;
  /** arquivo de áudio não encontrado no Mac */
  missing: boolean;
  parts: RemotePart[];
  regions: RemoteRegion[];
}

export interface RemoteBlock {
  id: string;
  name: string;
  color: string;
  duration: number;
}

export interface RemoteTrack {
  id: string;
  name: string;
  volume: number;
  mute: boolean;
  solo: boolean;
  locked: boolean;
  tone: 'cue' | 'band';
}

/** Cartão Tocando / Próxima do Modo Show. */
export interface RemoteCard {
  name: string;
  /** nome do medley quando o cartão mostra uma parte dele */
  medley: string | null;
  key: string;
  bpm: string;
  duration: number;
}

/** Resposta do Mac a um pedido do celular que leva número (`req`), como a seleção da Lista. */
export interface RemoteReply {
  req: string;
  ok: boolean;
  /** por que o Mac não fez (só quando `ok` é falso) */
  reason: string | null;
}

export interface RemoteState {
  v: number;
  /** relógio do Mac (ms) no momento em que o estado foi montado */
  at: number;
  showName: string;
  playing: boolean;
  paused: boolean;
  /** há música no ar (tocando ou pausada) */
  active: boolean;
  currentId: string | null;
  nextId: string | null;
  selectedId: string | null;
  flow: PlayFlow;
  /** posição na música (segundos do áudio original) em `at` */
  pos: number;
  /** segundos de áudio que andam por segundo de relógio (ajuste de BPM) */
  speed: number;
  /** segundos (de relógio) que faltam na música em `at`; null sem música */
  remaining: number | null;
  /** trecho que a barra de progresso mede (a música inteira ou a parte do medley) */
  segStart: number;
  segEnd: number;
  current: RemoteCard | null;
  next: RemoteCard | null;
  towers: { bpm: boolean; tuner: boolean };
  soloActive: boolean;
  error: string | null;
  diskLag: string[];
  audio: string;
  outputs: number;
  /** cronômetro "Falta no show" */
  clock: { run: { startedAt: number; durationSec: number } | null; duration: number };
  total: number;
  queued: { songId: string; regionId: string } | null;
  songs: RemoteSong[];
  blocks: RemoteBlock[];
  blockColors: string[];
  tracks: RemoteTrack[];
  master: number;
  /** última resposta do Mac a um pedido com número (programas antigos não mandam) */
  reply?: RemoteReply | null;
  /** versão do programa do Mac (a página da Rede Local se recarrega se for de outra versão) */
  app?: string;
  /** Show Online: revisão da lista (músicas, blocos, cores) que este estado leva */
  rev?: string;
}

export type AdjustKind = 'bpm' | 'tuner';

// `on`, `queue`, `loop`, `from` e `wasActive`: o que o celular via e quer na hora do toque. Com eles
// o Mac não desfaz no segundo toque (toque duplo de quem achou que não pegou). Sem eles (página
// antiga), o comando inverte como antes.
export type RemoteCommand =
  // transporte
  | { action: 'play' }
  /** `wasActive`: o celular via música no ar no toque */
  | { action: 'stop'; wasActive?: boolean }
  // ações antigas do controle celular (continuam valendo)
  | { action: 'pause' }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'selectSong'; songId: string }
  // Lista: tocar na música só seleciona (como o clique na playlist do Mac), sem tocar.
  // `req` é o número do pedido: o Mac responde em `reply` se selecionou ou por que não.
  | { action: 'select'; songId: string; req?: string }
  // Modo Show
  | { action: 'pick'; songId: string }
  | { action: 'setNext'; songId: string | null }
  | { action: 'flow'; flow: PlayFlow }
  | { action: 'towerBpm'; on?: boolean }
  | { action: 'towerTuner'; on?: boolean }
  | { action: 'adjust'; songId: string; kind: AdjustKind; delta: 1 | -1; partId?: string }
  /** `queue`: engatilhar (fora do ar); `loop`: loop ligado (parte no ar) */
  | { action: 'section'; songId: string; regionId: string; queue?: boolean; loop?: boolean }
  | { action: 'skipSection'; songId: string; on?: boolean }
  | { action: 'regionLoop'; songId: string; regionId: string; on?: boolean }
  /** `from`: repetições que o celular via (null = até desligar) */
  | { action: 'regionRepeat'; songId: string; regionId: string; from?: number | null }
  | { action: 'slice'; songId: string; partId: string }
  | { action: 'sliceToggle'; songId: string; partId: string; on?: boolean }
  | { action: 'clockStart' }
  | { action: 'clockReset' }
  | { action: 'clockDuration'; sec: number | null }
  | { action: 'dismissError' }
  // Mixer
  | { action: 'volume'; trackId: string; value: number }
  | { action: 'master'; value: number }
  | { action: 'mute'; trackId: string; on?: boolean }
  | { action: 'solo'; trackId: string; on?: boolean }
  // edição da lista (excluir fica só no Mac)
  | { action: 'rename'; songId: string; name: string }
  | { action: 'duplicate'; songId: string }
  | { action: 'move'; songId: string; dir: 1 | -1 }
  | { action: 'createBlock'; songId: string }
  | { action: 'renameBlock'; blockId: string; name: string }
  | { action: 'blockColor'; blockId: string; color: string };

const FLOWS: PlayFlow[] = ['continuo', 'bloco', 'uma-uma'];
const MAX_ID = 200;
const MAX_NAME = 120;
/** 24 h: o mesmo teto do cronômetro do show */
const MAX_CLOCK_SEC = 24 * 3600;

function id(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID ? v : null;
}

function name(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, MAX_NAME);
  return t ? t : null;
}

/** Número do pedido: letras, números, - e _, até 40. */
function reqId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null;
}

function dir(v: unknown): 1 | -1 | null {
  return v === 1 || v === -1 ? v : null;
}

function fader(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1.5, v)) : null;
}

/** Valor desejado (liga/desliga): ausente vale como "inverter"; qualquer coisa fora de sim/não recusa o comando. */
function flag(v: unknown): boolean | undefined | null {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'boolean' ? v : null;
}

/** Junta ao comando só os valores desejados que vieram (null em algum recusa o comando inteiro). */
function withFlags<T extends object>(cmd: T, flags: Record<string, boolean | undefined | null>): T | null {
  const out = { ...cmd } as Record<string, unknown>;
  for (const [k, v] of Object.entries(flags)) {
    if (v === null) return null;
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/**
 * Confere o comando que chegou do celular. Devolve null para qualquer coisa fora do formato:
 * o programa nunca executa um pedido que não reconhece.
 */
export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.action) {
    case 'play': case 'pause': case 'next': case 'prev':
    case 'clockStart': case 'clockReset': case 'dismissError':
      return { action: c.action };
    case 'stop':
      return withFlags({ action: 'stop' as const }, { wasActive: flag(c.wasActive) });
    case 'towerBpm': case 'towerTuner':
      return withFlags({ action: c.action }, { on: flag(c.on) });
    case 'select': {
      const songId = id(c.songId);
      if (!songId) return null;
      if (c.req === undefined || c.req === null) return { action: 'select', songId };
      const req = reqId(c.req);
      return req ? { action: 'select', songId, req } : null;
    }
    case 'selectSong': case 'pick': case 'duplicate': case 'createBlock': {
      const songId = id(c.songId);
      return songId ? { action: c.action, songId } : null;
    }
    case 'skipSection': {
      const songId = id(c.songId);
      return songId ? withFlags({ action: 'skipSection' as const, songId }, { on: flag(c.on) }) : null;
    }
    case 'setNext':
      if (c.songId === null) return { action: 'setNext', songId: null };
      return id(c.songId) ? { action: 'setNext', songId: c.songId as string } : null;
    case 'flow':
      return FLOWS.includes(c.flow as PlayFlow) ? { action: 'flow', flow: c.flow as PlayFlow } : null;
    case 'adjust': {
      const songId = id(c.songId);
      const delta = dir(c.delta);
      if (!songId || !delta || (c.kind !== 'bpm' && c.kind !== 'tuner')) return null;
      if (c.partId === undefined || c.partId === null) return { action: 'adjust', songId, kind: c.kind, delta };
      const partId = id(c.partId);
      return partId ? { action: 'adjust', songId, kind: c.kind, delta, partId } : null;
    }
    case 'section': case 'regionLoop': case 'regionRepeat': {
      const songId = id(c.songId);
      const regionId = id(c.regionId);
      if (!songId || !regionId) return null;
      if (c.action === 'section') {
        return withFlags({ action: 'section' as const, songId, regionId }, { queue: flag(c.queue), loop: flag(c.loop) });
      }
      if (c.action === 'regionLoop') return withFlags({ action: 'regionLoop' as const, songId, regionId }, { on: flag(c.on) });
      if (c.from === undefined) return { action: 'regionRepeat', songId, regionId };
      // null = até desligar (∞); senão o número de vezes
      const from = c.from === null ? null : typeof c.from === 'number' && Number.isInteger(c.from) && c.from > 0 && c.from <= 99 ? c.from : undefined;
      return from === undefined ? null : { action: 'regionRepeat', songId, regionId, from };
    }
    case 'slice': {
      const songId = id(c.songId);
      const partId = id(c.partId);
      return songId && partId ? { action: 'slice', songId, partId } : null;
    }
    case 'sliceToggle': {
      const songId = id(c.songId);
      const partId = id(c.partId);
      return songId && partId ? withFlags({ action: 'sliceToggle' as const, songId, partId }, { on: flag(c.on) }) : null;
    }
    case 'clockDuration':
      if (c.sec === null) return { action: 'clockDuration', sec: null };
      return typeof c.sec === 'number' && Number.isFinite(c.sec) && c.sec > 0 && c.sec <= MAX_CLOCK_SEC
        ? { action: 'clockDuration', sec: c.sec }
        : null;
    case 'volume': {
      const trackId = id(c.trackId);
      const value = fader(c.value);
      return trackId && value !== null ? { action: 'volume', trackId, value } : null;
    }
    case 'master': {
      const value = fader(c.value);
      return value !== null ? { action: 'master', value } : null;
    }
    case 'mute': case 'solo': {
      const trackId = id(c.trackId);
      return trackId ? withFlags({ action: c.action, trackId }, { on: flag(c.on) }) : null;
    }
    case 'rename': {
      const songId = id(c.songId);
      const n = name(c.name);
      return songId && n ? { action: 'rename', songId, name: n } : null;
    }
    case 'move': {
      const songId = id(c.songId);
      const d = dir(c.dir);
      return songId && d ? { action: 'move', songId, dir: d } : null;
    }
    case 'renameBlock': {
      const blockId = id(c.blockId);
      const n = name(c.name);
      return blockId && n ? { action: 'renameBlock', blockId, name: n } : null;
    }
    case 'blockColor': {
      const blockId = id(c.blockId);
      const color = typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : null;
      return blockId && color ? { action: 'blockColor', blockId, color } : null;
    }
    default:
      return null;
  }
}

// ---------- medidores (barra de LEDs de cada fader) ----------
// Vão separados do estado: chegam umas 12 vezes por segundo e são pequenos.

/** Nível de pico (amplitude, 1 = 0 dBFS) de cada canal do Remote e do master. */
export interface RemoteMeters {
  v: number;
  at: number;
  ids: string[];
  levels: number[];
  master: number;
}

const MAX_METER_IDS = 64;

function meterValue(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  // 4 casas bastam: o medidor começa em -48 dBFS (0,004)
  return Math.round(Math.max(0, Math.min(4, n)) * 10000) / 10000;
}

/** Monta o pacote dos medidores com o nível de cada canal (`level`) e do master. */
export function packMeters(ids: string[], level: (id: string) => number, at: number): RemoteMeters {
  const list = ids.slice(0, MAX_METER_IDS);
  return { v: REMOTE_VERSION, at, ids: list, levels: list.map((id) => meterValue(level(id))), master: meterValue(level('master')) };
}

/** Pacote de medidores que chegou e parece inteiro. */
export function isRemoteMeters(raw: unknown): raw is RemoteMeters {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<RemoteMeters>;
  return m.v === REMOTE_VERSION && typeof m.at === 'number' && Array.isArray(m.ids) && Array.isArray(m.levels)
    && m.ids.length === m.levels.length && m.ids.length <= MAX_METER_IDS && typeof m.master === 'number';
}

/** Nível de cada canal pelo id (e 'master'), para os medidores do celular. */
export function unpackMeters(m: RemoteMeters): Map<string, number> {
  const out = new Map<string, number>();
  m.ids.forEach((id, i) => { if (typeof id === 'string') out.set(id, meterValue(m.levels[i])); });
  out.set('master', meterValue(m.master));
  return out;
}

// ---------- seleção pela Lista do celular ----------

/** Sem resposta do Mac nesse tempo, a seleção tocada no celular volta e o celular avisa. */
export const PICK_TIMEOUT_MS = 5000;

/** Música tocada na Lista que espera a resposta do Mac. `at` é o relógio do celular no toque. */
export interface PendingPick {
  songId: string;
  req: string;
  at: number;
}

export type PickCheck =
  | { kind: 'wait' }
  | { kind: 'done' }
  | { kind: 'refused'; reason: string };

export const PICK_NO_ANSWER = 'O Mac não respondeu. Confira se o programa está aberto e conectado, e toque de novo.';

/**
 * Como está a música tocada no celular:
 * - o Mac respondeu ao pedido: selecionou (`done`) ou recusou, com o motivo (`refused`);
 * - o Mac já mostra a música selecionada (programa antigo, que não responde): `done`;
 * - passou do tempo sem nada: `refused` (o destaque volta para a seleção do Mac);
 * - senão espera (`wait`), com a música já destacada no celular.
 */
export function checkPick(pick: PendingPick, state: RemoteState, now: number): PickCheck {
  const reply = state.reply;
  if (reply && reply.req === pick.req) {
    return reply.ok ? { kind: 'done' } : { kind: 'refused', reason: reply.reason || 'O Mac não selecionou a música.' };
  }
  if (state.selectedId === pick.songId) return { kind: 'done' };
  if (now - pick.at >= PICK_TIMEOUT_MS) return { kind: 'refused', reason: PICK_NO_ANSWER };
  return { kind: 'wait' };
}

/** Música destacada na Lista: a tocada agora (sem esperar o Mac) ou a selecionada no Mac. */
export function shownSelection(pick: PendingPick | null, state: RemoteState): string | null {
  return pick ? pick.songId : state.selectedId;
}

/** Estado que chegou e parece inteiro. */
export function isRemoteState(raw: unknown): raw is RemoteState {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Partial<RemoteState>;
  return s.v === REMOTE_VERSION && typeof s.at === 'number' && Array.isArray(s.songs) && Array.isArray(s.tracks);
}

// ---------- tempo no celular entre uma mensagem e outra ----------
// `macNow` é o relógio do Mac estimado no celular (Date.now() + diferença medida na chegada).

function elapsedSec(s: RemoteState, macNow: number): number {
  return s.playing ? Math.max(0, (macNow - s.at) / 1000) : 0;
}

/** Posição na música agora. */
export function livePos(s: RemoteState, macNow: number): number {
  return s.pos + elapsedSec(s, macNow) * s.speed;
}

/** Segundos que faltam na música agora (null sem música). */
export function liveRemaining(s: RemoteState, macNow: number): number | null {
  if (s.remaining === null) return null;
  return Math.max(0, s.remaining - elapsedSec(s, macNow));
}

/** Progresso (0 a 100) da música no ar, igual à barra de LEDs do Modo Show. */
export function liveProgressPct(s: RemoteState, macNow: number): number {
  if (!s.playing) return 0;
  const len = s.segEnd - s.segStart;
  if (!(len > 0)) return 0;
  return Math.min(100, Math.max(0, ((livePos(s, macNow) - s.segStart) / len) * 100));
}

// ---------- relógio do Mac no celular (Rede Local) ----------

/** Quantas medidas da diferença de relógio ficam guardadas. */
const CLOCK_SAMPLES = 10;

/**
 * Guarda mais uma medida da diferença entre o relógio do Mac e o do celular e devolve a que vale.
 * A resposta atrasada no Wi-Fi só diminui a diferença medida, então a maior das últimas é a mais certa.
 */
export function pushClockSample(samples: number[], sample: number): number {
  samples.push(sample);
  if (samples.length > CLOCK_SAMPLES) samples.splice(0, samples.length - CLOCK_SAMPLES);
  return Math.max(...samples);
}

// ---------- fila de comandos do celular (Rede Local) ----------

function sameFader(a: RemoteCommand, b: RemoteCommand): boolean {
  return (a.action === 'master' && b.action === 'master')
    || (a.action === 'volume' && b.action === 'volume' && a.trackId === b.trackId);
}

/** Põe o comando na fila. Fader que já espera na fila só troca de valor (vale o último). */
export function enqueueCommand(queue: RemoteCommand[], cmd: RemoteCommand): void {
  const i = queue.findIndex((q) => sameFader(q, cmd));
  if (i >= 0) queue[i] = cmd;
  else queue.push(cmd);
}

// ---------- Show Online: a lista só vai quando muda ----------
// A lista (músicas com partes e marcações, blocos, cores) é a parte grande do estado. O Mac manda
// a lista inteira quando ela muda, quando um celular pede ('hello') ou quando há no canal uma
// página antiga; nas outras mensagens vai o estado leve (`lite`) com a revisão da lista.

/** A lista do show que o celular guarda para juntar com as mensagens leves. */
export interface RemoteList {
  rev?: string;
  songs: RemoteSong[];
  blocks: RemoteBlock[];
  blockColors: string[];
}

/** Texto que identifica a lista (para saber se mudou). */
export function remoteListKey(s: RemoteState): string {
  return JSON.stringify([s.songs, s.blocks, s.blockColors]);
}

/** Revisão pelo conteúdo (FNV-1a de 32 bits): muda com qualquer mudança e não repete ao reabrir o Mac. */
export function listRevision(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Estado sem a lista, com a revisão dela. */
export function liteRemoteState(s: RemoteState, rev: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s, rev, lite: 1 };
  delete out.songs;
  delete out.blocks;
  delete out.blockColors;
  return out;
}

export type RemoteMessage =
  /** estado inteiro, com a lista que o celular passa a guardar */
  | { kind: 'state'; state: RemoteState; list: RemoteList }
  /** estado leve de outra lista (ou sem lista guardada): o celular pede o estado completo */
  | { kind: 'needFull' }
  | { kind: 'bad' };

/**
 * Lê o estado que chegou do Mac. O estado leve é juntado com a lista guardada quando a revisão
 * bate; o completo (de qualquer versão do Mac, com ou sem revisão) vale como sempre.
 */
export function readRemoteMessage(raw: unknown, list: RemoteList | null): RemoteMessage {
  if (!raw || typeof raw !== 'object') return { kind: 'bad' };
  const m = raw as Record<string, unknown>;
  if (m.lite === 1) {
    if (!list || list.rev === undefined || typeof m.rev !== 'string' || list.rev !== m.rev) return { kind: 'needFull' };
    const joined: Record<string, unknown> = { ...m, songs: list.songs, blocks: list.blocks, blockColors: list.blockColors };
    delete joined.lite;
    return isRemoteState(joined) ? { kind: 'state', state: joined, list } : { kind: 'bad' };
  }
  if (!isRemoteState(raw)) return { kind: 'bad' };
  const rev = typeof raw.rev === 'string' ? raw.rev : undefined;
  return {
    kind: 'state',
    state: raw,
    list: { rev, songs: raw.songs, blocks: Array.isArray(raw.blocks) ? raw.blocks : [], blockColors: Array.isArray(raw.blockColors) ? raw.blockColors : [] },
  };
}
