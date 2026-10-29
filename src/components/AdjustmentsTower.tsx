import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { Minus, Plus } from 'lucide-react';
import { useRef } from 'react';

const LIMITS = { bpm: 30, tuner: 12 } as const;

// O ajuste de BPM guardado é relativo a 120 (velocidade = (120 + ajuste) / 120), como sempre
// foi — projetos salvos tocam igual. Na tela e nos botões ele vale em BPM REAL da música:
// numa música de 154 BPM, "+7" deixa ela em 161 (antes "+7" virava 163 e o painel mostrava +9).
function realBpmDelta(bpm: number, adjust: number): number {
  return Math.round(bpm * ((120 + adjust) / 120)) - Math.round(bpm);
}

function adjustForRealDelta(bpm: number, delta: number): number {
  return ((Math.round(bpm) + delta) / bpm - 1) * 120;
}

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
    const bpm = kind === 'bpm' && song?.bpmDetected && song.bpm ? song.bpm : null;
    let next: number;
    if (bpm) {
      const real = Math.max(-LIMITS.bpm, Math.min(LIMITS.bpm, realBpmDelta(bpm, cur) + delta));
      next = real === 0 ? 0 : adjustForRealDelta(bpm, real);
    } else {
      next = Math.max(-LIMITS[kind], Math.min(LIMITS[kind], cur + delta));
    }
    const same = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-6;
    const field = kind === 'bpm' ? 'bpmAdjust' : 'tuner';
    if (partId) {
      // igual ao da música = volta a seguir a música (senão a fatia ficava presa e o ajuste
      // da música deixava de valer nela, parecendo que o tuner/BPM não funcionava)
      st.updateMedleyPart(songId, partId, { [field]: same(next, songValue) ? undefined : next });
    } else {
      // fatias que estavam iguais à música continuam acompanhando a música
      for (const p of song?.medley ?? []) {
        if (same(p[field], songValue)) st.updateMedleyPart(songId, p.id, { [field]: undefined });
      }
      if (kind === 'bpm') st.setSongBpmAdjust(songId, next);
      else st.setSongTuner(songId, next);
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      audioEngine.applySongPlaybackParams(songId);
    }, 30);
  };
  const songBpm = useStore((s) => {
    const sg = s.songs.find((x) => x.id === songId);
    return kind === 'bpm' && sg?.bpmDetected && sg.bpm ? sg.bpm : null;
  });
  // BPM: mostra quantos BPM reais a música (ou a fatia) está acima/abaixo do original
  const shown = songBpm ? realBpmDelta(songBpm, value) : Math.round(value);
  const size = partId ? 'w-[18px] h-[18px]' : 'w-5 h-5';
  const btn = `${size} rounded border border-logic-border-light bg-logic-bg-elevated text-logic-text hover:bg-logic-bg-panel-light hover:border-logic-accent flex items-center justify-center transition-colors`;
  const tone = inherited ? 'text-logic-text-muted/60' : shown === 0 ? 'text-logic-text-muted' : shown > 0 ? 'text-logic-lcd-green' : 'text-logic-lcd-amber';
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
        {shown > 0 ? '+' : ''}{shown}
      </span>
      <button className={btn} onClick={() => bump(1)} aria-label={kind === 'bpm' ? 'Aumentar BPM' : 'Subir meio tom'}>
        <Plus size={10} />
      </button>
    </div>
  );
}
