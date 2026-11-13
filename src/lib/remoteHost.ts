// VS Stage Remote, lado do programa do Mac: monta o estado do Modo Show para o celular e executa
// os comandos que chegam dele, com as mesmas funções que os botões do programa usam.

import { useStore, ROUTABLE_TRACKS, BLOCK_COLORS } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { startPlayback, stopPlayback, pausePlayback, seekToPosition } from '@/lib/transportControl';
import {
  currentAndNextSlice, isSliceEnabled, medleySlices, paramsAt, playedDuration, sliceDuration, sliceParams,
} from '@/lib/medley';
import { effectiveBpm } from '@/lib/musicianApi';
import { songKeyLabel } from '@/lib/musicKey';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';
import { durationFor, getShowClock, resetShowClock, setShowDuration, showKeyOf, startShowClock } from '@/lib/showClock';
import { getDiskLag } from '@/lib/diskLag';
import { nextRepeat, regionAt, sortedRegions } from '@/lib/regions';
import { activeShowName } from '@/lib/shows';
import { bpmLabel, toneLabel } from '@/components/ShowRundown';
import { bumpAdjust, shownAdjust } from '@/components/AdjustmentsTower';
import { followingRegion, pickSection, skipSection } from '@/components/SectionPads';
import { interfaceName } from '@/components/ShowModePanel';
import {
  REMOTE_VERSION, packMeters, parseRemoteCommand,
  type RemoteCard, type RemoteMeters, type RemoteReply, type RemoteState, type RemoteSong,
} from '@/lib/remoteProtocol';
import { meterLevel } from '@/lib/meterBus';
import type { Song } from '@/types';

type Store = ReturnType<typeof useStore.getState>;

// Resposta ao último pedido com número (a seleção da Lista). Vai no estado; quem transmite
// (Rede Local ou Show Online) é avisado para mandar o estado na hora, mesmo quando o Mac recusa
// e nada mais muda.
let lastReply: RemoteReply | null = null;
const replyListeners = new Set<() => void>();

function answer(req: string | undefined, ok: boolean, reason: string | null = null) {
  if (!req) return;
  lastReply = { req, ok, reason: ok ? null : reason };
  replyListeners.forEach((cb) => cb());
}

/** Avisa quando o Mac responde a um pedido do celular (para transmitir o estado na hora). */
export function onRemoteReply(cb: () => void): () => void {
  replyListeners.add(cb);
  return () => { replyListeners.delete(cb); };
}

function songBpmOf(song: Song | undefined): number | null {
  return song?.bpmDetected && song.bpm ? song.bpm : null;
}

function showTotal(st: Store): number {
  let total = 0;
  for (const p of st.playlist) {
    const d = playedDuration(st.songs.find((s) => s.id === p.songId), p.duration ?? 0);
    if (Number.isFinite(d) && d > 0) total += d;
  }
  return total;
}

/** Tom e BPM que valem numa música no ponto `at` (igual aos cartões do Modo Show). */
function cardOf(st: Store, song: Song | undefined, name: string | null, medley: string | null, at: number, duration: number): RemoteCard | null {
  if (!song || !name) return null;
  const p = paramsAt(song, at);
  const bpm = effectiveBpm(song.bpm, song.bpmDetected, p.bpmAdjust);
  return {
    name,
    medley,
    key: songKeyLabel({ musicKey: song.musicKey || st.songKeys?.[song.id]?.key, tuner: p.tuner }),
    bpm: bpm ? String(bpm) : '',
    duration,
  };
}

