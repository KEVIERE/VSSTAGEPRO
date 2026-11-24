import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AudioClip } from '@/types';
import { getClipAudio, type ClipAudio } from '@/lib/audioLibrary';
import { FINE_FRAMES_PER_PEAK, waveColumnsCached, type FinePeaks } from '@/lib/waveColumns';
import { finePeaksPending, finePeaksSnapshot, peekFinePeaks, requestFinePeaks, subscribeFinePeaks } from '@/lib/finePeaks';
import { buildWaveIndexStep, wantWaveIndex, waveIndexPending, WAVE_INDEX_MIN_FRAMES_PER_PX } from '@/lib/waveIndex';
import { preciseColumns, preciseReadable, requestPreciseColumns, wantsPrecise } from '@/lib/wavePrecise';
import { useStore } from '@/store';
import { useTimelineVisible } from '@/lib/timelineView';
import { waveScaleX } from '@/lib/zoomGeometry';
import { fineColumnsInto, liveHeightsInto, peaksColumnsInto, pickLiveKind, sampleColumnsInto, type LiveSpan } from '@/lib/liveWave';
import { liveWaveActive, liveWaveSettling, registerLiveWave, type LiveWaveEntry, type LiveWaveSpanInput } from '@/lib/liveWaveHub';

export const WAVE_TILE_PX = 2048;
const SETTLE_MS = 160;
// Até 4x o desenho só é esticado (CSS) durante o zoom; com 2x, uma pinça contínua redesenhava
// todas as ondas várias vezes por segundo, no meio do gesto, e os medidores congelavam.
const MAX_STRETCH = 4;
/**
 * Quanto um bloco com zoom aproximado espera o desenho certo (resumo detalhado ou amostras lidas
 * do disco) antes de desenhar o aproximado. Desenhar o aproximado e trocar depois fazia a onda
 * "pular" para a grade na frente da pessoa.
 */
const FINE_WAIT_MS = 600;
/** Desenho novo (depois do zoom) que não termina nesse tempo entra assim mesmo no lugar do antigo. */
const SWAP_FALLBACK_MS = 2000;

// Desenha as ondas em fila, no máximo 4 ms por quadro, para que muitas faixas
// redesenhando juntas depois do zoom não travem a tela. Durante o zoom ao vivo, 2 ms: as ondas da
// tela estão no canvas do gesto, e o quadro fica para ele.
const drawQueue = new Set<() => void>();
let drawFrame = 0;
function flushDrawQueue() {
  drawFrame = 0;
  const live = liveWaveActive();
  const deadline = performance.now() + (live ? 2 : 4);
  while (drawQueue.size > 0 && performance.now() < deadline) {
    const draw = drawQueue.values().next().value;
    if (!draw) break;
    drawQueue.delete(draw);
    draw();
  }
  if (drawQueue.size > 0) {
    drawFrame = requestAnimationFrame(flushDrawQueue);
    return;
  }
  // Fila vazia: o tempo que sobra do quadro monta o índice de máximos das ondas com zoom
  // aproximado (waveIndex.ts). No zoom ao vivo o quadro é do gesto: tenta no próximo.
  if (!waveIndexPending()) return;
  if (live) {
    drawFrame = requestAnimationFrame(flushDrawQueue);
    return;
  }
  if (waveIndexBlocked()) {
    waitWaveIndexTurn();
    return;
  }
  if (buildWaveIndexStep(deadline)) drawFrame = requestAnimationFrame(flushDrawQueue);
}

// O índice só é montado com a música parada e nenhuma música abrindo: o Play e a música da tela
// vêm primeiro (a mesma regra da montagem do resumo detalhado, finePeaks.ts).
const waveIndexBlocked = (s = useStore.getState()) => s.transport.isPlaying || s.loadingSongIds.length > 0;
let waveIndexWait: (() => void) | null = null;
function waitWaveIndexTurn() {
  if (waveIndexWait) return;
  waveIndexWait = useStore.subscribe((s) => {
    if (waveIndexBlocked(s)) return;
    const off = waveIndexWait;
    waveIndexWait = null;
    off?.();
    kickWaveIndex();
  });
}

