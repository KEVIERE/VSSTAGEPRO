/**
 * Ondas do zoom ao vivo, sem React (como o ZoomCanvasHub da régua e da grade).
 *
 * Cada onda da timeline se registra aqui (ClipWaveform). A cada quadro do gesto o painel chama
 * `frame` com o zoom e o scroll do quadro (TimelinePanel, applyPending) e cada onda visível
 * redesenha o próprio canvas do gesto, do tamanho só da parte do clipe que está na tela. O tempo
 * de todas juntas é medido: passou do orçamento, no próximo quadro só as faixas mais próximas do
 * mouse redesenham e as outras voltam ao desenho esticado de antes (nunca trava).
 *
 * No fim do gesto (`settle`) o canvas fica na tela até o desenho normal da onda, já na escala
 * nova, estar pronto (`ready`), e então sai: a troca não muda a forma.
 */
import { LIVE_HARD_MS, liveSpan, nextLiveLimit, orderByDistance, trimPyramids, type LiveSpan } from '@/lib/liveWave';

export interface LiveView {
  zoom: number;
  scrollLeft: number;
  clientWidth: number;
}

export interface LiveSettleView extends LiveView {
  scrollTop: number;
}

export interface LiveWaveSpanInput {
  startSec: number;
  duration: number;
  minPx: number;
  from?: number;
  to?: number;
}

export interface LiveWaveEntry {
  /** Posição vertical na tela (client), lida antes das escritas do quadro; null sem elemento. */
  measure(): { top: number; bottom: number } | null;
  /** Onde fica a onda no tempo; null quando ela não acompanha o zoom ao vivo. */
  geometry(): LiveWaveSpanInput | null;
  /** Desenha no canvas do gesto; false quando não deu (fica no esticado). */
  draw(view: LiveView, span: LiveSpan): boolean;
  /** Volta ao desenho esticado (o canvas some da tela, mas fica guardado até o fim do gesto). */
  hide(): void;
  /** Tira o canvas do gesto. */
  release(): void;
  /** O desenho normal na escala nova já está pronto (fim do gesto). */
  ready(): boolean;
  /** O canvas do gesto está na tela. */
  shown(): boolean;
}

/** Folga dos lados da tela no canvas do gesto (px). */
const PAD_PX = 16;
/** Depois do gesto o canvas nunca fica mais que isso esperando o desenho normal. */
const SETTLE_MAX_MS = 2500;

type Phase = 'idle' | 'active' | 'settling';

const entries = new Set<LiveWaveEntry>();
const rects = new Map<LiveWaveEntry, { top: number; bottom: number } | null>();
let phase: Phase = 'idle';
let limit = Infinity;
let mouseY = 0;
let viewTop = -Infinity;
let viewBottom = Infinity;
let settleAt = 0;
let settleFrame = 0;
let settleView: (() => LiveSettleView | null) | null = null;
let lastView: LiveView | null = null;
let settleTop: number | null = null;
/** Tempo do último quadro (ms), para o painel de desempenho e os testes. */
let lastMs = 0;

const raf = (fn: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number));
const caf = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

export function registerLiveWave(entry: LiveWaveEntry): () => void {
  entries.add(entry);
  return () => {
    entries.delete(entry);
    rects.delete(entry);
    entry.release();
  };
}

/** Gesto em curso: o desenho normal das ondas fica com menos tempo por quadro. */
export function liveWaveActive(): boolean {
  return phase === 'active';
}

/** Fim de gesto esperando o desenho normal: ele redesenha sem a espera de sempre. */
export function liveWaveSettling(): boolean {
  return phase === 'settling';
}

export function liveWaveLastMs(): number {
  return lastMs;
}

/** Altura do mouse e faixa vertical da área das faixas (client), a cada evento do gesto. */
export function liveWavePointer(y: number, top: number, bottom: number): void {
  mouseY = y;
  viewTop = top;
  viewBottom = bottom;
}

/**
 * Antes das escritas do quadro: mede a altura das ondas que ainda não foram medidas (no começo do
 * gesto, todas; no meio, só as que montaram agora). A altura não muda durante o zoom horizontal.
 */