function songsOf(st: Store): RemoteSong[] {
  let start = 0;
  return st.playlist.map((entry) => {
    const song = st.songs.find((s) => s.id === entry.songId);
    const duration = playedDuration(song, entry.duration);
    const row: RemoteSong = {
      id: entry.songId,
      name: entry.name,
      duration,
      start,
      bpm: bpmLabel(song),
      tone: song ? toneLabel(song.tuner) : '-',
      tuner: song?.tuner ?? 0,
      bpmShown: shownAdjust(songBpmOf(song), song?.bpmAdjust ?? 0),
      blockId: entry.blockId,
      missing: st.incompleteSongIds.includes(entry.songId),
      parts: song ? medleySlices(song).map((s) => {
        const params = sliceParams(song, s);
        return {
          id: s.id,
          name: s.name,
          start: s.start,
          duration: sliceDuration(song, s),
          enabled: isSliceEnabled(s),
          bpmShown: shownAdjust(songBpmOf(song), params.bpmAdjust),
          tunerShown: Math.round(params.tuner),
          bpmInherited: s.bpmAdjust === undefined,
          tunerInherited: s.tuner === undefined,
        };
      }) : [],
      regions: song ? sortedRegions(song.regions).map((r) => ({
        id: r.id, name: r.name, color: r.color, start: r.start, end: r.end, loop: r.loop, repeat: r.repeat ?? null,
      })) : [],
    };
    start += duration;
    return row;
  });
}

export function buildRemoteState(): RemoteState {
  const st = useStore.getState();
  const t = st.transport;
  const running = t.isPlaying && audioEngine.isRunning();
  const exact = running && !audioEngine.isUserSeeking();
  const engineTime = exact ? audioEngine.getCurrentTime() : t.currentTime;

  // Cartões Tocando / Próxima: mesma conta do ShowModePanel
  const active = !t.isStopped || t.isPlaying;
  const current = active ? st.songs.find((s) => s.id === t.currentSongId) : undefined;
  const next = t.playFlow !== 'uma-uma' ? st.songs.find((s) => s.id === t.nextSongId) : undefined;
  const slices = currentAndNextSlice(current, running ? audioEngine.getCurrentTime() : 0);
  const currentName = current ? slices.current?.name ?? current.name ?? null : null;
  const nextName = current && slices.next ? slices.next.name : next?.name ?? null;
  const nextDuration = current && slices.next ? sliceDuration(current, slices.next) : next?.duration ?? 0;
  const nextSong = current && slices.next ? current : next;
  const nextAt = current && slices.next ? slices.next.start : 0;

  // Display "Restante da música": mesma conta do useSongRemaining
  const remId = t.currentSongId ?? st.selectedSongId ?? st.playlist[0]?.songId;
  const remSong = st.songs.find((s) => s.id === remId);
  const remPos = t.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking() ? audioEngine.getCurrentTime() : t.currentTime;
  const remaining = remSong && remSong.duration > 0
    ? Math.max(0, remSong.duration - remPos) * bpmAdjustToAlpha(remSong.bpmAdjust ?? 0)
    : null;

  // Barra de LEDs: a música no ar inteira, ou a parte do medley que está tocando
  const playSong = t.isPlaying ? st.songs.find((s) => s.id === (t.currentSongId ?? st.playlist[0]?.songId)) : undefined;
  const playSlices = playSong ? currentAndNextSlice(playSong, engineTime) : { current: null, next: null };
  const segStart = playSlices.current ? playSlices.current.start : 0;
  const segEnd = playSong
    ? playSlices.current ? playSlices.current.start + Math.max(0.01, sliceDuration(playSong, playSlices.current)) : playSong.duration
    : 0;
  const speedParams = playSong ? paramsAt(playSong, engineTime) : null;

  const total = showTotal(st);
  const clock = getShowClock();
  const connected = st.audioInterfaceConnected;

  return {
    v: REMOTE_VERSION,
    at: Date.now(),
    showName: activeShowName(st),
    playing: t.isPlaying,
    paused: t.isPaused,
    active,
    currentId: t.currentSongId,
    nextId: t.nextSongId,
    selectedId: st.selectedSongId,
    flow: t.playFlow,
    pos: engineTime,
    speed: speedParams ? 1 / bpmAdjustToAlpha(speedParams.bpmAdjust) : 1,
    remaining,
    segStart,
    segEnd,
    current: cardOf(st, current, currentName, slices.current ? current?.name ?? null : null, running ? audioEngine.getCurrentTime() : 0, current?.duration ?? 0),
    next: cardOf(st, nextSong, nextName, slices.next ? current?.name ?? null : null, nextAt, nextDuration),
    towers: { bpm: st.showBpmTower, tuner: st.showTunerTower },
    soloActive: st.tracks.some((tr) => tr.solo),
    error: st.playbackError,
    diskLag: [...getDiskLag()],
    audio: connected ? interfaceName(st.audioInterface ?? '') : 'Saída padrão',
    outputs: st.outputChannelCount,
    clock: { run: clock.run, duration: durationFor(clock, showKeyOf(st.activeShowId), total) },
    total,
    queued: st.queuedRegion,
    songs: songsOf(st),
    blocks: st.blocks.map((b) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      duration: st.playlist.reduce((a, p) => a + (p.blockId === b.id ? playedDuration(st.songs.find((s) => s.id === p.songId), p.duration) : 0), 0),
    })),
    blockColors: [...BLOCK_COLORS],
    reply: lastReply,
    app: __APP_VERSION__,
    tracks: ROUTABLE_TRACKS
      .map((id) => st.tracks.find((tr) => tr.id === id))
      .filter((tr): tr is NonNullable<typeof tr> => !!tr && !tr.parentId)
      .map((tr) => ({
        id: tr.id, name: tr.name, volume: tr.volume, mute: tr.mute, solo: tr.solo,
        locked: !!tr.faderLocked, tone: tr.isSubgroup && tr.id !== 'track-guia' ? 'band' : 'cue',
      })),
    master: st.masterVolume,
  };
}

