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
  if (clip.mute) return '#666670';
  return clip.routingMethod === 'ai' ? '#0a84ff' : clip.routingMethod === 'name' ? '#30d158' : '#ffd60a';
}

interface TileProps {
  peaks: number[] | undefined;
  color: string;
  gain?: number;
  fullWidth: number;
  offset: number;
  width: number;
  height: number;
}

const WaveTile = memo(function WaveTile({ peaks, color, gain = 1, fullWidth, offset, width, height }: TileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Fundo limpo e transparente de estúdio (o fundo escuro do clipe garante o contraste do DAW)
    ctx.clearRect(0, 0, width, height);
    if (!peaks || peaks.length === 0) return;

    const mid = height / 2;
    const amp = mid - 2;
    const n = peaks.length;
    const total = Math.max(1, fullWidth);

    // Interpolação Hermite S-Curve suave e orgânica quando ampliado (sem cantos angulares de origami)
    // Agregação precisa de pico máximo quando reduzido (visão geral da música)
    const samplePeak = (localX: number) => {
      const x = offset + localX;
      if (n <= total) {
        const pos = (x / total) * (n - 1);
        const i = Math.floor(pos);
        const a = peaks[i] ?? 0;
        const b = peaks[Math.min(i + 1, n - 1)] ?? 0;
        const t = pos - i;
        // Hermite smoothstep (derivada zero nos extremos): cria curvas acústicas orgânicas
        const smoothT = t * t * (3 - 2 * t);
        return a + (b - a) * smoothT;
      }
      const s = Math.floor((x / total) * n);
      const e = Math.max(s + 1, Math.floor(((x + 1) / total) * n));
      let maxV = 0;
      for (let i = s; i < e && i < n; i++) if (peaks[i] > maxV) maxV = peaks[i];
      return maxV;
    };

    const values = new Float32Array(width + 1);
    const gainFactor = Math.max(0.01, gain || 1);
    for (let x = 0; x <= width; x++) {
      const raw = samplePeak(x) * gainFactor;
      // Escala perceptual de sonoridade (curva dinâmica que destaca nuances sem achatar a forma)
      values[x] = Math.pow(Math.max(0, Math.min(1, raw)), 0.68);
    }

    // 2. Linha central ultra-discreta de estúdio (referência de zero-crossing analógica fina)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    // 3. Renderização de Envelope Fechado Contínuo de Alta Fidelidade (Padrão Apple Logic Pro 11 / Pro Tools HD)
    // Em trechos de silêncio (v < 0.003), a altura é exatamente 0 para não formar linha grossa no meio
    ctx.beginPath();
    ctx.moveTo(0, mid);
    for (let x = 0; x <= width; x++) {
      const v = values[x];
      const hTop = v < 0.003 ? 0 : Math.max(0.5, v * amp);
      ctx.lineTo(x, mid - hTop);
    }
    ctx.lineTo(width, mid);
    for (let x = width; x >= 0; x--) {
      const v = values[x];
      const hBottom = v < 0.003 ? 0 : Math.max(0.5, v * amp);
      ctx.lineTo(x, mid + hBottom);
    }
    ctx.closePath();

    // Gradiente vertical rico e encorpado de DAW profissional: sólido, vibrante e com presença real
    const bodyGrad = ctx.createLinearGradient(0, mid - amp, 0, mid + amp);
    bodyGrad.addColorStop(0, `${color}`);
    bodyGrad.addColorStop(0.3, `${color}f0`);
    bodyGrad.addColorStop(0.5, `${color}b8`);
    bodyGrad.addColorStop(0.7, `${color}f0`);
    bodyGrad.addColorStop(1, `${color}`);

    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // 4. Contorno de Crista Nítido e Cirúrgico (Ataques e Transientes sem borrões nem sombras artificiais)
    ctx.beginPath();
    let startedTop = false;
    for (let x = 0; x <= width; x++) {
      const v = values[x];
      if (v < 0.003) {
        startedTop = false;
        continue;
      }
      const hTop = Math.max(0.5, v * amp);
      if (!startedTop) {
        ctx.moveTo(x, mid - hTop);
        startedTop = true;
      } else {
        ctx.lineTo(x, mid - hTop);
      }
    }
    ctx.strokeStyle = `${color}`;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    let startedBottom = false;
    for (let x = 0; x <= width; x++) {
      const v = values[x];
      if (v < 0.003) {
        startedBottom = false;
        continue;
      }
      const hBottom = Math.max(0.5, v * amp);
      if (!startedBottom) {
        ctx.moveTo(x, mid + hBottom);
        startedBottom = true;
      } else {
        ctx.lineTo(x, mid + hBottom);
      }
    }
    ctx.strokeStyle = `${color}cc`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }, [peaks, color, gain, fullWidth, offset, width, height]);

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
  color?: string;
}

// Desenha só os blocos visíveis; durante o zoom estica o desenho existente e redesenha quando o zoom para.
export function ClipWaveform({ clip, left, width, height, visible, color: propColor }: ClipWaveformProps) {
  const color = propColor || routingColorOf(clip);
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
            gain={clip.gain ?? 1}
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
