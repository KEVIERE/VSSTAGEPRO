import type { LyricPage } from '@/lib/prompterTypes';

export type TrackType = 'audio' | 'midi' | 'subgroup' | 'master';

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  antiClip: boolean;
  isSubgroup: boolean;
  parentId: string | null;
  children: string[];
  height: number;
  visible: boolean;
  /** -1 = sem saída, 0 = Master L/R, N = saída física N da interface */
  outputChannel: number;
  faderLocked?: boolean;
  meterLevel: number;
  clipIndicator: boolean;
  /** Pico (linear) que causou o último clip, mantido até o usuário resolver */
  clipPeak: number;
}

export type PlayFlow = 'continuo' | 'bloco' | 'uma-uma';

export interface Marker {
  id: string;
  name: string;
  position: number;
  type: 'start' | 'end' | 'custom';
}

export interface SongRegion {
  id: string;
  name: string;
  /** Segundos no tempo original da música (independente do ajuste de BPM) */
  start: number;
  end: number;
  color: string;
  loop: boolean;
  /** Quantas vezes a região toca com o loop ligado; ausente = até desligar */
  repeat?: number;
}

/** Uma música dentro de um medley; a primeira sempre começa em 0 */
export interface MedleyPart {
  id: string;
  name: string;
  start: number;
  /** false = pulada quando a reprodução chega nela sozinha */
  enabled?: boolean;
  /** Sem valor, herda o ajuste da música */
  bpmAdjust?: number;
  tuner?: number;
}

/** Formato antigo (pontos), lido apenas para converter projetos salvos antes das regiões */
export interface LegacySongMarker {
  id: string;
  name: string;
  position: number;
  color: string;
}

export interface AudioClip {
  id: string;
  trackId: string;
  name: string;
  fileName: string;
  filePath: string;
  songId: string;
  startTime: number;
  duration: number;
  sampleRate: number;
  channels: number;
  bpm: number | null;
  markers: Marker[];
  routingMethod: 'name' | 'ai' | 'manual';
  routingConfidence: number;
  waveformPeaks: number[];
  /** Segundos cortados do fim do áudio (o arquivo continua inteiro) */
  trimEnd?: number;
}

export interface Song {
  id: string;
  name: string;
  clips: string[];
  bpm: number;
  bpmDetected?: boolean;
  /** 'click' quando o BPM foi medido batida a batida na faixa de click */
  bpmSource?: 'click' | 'audio' | 'manual';
  /** A medição automática não encontrou o BPM */
  bpmMissing?: boolean;
  /** Segundos (tempo original) do primeiro tempo forte; base da grade de compassos */
  downbeat?: number;
  beatsPerBar?: 3 | 4 | 6;
  bpmAdjust: number;
  tuner: number;
  duration: number;
  timelineStart: number;
  blockId: string | null;
  /** Ausente em projetos salvos antes das regiões existirem */
  regions?: SongRegion[];
  markers?: LegacySongMarker[];
  medley?: MedleyPart[];
}

export interface Block {
  id: string;
  name: string;
  color: string;
  order: number;
}

export type SequenceStatus = 'idle' | 'playing' | 'paused' | 'stopped';

export interface PlaylistEntry {
  id: string;
  songId: string;
  name: string;
  order: number;
  bpm?: number;
  blockId: string | null;
  duration: number;
}

export interface ShowSet {
  id: string;
  name: string;
  playlist: PlaylistEntry[];
}

export type ImportStatus = 'idle' | 'decoding' | 'detecting-bpm' | 'classifying' | 'routing' | 'done' | 'error';

export interface ImportProgress {
  clipId: string;
  status: ImportStatus;
  message: string;
  current?: number;
  total?: number;
}

export type RoutingTarget =
  | 'track-guia'
  | 'track-click'
  | 'track-maestro'
  | 'track-bateria'
  | 'track-percussoes'
  | 'track-contrabaixo'
  | 'track-guitarras'
  | 'track-violoes'
  | 'track-sanfonas'
  | 'track-teclados'
  | 'track-solos'
  | 'track-outros';

export interface TransportState {
  isPlaying: boolean;
  isPaused: boolean;
  isStopped: boolean;
  currentTime: number;
  bpm: number;
  playFlow: PlayFlow;
  currentSongId: string | null;
  nextSongId: string | null;
  songProgress: number;
  nextSongCountdown: number;
}

export type ExportFormat = 'vs_stage' | 'reaper' | 'logicpro';
export type ExportMode = 'lr' | 'multipista';
export type ExportScope = 'musica' | 'projeto';

export interface ExportConfig {
  scope: ExportScope;
  mode: ExportMode;
  songId?: string;
}

export type PanelVisibility = {
  mixer: boolean;
  playlist: boolean;
  timeline: boolean;
};

export interface ProjectState {
  projectName: string;
  tracks: Track[];
  clips: AudioClip[];
  songs: Song[];
  blocks: Block[];
  playlist: PlaylistEntry[];
  playlistOrder: string[];
  shows: ShowSet[];
  activeShowId: string | null;
  defaultPlaylist: PlaylistEntry[] | null;
  timelineOrder: string[];
  transport: TransportState;
  selectedTrackId: string | null;
  selectedSongId: string | null;
  selectedClipIds: string[];
  selectedBlockId: string | null;
  mixerVisible: boolean;
  playlistVisible: boolean;
  playlistMaximized: boolean;
  timelineVisible: boolean;
  mixerHeight: number;
  zoomH: number;
  zoomV: number;
  importProgress: ImportProgress | null;
  lrMasterActive: boolean;
  magicRoutingActive: boolean;
  audioInterface: string;
  showBpmTower: boolean;
  showTunerTower: boolean;
  exportProgress: { active: boolean; message: string } | null;
  masterVolume: number;
  masterMeterLevel: number;
  masterClipPeak: number;
  playbackError: string | null;
  preparingParams: { done: number; total: number } | null;
  lyricMaps: Record<string, LyricPage[]>;
}