// Fader do celular no Desfazer: um arrasto vira um passo só, como o fader do Mac. O primeiro valor
// entra no histórico. Os seguintes do mesmo fader, a menos de 800 ms um do outro e sem nada novo no
// Desfazer no meio, mudam o volume com o histórico pausado só naquele instante. Não sobra pausa
// ligada, então nada atrapalha o arrasto do Mac (historyGesture) nem o clique (undoGestures).
const REMOTE_DRAG_GAP_MS = 800;
let remoteDrag: { key: string; at: number; top: unknown } | null = null;

function historyTop(): unknown {
  const past = useStore.temporal.getState().pastStates;
  return past[past.length - 1];
}

function remoteFader(key: string, apply: () => void): void {
  const history = useStore.temporal.getState();
  const now = Date.now();
  const d = remoteDrag;
  if (d && d.key === key && now - d.at < REMOTE_DRAG_GAP_MS && d.top === historyTop() && history.isTracking) {
    history.pause();
    try { apply(); } finally { history.resume(); }
    d.at = now;
    return;
  }
  const before = historyTop();
  apply();
  const after = historyTop();
  // o arrasto só começa se este valor entrou no Desfazer (fader travado, valor igual ou outro gesto em curso: não entra)
  remoteDrag = after !== before ? { key, at: now, top: after } : null;
}

