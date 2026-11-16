/**
 * Contas da geometria da timeline sem React (sem dependências do programa, para os testes).
 *
 * O zoom horizontal (px por segundo) fica numa variável CSS, --vs-zoom, gravada no conteúdo da
 * timeline quando o zoom muda (TimelinePanel). Clipes, cortes, fades e o cursor ficam em segundos
 * no estilo (calc(var(--vs-zoom) * Xpx)): no zoom, quem refaz a conta é o motor de layout do
 * navegador, e os clipes não passam pelo React. A régua e a grade são desenhadas em canvas do
 * tamanho da janela visível (no lugar de centenas de divs). No zoom ao vivo o painel muda só a
 * variável a cada quadro, e os canvas redesenham no zoom do quadro (ZoomCanvasHub).
 */

export interface PxRange {
  start: number;
  end: number;
}

/** Número para dentro do calc (NaN e infinito viram 0, para o estilo nunca ficar inválido). */
function cssNum(n: number): string {
  return Number.isFinite(n) ? String(n) : '0';
}

/** `seconds` em px no zoom atual, pela variável CSS do conteúdo. */
export function zoomPx(seconds: number): string {
  return `calc(var(--vs-zoom) * ${cssNum(seconds)}px)`;
}

/** Igual a Math.max(minPx, seconds * zoom) em px. */
export function zoomPxMin(minPx: number, seconds: number): string {
  return `max(${cssNum(minPx)}px, ${zoomPx(seconds)})`;
}

/**
 * Escala horizontal da camada desenhada com `drawnW` px para a largura que a tela mostra:
 * max(minPx, --vs-zoom * segundos) / drawnW, feita pelo navegador. Só esta camada é esticada no
 * zoom ao vivo (dentro do próprio clipe); o resto da timeline fica nítido.
 */
export function waveScaleX(seconds: number, minPx: number, drawnW: number): string {
  const sec = Number.isFinite(seconds) ? seconds : 0;
  const min = Number.isFinite(minPx) ? minPx : 0;
  if (!(drawnW > 0) || !Number.isFinite(drawnW)) return '1';
  return `calc(max(${min}, var(--vs-zoom) * ${sec}) / ${drawnW})`;
}

/**
 * O bloco (início e duração em segundos, largura mínima em px) cruza a janela visível (em px)?
 * A mesma conta que o ClipBlock fazia antes de devolver null fora da tela.
 */
export function spanInView(start: number, duration: number, zoom: number, visible: PxRange, minWidth = 30): boolean {
  const left = start * zoom;
  const right = left + Math.max(minWidth, duration * zoom);
  return !(left > visible.end || right < visible.start);
}

/** Passos da régua de tempo (s): o primeiro com pelo menos 60 px entre um número e outro. */
export const RULER_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function rulerStepFor(zoom: number): number {
  return RULER_STEPS.find((step) => step * zoom >= 60) ?? 600;
}

/** Instantes (s) dos números da régua de tempo entre startPx e endPx, sem passar do fim da timeline. */
export function rulerTicks(step: number, zoom: number, startPx: number, endPx: number, timelineWidth: number): number[] {
  const stepPx = step * zoom;
  if (!(stepPx > 0)) return [];
  const first = Math.max(0, Math.floor(startPx / stepPx));
  const last = Math.min(Math.ceil(timelineWidth / stepPx), Math.ceil(endPx / stepPx));
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i * step);
  return out;
}

