import { memo, useEffect, useRef, useState } from 'react';
import type { AudioClip } from '@/types';
import { getClipAudio, type ClipAudio } from '@/lib/audioLibrary';
import { waveColumnsCached } from '@/lib/waveColumns';
import { useStore } from '@/store';

export const WAVE_TILE_PX = 2048;
const SETTLE_MS = 160;
// Até 4x o desenho só é esticado (CSS) durante o zoom; com 2x, uma pinça contínua redesenhava
// todas as ondas várias vezes por segundo, no meio do gesto, e os medidores congelavam.
const MAX_STRETCH = 4;

// Desenha as ondas em fila, no máximo 4 ms por quadro, para que muitas faixas
// redesenhando juntas depois do zoom não travem a tela.
const drawQueue = new Set<() => void>();
let drawFrame = 0;
function flushDrawQueue() {
  drawFrame = 0;
  const deadline = performance.now() + 4;
  while (drawQueue.size > 0 && performance.now() < deadline) {
    const draw = drawQueue.values().next().value;
    if (!draw) break;
    drawQueue.delete(draw);
    draw();
  }
  if (drawQueue.size > 0) drawFrame = requestAnimationFrame(flushDrawQueue);
}

function scheduleDraw(draw: () => void) {
  drawQueue.add(draw);
  if (!drawFrame) drawFrame = requestAnimationFrame(flushDrawQueue);
  return () => {
    drawQueue.delete(draw);
    if (drawQueue.size === 0 && drawFrame) {
      cancelAnimationFrame(drawFrame);
      drawFrame = 0;
    }
  };
}

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
  /** Áudio do arquivo na memória: com zoom aproximado a onda é desenhada direto das amostras */
  audio: ClipAudio | null;
  /** Duração do arquivo inteiro, em segundos (corresponde a `fullWidth`) */
  duration: number;
  color: string;
  gain?: number;
  fullWidth: number;
  offset: number;
  width: number;
  height: number;
}

const WaveTile = memo(function WaveTile({ peaks, audio, duration, color, gain = 1, fullWidth, offset, width, height }: TileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => scheduleDraw(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // realocar o canvas (até 4096 px) só quando o tamanho muda; o clearRect abaixo já limpa
    const cw = Math.max(1, Math.floor(width * dpr));
    const ch = Math.max(1, Math.floor(height * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 1. Fundo limpo e transparente de estúdio (o fundo escuro do clipe garante o contraste do DAW)
    ctx.clearRect(0, 0, width, height);
    if ((!peaks || peaks.length === 0) && !audio) return;

    const mid = height / 2;
    const amp = mid - 2;

    // Altura de cada pixel: das amostras do áudio quando ampliado, do resumo quando afastado
    // em cache: mudar só a altura, o ganho ou a cor não lê as amostras de novo
    const columns = waveColumnsCached(peaks, audio, duration, fullWidth, offset, width);
    const values = new Float32Array(width + 1);
    const gainFactor = Math.max(0.01, gain || 1);
    for (let x = 0; x <= width; x++) {
      const raw = columns[x] * gainFactor;
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
  }), [peaks, audio, duration, color, gain, fullWidth, offset, width, height]);

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

const tooStretched = (now: number, drawn: number) => {
  if (!(drawn > 0)) return true;
  const ratio = now / drawn;
  return ratio > MAX_STRETCH || ratio < 1 / MAX_STRETCH;
};

// Desenha só os blocos visíveis; durante o zoom (largura E altura) estica o desenho existente e
// redesenha uma vez só, quando o zoom para. Antes a altura (zoom vertical) redesenhava todas as
// ondas a cada passo da alça, sem esperar.
export function ClipWaveform({ clip, left, width, height, visible, color: propColor }: ClipWaveformProps) {
  const color = propColor || routingColorOf(clip);
  // redesenha com as amostras quando o áudio da música termina de abrir
  const songLoading = useStore((s) => s.loadingSongIds.includes(clip.songId));
  const audio = songLoading ? null : getClipAudio(clip.id);
  const [drawnWidth, setDrawnWidth] = useState(width);
  const [drawnHeight, setDrawnHeight] = useState(height);
  const tooWide = tooStretched(width, drawnWidth);
  const tooTall = tooStretched(height, drawnHeight);
  const baseWidth = tooWide ? width : drawnWidth;
  const baseHeight = tooTall ? height : drawnHeight;
  const scale = width / baseWidth;
  const scaleY = baseHeight > 0 ? height / baseHeight : 1;

  useEffect(() => {
    // esticado demais: o desenho deformado fica feio, redesenha já nesse sentido
    if (tooWide || tooTall) {
      if (tooWide) setDrawnWidth(width);
      if (tooTall) setDrawnHeight(height);
      return;
    }
    if (width === drawnWidth && height === drawnHeight) return;
    // um só temporizador para os dois sentidos: o redesenho espera o gesto parar
    const t = window.setTimeout(() => {
      setDrawnWidth(width);
      setDrawnHeight(height);
    }, SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [width, height, drawnWidth, drawnHeight, tooWide, tooTall]);

  const tiles: number[] = [];
  const first = Math.max(0, Math.floor((visible.start - left) / scale / WAVE_TILE_PX));
  const last = Math.min(Math.ceil(baseWidth / WAVE_TILE_PX) - 1, Math.floor((visible.end - left) / scale / WAVE_TILE_PX));
  for (let i = first; i <= last; i++) tiles.push(i);

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        width: `${baseWidth}px`,
        height: `${baseHeight}px`,
        transform: scale === 1 && scaleY === 1 ? undefined : `scale(${scale}, ${scaleY})`,
        transformOrigin: '0 0',
      }}
    >
      {tiles.map((i) => {
        const offset = i * WAVE_TILE_PX;
        return (
          <WaveTile
            key={i}
            peaks={clip.waveformPeaks}
            audio={audio}
            duration={clip.duration}
            color={color}
            gain={clip.gain ?? 1}
            fullWidth={baseWidth}
            offset={offset}
            width={Math.min(WAVE_TILE_PX, Math.ceil(baseWidth - offset))}
            height={baseHeight}
          />
        );
      })}
    </div>
  );
}
