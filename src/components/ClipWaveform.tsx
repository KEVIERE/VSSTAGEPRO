import { memo, useEffect, useRef, useState } from 'react';
import type { AudioClip } from '@/types';

export const WAVE_TILE_PX = 2048;
const SETTLE_MS = 160;
const MAX_STRETCH = 2;

export interface VisibleRange {
  start: number;
  end: number;
}

export function routingColorOf(clip: AudioClip) {
  return clip.routingMethod === 'ai' ? '#0a84ff' : clip.routingMethod === 'name' ? '#30d158' : '#ffd60a';
}

interface TileProps {
  peaks: number[] | undefined;
  color: string;
  fullWidth: number;
  offset: number;
  width: number;
  height: number;
}

const WaveTile = memo(function WaveTile({ peaks, color, fullWidth, offset, width, height }: TileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = `${color}1a`;
    ctx.fillRect(0, 0, width, height);
    if (!peaks || peaks.length === 0) return;

    const mid = height / 2;
    const amp = mid - 2;
    const n = peaks.length;
    const total = Math.max(1, fullWidth);

    // Interpola quando há menos picos que pixels; senão agrega pelo máximo do intervalo.
    const samplePeak = (localX: number) => {
      const x = offset + localX;
      if (n <= total) {
        const pos = (x / total) * (n - 1);
        const i = Math.floor(pos);
        const a = peaks[i] ?? 0;
        const b = peaks[Math.min(i + 1, n - 1)] ?? 0;
        return a + (b - a) * (pos - i);
      }
      const s = Math.floor((x / total) * n);
      const e = Math.max(s + 1, Math.floor(((x + 1) / total) * n));
      let maxV = 0;
      for (let i = s; i < e && i < n; i++) if (peaks[i] > maxV) maxV = peaks[i];
      return maxV;
    };

    const values = new Float32Array(width + 1);
    for (let x = 0; x <= width; x++) values[x] = samplePeak(x);

    const drawEnvelope = (scale: number, fill: string, alpha: number) => {
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let x = 0; x <= width; x++) ctx.lineTo(x, mid - values[x] * amp * scale);
      for (let x = width; x >= 0; x--) ctx.lineTo(x, mid + values[x] * amp * scale);
      ctx.closePath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    drawEnvelope(1, color, 0.9);
    drawEnvelope(0.62, 'rgba(255, 255, 255, 0.28)', 1);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(width, mid + 0.5);
    ctx.stroke();
  }, [peaks, color, fullWidth, offset, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 block"
      style={{ left: `${offset}px`, width: `${width}px`, height: `${height}px` }}
    />
  );
});

interface ClipWaveformProps {
  clip: AudioClip;
  left: number;
  width: number;
  height: number;
  visible: VisibleRange;
}

// Desenha só os blocos visíveis; durante o zoom estica o desenho existente e redesenha quando o zoom para.
export function ClipWaveform({ clip, left, width, height, visible }: ClipWaveformProps) {
  const color = routingColorOf(clip);
  const [drawnWidth, setDrawnWidth] = useState(width);
  const ratio = width / drawnWidth;
  const tooStretched = ratio > MAX_STRETCH || ratio < 1 / MAX_STRETCH;
  const baseWidth = tooStretched ? width : drawnWidth;
  const scale = width / baseWidth;

  useEffect(() => {
    if (tooStretched) {
      setDrawnWidth(width);
      return;
    }
    if (width === drawnWidth) return;
    const t = window.setTimeout(() => setDrawnWidth(width), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [width, drawnWidth, tooStretched]);

  const tiles: number[] = [];
  const first = Math.max(0, Math.floor((visible.start - left) / scale / WAVE_TILE_PX));
  const last = Math.min(Math.ceil(baseWidth / WAVE_TILE_PX) - 1, Math.floor((visible.end - left) / scale / WAVE_TILE_PX));
  for (let i = first; i <= last; i++) tiles.push(i);

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: `${baseWidth}px`, height: `${height}px`, transform: scale === 1 ? undefined : `scaleX(${scale})`, transformOrigin: '0 0' }}
    >
      {tiles.map((i) => {
        const offset = i * WAVE_TILE_PX;
        return (
          <WaveTile
            key={i}
            peaks={clip.waveformPeaks}
            color={color}
            fullWidth={baseWidth}
            offset={offset}
            width={Math.min(WAVE_TILE_PX, Math.ceil(baseWidth - offset))}
            height={height}
          />
        );
      })}
    </div>
  );
}