/** Texto do número da régua de tempo (m:ss, ou m:ss.d com passo abaixo de 1 s). */
export function formatRulerTick(sec: number, step: number): string {
  if (step < 1) {
    const whole = Math.floor(sec);
    const frac = Math.round((sec - whole) * 10);
    return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}.${frac}`;
  }
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Grade sem andamento (antes um repeating-linear-gradient no fundo do conteúdo): uma linha de 1 px
 * no último pixel de cada passo. Devolve o começo (px) de cada linha que cruza [startPx, endPx),
 * dentro da largura da timeline.
 */
export function stepLinesPx(stepPx: number, startPx: number, endPx: number, widthPx: number): number[] {
  if (!(stepPx > 1)) return [];
  const end = Math.min(endPx, widthPx);
  const out: number[] = [];
  for (let m = Math.max(1, Math.floor(startPx / stepPx)); m * stepPx - 1 < end; m++) {
    const x = m * stepPx - 1;
    if (x + 1 > startPx) out.push(x);
  }
  return out;
}

/** Quadro do zoom ao vivo em curso, como o painel aplica (TimelinePanel, applyLiveFrame). */
export interface CanvasLive {
  /** Zoom (px/s) do quadro: o conteúdo já está no layout nesse zoom (--vs-zoom). */
  zoom: number;
  /** scrollLeft do quadro. */
  scrollLeft: number;
  clientWidth: number;
  /** Largura da timeline (px) no zoom do quadro. */
  timelineWidth: number;
}

/**
 * Zoom ao vivo em curso, para os canvas da régua e da grade redesenharem a cada quadro do gesto
 * (o painel grava `live` e chama `draws`).
 */
export interface ZoomCanvasHub {
  live: CanvasLive | null;
  draws: Set<() => void>;
}

export function createZoomCanvasHub(): ZoomCanvasHub {
  return { live: null, draws: new Set() };
}

/**
 * Onde fica o canvas e quantos pixels ele tem: um pixel do canvas por pixel da tela. Parado: cobre a
 * janela visível (em px do conteúdo). No zoom ao vivo: cobre só a tela, com uma folga dos dois
 * lados, no zoom do quadro (a janela visível do React ainda é a do zoom de verdade). `limit` (px)
 * corta a borda direita no zoom ao vivo sem passar da tela: a grade não aumenta a área rolável.
 */
export interface CanvasSpan {
  /** Borda esquerda do canvas, em px do conteúdo. */
  left: number;
  /** Largura do canvas no estilo, em px do conteúdo. */
  cssWidth: number;
  /** Largura do canvas em pixels. */
  pixelWidth: number;
  /** Pixels do canvas por px do conteúdo. */
  scale: number;
  /** Zoom (px/s) do conteúdo e do desenho. */
  zoom: number;
  /** Intervalo de tempo (s) que o canvas cobre. */
  from: number;
  to: number;
}

/** Limite de largura de canvas do Chromium (por lado). */
export const MAX_CANVAS_PX = 32000;

export function canvasSpan(base: number, visible: PxRange, dpr: number, live: CanvasLive | null, pad = 32, limit = Infinity): CanvasSpan {
  const ratio = dpr > 0 ? dpr : 1;
  let z = base > 0 ? base : 1;
  let start = visible.start;
  let end = visible.end;
  if (live && live.zoom > 0) {
    z = live.zoom;
    const screenEnd = live.scrollLeft + live.clientWidth;
    start = Math.max(0, live.scrollLeft - pad);
    end = Math.min(screenEnd + pad, Math.max(limit, screenEnd));
  }
  const pixelWidth = Math.max(0, Math.min(MAX_CANVAS_PX, Math.round(Math.max(0, end - start) * ratio)));
  const cssWidth = pixelWidth / ratio;
  return { left: start, cssWidth, pixelWidth, scale: ratio, zoom: z, from: start / z, to: (start + cssWidth) / z };
}

/** Coluna do canvas (pixel inteiro, linha nítida) de um ponto em px do conteúdo. */
export function canvasX(span: CanvasSpan, contentPx: number): number {
  return Math.round((contentPx - span.left) * span.scale);
}

/** Coluna do canvas de um instante (s). */
export function canvasXAt(span: CanvasSpan, time: number): number {
  return canvasX(span, time * span.zoom);
}

/**
 * Linha de base do texto numa caixa de linha (como o navegador faz: meia entrelinha arredondada
 * para baixo em cima, mais a subida da fonte).
 */
export function textBaseline(boxTop: number, lineHeight: number, ascent: number, descent: number): number {
  const a = Math.round(ascent);
  const d = Math.round(descent);
  return boxTop + Math.floor((lineHeight - (a + d)) / 2) + a;
}
