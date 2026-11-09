import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';

/**
 * Segundos (arredondados) que faltam na música em uso, ou null quando não há música.
 * Lê o relógio do áudio a cada quadro, mas só avisa o React quando o número muda
 * (uma vez por segundo), então os displays não pesam o programa.
 * Considera o ajuste de BPM: música mais lenta demora mais para acabar.
 */
export function useSongRemaining(): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let last: number | null | undefined;
    const tick = () => {
      const st = useStore.getState();
      const curId = st.transport.currentSongId ?? st.selectedSongId ?? st.playlist[0]?.songId;
      const song = st.songs.find((s) => s.id === curId);
      const duration = song?.duration ?? 0;
      let next: number | null = null;
      if (song && duration > 0) {
        const live = st.transport.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking();
        const t = live ? audioEngine.getCurrentTime() : st.transport.currentTime;
        next = Math.round(Math.max(0, duration - t) * bpmAdjustToAlpha(song.bpmAdjust ?? 0));
      }
      if (next !== last) {
        last = next;
        setLeft(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return left;
}

/** "m:ss" (ou "h:mm:ss") para os displays de 7 segmentos */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
