import { create } from 'zustand';
import { temporal } from 'zundo';
import { routeByName } from '@/lib/nameRouter';
import { computeNextSongId } from '@/lib/playFlow';
import type {
  ProjectState, Track, AudioClip, Song, Block, PlaylistEntry,
  PlayFlow, RoutingTarget, ImportProgress, ExportConfig, SongRegion, MedleyPart,
} from '@/types';
import { clearAudioLibrary, clipPlayLength, registerClipSource } from '@/lib/audioLibrary';
import { normalizePages } from '@/lib/prompterTypes';
import { convertLegacyMarkers, minRegionLength, neighbourBounds, RESIZE_MIN_LENGTH, sortedRegions, withoutLoops } from '@/lib/regions';
import type { RegionLayout } from '@/lib/regions';
import type { SaveTarget } from '@/lib/projectSaver';
import type { SnapStep } from '@/lib/grid';

export interface InstantPrep {
  done: number;
  total: number;
  name?: string;
  ready?: boolean;
  failed?: number;
}
import { entriesForSongs, newShowId, normalizeShows, removeSongFromShows, switchShow, syncedShows } from '@/lib/shows';
import { isTimecodeTrackId, makeTimecodeTrack, NO_OUTPUT, TIMECODE_TRACK_ID, usedOutputs, withTimecodeFirst } from '@/lib/timecode';

function migrateSongRegions(song: Song): Song {
  if (song.regions) return song.markers ? { ...song, markers: undefined } : song;
  return { ...song, regions: convertLegacyMarkers(song.markers ?? [], song.duration, song.bpm), markers: undefined };
}

const DEFAULT_TRACKS: Track[] = [
  makeTimecodeTrack(),
  { id: 'track-click', name: 'Click', type: 'audio', color: '#5b8db8', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: false, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-maestro', name: 'Maestro', type: 'audio', color: '#5b8db8', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: false, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-bateria', name: 'Bateria', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-contrabaixo', name: 'Contrabaixo', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-percussoes', name: 'Percussões', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-guitarras', name: 'Guitarras', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-violoes', name: 'Violões', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-sanfonas', name: 'Sanfonas', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-teclados', name: 'Teclados', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-solos', name: 'Solos', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
  { id: 'track-outros', name: 'Outros', type: 'subgroup', color: '#5bb87a', volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true, outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0 },
];

export const ROUTABLE_TRACKS: RoutingTarget[] = [
  'track-click', 'track-maestro', 'track-bateria', 'track-contrabaixo',
  'track-percussoes', 'track-guitarras', 'track-violoes', 'track-sanfonas',
  'track-teclados', 'track-solos', 'track-outros',
];

export const BLOCK_COLORS = [
  '#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158',
  '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f', '#8e8e93',
  '#b3261e', '#e8590c', '#a3e635', '#15803d', '#0f766e',
  '#1e3a8a', '#ec4899', '#8b5a2b', '#3a3a3c', '#000000',
];

interface ProjectStateExt {
  magicRoutingActive: boolean;
  prevOutputChannels: Record<string, number> | null;
  saveDialogOpen: boolean;
  openDialogOpen: boolean;
  audioDeviceDialogOpen: boolean;
  bounceDialogOpen: boolean;
  loadingSongIds: string[];
  incompleteSongIds: string[];
  instantPrep: InstantPrep | null;
  /** Quantas saídas físicas a interface de áudio escolhida oferece */
  outputChannelCount: number;
  queuedRegion: { songId: string; regionId: string } | null;
  sectionKeys: boolean;
  saveTarget: SaveTarget | null;
  saveStatus: { kind: 'saving' | 'saved' | 'error'; message: string } | null;
  snapStep: SnapStep;
}

function normalizeLyricMaps(raw: unknown): ProjectState['lyricMaps'] {
  if (!raw || typeof raw !== 'object') return {};
  const out: ProjectState['lyricMaps'] = {};
  for (const [songId, pages] of Object.entries(raw as Record<string, unknown>)) {
    const list = normalizePages(pages);
    if (list.length > 0) out[songId] = list;
  }
  return out;
}

export const DEFAULT_PROJECT_NAME = 'Novo Projeto';

const INITIAL_STATE: ProjectState & ProjectStateExt = {
  projectName: DEFAULT_PROJECT_NAME,
  tracks: DEFAULT_TRACKS.map((t) => ({ ...t })),
  magicRoutingActive: false,
  prevOutputChannels: null,
  saveDialogOpen: false,
  openDialogOpen: false,
  audioDeviceDialogOpen: false,
  bounceDialogOpen: false,
  loadingSongIds: [],
  incompleteSongIds: [],
  instantPrep: null,
  outputChannelCount: 2,
  queuedRegion: null,
  sectionKeys: localStorage.getItem('sectionKeys') === '1',
  saveTarget: null,
  saveStatus: null,
  snapStep: 'beat',
  clips: [],
  songs: [],
  blocks: [],
  playlist: [],
  playlistOrder: [],
  shows: [],
  activeShowId: null,
  defaultPlaylist: null,
  timelineOrder: [],
  transport: {
    isPlaying: false,
    isPaused: false,
    isStopped: true,
    currentTime: 0,
    bpm: 120,
    playFlow: 'continuo',
    currentSongId: null,
    nextSongId: null,
    songProgress: 0,
    nextSongCountdown: 0,
  },
  selectedTrackId: null,
  selectedSongId: null,
  selectedClipIds: [],
  selectedBlockId: null,
  mixerVisible: true,
  playlistVisible: true,
  playlistMaximized: false,
  timelineVisible: true,
  mixerHeight: 220,
  zoomH: 20,
  zoomV: 1,
  importProgress: null,
  lrMasterActive: false,
  audioInterface: 'default',
  showBpmTower: false,
  showTunerTower: false,
  exportProgress: null,
  masterVolume: 0.8,
  masterMeterLevel: 0,
  masterClipPeak: 0,
  playbackError: null,
  preparingParams: null,
  lyricMaps: {},
};

interface StoreActions {
  setProjectName: (name: string) => void;
  setLyricMaps: (maps: ProjectState['lyricMaps']) => void;
  selectTrack: (id: string | null) => void;
  selectSong: (id: string | null) => void;
  selectClip: (id: string | null, additive?: boolean) => void;
  selectClips: (ids: string[]) => void;
  trimClips: (trims: { id: string; trimEnd: number }[]) => void;
  selectBlock: (id: string | null) => void;
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  toggleAntiClip: (trackId: string) => void;
  setVolume: (trackId: string, volume: number) => void;
  setPan: (trackId: string, pan: number) => void;
  setTrackColor: (trackId: string, color: string) => void;
  setOutputChannel: (trackId: string, channel: number) => void;
  toggleFaderLock: (trackId: string) => void;
  setOutputChannelCount: (count: number) => void;
  addChildTrack: (parentId: string, name: string, childId?: string) => void;
  setPlayFlow: (flow: PlayFlow) => void;
  cyclePlayFlow: () => void;
  play: () => void;
  pause: (time: number) => void;
  stop: (returnTo?: number) => void;
  setBpm: (bpm: number) => void;
  setCurrentTime: (time: number) => void;
  setSongProgress: (progress: number) => void;
  setNextSongCountdown: (seconds: number) => void;
  setPlaybackTick: (time: number, progress: number, countdown: number) => void;
  setNextSong: (songId: string | null) => void;
  toggleMixer: () => void;
  togglePlaylist: () => void;
  toggleTimeline: () => void;
  togglePlaylistMaximized: () => void;
  setMixerHeight: (height: number) => void;
  setZoomH: (zoom: number) => void;
  setZoomV: (zoom: number) => void;
  newProject: () => void;
  loadProject: (data: Partial<ProjectState>) => void;
  addToPlaylist: (songId: string, name: string, duration: number, bpm?: number) => void;
  removeFromPlaylist: (songId: string) => void;
  duplicatePlaylistEntry: (songId: string) => void;
  reorderPlaylist: (fromIndex: number, toIndex: number) => void;
  createShow: (name: string, songIds: string[]) => string;
  updateShow: (id: string, patch: { name?: string; songIds?: string[] }) => void;
  duplicateShow: (id: string) => void;
  deleteShow: (id: string) => void;
  activateShow: (id: string | null) => void;
  addClip: (clip: AudioClip) => void;
  updateClip: (clipId: string, updates: Partial<AudioClip>) => void;
  removeClip: (clipId: string) => void;
  routeClip: (clipId: string, targetTrackId: string) => void;
  resetClipRouting: (clipId: string) => void;
  setClipMarkers: (clipId: string, markers: AudioClip['markers']) => void;
  setImportProgress: (progress: ImportProgress | null) => void;
  setClipBpm: (clipId: string, bpm: number) => void;
  addSong: (song: Song) => void;
  updateSong: (songId: string, updates: Partial<Song>) => void;
  removeSong: (songId: string) => void;
  renameSong: (songId: string, name: string) => void;
  setSongBpmAdjust: (songId: string, adjust: number) => void;
  setSongTuner: (songId: string, tuner: number) => void;
  addSongRegion: (songId: string, region: SongRegion) => boolean;
  updateSongRegion: (songId: string, regionId: string, updates: Partial<Omit<SongRegion, 'id'>>) => void;
  removeSongRegion: (songId: string, regionId: string) => void;
  placeSongRegions: (songId: string, layout: RegionLayout) => void;
  setSongLoading: (songId: string, loading: boolean) => void;
  setSongIncomplete: (songId: string, incomplete: boolean) => void;
  setInstantPrep: (prep: InstantPrep | null) => void;
  setQueuedRegion: (queued: { songId: string; regionId: string } | null) => void;
  updateMedleyPart: (songId: string, partId: string, patch: Partial<Omit<MedleyPart, 'id'>>) => void;
  toggleSectionKeys: () => void;
  createBlock: (afterSongId?: string) => void;
  renameBlock: (blockId: string, name: string) => void;
  setBlockColor: (blockId: string, color: string) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, toIndex: number) => void;
  moveBlockTo: (blockId: string, beforeSongId: string | null) => void;
  moveSongTo: (songId: string, beforeSongId: string | null, blockId: string | null) => void;
  assignSongToBlock: (songId: string, blockId: string | null) => void;
  toggleBpmTower: () => void;
  toggleTunerTower: () => void;
  toggleLrMaster: () => void;
  toggleMagicRouting: () => void;
  setAudioInterface: (iface: string) => void;
  updateMeter: (trackId: string, level: number) => void;
  updateMasterMeter: (level: number) => void;
  clearMasterClipIndicator: () => void;
  setPlaybackError: (message: string | null) => void;
  applyAntiClipMaster: () => void;
  setMasterVolume: (volume: number) => void;
  clearClipIndicator: (trackId: string) => void;
  applyAntiClip: (trackId: string) => void;
  setPreparingParams: (v: { done: number; total: number } | null) => void;

  setVolumeDb: (trackId: string, dbChange: number) => void;
  exportProject: (config: ExportConfig) => void;
  setExportProgress: (progress: { active: boolean; message: string } | null) => void;
  recalcTimeline: () => void;
  reconcileTracks: () => void;
  reconcileTracksAnnounced: () => void;
  setSaveDialogOpen: (v: boolean) => void;
  setOpenDialogOpen: (v: boolean) => void;
  setAudioDeviceDialogOpen: (v: boolean) => void;
  setBounceDialogOpen: (v: boolean) => void;
  applyLoadedProject: (manifest: Partial<ProjectState>, sources: Map<string, Blob>, target?: SaveTarget) => void;
  setSaveTarget: (target: SaveTarget | null) => void;
  setSaveStatus: (status: ProjectStateExt['saveStatus']) => void;
  setSnapStep: (step: SnapStep) => void;
}