export function liveWavePrepare(gestureStart: boolean): void {
  // depois do zoom de verdade no meio do gesto (limite de 4x) a altura continua a mesma
  if (gestureStart && phase === 'idle') rects.clear();
  for (const e of entries) if (!rects.has(e)) rects.set(e, e.measure());
}

function drawAll(view: LiveView, onlyShown: boolean): void {
  const t0 = performance.now();
  const list: Array<{ e: LiveWaveEntry; span: LiveSpan; center: number }> = [];
  for (const e of entries) {
    if (onlyShown && !e.shown()) continue;
    const r = rects.get(e);
    const g = r && r.bottom > viewTop && r.top < viewBottom ? e.geometry() : null;
    const span = g ? liveSpan({ ...view, ...g, pad: PAD_PX }) : null;
    if (!span) {
      if (onlyShown) e.release();
      else e.hide();
      continue;
    }
    list.push({ e, span, center: (r!.top + r!.bottom) / 2 });
  }
  const order = orderByDistance(list.map((it) => it.center), mouseY);
  let drawn = 0;
  for (const i of order) {
    const { e, span } = list[i];
    const late = performance.now() - t0 > LIVE_HARD_MS;
    if (drawn >= limit || late || !e.draw(view, span)) {
      if (onlyShown) e.release();
      else e.hide();
      continue;
    }
    drawn++;
  }
  lastMs = performance.now() - t0;
  limit = nextLiveLimit(limit, drawn, list.length, lastMs);
  lastView = view;
}

/** Um quadro do zoom ao vivo: as ondas visíveis redesenham no zoom e no scroll do quadro. */
export function liveWaveFrame(view: LiveView): void {
  if (phase === 'settling') stopSettle();
  phase = 'active';
  drawAll(view, false);
}

function stopSettle() {
  if (settleFrame) { caf(settleFrame); settleFrame = 0; }
  settleView = null;
  settleTop = null;
}

function releaseAll() {
  for (const e of entries) e.release();
  stopSettle();
  phase = 'idle';
  lastView = null;
  // fora do gesto: as pirâmides dos clipes menos usados saem (memória limitada)
  trimPyramids();
}

/** Desenho do fim do gesto no zoom de verdade (o arredondamento do zoom ou a rolagem mudaram). */
function redrawSettled(): void {
  const v = settleView?.();
  if (!v) { releaseAll(); return; }
  if (settleTop === null) settleTop = v.scrollTop;
  // rolou na vertical: a altura medida não vale mais
  if (v.scrollTop !== settleTop) { releaseAll(); return; }
  if (lastView && lastView.zoom === v.zoom && lastView.scrollLeft === v.scrollLeft && lastView.clientWidth === v.clientWidth) return;
  drawAll({ zoom: v.zoom, scrollLeft: v.scrollLeft, clientWidth: v.clientWidth }, true);
}

function pollSettle() {
  settleFrame = 0;
  if (phase !== 'settling') return;
  redrawSettled();
  if (phase !== 'settling') return;
  const timeUp = performance.now() - settleAt > SETTLE_MAX_MS;
  let left = 0;
  for (const e of entries) {
    if (!e.shown()) { e.release(); continue; }
    if (timeUp || e.ready()) e.release();
    else left++;
  }
  if (left === 0) { releaseAll(); return; }
  settleFrame = raf(pollSettle);
}

/**
 * Fim do gesto: as ondas ficam no canvas do gesto até o desenho normal estar pronto. `view` lê o
 * zoom de verdade e o scroll da hora.
 */
export function liveWaveSettle(view: () => LiveSettleView | null): void {
  if (phase === 'idle') return;
  phase = 'settling';
  settleAt = performance.now();
  settleView = view;
  settleTop = null;
  for (const e of entries) if (!e.shown()) e.release();
  if (!settleFrame) settleFrame = raf(pollSettle);
}

/** Rolagem depois do gesto, antes de o desenho normal assumir: acompanha (ou sai, na vertical). */
export function liveWaveScrolled(): void {
  if (phase === 'settling') redrawSettled();
}

/** Para teste. */
export function liveWaveReset(): void {
  releaseAll();
  entries.clear();
  rects.clear();
  limit = Infinity;
}
