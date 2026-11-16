/**
 * Contas do zoom horizontal ao vivo da timeline (sem dependências do programa, para os testes).
 *
 * Durante a pinça ou a roda com Ctrl/Cmd o painel muda a cada quadro só a variável CSS do zoom
 * (--vs-zoom), a largura da timeline (--vs-tl-w) e o scrollLeft, sem render do React: clipes,
 * nomes, bordas e cursor saem nítidos no zoom do quadro, e régua e grade são redesenhadas. Estas
 * contas usam o mesmo arredondamento do setZoomH e o mesmo corte do scroll no começo e no fim da
 * música, então o zoom de verdade (no fim do gesto) entra exatamente no lugar que o quadro mostrava.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 500;
/**
 * Quanto o zoom ao vivo pode aproximar antes de um zoom de verdade intermediário. Com a onda
 * redesenhada a cada quadro do gesto (liveWaveHub), ela não borra mais; cada zoom de verdade no
 * meio do gesto custava uma render da timeline (60 a 80 ms medidos tocando), então o limite subiu
 * de 4x para 16x.
 */
export const MAX_PREVIEW_IN = 16;
/**
 * Quanto o zoom ao vivo pode afastar. Um pouco antes de 1/4: abaixo disso a onda troca a camada na
 * hora (ClipWaveform, MAX_STRETCH) e os blocos novos entram vazios.
 */
export const MAX_PREVIEW_OUT = 1 / 3;
/** A janela visível anda em blocos desse tamanho: só re-renderiza quando muda de bloco. */
export const VISIBLE_QUANTUM = 256;

/** Mesmo arredondamento (0,01 px/s) e mesmos limites do setZoomH. */
export function clampZoom(zoom: number): number {
  const z = Math.round(zoom * 100) / 100;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

/** Largura da timeline em px (igual ao timelineWidth do painel). */
export function timelineWidthFor(contentEnd: number, zoom: number): number {
  return Math.max(200, Math.ceil(contentEnd * zoom));
}

/**
 * Instante (s) na borda direita da tela quando a pessoa já rolou além do fim da timeline; 0 quando
 * não rolou. Calculado uma vez, no começo do gesto (scroll e zoom do mesmo momento). A grade uniforme é desenhada um pouco à frente da tela e aumenta a área rolável, então
 * dá para passar do fim da música. Sem guardar esse instante, o corte no fim (anchoredScroll) puxava
 * a tela de volta para o fim da música logo no primeiro quadro do zoom: um salto.
 */
export function pastEndReach(contentEnd: number, zoom: number, scrollLeft: number, clientWidth: number): number {
  const max = Math.max(0, timelineWidthFor(contentEnd, zoom) - clientWidth);
  return scrollLeft > max ? (scrollLeft + clientWidth) / zoom : 0;
}

/** Largura que o corte do fim usa no zoom `zoom`: a timeline ou, além do fim, o instante `reach`. */
export function reachWidthFor(contentEnd: number, zoom: number, reach: number): number {
  return Math.max(timelineWidthFor(contentEnd, zoom), reach * zoom);
}

/**
 * scrollLeft depois do zoom: o instante `anchorTime` fica no ponto `anchorScreen` da tela,
 * cortado no começo (0) e no fim (largura nova menos a tela). Arredondado para o pixel, igual no
 * quadro do zoom ao vivo e no zoom de verdade.
 */
export function anchoredScroll(
  anchorTime: number,
  anchorScreen: number,
  zoom: number,
  timelineWidth: number,
  clientWidth: number,
): number {
  const max = Math.max(0, timelineWidth - clientWidth);
  return Math.round(Math.max(0, Math.min(max, anchorTime * zoom - anchorScreen)));
}

/**
 * Zoom que o quadro do zoom ao vivo mostra. `limited` = passou de MAX_PREVIEW_IN ou
 * MAX_PREVIEW_OUT em relação ao zoom de verdade: o painel aplica o zoom de verdade no limite e
 * continua o gesto a partir dele.
 */
export function previewTarget(base: number, wanted: number): { target: number; limited: boolean } {
  const want = clampZoom(wanted);
  // arredonda para dentro do limite: o fator nunca passa de 4x nem de 1/3
  const hi = Math.floor(base * MAX_PREVIEW_IN * 100) / 100;
  const lo = previewLow(base);
  if (want > hi) return { target: clampZoom(hi), limited: true };
  if (want < lo) return { target: clampZoom(lo), limited: true };
  return { target: want, limited: false };
}

/** Menor zoom que o zoom ao vivo mostra a partir do zoom de verdade `base` (o limite de 1/3). */
export function previewLow(base: number): number {
  return Math.ceil(base * MAX_PREVIEW_OUT * 100) / 100;
}

function quantized(startPx: number, endPx: number): { start: number; end: number } {
  const q = VISIBLE_QUANTUM;
  return { start: Math.max(0, Math.floor(startPx / q) * q), end: Math.ceil(endPx / q) * q };
}

/**
 * Trecho da timeline (em px) que monta clipes, blocos de onda, grade e régua: a tela e uma folga
 * dos dois lados, em blocos de VISIBLE_QUANTUM.
 */
export function visibleWindow(scrollLeft: number, clientWidth: number, margin: number): { start: number; end: number } {
  return quantized(scrollLeft - margin, scrollLeft + clientWidth + margin);
}

/**
 * Janela (em px do zoom de verdade `base`) que monta tudo o que o zoom ao vivo pode trazer para a
 * tela afastando até `low` px/s com o instante `anchorTime` na tela. Qualquer tela com o instante
 * parado e zoom de pelo menos `low` cabe em anchorTime -+ clientWidth / low (vale também com o
 * scroll cortado no começo ou no fim). Gravada uma vez quando o gesto começa a afastar.
 */
export function zoomOutWindow(base: number, low: number, anchorTime: number, clientWidth: number, margin: number): { start: number; end: number } {
  const span = clientWidth / Math.max(1e-6, low);
  return quantized((anchorTime - span) * base - margin, (anchorTime + span) * base + margin);
}

/** Posição e largura (em %) do controle da barra de rolagem de baixo. */
export function thumbGeometry(scrollLeft: number, clientWidth: number, timelineWidth: number, scrollWidth: number): { left: number; width: number } {
  const viewW = Math.max(10, clientWidth);
  const totalW = Math.max(viewW, timelineWidth);
  const maxScroll = Math.max(1, scrollWidth - clientWidth);
  const ratio = Math.min(1, Math.max(0.06, viewW / totalW));
  const width = ratio * 100;
  const scrollRatio = Math.max(0, Math.min(1, scrollLeft / maxScroll));
  return { left: scrollRatio * (100 - width), width };
}