function kickWaveIndex() {
  if (drawFrame || !waveIndexPending()) return;
  if (waveIndexBlocked()) {
    waitWaveIndexTurn();
    return;
  }
  drawFrame = requestAnimationFrame(flushDrawQueue);
}

function scheduleDraw(draw: () => void) {
  drawQueue.add(draw);
  if (!drawFrame) drawFrame = requestAnimationFrame(flushDrawQueue);
  return () => {
    drawQueue.delete(draw);
    // o quadro marcado também monta o índice: só sai se não houver índice pedido
    if (drawQueue.size === 0 && drawFrame && !waveIndexPending()) {
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
  /** Zoom aproximado sem o áudio na memória: lê do disco o trecho deste bloco e desenha exato. */
  preciseClipId?: string | null;
  /** Resumo detalhado guardado no disco: a onda já sai no lugar certo com zoom aproximado. */
  fine?: FinePeaks | null;
  /** Conferindo no disco se há resumo detalhado: espera um instante antes de desenhar o aproximado. */
  hold?: boolean;
  preciseSongId?: string;
  preciseRate?: number;
  /** Avisa quando o bloco terminou o primeiro desenho (a camada nova só entra com todos prontos). */
  tileKey?: string;
  onDrawn?: (key: string) => void;
}

const WaveTile = memo(function WaveTile({ peaks, audio, duration, color, gain = 1, fullWidth, offset, width, height, preciseClipId = null, preciseSongId = '', preciseRate = 0, fine = null, hold = false, tileKey = '', onDrawn }: TileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // até ~150 ms esperando o resumo detalhado; se não vier, desenha com o que tem
  const [waitOver, setWaitOver] = useState(false);
  useEffect(() => {
    if (!hold) { setWaitOver(false); return; }
    const t = window.setTimeout(() => setWaitOver(true), FINE_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [hold]);
  const preciseId = preciseClipId;
  const [exact, setExact] = useState<Float32Array | null>(null);
  const holding = hold && !waitOver && !(exact && exact.length === width + 1);

  useEffect(() => {
    if (!preciseId) { setExact(null); return; }
    const req = { clipId: preciseId, songId: preciseSongId, duration, sampleRate: preciseRate, fullWidth, offset, width };
    const hit = preciseColumns(req);
    if (hit !== undefined) { setExact(hit); return; }
    // até chegar, fica o desenho do resumo
    setExact(null);
    return requestPreciseColumns(req, setExact);
  }, [preciseId, preciseSongId, preciseRate, duration, fullWidth, offset, width]);

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

    // o resumo detalhado está chegando: não desenha o aproximado para não "pular" na frente da pessoa
    // (e não apaga o que já está desenhado)
    if (holding) return;
    // 1. Fundo limpo e transparente de estúdio (o fundo escuro do clipe garante o contraste do DAW)
    ctx.clearRect(0, 0, width, height);
    if ((!peaks || peaks.length === 0) && !audio && !exact) { onDrawn?.(tileKey); return; }

    const mid = height / 2;
    const amp = mid - 2;

    // Altura de cada pixel: das amostras do áudio quando ampliado, do resumo quando afastado
    // em cache: mudar só a altura, o ganho ou a cor não lê as amostras de novo
    const columns = exact && exact.length === width + 1 ? exact : waveColumnsCached(peaks, audio, duration, fullWidth, offset, width, fine);
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
    onDrawn?.(tileKey);
  }), [peaks, audio, exact, fine, holding, duration, color, gain, fullWidth, offset, width, height, onDrawn, tileKey]);

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
  /**
   * Largura em segundos (e mínima em px) que a onda tem na tela: com ela, a escala horizontal sai
   * do CSS (var(--vs-zoom)) e a onda preenche o clipe no zoom ao vivo, sem render do React. Sem
   * ela, a escala vem de `width`.
   */
  zoomSec?: number;
  zoomMinPx?: number;
  /**
   * Início do arquivo inteiro na timeline (s), no mesmo lugar em que o elemento em volta da onda
   * começa. Com ele a onda acompanha o zoom ao vivo nítida (canvas do gesto, liveWaveHub); sem
   * ele, fica esticada até o fim do gesto.
   */
  startSec?: number;
  /** Trecho do arquivo que toca (s): o canvas do gesto não desenha o que o corte esconde. */
  liveFrom?: number;
  liveTo?: number;
}

/** Cor do preenchimento do canvas do gesto: a média do gradiente do desenho normal (~0,9). */
function liveFill(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}e6` : color;
}

interface LiveParams {
  clip: AudioClip;
  audio: ClipAudio | null;
  fine: FinePeaks | null;
  color: string;
  height: number;
  startSec?: number;
  minPx: number;
  from?: number;
  to?: number;
}

/**
 * Canvas da onda durante o zoom ao vivo (só existe durante o gesto e até o desenho normal assumir).
 * Fica logo depois da camada da tela, dentro do mesmo elemento: o corte (overflow) e a posição do
 * clipe valem para os dois. Enquanto ele está na tela, o elemento em volta ganha data-vs-live e as
 * camadas do desenho normal ficam escondidas (index.css).
 */
function createLiveEntry(
  paramsRef: { current: LiveParams },
  layerRef: { current: HTMLDivElement | null },
  settledRef: { current: boolean },
): LiveWaveEntry {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let host: HTMLElement | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let x = NaN;
  let visible = false;
  let cols = new Float32Array(0);
  let heights = new Float32Array(0);
  const mark = (on: boolean) => {
    if (!host) return;
    if (on) host.setAttribute('data-vs-live', '');
    else host.removeAttribute('data-vs-live');
  };
  const release = () => {
    if (canvas) canvas.remove();
    mark(false);
    canvas = null;
    ctx = null;
    host = null;
    visible = false;
    cssW = 0;
    cssH = 0;
    x = NaN;
    cols = new Float32Array(0);
    heights = new Float32Array(0);
  };
  return {
    measure() {
      const el = layerRef.current?.parentElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    },
    geometry(): LiveWaveSpanInput | null {
      const p = paramsRef.current;
      if (p.startSec === undefined || !(p.clip.duration > 0)) return null;
      return { startSec: p.startSec, duration: p.clip.duration, minPx: p.minPx, from: p.from, to: p.to };
    },
    draw(view, span: LiveSpan) {
      const p = paramsRef.current;
      const layer = layerRef.current;
      const parent = layer?.parentElement;
      if (!layer || !parent) return false;
      const clip = p.clip;
      const peaks = clip.waveformPeaks;
      const audio = p.audio && p.audio.length > 0 && p.audio.channels.length > 0 ? p.audio : null;
      const fine = p.fine && p.fine.data.length > 0 ? p.fine : null;
      const perPx = audio ? (clip.duration / Math.max(1, span.total)) * audio.sampleRate : Infinity;
      const kind = pickLiveKind({ peakCount: peaks?.length ?? 0, total: span.total, hasFine: !!fine, hasAudio: !!audio, framesPerPx: perPx, cols: span.width + 1 });
      if (kind === 'none') return false;
      if (!canvas || host !== parent) {
        release();
        canvas = document.createElement('canvas');
        canvas.className = 'vs-wave-live';
        const st = canvas.style;
        st.position = 'absolute';
        st.top = '0';
        st.left = '0';
        st.pointerEvents = 'none';
        st.display = 'none';
        layer.insertAdjacentElement('afterend', canvas);
        host = parent;
      }
      const h = p.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const need = span.width + 1;
      // cresce só quando precisa (com folga), no máximo a largura da tela com a folga dos lados
      if (cssW < need || cssH !== h || dpr !== ratio) {
        if (cssW < need) cssW = Math.max(need, Math.min(view.clientWidth + 34, Math.ceil((need * 1.25) / 64) * 64));
        cssH = h;
        dpr = ratio;
        canvas.width = Math.max(1, Math.ceil(cssW * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${h}px`;
        ctx = canvas.getContext('2d');
      }
      if (!ctx) return false;
      const w = span.width;
      if (cols.length < w + 1) {
        cols = new Float32Array(Math.ceil((w + 1) * 1.25));
        heights = new Float32Array(cols.length);
      }
      if (kind === 'fine') fineColumnsInto(fine!, clip.duration, span.total, span.left, w, cols);
      else if (kind === 'samples') sampleColumnsInto(audio!.channels, audio!.length, perPx, span.left, w, cols);
      else peaksColumnsInto(peaks!, span.total, span.left, w, cols);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, h);
      const mid = h / 2;
      liveHeightsInto(cols, w, clip.gain ?? 1, mid - 2, heights);
      // a mesma linha do meio do desenho normal; a onda num preenchimento só (sem gradiente e contorno)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (let i = 0; i <= w; i++) ctx.lineTo(i, mid - heights[i]);
      ctx.lineTo(w, mid);
      for (let i = w; i >= 0; i--) ctx.lineTo(i, mid + heights[i]);
      ctx.closePath();
      ctx.fillStyle = liveFill(p.color);
      ctx.fill();
      if (x !== span.left) {
        x = span.left;
        canvas.style.transform = `translateX(${x}px)`;
      }
      if (!visible) {
        canvas.style.display = '';
        visible = true;
        mark(true);
      }
      return true;
    },
    hide() {
      if (!canvas || !visible) return;
      canvas.style.display = 'none';
      visible = false;
      mark(false);
    },
    release,
    ready: () => settledRef.current && drawQueue.size === 0,
    shown: () => visible,
  };
}

