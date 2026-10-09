import { useEffect, useRef, useState } from 'react';
import { newId, type Stroke } from '@/lib/notebook';

export type DrawTool = 'pen' | 'marker' | 'eraser';

const X_SCALE = 10000;
const MIN_GAP = 2;
const ERASE_RADIUS = 14;
const MARKER_ALPHA = 0.35;

function paint(ctx: CanvasRenderingContext2D, s: Stroke, width: number) {
  const p = s.points;
  if (p.length < 2) return;
  ctx.save();
  ctx.globalAlpha = s.tool === 'marker' ? MARKER_ALPHA : 1;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = s.tool === 'marker' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  const x = (i: number) => (p[i] / X_SCALE) * width;
  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(x(0), p[1], s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(x(0), p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (x(i) + x(i + 2)) / 2;
      const my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(x(i), p[i + 1], mx, my);
    }
    ctx.lineTo(x(p.length - 2), p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

export default function DrawingLayer({ strokes, tool, color, width, onAdd, onErase }: {
  strokes: Stroke[];
  tool: DrawTool | null;
  color: string;
  width: number;
  onAdd: (s: Stroke) => void;
  onErase: (ids: string[]) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const live = useRef<Stroke | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const redraw = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const visible = strokes.filter((s) => !hidden.has(s.id));
    visible.filter((s) => s.tool === 'marker').forEach((s) => paint(ctx, s, size.w));
    visible.filter((s) => s.tool === 'pen').forEach((s) => paint(ctx, s, size.w));
    if (live.current) paint(ctx, live.current, size.w);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, size.w * dpr);
    c.height = Math.max(1, size.h * dpr);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, strokes, hidden]);

  const local = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const eraseAt = (x: number, y: number) => {
    const set = erasing.current;
    if (!set) return;
    let changed = false;
    for (const s of strokes) {
      if (set.has(s.id)) continue;
      const hitR = ERASE_RADIUS + s.width / 2;
      for (let i = 0; i < s.points.length; i += 2) {
        const px = (s.points[i] / X_SCALE) * size.w;
        if (Math.abs(px - x) < hitR && Math.abs(s.points[i + 1] - y) < hitR) { set.add(s.id); changed = true; break; }
      }
    }
    if (changed) setHidden(new Set(set));
  };

  const down = (e: React.PointerEvent) => {
    if (!tool || e.button > 0 || !size.w) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = local(e);
    if (tool === 'eraser') {
      erasing.current = new Set();
      eraseAt(x, y);
      return;
    }
    live.current = {
      id: newId(), tool, color,
      width: tool === 'marker' ? width * 3 : width,
      points: [Math.round((x / size.w) * X_SCALE), Math.round(y)],
    };
    redraw();
  };

  const move = (e: React.PointerEvent) => {
    if (erasing.current) {
      const { x, y } = local(e);
      eraseAt(x, y);
      return;
    }
    const s = live.current;
    if (!s) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    const r = wrapRef.current!.getBoundingClientRect();
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const lx = (s.points[s.points.length - 2] / X_SCALE) * size.w;
      const ly = s.points[s.points.length - 1];
      if (Math.hypot(x - lx, y - ly) < MIN_GAP) continue;
      s.points.push(Math.round((x / size.w) * X_SCALE), Math.round(y));
    }
    redraw();
  };

  const up = () => {
    if (erasing.current) {
      const ids = [...erasing.current];
      erasing.current = null;
      if (ids.length) onErase(ids);
      setHidden(new Set());
      return;
    }
    const s = live.current;
    live.current = null;
    if (s) onAdd(s);
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-10"
      style={{
        pointerEvents: tool ? 'auto' : 'none',
        touchAction: tool ? 'none' : 'auto',
        cursor: tool === 'eraser' ? 'cell' : tool ? 'crosshair' : undefined,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: size.w, height: size.h }} />
    </div>
  );
}
