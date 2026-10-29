import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { computeNextSongId } from '@/lib/playFlow';
import { previousRegionStart } from '@/lib/regions';
import { entryPoint } from '@/lib/medley';
import { audioRecorder, saveRecordingToMaestro } from '@/lib/audioRecorder';

const PLAY_FAILED = 'Não foi possível tocar esta música. Confira a saída de áudio e tente de novo.';

async function finalizeActiveRecording() {
  const st = useStore.getState();
  const rec = st.recordingMaestro;
  if (!rec || !rec.isRecording) return;
  st.setRecordingMaestro(null);
  try {
    const res = await audioRecorder.stop();
    if (res && res.audioBuffer) {
      await saveRecordingToMaestro(rec.songId, rec.startTime, res.audioBuffer);
      st.setImportProgress({
        clipId: 'maestro',
        status: 'done',
        message: 'Gravação da voz do Maestro adicionada à timeline!',
      });
      setTimeout(() => st.setImportProgress(null), 3000);
    }
  } catch (err) {
    console.error('[Maestro REC] erro ao salvar gravação:', err);
  }
}

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

export async function startPlayback() {
  const st = useStore.getState();
  if (st.transport.isPlaying) return;
  if (st.projectAudioPrep?.status === 'loading') {
    st.setPlaybackError(`Aguarde a preparação do projeto: ${st.projectAudioPrep.done} de ${st.projectAudioPrep.total} músicas carregadas.`);
    return;
  }
  if (audioEngine.isStarting()) {
    // Se o motor estava terminando uma ação anterior, espera até 200ms em vez de descartar o clique do Play
    for (let i = 0; i < 5 && audioEngine.isStarting(); i++) {
      await new Promise((r) => setTimeout(r, 40));
    }
    if (useStore.getState().transport.isPlaying) return;
  }
  const songId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;
  if (!songId) return;
  const song = st.songs.find((sg) => sg.id === songId);
  // Se o usuário cortou o fim do VS, o cursor pode estar além da nova duração:
  // nesse caso toca da última fatia ou volta ao início, sem travar
  const cursor = !st.transport.currentSongId || st.transport.currentSongId === songId ? st.transport.currentTime : 0;
  const maxSafe = song ? Math.max(0, song.duration - 0.05) : 0;
  const safeCursor = Math.min(cursor, maxSafe);
  const offset = song && safeCursor > 0 ? safeCursor : entryPoint(song);
  st.setPlaybackError(null);
  st.play();
  audioEngine.playSong(songId, offset)
    .catch((err) => console.error('[play] falha', err))
    .finally(() => verifyStarted(songId));
  refreshNextSong(songId);
}

export function pausePlayback() {
  finalizeActiveRecording();
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
  finalizeActiveRecording();
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