function useLiveWave(params: LiveParams, layerRef: { current: HTMLDivElement | null }, settled: boolean) {
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const settledRef = useRef(settled);
  settledRef.current = settled;
  const [entry] = useState(() => createLiveEntry(paramsRef, layerRef, settledRef));
  const live = params.startSec !== undefined;
  useEffect(() => (live ? registerLiveWave(entry) : undefined), [live, entry]);
  // mudou o que o canvas mostra (altura, cor, ganho, lugar, outro áudio) depois do gesto: o canvas
  // sai e o desenho normal assume (durante o gesto o próximo quadro já redesenha certo)
  const sig = `${params.height}|${params.color}|${params.clip.gain ?? 1}|${params.clip.duration}|${params.startSec}|${params.minPx}`;
  const peaks = params.clip.waveformPeaks;
  const last = useRef({ sig, peaks });
  useEffect(() => {
    if (last.current.sig === sig && last.current.peaks === peaks) return;
    last.current = { sig, peaks };
    if (liveWaveSettling()) entry.release();
  }, [sig, peaks, entry]);
}

const tooStretched = (now: number, drawn: number) => {
  if (!(drawn > 0)) return true;
  const ratio = now / drawn;
  return ratio > MAX_STRETCH || ratio < 1 / MAX_STRETCH;
};

