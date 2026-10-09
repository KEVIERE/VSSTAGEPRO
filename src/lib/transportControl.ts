import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { computeNextSongId } from '@/lib/playFlow';
import { previousRegionStart } from '@/lib/regions';
import { entryPoint } from '@/lib/medley';

const PLAY_FAILED = 'Não foi possível tocar esta música. Confira a saída de áudio e tente de novo.';

function verifyStarted(songId: string) {
  const st = useStore.getState();
  if (!st.transport.isPlaying || audioEngine.isRunning() || audioEngine.isStarting()) return;
  if (st.transport.currentSongId && st.transport.currentSongId !== songId) return;
  st.stop(st.transport.currentTime);
  st.setPlaybackError(PLAY_FAILED);
}

function refreshNextSong(songId: string) {
  const st = useStore.getState();
  st.setNextSong(computeNextSongId(songId, st.playlist, st.playlistOrder, st.transport.playFlow));
}

export function startPlayback() {
  const st = useStore.getState();
  if (st.transport.isPlaying || audioEngine.isStarting()) return;
  const songId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;
  if (!songId) return;
  const song = st.songs.find((sg) => sg.id === songId);
  // a posição guardada pertence à última música tocada; outra música escolhida começa do início
  const cursor = !st.transport.currentSongId || st.transport.currentSongId === songId ? st.transport.currentTime : 0;
  const offset = song && cursor > 0 && cursor < song.duration - 0.05 ? cursor : entryPoint(song);
  st.setPlaybackError(null);
  st.play();
  audioEngine.playSong(songId, offset)
    .catch((err) => console.error('[play] falha', err))
    .finally(() => verifyStarted(songId));
  refreshNextSong(songId);
}

export function pausePlayback() {
  const st = useStore.getState();
  if (!st.transport.isPlaying) return;
  const position = audioEngine.isRunning() ? audioEngine.getCurrentTime() : st.transport.currentTime;
  audioEngine.stopAll();
  st.pause(Math.max(0, position));
}

export function togglePlayPause() {
  if (useStore.getState().transport.isPlaying) pausePlayback();
  else startPlayback();
}

export function stopPlayback() {
  const st = useStore.getState();
  const songId = st.transport.currentSongId ?? st.selectedSongId;
  const position = st.transport.isPlaying && audioEngine.isRunning() ? audioEngine.getCurrentTime() : st.transport.currentTime;
  const song = st.songs.find((sg) => sg.id === songId);
  const returnTo = previousRegionStart(song?.regions, position);
  audioEngine.stopAll();
  st.setQueuedRegion(null);
  st.stop(returnTo);
}

/** Mantém a próxima engatilhada em dia quando a playlist muda, sem desfazer uma próxima escolhida à mão. */
export function watchPlaylistForNextSong(): () => void {
  return useStore.subscribe((s, prev) => {
    if (s.playlistOrder === prev.playlistOrder && s.playlist === prev.playlist) return;
    const cur = s.transport.currentSongId;
    if (!cur) return;
    const next = s.transport.nextSongId;
    const prevAuto = computeNextSongId(cur, prev.playlist, prev.playlistOrder, prev.transport.playFlow);
    if (next && next !== prevAuto && s.playlistOrder.includes(next)) return;
    const auto = computeNextSongId(cur, s.playlist, s.playlistOrder, s.transport.playFlow);
    if (auto !== next) s.setNextSong(auto);
  });
}

export function seekToPosition(songId: string, position: number) {
  const st = useStore.getState();
  if (st.transport.isPlaying) {
    if (st.transport.currentSongId === songId) audioEngine.seekTo(position);
    return;
  }
  st.setCurrentTime(position);
}
