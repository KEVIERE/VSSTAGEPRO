import { useRef, useState } from 'react';
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';
import { useFrame } from '@/lib/frameClock';

/** Segundos (arredondados) que faltam agora na música em uso, ou null quando não há música. */
function remainingNow(): number | null {
  const st = useStore.getState();
  const curId = st.transport.currentSongId ?? st.selectedSongId ?? st.playlist[0]?.songId;
  const song = st.songs.find((s) => s.id === curId);
  const duration = song?.duration ?? 0;
  if (!song || duration <= 0) return null;
  const live = st.transport.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking();
  const t = live ? audioEngine.getCurrentTime() : st.transport.currentTime;
  return Math.round(Math.max(0, duration - t) * bpmAdjustToAlpha(song.bpmAdjust ?? 0));
}

/**
 * Segundos (arredondados) que faltam na música em uso, ou null quando não há música.
 * Lê o relógio do áudio a cada quadro do relógio único (frameClock), mas só avisa o React quando
 * o número muda (uma vez por segundo), então os displays não pesam o programa. Parado, o relógio
 * dorme e acorda quando o cursor, a música ou o ajuste mudam no store.
 * Considera o ajuste de BPM: música mais lenta demora mais para acabar.
 */
export function useSongRemaining(): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const last = useRef<number | null | undefined>(undefined);
  useFrame(() => {
    const next = remainingNow();
    if (next !== last.current) {
      last.current = next;
      setLeft(next);
    }
  });
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