interface Base { w: number; h: number }
const sameBase = (a: Base, b: Base) => a.w === b.w && a.h === b.h;
const tileKeyOf = (b: Base, i: number) => `${b.w}x${b.h}:${i}`;

// Desenha só os blocos visíveis. Durante o zoom (largura e altura) estica o desenho que está na
// tela; o desenho na escala nova é feito escondido, numa segunda camada, e só entra no lugar do
// antigo quando todos os blocos visíveis dela terminaram. Antes os blocos eram trocados por canvas
// vazios na hora e a timeline ficava preta por até um segundo no zoom rápido.
export function ClipWaveform({ clip, left, width, height, visible, color: propColor, zoomSec, zoomMinPx = 0, startSec, liveFrom, liveTo }: ClipWaveformProps) {
  const color = propColor || routingColorOf(clip);
  // redesenha com as amostras quando o áudio da música termina de abrir
  const songLoading = useStore((s) => s.loadingSongIds.includes(clip.songId));
  const audio = songLoading ? null : getClipAudio(clip.id);
  // target: a escala em que se quer desenhar; shown: a camada que está na tela
  const [target, setTarget] = useState<Base>({ w: width, h: height });
  const [shown, setShown] = useState<Base>(target);
  const tooWide = tooStretched(width, target.w);
  const tooTall = tooStretched(height, target.h);

  useEffect(() => {
    // esticado demais: já começa a desenhar na escala nova (escondido, a tela segue com a antiga)
    if (tooWide || tooTall) {
      setTarget((t) => ({ w: tooWide ? width : t.w, h: tooTall ? height : t.h }));
      return;
    }
    if (width === target.w && height === target.h) return;
    // um só temporizador para os dois sentidos: o redesenho espera o gesto parar (no fim do zoom ao
    // vivo o gesto já parou, e o canvas do gesto está na tela até este desenho ficar pronto)
    const t = window.setTimeout(() => setTarget({ w: width, h: height }), liveWaveSettling() ? 0 : SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [width, height, target, tooWide, tooTall]);

  // Resumo do projeto mais grosso que os pixels e sem o áudio na memória: usa o resumo detalhado
  // guardado no disco do app (já abre no lugar certo). Se ainda não existe, é montado em segundo
  // plano para as próximas vezes, e enquanto isso os blocos leem as amostras do disco.
  // só o resumo desta faixa (ou o nome dele) re-renderiza esta onda; o de outra faixa não
  const fineSnapshot = useCallback(() => finePeaksSnapshot(clip), [clip]);
  useSyncExternalStore(subscribeFinePeaks, fineSnapshot);
  const peakCount = clip.waveformPeaks?.length ?? 0;
  // também enquanto a música abre na memória: o resumo detalhado já está no lugar certo, e o
  // desenho não muda quando o áudio chega (só a montagem espera a abertura terminar)
  const wantFine = !audio && peakCount > 0 && clip.sampleRate > 0;
  const fine = wantFine ? peekFinePeaks(clip) : null;
  // monta o resumo detalhado assim que a música aparece (não só com zoom): quando a pessoa
  // aproximar, ele já está pronto
  // Com o áudio na memória o desenho normal lê as amostras, mas no zoom ao vivo elas custam caro:
  // o resumo detalhado já montado no disco vem para a memória (só leitura, sem montar), e o canvas
  // do gesto usa ele.
  const audioFine = !wantFine && !!audio && peakCount > 0 && clip.sampleRate > 0;
  useEffect(() => {
    if (wantFine) requestFinePeaks(clip, !songLoading);
    else if (audioFine) requestFinePeaks(clip, false);
  }, [wantFine, audioFine, songLoading, clip]);
  const liveFine = fine || (audioFine ? peekFinePeaks(clip) || null : null);

  // Zoom aproximado com o áudio na memória (os blocos leem as amostras): pede o índice de máximos,
  // montado aos pedaços com a música parada. Pronto, mudar o zoom ou rolar lê só as pontas de cada
  // pixel, com a mesma coluna de antes. Sai da fila quando a onda sai da tela ou o zoom afasta.
  const indexAudio = audio && audio.length > 0 && audio.channels.length > 0 && clip.duration > 0 && target.w >= peakCount
    && (clip.duration / Math.max(1, target.w)) * audio.sampleRate >= WAVE_INDEX_MIN_FRAMES_PER_PX ? audio : null;
  useEffect(() => {
    if (!indexAudio) return;
    const release = wantWaveIndex(indexAudio);
    kickWaveIndex();
    return release;
  }, [indexAudio]);

  const tilesOf = (base: Base): number[] => {
    const sc = width / base.w;
    const out: number[] = [];
    const first = Math.max(0, Math.floor((visible.start - left) / sc / WAVE_TILE_PX));
    const last = Math.min(Math.ceil(base.w / WAVE_TILE_PX) - 1, Math.floor((visible.end - left) / sc / WAVE_TILE_PX));
    for (let i = first; i <= last; i++) out.push(i);
    return out;
  };

  // blocos da camada nova que já terminaram o primeiro desenho
  const drawnRef = useRef(new Set<string>());
  const [drawnTick, setDrawnTick] = useState(0);
  const pending = !sameBase(target, shown);
  // a camada da tela já está na escala que a tela mostra (o canvas do gesto pode sair)
  const settled = !pending && shown.w === width && shown.h === height;
  const shownLayerRef = useRef<HTMLDivElement | null>(null);
  useLiveWave(
    { clip, audio, fine: liveFine, color, height, startSec, minPx: zoomMinPx, from: liveFrom, to: liveTo },
    shownLayerRef,
    settled,
  );
  // lidos pelo onDrawn (estável): a mesma função vai para as duas camadas, então a troca de camada
  // não muda as props dos blocos e eles não desenham de novo (antes cada bloco desenhava duas vezes)
  const targetRef = useRef(target);
  targetRef.current = target;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const onDrawn = useCallback((key: string) => {
    // só conta bloco da camada nova enquanto ela espera; o resto não re-renderiza nada
    if (!pendingRef.current || !key.startsWith(`${targetRef.current.w}x${targetRef.current.h}:`)) return;
    if (drawnRef.current.has(key)) return;
    drawnRef.current.add(key);
    setDrawnTick((n) => n + 1);
  }, []);

  // Afastando muito (mais de 4x em relação à escala que está sendo desenhada), troca na hora, como
  // antes. A comparação é com a camada nova: no zoom ao vivo, passos seguidos de 1/3 não forçam a
  // troca (com a tela vazia) enquanto a camada anterior ainda desenha. Contra a camada da tela, só
  // depois de 16x (ela teria de montar blocos demais na escala velha).
  useEffect(() => {
    if (sameBase(target, shown)) return;
    const farFromTarget = width / target.w < 1 / MAX_STRETCH || height / target.h < 1 / MAX_STRETCH;
    const limit = 1 / (MAX_STRETCH * MAX_STRETCH);
    const farFromShown = width / shown.w < limit || height / shown.h < limit;
    if (farFromTarget || farFromShown) {
      setShown(target);
      drawnRef.current.clear();
    }
  }, [width, height, target, shown]);
  // escala nova: o que estava marcado como pronto era de outra escala
  useEffect(() => { drawnRef.current.clear(); }, [target.w, target.h]);

  const targetTiles = pending ? tilesOf(target) : [];
  const targetReady = pending && targetTiles.every((i) => drawnRef.current.has(tileKeyOf(target, i)));
  useEffect(() => {
    if (!pending) return;
    if (targetReady) {
      setShown(target);
      drawnRef.current.clear();
      return;
    }
    const t = window.setTimeout(() => { setShown(target); drawnRef.current.clear(); }, SWAP_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [pending, targetReady, target, drawnTick]);

  const layer = (base: Base, hidden: boolean) => {
    const scale = width / base.w;
    const scaleY = base.h > 0 ? height / base.h : 1;
    const zoomedIn = peakCount > 0 && base.w >= peakCount;
    const framesPerPx = base.w > 0 ? (clip.duration / base.w) * clip.sampleRate : Infinity;
    // com o resumo detalhado, a leitura do disco só faz falta com zoom muito aproximado
    const precise = !audio && !songLoading && wantsPrecise(clip.duration, clip.sampleRate, base.w, peakCount)
      && (fine === null || (!!fine && framesPerPx < FINE_FRAMES_PER_PEAK / 2));
    // com zoom aproximado, sem o desenho certo ainda: espera (o resumo do projeto ficaria antes da grade)
    const hold = wantFine && zoomedIn && !fine && (fine === undefined || finePeaksPending(clip) || (precise && preciseReadable(clip.id)));
    const scaleX = zoomSec !== undefined ? waveScaleX(zoomSec, zoomMinPx, base.w) : scale === 1 ? null : String(scale);
    return (
      <div
        key={`${base.w}x${base.h}`}
        ref={hidden ? undefined : shownLayerRef}
        className="vs-wave-layer absolute top-0 left-0 pointer-events-none"
        style={{
          width: `${base.w}px`,
          height: `${base.h}px`,
          transform: scaleX === null && scaleY === 1 ? undefined : `scale(${scaleX ?? 1}, ${scaleY})`,
          transformOrigin: '0 0',
          visibility: hidden ? 'hidden' : undefined,
        }}
      >
        {tilesOf(base).map((i) => {
          const offset = i * WAVE_TILE_PX;
          return (
            <WaveTile
              key={i}
              peaks={clip.waveformPeaks}
              audio={audio}
              duration={clip.duration}
              color={color}
              gain={clip.gain ?? 1}
              fullWidth={base.w}
              offset={offset}
              width={Math.min(WAVE_TILE_PX, Math.ceil(base.w - offset))}
              height={base.h}
              preciseClipId={precise ? clip.id : null}
              fine={zoomedIn ? fine ?? null : null}
              hold={hold}
              preciseSongId={clip.songId}
              preciseRate={clip.sampleRate}
              tileKey={tileKeyOf(base, i)}
              onDrawn={onDrawn}
            />
          );
        })}
      </div>
    );
  };

  // A camada nova vem antes no JSX: os efeitos dela entram antes na fila de desenho, e a troca
  // acontece antes de a camada da tela desenhar blocos que logo saem. Escondida, a ordem não muda o
  // que se vê, e a key mantém a div reaproveitada na troca.
  return (
    <>
      {pending && layer(target, true)}
      {layer(shown, false)}
    </>
  );
}

interface ZoomedClipWaveformProps {
  clip: AudioClip;
  /** Início do arquivo inteiro na timeline (s): o começo do clipe menos o corte do início. */
  startSec: number;
  height: number;
  color?: string;
  /** Cortes do clipe (s): o canvas do zoom ao vivo desenha só o trecho que toca. */
  trimStart?: number;
  trimEnd?: number;
}

/**
 * Onda de um clipe da timeline que acompanha o zoom sozinha: assina o zoom e a janela visível e
 * passa a largura em px para o ClipWaveform. O ClipBlock em volta fica em segundos no estilo
 * (var(--vs-zoom)) e não re-renderiza no zoom nem na rolagem; só a onda, que precisa da largura.
 * No zoom ao vivo a escala da onda também vem da variável (zoomSec): ela preenche o clipe a cada
 * quadro e redesenha quando o zoom de verdade entra.
 */
export const ZoomedClipWaveform = memo(function ZoomedClipWaveform({ clip, startSec, height, color, trimStart = 0, trimEnd = 0 }: ZoomedClipWaveformProps) {
  const zoomH = useStore((s) => s.zoomH);
  const visible = useTimelineVisible();
  return (
    <ClipWaveform
      clip={clip}
      left={startSec * zoomH}
      width={Math.max(30, clip.duration * zoomH)}
      height={height}
      visible={visible}
      color={color}
      zoomSec={clip.duration}
      zoomMinPx={30}
      startSec={startSec}
      liveFrom={trimStart}
      liveTo={clip.duration - trimEnd}
    />
  );
});
