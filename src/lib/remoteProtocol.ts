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
}

export type AdjustKind = 'bpm' | 'tuner';

export type RemoteCommand =
  // transporte
  | { action: 'play' }
  | { action: 'stop' }
  // ações antigas do controle celular (continuam valendo)
  | { action: 'pause' }
  | { action: 'next' }
  | { action: 'prev' }
  | { action: 'selectSong'; songId: string }
  // Lista: tocar na música só seleciona (como o clique na playlist do Mac), sem tocar
  | { action: 'select'; songId: string }
  // Modo Show
  | { action: 'pick'; songId: string }
  | { action: 'setNext'; songId: string | null }
  | { action: 'flow'; flow: PlayFlow }
  | { action: 'towerBpm' }
  | { action: 'towerTuner' }
  | { action: 'adjust'; songId: string; kind: AdjustKind; delta: 1 | -1; partId?: string }
  | { action: 'section'; songId: string; regionId: string }
  | { action: 'skipSection'; songId: string }
  | { action: 'regionLoop'; songId: string; regionId: string }
  | { action: 'regionRepeat'; songId: string; regionId: string }
  | { action: 'slice'; songId: string; partId: string }
  | { action: 'sliceToggle'; songId: string; partId: string }
  | { action: 'clockStart' }
  | { action: 'clockReset' }
  | { action: 'clockDuration'; sec: number | null }
  | { action: 'dismissError' }
  // Mixer
  | { action: 'volume'; trackId: string; value: number }
  | { action: 'master'; value: number }
  | { action: 'mute'; trackId: string }
  | { action: 'solo'; trackId: string }
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

function dir(v: unknown): 1 | -1 | null {
  return v === 1 || v === -1 ? v : null;
}

function fader(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1.5, v)) : null;
}

/**
 * Confere o comando que chegou do celular. Devolve null para qualquer coisa fora do formato:
 * o programa nunca executa um pedido que não reconhece.
 */
export function parseRemoteCommand(raw: unknown): RemoteCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.action) {
    case 'play': case 'stop': case 'pause': case 'next': case 'prev':
    case 'towerBpm': case 'towerTuner': case 'clockStart': case 'clockReset': case 'dismissError':
      return { action: c.action };
    case 'selectSong': case 'select': case 'pick': case 'skipSection': case 'duplicate': case 'createBlock': {
      const songId = id(c.songId);
      return songId ? { action: c.action, songId } : null;
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
      return songId && regionId ? { action: c.action, songId, regionId } : null;
    }
    case 'slice': case 'sliceToggle': {
      const songId = id(c.songId);
      const partId = id(c.partId);
      return songId && partId ? { action: c.action, songId, partId } : null;
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
      return trackId ? { action: c.action, trackId } : null;
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