export type Store = ProjectState & ProjectStateExt & StoreActions;

export const HISTORY_LIMIT = Number.POSITIVE_INFINITY;

let entrySeq = 0;
function newEntryId(): string {
  entrySeq += 1;
  return `pl-${Date.now().toString(36)}-${entrySeq}-${Math.random().toString(36).slice(2, 7)}`;
}

// Projetos antigos podiam ter músicas com a mesma identificação (importadas no mesmo instante),
// o que fazia a lista ser desenhada fora de ordem. A ordem salva é preservada.
function normalizePlaylist(playlist: PlaylistEntry[], order: string[]): { playlist: PlaylistEntry[]; playlistOrder: string[] } {
  const rank = new Map(order.map((id, i) => [id, i]));
  const sorted = [...playlist].sort((a, b) =>
    (rank.get(a.songId) ?? a.order ?? 0) - (rank.get(b.songId) ?? b.order ?? 0));
  const seenIds = new Set<string>();
  const seenSongs = new Set<string>();
  const fixed: PlaylistEntry[] = [];
  for (const p of sorted) {
    if (seenSongs.has(p.songId)) continue;
    seenSongs.add(p.songId);
    const id = p.id && !seenIds.has(p.id) ? p.id : newEntryId();
    seenIds.add(id);
    fixed.push({ ...p, id, order: fixed.length });
  }
  return { playlist: fixed, playlistOrder: fixed.map((p) => p.songId) };
}

