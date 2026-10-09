import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { Minus, Plus } from 'lucide-react';
import { useRef } from 'react';

const LIMITS = { bpm: 30, tuner: 12 } as const;

interface SongAdjusterProps {
  songId: string;
  kind: 'bpm' | 'tuner';
  value: number;
  /** Ajusta só esta fatia do medley; sem ajuste próprio ela segue a música. */
  partId?: string;
  inherited?: boolean;
}

/** Botões de - e + do ajuste de BPM ou de tom de uma música. Cliques rápidos viram um só recálculo do áudio. */
export function SongAdjuster({ songId, kind, value, partId, inherited }: SongAdjusterProps) {
  const timer = useRef<number | null>(null);
  const bump = (delta: number) => {
    const st = useStore.getState();
    const song = st.songs.find((sg) => sg.id === songId);
    const songValue = kind === 'bpm' ? song?.bpmAdjust ?? 0 : song?.tuner ?? 0;
    const part = partId ? song?.medley?.find((p) => p.id === partId) : undefined;
    const cur = part ? (kind === 'bpm' ? part.bpmAdjust : part.tuner) ?? songValue : songValue;
    const next = Math.max(-LIMITS[kind], Math.min(LIMITS[kind], cur + delta));
    if (partId) st.updateMedleyPart(songId, partId, kind === 'bpm' ? { bpmAdjust: next } : { tuner: next });
    else if (kind === 'bpm') st.setSongBpmAdjust(songId, next);
    else st.setSongTuner(songId, next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      audioEngine.applySongPlaybackParams(songId);
    }, 30);
  };
  const size = partId ? 'w-[18px] h-[18px]' : 'w-5 h-5';
  const btn = `${size} rounded border border-logic-border-light bg-logic-bg-elevated text-logic-text hover:bg-logic-bg-panel-light hover:border-logic-accent flex items-center justify-center transition-colors`;
  const tone = inherited ? 'text-logic-text-muted/60' : value === 0 ? 'text-logic-text-muted' : value > 0 ? 'text-logic-lcd-green' : 'text-logic-lcd-amber';
  const label = kind === 'bpm' ? 'BPM' : 'tom';
  return (
    <div
      className="flex items-center justify-center gap-1 flex-shrink-0"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title={partId ? (inherited ? `Segue o ${label} da música. Ajuste para mudar só esta fatia.` : `${label} só desta fatia`) : undefined}
    >
      <button className={btn} onClick={() => bump(-1)} aria-label={kind === 'bpm' ? 'Diminuir BPM' : 'Descer meio tom'}>
        <Minus size={10} />
      </button>
      <span className={`text-xs font-mono tabular-nums w-9 text-center ${tone}`}>
        {value > 0 ? '+' : ''}{value}
      </span>
      <button className={btn} onClick={() => bump(1)} aria-label={kind === 'bpm' ? 'Aumentar BPM' : 'Subir meio tom'}>
        <Plus size={10} />
      </button>
    </div>
  );
}