/** Executa um comando do celular. Comando fora do formato é ignorado. Nenhum comando exclui música. */
export function applyRemoteCommand(raw: unknown): void {
  const cmd = parseRemoteCommand(raw);
  if (!cmd) return;
  const st = useStore.getState();
  const t = st.transport;
  const songOf = (id: string) => st.songs.find((s) => s.id === id);

  switch (cmd.action) {
    case 'play': startPlayback(); return;
    case 'stop':
      // O celular ainda via o show no ar e o Mac já está parado: o Parar já foi feito (toque duplo,
      // Parar no Mac ou fim da música). Parar de novo voltaria mais uma parte. Com o Mac tocando,
      // o Parar sempre para; com o celular já mostrando parado, cada toque volta uma parte, como no Mac.
      if (cmd.wasActive === true && t.isStopped && !t.isPlaying) return;
      stopPlayback();
      return;
    // pausa de verdade (para o som), igual à barra de espaço do Mac; parado, não faz nada
    case 'pause': if (t.isPlaying) pausePlayback(); return;
    case 'next': {
      if (t.nextSongId) { st.selectSong(t.nextSongId); startPlayback(); }
      return;
    }
    case 'prev': {
      const idx = st.playlist.findIndex((p) => p.songId === (t.currentSongId ?? st.selectedSongId));
      if (idx > 0) { st.selectSong(st.playlist[idx - 1].songId); startPlayback(); }
      return;
    }
    case 'selectSong': st.selectSong(cmd.songId); startPlayback(); return;
    // Lista do Remote: igual ao clique na playlist do Mac (seleciona, não toca)
    case 'select':
      if (!st.playlist.some((p) => p.songId === cmd.songId)) {
        answer(cmd.req, false, 'Essa música não está mais na lista do Mac.');
        return;
      }
      st.selectSong(cmd.songId);
      answer(cmd.req, useStore.getState().selectedSongId === cmd.songId, 'O Mac não conseguiu selecionar essa música.');
      return;

    // Pesquisar do Modo Show: escolhe a música; com o show parado ela vira a Próxima
    case 'pick':
      st.selectSong(cmd.songId);
      if (t.playFlow !== 'uma-uma' && !t.isPlaying) st.setNextSong(cmd.songId);
      return;
    case 'setNext':
      if (t.playFlow === 'uma-uma') return;
      st.setNextSong(cmd.songId);
      return;
    case 'flow': st.setPlayFlow(cmd.flow); return;
    case 'towerBpm': if (cmd.on === undefined || st.showBpmTower !== cmd.on) st.toggleBpmTower(); return;
    case 'towerTuner': if (cmd.on === undefined || st.showTunerTower !== cmd.on) st.toggleTunerTower(); return;
    case 'adjust': bumpAdjust(cmd.songId, cmd.kind, cmd.delta, cmd.partId); return;
    case 'section': {
      const song = songOf(cmd.songId);
      const region = song?.regions?.find((r) => r.id === cmd.regionId);
      if (!song || !region) return;
      // mesma conta do pickSection: no ar, o pad liga/desliga o loop; fora do ar, engatilha a parte
      const onAir = t.isPlaying && regionAt(song.regions, t.currentTime)?.id === region.id;
      const queued = st.queuedRegion?.songId === song.id && st.queuedRegion.regionId === region.id;
      if (onAir ? cmd.loop !== undefined && !!region.loop === cmd.loop : cmd.queue !== undefined && queued === cmd.queue) return;
      pickSection(song, region);
      return;
    }
    case 'skipSection': {
      const song = songOf(cmd.songId);
      if (!song) return;
      if (cmd.on !== undefined) {
        const next = followingRegion(sortedRegions(song.regions), t.currentTime);
        const queued = !!next && st.queuedRegion?.songId === song.id && st.queuedRegion.regionId === next.id;
        if (queued === cmd.on) return;
      }
      skipSection(song);
      return;
    }
    case 'regionLoop': {
      const region = songOf(cmd.songId)?.regions?.find((r) => r.id === cmd.regionId);
      if (!region) return;
      const want = cmd.on ?? !region.loop;
      if (!!region.loop !== want) st.updateSongRegion(cmd.songId, region.id, { loop: want });
      return;
    }
    case 'regionRepeat': {
      const region = songOf(cmd.songId)?.regions?.find((r) => r.id === cmd.regionId);
      if (!region?.loop) return;
      // o primeiro toque já mudou as repetições que o celular via: o segundo não pula mais um valor
      if (cmd.from !== undefined && (region.repeat ?? null) !== cmd.from) return;
      st.updateSongRegion(cmd.songId, region.id, { repeat: nextRepeat(region.repeat) });
      return;
    }
    // Música do medley: no ar, vai para ela; fora do ar, seleciona a música
    case 'slice': {
      const song = songOf(cmd.songId);
      const part = song ? medleySlices(song).find((s) => s.id === cmd.partId) : undefined;
      if (!song || !part) return;
      if (t.currentSongId === song.id && t.isPlaying) seekToPosition(song.id, part.start);
      else st.selectSong(song.id);
      return;
    }
    case 'sliceToggle': {
      const song = songOf(cmd.songId);
      const slices = song ? medleySlices(song) : [];
      const part = slices.find((s) => s.id === cmd.partId);
      if (!song || !part) return;
      const enabled = isSliceEnabled(part);
      const want = cmd.on ?? !enabled;
      if (want === enabled) return;
      // pelo menos uma música do medley precisa tocar
      if (!want && slices.filter(isSliceEnabled).length <= 1) return;
      st.updateMedleyPart(song.id, part.id, { enabled: want });
      return;
    }
    case 'clockStart': {
      const duration = durationFor(getShowClock(), showKeyOf(st.activeShowId), showTotal(st));
      if (!getShowClock().run) startShowClock(duration);
      return;
    }
    case 'clockReset': resetShowClock(); return;
    case 'clockDuration': setShowDuration(showKeyOf(st.activeShowId), cmd.sec, showTotal(st)); return;
    case 'dismissError': st.setPlaybackError(null); return;

    case 'volume': remoteFader(`v:${cmd.trackId}`, () => st.setVolume(cmd.trackId, cmd.value)); return;
    case 'master': remoteFader('master', () => st.setMasterVolume(cmd.value)); return;
    // um canal por vez (o mixer em grupo do Mac fica só no Mac); com `on`, o segundo toque não desfaz
    case 'mute': {
      const tr = st.tracks.find((x) => x.id === cmd.trackId);
      if (tr && (cmd.on === undefined || !!tr.mute !== cmd.on)) st.toggleMute(tr.id);
      return;
    }
    case 'solo': {
      const tr = st.tracks.find((x) => x.id === cmd.trackId);
      if (tr && (cmd.on === undefined || !!tr.solo !== cmd.on)) st.toggleSolo(tr.id);
      return;
    }

    case 'rename': if (songOf(cmd.songId)) st.renameSong(cmd.songId, cmd.name); return;
    case 'duplicate': if (st.playlist.some((p) => p.songId === cmd.songId)) st.duplicatePlaylistEntry(cmd.songId); return;
    case 'move': {
      const from = st.playlist.findIndex((p) => p.songId === cmd.songId);
      const to = from + cmd.dir;
      if (from < 0 || to < 0 || to >= st.playlist.length) return;
      st.reorderPlaylist(from, to);
      return;
    }
    case 'createBlock': st.createBlock(cmd.songId); return;
    case 'renameBlock': if (st.blocks.some((b) => b.id === cmd.blockId)) st.renameBlock(cmd.blockId, cmd.name); return;
    case 'blockColor':
      if (st.blocks.some((b) => b.id === cmd.blockId) && BLOCK_COLORS.includes(cmd.color)) st.setBlockColor(cmd.blockId, cmd.color);
      return;
  }
}