// Só o que o usuário edita entra no Desfazer; cursor, medidores e preferências de tela ficam de fora.
export function partializeHistory(state: Store) {
  return {
    projectName: state.projectName,
    tracks: state.tracks,
    clips: state.clips,
    songs: state.songs,
    blocks: state.blocks,
    playlist: state.playlist,
    playlistOrder: state.playlistOrder,
    shows: state.shows,
    activeShowId: state.activeShowId,
    defaultPlaylist: state.defaultPlaylist,
    timelineOrder: state.timelineOrder,
    lrMasterActive: state.lrMasterActive,
  };
}

export type HistoryState = ReturnType<typeof partializeHistory>;

const TRANSIENT_TRACK_KEYS = new Set<keyof Track>(['meterLevel', 'clipIndicator', 'clipPeak']);

function tracksEqual(a: Track[], b: Track[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const keys = Object.keys(x) as Array<keyof Track>;
    if (keys.length !== Object.keys(y).length) return false;
    for (const k of keys) {
      if (!TRANSIENT_TRACK_KEYS.has(k) && x[k] !== y[k]) return false;
    }
  }
  return true;
}

export function historyEqual(a: HistoryState, b: HistoryState): boolean {
  for (const key of Object.keys(a) as Array<keyof HistoryState>) {
    if (key === 'tracks') {
      if (!tracksEqual(a.tracks, b.tracks)) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

export const useStore = create<Store>()(
  temporal(
    (set, get) => ({
      ...INITIAL_STATE,

      setProjectName: (name) => set({ projectName: name }),
      setLyricMaps: (maps) => set({ lyricMaps: maps }),
      selectTrack: (id) => set({ selectedTrackId: id }),
      selectSong: (id) => set((s) => {
        if (id === s.selectedSongId || s.transport.isPlaying) return { selectedSongId: id };
        // trocar de música parada/pausada leva o cursor para o início da nova música
        return {
          selectedSongId: id,
          transport: { ...s.transport, isPaused: false, currentTime: 0, songProgress: 0 },
        };
      }),
      selectClip: (id, additive) => set((s) => {
        if (!id) return { selectedClipIds: [] };
        if (!additive) return { selectedClipIds: [id] };
        return {
          selectedClipIds: s.selectedClipIds.includes(id)
            ? s.selectedClipIds.filter((c) => c !== id)
            : [...s.selectedClipIds, id],
        };
      }),
      selectClips: (ids) => set({ selectedClipIds: ids }),
      trimClips: (trims) => set((s) => {
        const byId = new Map(trims.map((t) => [t.id, t.trimEnd]));
        const clips = s.clips.map((c) => {
          const t = byId.get(c.id);
          if (t === undefined) return c;
          return { ...c, trimEnd: Math.max(0, Math.min(c.duration - 0.05, t)) };
        });
        const touched = new Set(clips.filter((c) => byId.has(c.id)).map((c) => c.songId));
        const ends = new Map<string, number>();
        for (const c of clips) {
          if (!touched.has(c.songId)) continue;
          ends.set(c.songId, Math.max(ends.get(c.songId) ?? 0, c.startTime + clipPlayLength(c)));
        }
        return {
          clips,
          songs: s.songs.map((sg) => ends.has(sg.id) ? { ...sg, duration: ends.get(sg.id)! } : sg),
          playlist: s.playlist.map((p) => ends.has(p.songId) ? { ...p, duration: ends.get(p.songId)! } : p),
        };
      }),
      selectBlock: (id) => set({ selectedBlockId: id }),

      toggleMute: (trackId) => set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, mute: !t.mute } : t) })),
      toggleSolo: (trackId) => set((s) => isTimecodeTrackId(trackId) ? s : ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, solo: !t.solo } : t) })),
      toggleAntiClip: (trackId) => set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, antiClip: !t.antiClip } : t) })),

      setVolume: (trackId, volume) => set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId && !t.faderLocked ? { ...t, volume: Math.max(0, Math.min(1.5, volume)) } : t) })),
      setPan: (trackId, pan) => set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, pan: Math.max(-1, Math.min(1, pan)) } : t) })),
      setTrackColor: (trackId, color) => set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, color } : t) })),
      setOutputChannel: (trackId, channel) => set((s) => {
        const tc = s.tracks.find((t) => t.id === TIMECODE_TRACK_ID);
        if (isTimecodeTrackId(trackId)) {
          // o sinal de timecode nunca vai para o Master nem divide saída com a música
          if (channel !== NO_OUTPUT && (channel <= 0 || usedOutputs(s.tracks, trackId).has(channel))) return s;
        } else if (channel === NO_OUTPUT || (tc && channel > 0 && tc.outputChannel === channel)) {
          return s;
        }
        return { tracks: s.tracks.map((t) => t.id === trackId ? { ...t, outputChannel: channel } : t) };
      }),
      toggleFaderLock: (trackId) => set((s) => ({ tracks: s.tracks.map((t) => t.id === trackId ? { ...t, faderLocked: !t.faderLocked } : t) })),
      setOutputChannelCount: (count) => set((s) => (s.outputChannelCount === count ? s : { outputChannelCount: count })),

      addChildTrack: (parentId, name, childId) => {
        const id = childId || `track-${Date.now()}`;
        const parent = get().tracks.find((t) => t.id === parentId);
        set((s) => ({
          tracks: [
            ...s.tracks.map((t) => t.id === parentId ? { ...t, children: [...t.children, id] } : t),
            {
              id, name, type: 'audio' as const, color: parent?.color ?? '#5b8db8',
              volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false,
              isSubgroup: false, parentId, children: [], height: 40, visible: true,
              outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0,
            },
          ],
        }));
      },

      setPlayFlow: (flow) => set((s) => {
        if (flow === 'uma-uma') {
          return { transport: { ...s.transport, playFlow: flow, nextSongId: null, nextSongCountdown: 0 } };
        }
        const curId = s.transport.currentSongId ?? s.selectedSongId ?? s.playlist[0]?.songId ?? null;
        const nextId = computeNextSongId(curId, s.playlist, s.playlistOrder, flow);
        return { transport: { ...s.transport, playFlow: flow, nextSongId: nextId } };
      }),
      cyclePlayFlow: () => set((s) => {
        const flows: PlayFlow[] = ['continuo', 'bloco', 'uma-uma'];
        const idx = flows.indexOf(s.transport.playFlow);
        const nextFlow = flows[(idx + 1) % 3];
        if (nextFlow === 'uma-uma') {
          return { transport: { ...s.transport, playFlow: nextFlow, nextSongId: null, nextSongCountdown: 0 } };
        }
        const curId = s.transport.currentSongId ?? s.selectedSongId ?? s.playlist[0]?.songId ?? null;
        const nextId = computeNextSongId(curId, s.playlist, s.playlistOrder, nextFlow);
        return { transport: { ...s.transport, playFlow: nextFlow, nextSongId: nextId } };
      }),

      play: () => set((s) => {
        if (s.transport.isPlaying) return s;
        const songId = s.selectedSongId ?? s.playlist[0]?.songId ?? null;
        return { transport: { ...s.transport, isPlaying: true, isPaused: false, isStopped: false, currentSongId: songId } };
      }),
      pause: (time) => set((s) => ({
        transport: { ...s.transport, isPlaying: false, isPaused: true, isStopped: false, currentTime: time },
      })),
      stop: (returnTo = 0) => set((s) => ({
        transport: {
          ...s.transport, isPlaying: false, isPaused: false, isStopped: true,
          currentTime: returnTo, songProgress: 0, nextSongCountdown: 0,
        },
      })),
      setBpm: (bpm) => set((s) => ({ transport: { ...s.transport, bpm } })),
      setCurrentTime: (time) => set((s) => ({ transport: { ...s.transport, currentTime: time } })),
      setSongProgress: (progress) => set((s) => ({ transport: { ...s.transport, songProgress: progress } })),
      setNextSongCountdown: (seconds) => set((s) => ({ transport: { ...s.transport, nextSongCountdown: seconds } })),
      setPlaybackTick: (time, progress, countdown) => set((s) => ({
        transport: { ...s.transport, currentTime: time, songProgress: progress, nextSongCountdown: countdown },
      })),
      setNextSong: (songId) => set((s) => ({ transport: { ...s.transport, nextSongId: songId } })),

      toggleMixer: () => set((s) => ({ mixerVisible: !s.mixerVisible })),
      togglePlaylist: () => set((s) => ({ playlistVisible: !s.playlistVisible })),
      toggleTimeline: () => set((s) => ({ timelineVisible: !s.timelineVisible })),
      togglePlaylistMaximized: () => set((s) => ({ playlistMaximized: !s.playlistMaximized })),
      setMixerHeight: (height) => set({ mixerHeight: height }),
      setZoomH: (zoom) => set({ zoomH: Math.max(2, Math.min(200, zoom)) }),
      setZoomV: (zoom) => set({ zoomV: Math.max(0.3, Math.min(4, zoom)) }),


      setSaveDialogOpen: (v) => set({ saveDialogOpen: v }),
      setOpenDialogOpen: (v) => set({ openDialogOpen: v }),
      setAudioDeviceDialogOpen: (v) => set({ audioDeviceDialogOpen: v }),
      setBounceDialogOpen: (v) => set({ bounceDialogOpen: v }),

      setSaveTarget: (target) => set({ saveTarget: target }),
      setSaveStatus: (status) => set({ saveStatus: status }),
      setSnapStep: (step) => set({ snapStep: step }),

      applyLoadedProject: (manifest, sources, target) => {
        get().loadProject(manifest);
        set({ saveTarget: target ?? null });
        for (const c of get().clips) {
          const src = sources.get(c.id);
          if (src) registerClipSource(c.id, c.songId, src);
        }
      },

      newProject: () => {
        clearAudioLibrary();
        set({ ...INITIAL_STATE, tracks: DEFAULT_TRACKS.map((t) => ({ ...t, children: [] })) });
      },

      loadProject: (data) => {
        clearAudioLibrary();
        const tracks = data.tracks ?? DEFAULT_TRACKS.map((t) => ({ ...t }));
        const songs = (data.songs ?? []).map((sg) => withoutLoops(migrateSongRegions(sg)));
        set({
          ...INITIAL_STATE,
          ...data,
          ...normalizePlaylist(data.playlist ?? [], data.playlistOrder ?? []),
          songs,
          tracks,
          lyricMaps: normalizeLyricMaps(data.lyricMaps),
          shows: normalizeShows(data.shows),
          activeShowId: null,
          defaultPlaylist: null,
          queuedRegion: null,
          transport: { ...INITIAL_STATE.transport },
        });
        if (data.activeShowId) {
          const patch = switchShow(get(), data.activeShowId);
          if (patch) set(patch);
        }
        get().reconcileTracks();
      },

      addToPlaylist: (songId, name, duration, bpm) => set((s) => ({
        playlist: [...s.playlist, { id: newEntryId(), songId, name, order: s.playlist.length, bpm, blockId: null, duration }],
        playlistOrder: [...s.playlistOrder, songId],
        ...(s.activeShowId && s.defaultPlaylist ? {
          defaultPlaylist: [...s.defaultPlaylist, { id: newEntryId(), songId, name, order: s.defaultPlaylist.length, bpm, blockId: null, duration }],
        } : {}),
      })),

      removeFromPlaylist: (songId) => set((s) => ({
        playlist: s.playlist.filter((p) => p.songId !== songId).map((p, i) => ({ ...p, order: i })),
        playlistOrder: s.playlistOrder.filter((id) => id !== songId),
      })),

      duplicatePlaylistEntry: (songId) => {
        const state = get();
        const entry = state.playlist.find((p) => p.songId === songId);
        if (!entry) return;
        const newSongId = `song-dup-${newEntryId()}`;
        const song = state.songs.find((s) => s.id === songId);
        if (song) {
          set((s) => ({
            songs: [...s.songs, { ...song, id: newSongId }],
            playlist: [...s.playlist, { ...entry, id: newEntryId(), songId: newSongId, order: s.playlist.length }],
            playlistOrder: [...s.playlistOrder, newSongId],
          }));
        }
      },

      reorderPlaylist: (fromIndex, toIndex) => set((s) => {
        const arr = [...s.playlist];
        const [moved] = arr.splice(fromIndex, 1);
        if (!moved) return s;
        arr.splice(toIndex, 0, moved);
        const playlist = arr.map((p, i) => ({ ...p, order: i }));
        return { playlist, playlistOrder: playlist.map((p) => p.songId) };
      }),

      createShow: (name, songIds) => {
        const id = newShowId();
        set((s) => ({ shows: [...s.shows, { id, name: name.trim() || 'Novo Show', playlist: entriesForSongs(songIds, s) }] }));
        return id;
      },

      updateShow: (id, patch) => set((s) => {
        const show = s.shows.find((sh) => sh.id === id);
        if (!show) return s;
        const prev = s.activeShowId === id ? s.playlist : show.playlist;
        const playlist = patch.songIds ? entriesForSongs(patch.songIds, s, prev) : prev;
        const name = patch.name !== undefined ? (patch.name.trim() || show.name) : show.name;
        const shows = s.shows.map((sh) => sh.id === id ? { ...sh, name, playlist } : sh);
        if (s.activeShowId !== id) return { shows };
        return { shows, playlist, playlistOrder: playlist.map((p) => p.songId) };
      }),

      duplicateShow: (id) => set((s) => {
        const show = syncedShows(s).find((sh) => sh.id === id);
        if (!show) return s;
        const copy = { id: newShowId(), name: `${show.name} (cópia)`, playlist: show.playlist.map((p) => ({ ...p, id: newEntryId() })) };
        const at = s.shows.findIndex((sh) => sh.id === id) + 1;
        return { shows: [...s.shows.slice(0, at), copy, ...s.shows.slice(at)] };
      }),

      deleteShow: (id) => set((s) => {
        const patch = s.activeShowId === id ? switchShow(s, null) : null;
        return { ...patch, shows: (patch?.shows ?? s.shows).filter((sh) => sh.id !== id) };
      }),

      activateShow: (id) => set((s) => switchShow(s, id) ?? s),

      addClip: (clip) => set((s) => {
        const target = s.tracks.find((t) => t.id === clip.trackId);
        if (!target || !target.isSubgroup) {
          return { clips: [...s.clips, clip] };
        }
        const firstChildId = target.children[0];
        if (firstChildId) {
          return { clips: [...s.clips, { ...clip, trackId: firstChildId }] };
        }
        const childId = `${target.id}-child-${Date.now()}`;
        const child: Track = {
          id: childId, name: 'Extra 1', type: 'audio', color: target.color,
          volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false,
          isSubgroup: false, parentId: target.id, children: [], height: 40, visible: true,
          outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0,
        };
        return {
          tracks: [
            ...s.tracks.map((t) => t.id === target.id ? { ...t, children: [...t.children, childId] } : t),
            child,
          ],
          clips: [...s.clips, { ...clip, trackId: childId }],
        };
      }),
      updateClip: (clipId, updates) => set((s) => {
        // nunca deixa um clipe apontar diretamente para um subgrupo (pasta)
        let safe = updates;
        const current = s.clips.find((c) => c.id === clipId);
        // o timecode não troca de faixa com os stems, em nenhum sentido
        if (updates.trackId && current && updates.trackId !== current.trackId
          && (isTimecodeTrackId(updates.trackId) || isTimecodeTrackId(current.trackId))) {
          safe = { ...updates };
          delete safe.trackId;
        } else if (updates.trackId) {
          const target = s.tracks.find((t) => t.id === updates.trackId);
          if (target?.isSubgroup) {
            const firstChildId = target.children[0];
            safe = { ...updates, trackId: firstChildId ?? updates.trackId };
          }
        }
        return { clips: s.clips.map((c) => c.id === clipId ? { ...c, ...safe } : c) };
      }),
      removeClip: (clipId) => set((s) => ({
        clips: s.clips.filter((c) => c.id !== clipId),
        selectedClipIds: s.selectedClipIds.filter((id) => id !== clipId),
      })),
      routeClip: (clipId, targetTrackId) => set((s) => {
        const target = s.tracks.find((t) => t.id === targetTrackId);
        if (!target) return s;
        const moving = s.clips.find((c) => c.id === clipId);
        if (isTimecodeTrackId(targetTrackId) || isTimecodeTrackId(moving?.trackId)) return s;

        let actualTrackId = targetTrackId;
        let tracks = s.tracks;
        if (target.isSubgroup) {
          const firstChildId = target.children[0];
          if (firstChildId) {
            actualTrackId = firstChildId;
          } else {
            actualTrackId = `${target.id}-child-${Date.now()}`;
            const child: Track = {
              id: actualTrackId,
              name: `${target.name} 1`,
              type: 'audio',
              color: target.color,
              volume: 0.8,
              pan: 0,
              mute: false,
              solo: false,
              antiClip: false,
              isSubgroup: false,
              parentId: target.id,
              children: [],
              height: 40,
              visible: true,
              outputChannel: 0,
              meterLevel: 0,
              clipIndicator: false,
              clipPeak: 0,
            };
            tracks = s.tracks.map((track) => track.id === target.id
              ? { ...track, children: [...track.children, actualTrackId] }
              : track);
            tracks = [...tracks, child];
          }
        }

        return {
          tracks,
          clips: s.clips.map((c) => c.id === clipId
            ? { ...c, trackId: actualTrackId, routingMethod: 'manual' as const, routingConfidence: 1 }
            : c),
        };
      }),
      setClipMarkers: (clipId, markers) => set((s) => ({ clips: s.clips.map((c) => c.id === clipId ? { ...c, markers } : c) })),
      resetClipRouting: (clipId) => {
        set((s) => ({
          clips: s.clips.map((c) => c.id === clipId
            ? { ...c, routingMethod: 'name' as const, routingConfidence: 1 }
            : c),
        }));
        get().reconcileTracks();
      },
      setImportProgress: (progress) => set({ importProgress: progress }),
      setClipBpm: (clipId, bpm) => set((s) => ({ clips: s.clips.map((c) => c.id === clipId ? { ...c, bpm } : c) })),

      addSong: (song) => set((s) => ({ songs: [...s.songs, song] })),
      updateSong: (songId, updates) => set((s) => ({ songs: s.songs.map((sg) => sg.id === songId ? { ...sg, ...updates } : sg) })),
      removeSong: (songId) => {
        const state = get();
        set({
          ...removeSongFromShows(state, songId),
          songs: state.songs.filter((s) => s.id !== songId),
          clips: state.clips.filter((c) => c.songId !== songId),
          playlist: state.playlist.filter((p) => p.songId !== songId).map((p, i) => ({ ...p, order: i })),
          playlistOrder: state.playlistOrder.filter((id) => id !== songId),
          selectedSongId: state.selectedSongId === songId ? null : state.selectedSongId,
        });
      },
      renameSong: (songId, name) => set((s) => ({
        songs: s.songs.map((sg) => sg.id === songId ? { ...sg, name } : sg),
        playlist: s.playlist.map((p) => p.songId === songId ? { ...p, name } : p),
        shows: s.shows.map((sh) => ({ ...sh, playlist: sh.playlist.map((p) => p.songId === songId ? { ...p, name } : p) })),
        defaultPlaylist: s.defaultPlaylist?.map((p) => p.songId === songId ? { ...p, name } : p) ?? null,
      })),
      setSongBpmAdjust: (songId, adjust) => set((s) => ({ songs: s.songs.map((sg) => sg.id === songId ? { ...sg, bpmAdjust: adjust } : sg) })),
      setSongTuner: (songId, tuner) => set((s) => ({ songs: s.songs.map((sg) => sg.id === songId ? { ...sg, tuner } : sg) })),

      addSongRegion: (songId, region) => {
        const song = get().songs.find((sg) => sg.id === songId);
        if (!song) return false;
        const start = Math.max(0, region.start);
        const end = Math.min(song.duration, region.end);
        if (end - start < minRegionLength(song.bpm) - 1e-6) return false;
        const overlaps = (song.regions ?? []).some((r) => start < r.end - 1e-6 && end > r.start + 1e-6);
        if (overlaps) return false;
        set((s) => ({
          songs: s.songs.map((sg) => sg.id === songId
            ? { ...sg, regions: sortedRegions([...(sg.regions ?? []), { ...region, start, end }]) }
            : sg),
        }));
        return true;
      },
      updateSongRegion: (songId, regionId, updates) => set((s) => ({
        songs: s.songs.map((sg) => {
          if (sg.id !== songId) return sg;
          const current = (sg.regions ?? []).find((r) => r.id === regionId);
          if (!current) return sg;
          const next = { ...current, ...updates };
          if (updates.start !== undefined || updates.end !== undefined) {
            const { min, max } = neighbourBounds(sg, regionId);
            const minLen = Math.min(RESIZE_MIN_LENGTH, max - min);
            next.start = Math.min(Math.max(min, next.start), max - minLen);
            next.end = Math.max(Math.min(max, next.end), next.start + minLen);
          }
          return { ...sg, regions: sortedRegions((sg.regions ?? []).map((r) => r.id === regionId ? next : r)) };
        }),
      })),
      placeSongRegions: (songId, layout) => set((s) => ({
        songs: s.songs.map((sg) => sg.id === songId
          ? { ...sg, regions: sortedRegions((sg.regions ?? []).map((r) => (layout[r.id] ? { ...r, ...layout[r.id] } : r))) }
          : sg),
      })),
      removeSongRegion: (songId, regionId) => set((s) => ({
        songs: s.songs.map((sg) => sg.id === songId
          ? { ...sg, regions: (sg.regions ?? []).filter((r) => r.id !== regionId) }
          : sg),
        queuedRegion: s.queuedRegion?.regionId === regionId ? null : s.queuedRegion,
      })),
      setQueuedRegion: (queued) => set({ queuedRegion: queued }),
      updateMedleyPart: (songId, partId, patch) => set((s) => ({
        songs: s.songs.map((sg) => sg.id !== songId || !sg.medley ? sg : {
          ...sg,
          medley: sg.medley.map((p) => (p.id === partId ? { ...p, ...patch } : p)),
        }),
      })),
      toggleSectionKeys: () => set((s) => {
        localStorage.setItem('sectionKeys', s.sectionKeys ? '0' : '1');
        return { sectionKeys: !s.sectionKeys };
      }),
      setSongLoading: (songId, loading) => set((s) => {
        const has = s.loadingSongIds.includes(songId);
        if (loading === has) return {};
        return { loadingSongIds: loading ? [...s.loadingSongIds, songId] : s.loadingSongIds.filter((id) => id !== songId) };
      }),
      setInstantPrep: (prep) => set((s) => (
        prep?.done === s.instantPrep?.done && prep?.total === s.instantPrep?.total && prep?.name === s.instantPrep?.name
          && prep?.ready === s.instantPrep?.ready && prep?.failed === s.instantPrep?.failed ? {} : { instantPrep: prep }
      )),
      setSongIncomplete: (songId, incomplete) => set((s) => {
        const has = s.incompleteSongIds.includes(songId);
        if (incomplete === has) return {};
        return { incompleteSongIds: incomplete ? [...s.incompleteSongIds, songId] : s.incompleteSongIds.filter((id) => id !== songId) };
      }),

      createBlock: (afterSongId) => {
        if (!afterSongId) return;
        const existing = get().blocks;
        const used = new Set<number>();
        for (const b of existing) {
          const m = b.name.match(/Bloco\s+0*(\d+)/i);
          if (m) used.add(parseInt(m[1], 10));
        }
        let blockNum = 1;
        while (used.has(blockNum)) blockNum++;
        const id = `block-${Date.now()}`;
        const name = `Bloco ${blockNum.toString().padStart(2, '0')}`;
        set((s) => {
          const blocks = [...s.blocks, { id, name, color: '#ffffff', order: s.blocks.length }];
          const songs = s.songs.map((sg) => sg.id === afterSongId ? { ...sg, blockId: id } : sg);
          const playlist = s.playlist.map((p) => p.songId === afterSongId ? { ...p, blockId: id } : p);
          return { blocks, songs, playlist };
        });
      },

      renameBlock: (blockId, name) => set((s) => ({ blocks: s.blocks.map((b) => b.id === blockId ? { ...b, name } : b) })),
      setBlockColor: (blockId, color) => set((s) => ({ blocks: s.blocks.map((b) => b.id === blockId ? { ...b, color } : b) })),
      deleteBlock: (blockId) => set((s) => ({
        blocks: s.blocks.filter((b) => b.id !== blockId),
        playlist: s.playlist.map((p) => p.blockId === blockId ? { ...p, blockId: null } : p),
        songs: s.songs.map((sg) => sg.blockId === blockId ? { ...sg, blockId: null } : sg),
      })),
      moveBlock: (blockId, toIndex) => set((s) => {
        const arr = [...s.blocks];
        const idx = arr.findIndex((b) => b.id === blockId);
        if (idx === -1) return s;
        const [moved] = arr.splice(idx, 1);
        arr.splice(toIndex, 0, moved);
        return { blocks: arr.map((b, i) => ({ ...b, order: i })) };
      }),
      // move a marcação (cabeçalho) de um bloco para antes de uma música qualquer —
      // modelo divisória: o bloco rege as músicas abaixo dele até o próximo cabeçalho
      moveBlockTo: (blockId, beforeSongId) => set((s) => {
        const blockForSong = new Map<string, string>();
        for (const id of s.playlistOrder) {
          const e = s.playlist.find((p) => p.songId === id);
          if (e?.blockId && !blockForSong.has(e.blockId)) blockForSong.set(e.blockId, id);
        }
        blockForSong.delete(blockId);
        if (beforeSongId && s.playlistOrder.includes(beforeSongId)) {
          blockForSong.set(blockId, beforeSongId);
        }
        const songToBlock = new Map<string, string>();
        blockForSong.forEach((songId, blkId) => songToBlock.set(songId, blkId));
        let active: string | null = null;
        const resolved: Record<string, string | null> = {};
        for (const sid of s.playlistOrder) {
          if (songToBlock.has(sid)) active = songToBlock.get(sid)!;
          resolved[sid] = active;
        }
        const playlist = s.playlist
          .map((p) => ({ ...p, blockId: resolved[p.songId] ?? null }))
          .sort((a, b) => s.playlistOrder.indexOf(a.songId) - s.playlistOrder.indexOf(b.songId))
          .map((p, i) => ({ ...p, order: i }));
        const songs2 = s.songs.map((sg) => (resolved[sg.id] !== undefined ? { ...sg, blockId: resolved[sg.id] ?? null } : sg));
        return { playlist, songs: songs2 };
      }),

      // insere uma música em qualquer posição da playlist, atribuindo (ou removendo) o bloco
      moveSongTo: (songId, beforeSongId, blockId) => set((s) => {
        const order = s.playlistOrder.filter((id) => id !== songId);
        let idx = beforeSongId ? order.indexOf(beforeSongId) : order.length;
        if (idx === -1) idx = order.length;
        order.splice(idx, 0, songId);
        const playlist = order
          .map((sid, i) => {
            const entry = s.playlist.find((p) => p.songId === sid);
            if (!entry) return null;
            return { ...entry, order: i, blockId: sid === songId ? blockId : entry.blockId };
          })
          .filter(Boolean) as typeof s.playlist;
        return { playlistOrder: order, playlist };
      }),

      assignSongToBlock: (songId, blockId) => set((s) => ({
        songs: s.songs.map((sg) => sg.id === songId ? { ...sg, blockId } : sg),
        playlist: s.playlist.map((p) => p.songId === songId ? { ...p, blockId } : p),
      })),

      toggleBpmTower: () => set((s) => ({ showBpmTower: !s.showBpmTower })),
      toggleTunerTower: () => set((s) => ({ showTunerTower: !s.showTunerTower })),
      toggleLrMaster: () => set((s) => ({ lrMasterActive: !s.lrMasterActive })),

      // roteamento mágico: Click/Maestro → pan L e todo o resto ("Banda") → pan R
      toggleMagicRouting: () => set((s) => {
        if (s.magicRoutingActive) {
          const prev = s.prevOutputChannels;
          return {
            magicRoutingActive: false,
            prevOutputChannels: null,
            tracks: s.tracks.map((t) => (prev && t.id in prev ? { ...t, pan: prev[t.id] } : t)),
          };
        }
        const prev: Record<string, number> = {};
        s.tracks.forEach((t) => { prev[t.id] = t.pan; });
        const MAGIC_L = new Set(['track-click', 'track-maestro']);
        return {
          magicRoutingActive: true,
          prevOutputChannels: prev,
          tracks: s.tracks.map((t) => (isTimecodeTrackId(t.id) ? t : {
            ...t,
            pan: MAGIC_L.has(t.id) ? -1 : 1,
          })),
        };
      }),
      setAudioInterface: (iface) => set({ audioInterface: iface }),

      updateMeter: (trackId, level) => set((s) => ({
        tracks: s.tracks.map((t) => {
          if (t.id === trackId) {
            return {
              ...t,
              meterLevel: level,
              clipIndicator: level >= 1 || t.clipIndicator,
              clipPeak: level >= 1 ? Math.max(level, t.clipPeak) : t.clipPeak,
            };
          }
          return t;
        }),
      })),

      clearClipIndicator: (trackId) => set((s) => ({
        tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, clipIndicator: false, clipPeak: 0 } : t)),
      })),

      updateMasterMeter: (level) => set((s) => ({
        masterMeterLevel: level,
        masterClipPeak: level >= 1 ? Math.max(level, s.masterClipPeak) : s.masterClipPeak,
      })),

      clearMasterClipIndicator: () => set({ masterClipPeak: 0 }),
      setPlaybackError: (message) => set({ playbackError: message }),

      setMasterVolume: (volume) => set({ masterVolume: Math.max(0, Math.min(1.5, volume)) }),
      setPreparingParams: (v) => set({ preparingParams: v }),

      applyAntiClipMaster: () => set((s) => {
        if (s.masterClipPeak < 1) return s;
        // baixa o fader master só o necessário para o pico memorizado ficar a -0,2 dB do clipping
        const safeCeiling = Math.pow(10, -0.2 / 20);
        const newVol = Math.max(0, Math.min(1.5, s.masterVolume * (safeCeiling / s.masterClipPeak)));
        return { masterVolume: newVol, masterClipPeak: 0, masterMeterLevel: 0 };
      }),

      applyAntiClip: (trackId) => set((s) => ({
        tracks: s.tracks.map((t) => {
          if (t.id !== trackId || t.clipPeak < 1 || t.faderLocked) return t;
          // baixa o fader só o necessário para o pico memorizado ficar a -0,2 dB do clipping
          const safeCeiling = Math.pow(10, -0.2 / 20);
          const newVol = Math.max(0, Math.min(1.5, t.volume * (safeCeiling / t.clipPeak)));
          return { ...t, volume: newVol, meterLevel: 0, clipIndicator: false, clipPeak: 0, antiClip: true };
        }),
      })),

      setVolumeDb: (trackId, dbChange) => set((s) => ({
        tracks: s.tracks.map((t) => t.id === trackId && !t.faderLocked
          ? { ...t, volume: Math.max(0, Math.min(1.5, t.volume * Math.pow(10, dbChange / 20))) }
          : t),
      })),

      exportProject: (config) => {
        set({ exportProgress: { active: true, message: 'Iniciando exportação...' } });
        const state = get();
        const songsToExport = config.scope === 'musica' && config.songId
          ? [state.songs.find((sg) => sg.id === config.songId)].filter(Boolean)
          : state.songs;
        const total = songsToExport.length;
        let done = 0;
        const interval = setInterval(() => {
          done++;
          if (done >= total) {
            clearInterval(interval);
            set({ exportProgress: { active: false, message: 'Exportação concluída!' } });
            setTimeout(() => set({ exportProgress: null }), 3000);
          } else {
            set({ exportProgress: { active: true, message: `Exportando ${done}/${total}...` } });
          }
        }, 500);
      },
      setExportProgress: (progress) => set({ exportProgress: progress }),

      recalcTimeline: () => set((s) => {
        let pos = 0;
        const songs = s.songs.map((sg) => {
          const updated = { ...sg, timelineStart: pos };
          pos += sg.duration + 2;
          return updated;
        });
        return { songs };
      }),

      reconcileTracks: () => set((s) => {
        const protectedIds = new Set(['track-click', 'track-maestro']);
        const parents = s.tracks.filter((t) => t.isSubgroup);
        const normalize = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

        const fixedTracks = s.tracks.filter((t) => !t.parentId || t.isSubgroup);
        const prevChildByFullName = new Map<string, Track>();
        for (const t of s.tracks) {
          if (t.parentId && !t.isSubgroup) {
            prevChildByFullName.set(`${t.parentId}|${normalize(t.name)}`, t);
          }
        }

        // decide o destino final (subgrupo + nome de instrumento) de cada clipe
        // reclassifica tudo pelo nome do arquivo — ignora marca "manual" para desfazer bagunças antigas
        type Dest = { target: RoutingTarget; display: string } | 'click' | 'maestro';
        const destByClip = new Map<string, Dest>();
        for (const clip of s.clips) {
          if (isTimecodeTrackId(clip.trackId)) continue;
          if (clip.routingMethod === 'manual' && protectedIds.has(clip.trackId)) {
            destByClip.set(clip.id, clip.trackId === 'track-click' ? 'click' : 'maestro');
            continue;
          }
          const route = routeByName(clip.fileName) ?? routeByName(clip.name);
          if (route) {
            if (route.target === 'track-click') { destByClip.set(clip.id, 'click'); continue; }
            if (route.target === 'track-maestro') { destByClip.set(clip.id, 'maestro'); continue; }
            destByClip.set(clip.id, { target: route.target, display: route.instrumentName });
            continue;
          }
          // fallback: se o clipe já estava numa faixa filha válida (não é subgrupo nem fixa), preserva o nome
          const cur = s.tracks.find((t) => t.id === clip.trackId);
          if (cur && cur.parentId && !cur.isSubgroup && !protectedIds.has(cur.id)) {
            const prettyBase = cur.name.replace(/\s+\d+$/, '').trim() || 'Extra';
            destByClip.set(clip.id, { target: cur.parentId as RoutingTarget, display: prettyBase });
            continue;
          }
          destByClip.set(clip.id, { target: 'track-outros', display: 'Extra' });
        }

        // numera por música: na mesma música, 1º violão vira "Violão 1", 2º "Violão 2" etc
        const clipsBySong = new Map<string, AudioClip[]>();
        for (const c of s.clips) {
          const arr = clipsBySong.get(c.songId) ?? [];
          arr.push(c); clipsBySong.set(c.songId, arr);
        }
        const maxNByKey = new Map<string, number>();
        const displayByKey = new Map<string, string>();
        const assignmentByClip = new Map<string, { key: string; n: number }>();
        for (const [, songClips] of clipsBySong) {
          const counts = new Map<string, number>();
          for (const c of songClips) {
            const dest = destByClip.get(c.id);
            if (!dest || dest === 'click' || dest === 'maestro') continue;
            const base = normalize(dest.display);
            const key = `${dest.target}|${base}`;
            const n = (counts.get(key) ?? 0) + 1;
            counts.set(key, n);
            if (n > (maxNByKey.get(key) ?? 0)) maxNByKey.set(key, n);
            if (!displayByKey.has(key)) displayByKey.set(key, dest.display);
            assignmentByClip.set(c.id, { key, n });
          }
        }

        // cria as faixas filhas: uma por (grupo, instrumento, número)
        const newChildTracks: Track[] = [];
        const trackIdByKeyN = new Map<string, string>();
        let seq = 0;
        const now = Date.now();
        for (const [key, max] of maxNByKey) {
          const target = key.split('|')[0];
          const parent = parents.find((p) => p.id === target);
          const display = displayByKey.get(key) ?? 'Extra';
          for (let n = 1; n <= max; n++) {
            seq++;
            const fullName = `${display} ${n}`;
            const normName = normalize(fullName);
            const prev = prevChildByFullName.get(`${target}|${normName}`);
            const id = prev?.id ?? `${target}-child-${now}-${seq}`;
            newChildTracks.push({
              id,
              name: fullName,
              type: 'audio',
              color: prev?.color ?? parent?.color ?? '#5b8db8',
              volume: prev?.volume ?? 0.8,
              pan: prev?.pan ?? 0,
              mute: prev?.mute ?? false,
              solo: prev?.solo ?? false,
              antiClip: prev?.antiClip ?? false,
              isSubgroup: false,
              parentId: target,
              children: [],
              height: prev?.height ?? 40,
              visible: true,
              outputChannel: prev?.outputChannel ?? 0,
              meterLevel: 0,
              clipIndicator: false,
              clipPeak: 0,
            });
            trackIdByKeyN.set(`${key}|${n}`, id);
          }
        }

        // reaponta cada clipe para a nova faixa
        const newClips = s.clips.map((c) => {
          const dest = destByClip.get(c.id);
          let newId = c.trackId;
          if (dest === 'click') newId = 'track-click';
          else if (dest === 'maestro') newId = 'track-maestro';
          else {
            const a = assignmentByClip.get(c.id);
            if (a) newId = trackIdByKeyN.get(`${a.key}|${a.n}`) ?? c.trackId;
          }
          if (newId === c.trackId) return c;
          return {
            ...c,
            trackId: newId,
            ...(c.routingMethod !== 'manual' ? { routingMethod: 'name' as const, routingConfidence: 1 } : {}),
          };
        });

        // monta os subgrupos com os filhos novos
        const childrenByParent = new Map<string, string[]>();
        for (const ch of newChildTracks) {
          if (!ch.parentId) continue;
          const arr = childrenByParent.get(ch.parentId) ?? [];
          arr.push(ch.id);
          childrenByParent.set(ch.parentId, arr);
        }
        const finalFixed = fixedTracks.map((t) => {
          if (!t.isSubgroup) return t;
          return { ...t, children: childrenByParent.get(t.id) ?? [] };
        });

        // última linha de defesa: nenhum clipe pode terminar apontando para um subgrupo (pasta)
        const subgroupIds = new Set(parents.map((p) => p.id));
        const allTracks = [...finalFixed, ...newChildTracks];
        const extraChildByParent = new Map<string, string>();
        const guardedClips = newClips.map((c) => {
          if (!subgroupIds.has(c.trackId)) return c;
          const parentId = c.trackId;
          const parent = allTracks.find((t) => t.id === parentId);
          const firstChildId = parent?.children[0] ?? extraChildByParent.get(parentId);
          if (firstChildId) return { ...c, trackId: firstChildId };
          const childId = `${parentId}-extra-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const parentColor = parent?.color ?? '#5b8db8';
          const extra: Track = {
            id: childId, name: 'Extra 1', type: 'audio', color: parentColor,
            volume: 0.8, pan: 0, mute: false, solo: false, antiClip: false,
            isSubgroup: false, parentId, children: [], height: 40, visible: true,
            outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0,
          };
          allTracks.push(extra);
          const parentIdx = allTracks.findIndex((t) => t.id === parentId);
          if (parentIdx >= 0) allTracks[parentIdx] = { ...allTracks[parentIdx], children: [...allTracks[parentIdx].children, childId] };
          extraChildByParent.set(parentId, childId);
          return { ...c, trackId: childId };
        });

        return { tracks: withTimecodeFirst(allTracks), clips: guardedClips };
      }),

      reconcileTracksAnnounced: () => {
        const before = get().clips.map((c) => c.trackId);
        get().reconcileTracks();
        const after = get().clips;
        const moved = after.filter((c, i) => c.trackId !== before[i]).length;
        set({ importProgress: {
          clipId: 'done',
          status: 'done',
          message: `Reorganização concluída: ${moved} ${moved === 1 ? 'clipe movido' : 'clipes movidos'}`,
          current: moved,
          total: after.length,
        } });
        setTimeout(() => set({ importProgress: null }), 4000);
      },
    }),
    {
      partialize: partializeHistory,
      equality: historyEqual,
      limit: HISTORY_LIMIT,
    }
  )
);
