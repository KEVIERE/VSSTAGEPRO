import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';

export default function Playhead({ songId }: { songId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const st = useStore.getState();
      const live = st.transport.isPlaying && st.transport.currentSongId === songId && audioEngine.isRunning() && !audioEngine.isUserSeeking();
      const t = live ? audioEngine.getHeardTime() : st.transport.currentTime;
      // Posição em segundos vezes o zoom da variável CSS do conteúdo (--vs-zoom): no zoom o cursor
      // já sai no lugar certo no mesmo quadro (também no zoom ao vivo, que muda só a variável),
      // sem esperar este rAF nem reiniciar o laço.
      if (ref.current) ref.current.style.transform = `translateX(calc(var(--vs-zoom) * ${Math.max(0, t)}px))`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [songId]);

  return (
    <div
      ref={ref}
      className="absolute top-0 bottom-0 left-0 w-px bg-logic-lcd-amber pointer-events-none z-30 will-change-transform"
    >
      <div className="w-2.5 h-3 bg-logic-lcd-amber -ml-[4px] rounded-b-sm" />
    </div>
  );
}
