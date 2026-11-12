import { useEffect, useRef, useState } from 'react';
import type { LyricPage } from '@/lib/prompterTypes';
import { kindInfo } from '@/lib/prompterTypes';
import { formatClock } from '@/lib/prompterView';

export async function decodePeaks(file: File, buckets = 1600): Promise<{ peaks: Float32Array; duration: number }> {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf);
  const peaks = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(audio.length / buckets));
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let b = 0; b < buckets; b++) {
      let max = 0;
      const start = b * step;
      const end = Math.min(data.length, start + step);
      for (let i = start; i < end; i += 4) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      if (max > peaks[b]) peaks[b] = max;
    }
  }
  let top = 0;
  for (const v of peaks) if (v > top) top = v;
  if (top > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= top;
  return { peaks, duration: audio.duration };
}

const HEIGHT = 132;
/** Movimento (px) que separa um toque na marcação (selecionar) de um arraste. */
const DRAG_SLOP = 3;

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? '';
}

export default function LyricsWaveform({ peaks, duration, t, pages, activeIdx, selectedId, onSelect, onSeek, onMoveMarker, onPlace, clampTime }: {
  peaks: Float32Array | null;
  duration: number;
  t: number;
  pages: LyricPage[];
  activeIdx: number;
  /** Marcação escolhida (para apagar ou ajustar pelo teclado). */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onSeek: (time: number) => void;
  onMoveMarker: (id: string, time: number) => void;
  /** Duplo clique na onda: coloca ali o trecho que está para marcar, ou cria uma marcação. */
  onPlace?: (time: number) => void;
  /** Onde a marcação pode ficar durante o arraste (não passa por cima das vizinhas). */
  clampTime?: (id: string, time: number) => number | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<{ id: string; time: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = HEIGHT * dpr;
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, width, HEIGHT);
    const mid = HEIGHT / 2;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(0, mid, width, 1);
    if (!peaks) return;
    g.fillStyle = '#5b8db8';
    for (let x = 0; x < width; x++) {
      const v = peaks[Math.floor((x / width) * peaks.length)] ?? 0;
      const h = Math.max(1, v * (HEIGHT / 2 - 6));
      g.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, width]);

  const timeAt = (clientX: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  };
  const clamp = (id: string, time: number) => clampTime?.(id, time) ?? time;

  const startDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < DRAG_SLOP) return;
      moved = true;
      setDrag({ id, time: clamp(id, timeAt(ev.clientX)) });
    };
    const finish = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      setDrag(null);
      onSelect?.(id);
      if (moved && ev.type === 'pointerup') onMoveMarker(id, Math.round(clamp(id, timeAt(ev.clientX)) * 10) / 10);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const pct = (time: number) => (duration ? `${(time / duration) * 100}%` : '0%');

  // Próximo tempo marcado depois de cada página: limita a largura do texto ao lado da marcação.
  const nextTimes: (number | null)[] = [];
  let upcoming: number | null = null;
  for (let i = pages.length - 1; i >= 0; i--) {
    nextTimes[i] = upcoming;
    if (pages[i].time !== null) upcoming = pages[i].time;
  }

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative rounded-lg bg-logic-bg-deep border border-logic-border overflow-hidden cursor-pointer touch-none select-none"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => { if (duration) { onSelect?.(null); onSeek(timeAt(e.clientX)); } }}
        onDoubleClick={(e) => { if (duration && onPlace) onPlace(timeAt(e.clientX)); }}
        title={onPlace ? 'Clique para ouvir daqui. Duplo clique para colocar uma marcação neste ponto.' : undefined}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        {!peaks && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-logic-text-muted pointer-events-none">
            {duration ? 'Carregue o áudio LR Master para ver a onda' : 'Carregue o áudio LR Master desta música'}
          </p>
        )}
        {pages.map((p, i) => {
          if (p.time === null) return null;
          const time = drag?.id === p.id ? drag.time : p.time;
          const color = kindInfo(p.kind).color;
          const selected = selectedId === p.id;
          const next = nextTimes[i];
          const spanPx = duration && next !== null ? (Math.max(0, next - time) / duration) * width - 10 : (duration ? ((duration - time) / duration) * width - 10 : 0);
          const label = firstLine(p.text);
          return (
            <div key={p.id} className="absolute top-0 bottom-0" style={{ left: pct(time), zIndex: selected || drag?.id === p.id ? 3 : 1 }}>
              <div className={`absolute top-0 bottom-0 ${selected ? 'w-0.5' : 'w-px'}`} style={{ background: color, opacity: selected || i === activeIdx ? 1 : 0.6 }} />
              {label && spanPx > 24 && (
                <span
                  className="absolute bottom-1 left-1 pointer-events-none truncate text-[10px] leading-tight px-1 rounded-sm bg-black/55 text-logic-text"
                  style={{ maxWidth: Math.min(spanPx, 260), width: 'max-content' }}
                >
                  {label}
                </span>
              )}
              <button
                onPointerDown={(e) => startDrag(e, p.id)}
                onDoubleClick={(e) => e.stopPropagation()}
                className={`absolute top-1 -translate-x-1/2 min-w-[20px] h-5 px-1 rounded text-[11px] font-bold text-black cursor-ew-resize shadow ${selected ? 'ring-2 ring-logic-lcd-amber' : i === activeIdx ? 'ring-2 ring-white' : ''}`}
                style={{ background: color }}
                title={`Trecho ${i + 1} · ${formatClock(time)} (toque para escolher, arraste para ajustar)`}
                aria-label={`Marcação do trecho ${i + 1}`}
                aria-pressed={selected}
              >
                {i + 1}
              </button>
            </div>
          );
        })}
        {duration > 0 && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none shadow-[0_0_6px_rgba(255,255,255,0.6)]" style={{ left: pct(t), zIndex: 2 }} />
        )}
      </div>
      <div className="flex justify-between mt-1.5 text-xs tabular-nums text-logic-text-dim">
        <span className="text-logic-text font-medium">{formatClock(t)}</span>
        <span>{formatClock(duration)}</span>
      </div>
    </div>
  );
}
