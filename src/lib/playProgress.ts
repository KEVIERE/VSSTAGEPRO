import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { currentAndNextSlice, sliceDuration } from '@/lib/medley';

/**
 * Porcentagem de progresso da reprodução atual (0 a 100).
 * Tanto a Barra de Progresso ("Tocando") quanto a Barra de Regresso ("Próxima" / ampulheta)
 * usam EXATAMENTE este mesmo cálculo e mesma fonte de tempo no mesmo quadro, garantindo
 * alinhamento visual e temporal perfeito em qualquer circunstância (música inteira ou medley).
 */
export function getLiveProgressPct(): number {
  const st = useStore.getState();
  if (!st.transport.isPlaying) return 0;

  // A música que está tocando agora é rigorosamente currentSongId (nunca selectedSongId enquanto toca)
  const curId = st.transport.currentSongId ?? st.playlist[0]?.songId;
  if (!curId) return 0;
  const curSong = st.songs.find((s) => s.id === curId);
  const duration = curSong?.duration ?? 0;
  if (duration <= 0) return 0;

  const live = audioEngine.isRunning() && !audioEngine.isUserSeeking();
  const t = live ? audioEngine.getCurrentTime() : st.transport.currentTime;

  const slices = curSong ? currentAndNextSlice(curSong, t) : { current: null, next: null };
  if (slices.current) {
    const sDur = Math.max(0.01, sliceDuration(curSong!, slices.current));
    return Math.min(100, Math.max(0, ((t - slices.current.start) / sDur) * 100));
  }

  return Math.min(100, Math.max(0, (t / duration) * 100));
}