/** Canais que o Remote mostra (os mesmos do mixer do Mac, na mesma ordem). */
function remoteTrackIds(st: Store): string[] {
  return ROUTABLE_TRACKS.filter((id) => st.tracks.some((tr) => tr.id === id && !tr.parentId));
}

/**
 * Medidores do Remote: manda o nível de cada canal e do master a cada `intervalMs` enquanto
 * `enabled()` deixar. Em silêncio repete no máximo uma vez por segundo (o celular apaga a barra
 * sozinho se parar de chegar).
 */
export function startRemoteMeterFeed(
  push: (m: RemoteMeters) => void,
  opts: { intervalMs: number; enabled?: () => boolean },
): () => void {
  let lastKey = '';
  let lastAt = 0;
  const timer = window.setInterval(() => {
    if (opts.enabled && !opts.enabled()) return;
    const now = Date.now();
    const m = packMeters(remoteTrackIds(useStore.getState()), meterLevel, now);
    const key = `${m.ids.join()}|${m.levels.join()}|${m.master}`;
    if (key === lastKey && now - lastAt < 1000) return;
    lastKey = key;
    lastAt = now;
    push(m);
  }, opts.intervalMs);
  return () => window.clearInterval(timer);
}

/**
 * Resumo do que o Remote mostra e o transporte do show não cobre (mixer, ajustes, torres, erro,
 * parte engatilhada, seleção). Quando muda, o estado vai na hora para o celular.
 */
export function remoteSignature(st: Store): string {
  return JSON.stringify([
    st.showBpmTower, st.showTunerTower, st.playbackError, st.masterVolume, st.queuedRegion, st.selectedSongId,
    st.audioInterface, st.audioInterfaceConnected, st.outputChannelCount, st.incompleteSongIds.length,
    st.tracks.map((tr) => `${tr.id}:${tr.volume}:${tr.mute ? 1 : 0}${tr.solo ? 1 : 0}${tr.faderLocked ? 1 : 0}`),
  ]);
}
