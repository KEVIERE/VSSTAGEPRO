import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { LyricPage } from '@/lib/prompterTypes';
import { kindInfo } from '@/lib/prompterTypes';
import { formatClock } from '@/lib/prompterView';

export async function decodePeaks(file: File, buckets = 12000): Promise<{ peaks: Float32Array; duration: number }> {
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
/** Níveis de zoom da onda (1 = música inteira). */
const ZOOMS = [1, 2, 4, 8, 16, 32];
/** Espaço mínimo (px) entre marcações para dar para pegar cada uma com o dedo/mouse. */
const MIN_MARKER_PX = 34;

/** Zoom que deixa as marcações com espaço para pegar: música longa com muita letra abre mais perto. */
export function suggestZoom(times: number[], duration: number, width: number): number {
  if (!duration || !width || times.length < 2) return 1;
  const sorted = [...times].sort((a, b) => a - b);
  const gaps = sorted.slice(1).map((t, i) => t - sorted[i]).filter((g) => g > 0).sort((a, b) => a - b);
  if (!gaps.length) return 1;
  const typical = gaps[Math.floor(gaps.length / 2)];
  const need = (MIN_MARKER_PX * duration) / (typical * width);
  return ZOOMS.find((z) => z >= need) ?? ZOOMS[ZOOMS.length - 1];
}

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
  // Janela visível da onda: com zoom, só um pedaço da música aparece (como no CapCut).
  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const userZoomed = useRef(false);
  const viewDur = duration > 0 ? duration / zoom : 0;
  const maxStart = Math.max(0, duration - viewDur);
  const start = Math.min(maxStart, Math.max(0, viewStart));

  const timed = pages.filter((p) => p.time !== null).map((p) => p.time as number);
  const timedKey = timed.length;
  // Zoom automático quando a letra chega: só enquanto a pessoa não mexeu no zoom.
  useEffect(() => {
    if (userZoomed.current || !width || !duration) return;
    setZoom(suggestZoom(timed, duration, width));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedKey, duration, width]);

  // Tocando (ou pulando para outro ponto), a janela anda junto com a música. Só quando o cursor
  // muda: se a pessoa rolar a onda para ver outra parte, a janela fica onde ela deixou.
  const followRef = useRef({ start, viewDur, zoom, drag: !!drag });
  followRef.current = { start, viewDur, zoom, drag: !!drag };
  useEffect(() => {
    const f = followRef.current;
    if (f.zoom === 1 || !f.viewDur || f.drag) return;
    if (t < f.start || t > f.start + f.viewDur * 0.95) setViewStart(Math.max(0, t - f.viewDur * 0.1));
  }, [t]);

  const zoomTo = (next: number, anchor?: number) => {
    userZoomed.current = true;
    const z = Math.min(ZOOMS[ZOOMS.length - 1], Math.max(1, next));
    const at = anchor ?? (t >= start && t <= start + viewDur ? t : start + viewDur / 2);
    const frac = viewDur ? (at - start) / viewDur : 0.5;
    const dur = duration / z;
    setZoom(z);
    setViewStart(Math.max(0, Math.min(duration - dur, at - frac * dur)));
  };
  const zoomStep = (dir: 1 | -1, anchor?: number) => {
    const i = ZOOMS.indexOf(zoom);
    zoomTo(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))], anchor);
  };

  // Trackpad: pinça (ou Ctrl/Cmd + rolar) aproxima no ponto do mouse; rolar para os lados anda.
  const wheelState = useRef({ start, viewDur, duration, zoom });
  wheelState.current = { start, viewDur, duration, zoom };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const st = wheelState.current;
      if (!st.duration) return;
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        acc += e.deltaY;
        if (Math.abs(acc) < 40) return;
        const anchor = st.start + ((e.clientX - r.left) / r.width) * st.viewDur;
        zoomStepRef.current(acc < 0 ? 1 : -1, anchor);
        acc = 0;
        return;
      }
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!dx || st.zoom === 1) return;
      e.preventDefault();
      setViewStart(Math.max(0, Math.min(st.duration - st.viewDur, st.start + (dx / r.width) * st.viewDur)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const zoomStepRef = useRef(zoomStep);
  zoomStepRef.current = zoomStep;

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
    if (!peaks || !duration) return;
    g.fillStyle = '#5b8db8';
    const n = peaks.length;
    for (let x = 0; x < width; x++) {
      // cada coluna de pixel pega o pico do trecho de música que ela cobre
      const a = Math.floor(((start + (x / width) * viewDur) / duration) * n);
      const b = Math.max(a + 1, Math.floor(((start + ((x + 1) / width) * viewDur) / duration) * n));
      let v = 0;
      for (let i = a; i < b && i < n; i++) if (peaks[i] > v) v = peaks[i];
      const h = Math.max(1, v * (HEIGHT / 2 - 6));
      g.fillRect(x, mid - h, 1, h * 2);
    }
  }, [peaks, width, start, viewDur, duration]);

  const timeAt = (clientX: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.min(duration, Math.max(0, start + ((clientX - r.left) / r.width) * viewDur));
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

  const pct = (time: number) => (viewDur ? `${((time - start) / viewDur) * 100}%` : '0%');
  const visible = (time: number) => time >= start - viewDur * 0.02 && time <= start + viewDur * 1.02;

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
          if (!visible(time)) return null;
          const color = kindInfo(p.kind).color;
          const selected = selectedId === p.id;
          const next = nextTimes[i];
          const pxPerSec = viewDur ? width / viewDur : 0;
          const spanPx = (Math.max(0, (next ?? duration) - time)) * pxPerSec - 10;
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
        {duration > 0 && visible(t) && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none shadow-[0_0_6px_rgba(255,255,255,0.6)]" style={{ left: pct(t), zIndex: 2 }} />
        )}
      </div>
      {zoom > 1 && duration > 0 && (
        // Barra de rolagem: o trecho visível da música, arrastável.
        <div
          className="relative h-2 mt-1 rounded-full bg-black/40 cursor-pointer"
          onPointerDown={(e) => {
            const bar = e.currentTarget.getBoundingClientRect();
            const go = (cx: number) => setViewStart(Math.max(0, Math.min(maxStart, ((cx - bar.left) / bar.width) * duration - viewDur / 2)));
            go(e.clientX);
            const move = (ev: PointerEvent) => go(ev.clientX);
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          title="Arraste para andar pela música"
        >
          <div className="absolute top-0 bottom-0 rounded-full bg-logic-lcd-amber/70" style={{ left: `${(start / duration) * 100}%`, width: `${(viewDur / duration) * 100}%` }} />
          <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-white" style={{ left: `${(t / duration) * 100}%` }} />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-1.5 text-xs tabular-nums text-logic-text-dim">
        <span className="text-logic-text font-medium min-w-[40px]">{formatClock(t)}</span>
        {duration > 0 && (
          <span className="flex items-center gap-1" title="Zoom na onda (pinça no trackpad ou Ctrl/Cmd + rolar)">
            <button onClick={() => zoomStep(-1)} disabled={zoom === 1} className="console-key w-7 h-6 flex items-center justify-center disabled:opacity-30" aria-label="Afastar a onda"><ZoomOut size={12} /></button>
            <span className="console-legend !text-[10px] w-9 text-center">{zoom}x</span>
            <button onClick={() => zoomStep(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} className="console-key w-7 h-6 flex items-center justify-center disabled:opacity-30" aria-label="Aproximar a onda"><ZoomIn size={12} /></button>
          </span>
        )}
        <span className="min-w-[40px] text-right">{zoom > 1 ? `${formatClock(start)}–${formatClock(start + viewDur)}` : formatClock(duration)}</span>
      </div>
    </div>
  );
}
