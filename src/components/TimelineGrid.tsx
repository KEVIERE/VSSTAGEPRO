import { shortcutLabel } from '@/lib/shortcuts/runtime';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Magnet, RefreshCw, Loader2, CheckCheck, Scissors } from 'lucide-react';
import { useStore } from '@/store';
import type { Song } from '@/types';
import { barBeatLabel, bpmAt, gridLines, moveTempoChange, uniformSegments, SNAP_LABELS, snapTempoChange, tempoChangeIndex, type SnapStep, type SongGrid } from '@/lib/grid';
import { remeasureSongBpm, setSongBpm } from '@/lib/importManager';
import { trimAllSongEnds, trimSongEnd } from '@/lib/songEndTools';
import type { VisibleRange } from '@/components/ClipWaveform';
import { useSkin } from '@/lib/useSkin';
import { currentSkin } from '@/lib/skins';
import { timelineWidthFor } from '@/lib/zoomPreview';
import { canvasSpan, canvasX, canvasXAt, formatRulerTick, rulerStepFor, rulerTicks, stepLinesPx, textBaseline, zoomPx, type CanvasSpan, type ZoomCanvasHub } from '@/lib/zoomGeometry';
import { draggedGrid, tempoDragView, useTimelineVisible, useViewValue } from '@/lib/timelineView';

/**
 * A grade como aparece agora: com a placa de BPM sendo arrastada, a mudança de andamento já no
 * lugar novo. Cada desenho da grade assina o arraste sozinho: mexer a placa redesenha a régua, as
 * placas e as linhas, e não a timeline inteira (antes o arraste era um setState do painel).
 */
function useShownGrid<G extends SongGrid | null>(grid: G): G {
  const drag = useViewValue(tempoDragView);
  return useMemo(() => draggedGrid(grid, drag), [grid, drag]);
}

/** A janela visível de quem passou uma; sem ela, a da timeline (assinada aqui, não no painel). */
function useShownVisible(visible: VisibleRange | undefined): VisibleRange {
  const live = useTimelineVisible();
  return visible ?? live;
}

const LINE_COLORS = {
  bar: 'rgba(255,255,255,0.22)',
  beat: 'rgba(255,255,255,0.11)',
  sub: 'rgba(255,255,255,0.05)',
};
/** Cor da grade sem andamento (antes o repeating-linear-gradient do fundo do conteúdo). */
const STEP_LINE_COLOR = 'rgba(255,255,255,0.045)';

/** Posiciona o canvas (em px do conteúdo) e ajusta os pixels só quando mudam. */
function placeCanvas(cv: HTMLCanvasElement, span: CanvasSpan, pixelHeight: number) {
  if (cv.width !== span.pixelWidth) cv.width = span.pixelWidth;
  if (cv.height !== pixelHeight) cv.height = pixelHeight;
  const left = `${span.left}px`;
  const width = `${span.cssWidth}px`;
  if (cv.style.left !== left) cv.style.left = left;
  if (cv.style.width !== width) cv.style.width = width;
}

/** Redesenha no layout (antes da pintura) quando as props mudam, na troca de tela e quando a fonte chega. */
function useCanvasRedraw(draw: () => void, deps: unknown[], hub?: ZoomCanvasHub) {
  useLayoutEffect(draw, [draw, ...deps]);
  useEffect(() => {
    // trocar de monitor (outra densidade de pixels) chega como resize
    window.addEventListener('resize', draw);
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', draw);
    hub?.draws.add(draw);
    return () => {
      window.removeEventListener('resize', draw);
      fonts?.removeEventListener?.('loadingdone', draw);
      hub?.draws.delete(draw);
    };
  }, [draw, hub]);
}

/**
 * Linhas da grade (compasso, tempo e meio tempo) por cima dos clipes, num canvas do tamanho da
 * janela visível com 1 px de altura esticado na vertical (as linhas são verticais). Antes eram
 * centenas de divs que o React refazia a cada zoom. No zoom ao vivo o canvas cobre a tela e é
 * redesenhado a cada quadro no zoom do quadro: linhas com 1 px e na densidade do zoom novo.
 */
export const GridLinesCanvas = memo(function GridLinesCanvas({ grid: baseGrid, zoomH, visible: visibleProp, timelineWidth, hub }: {
  grid: SongGrid;
  zoomH: number;
  /** Sem ela, a janela visível da timeline (o painel não redesenha a cada rolagem). */
  visible?: VisibleRange;
  timelineWidth: number;
  hub: ZoomCanvasHub;
}) {
  const grid = useShownGrid(baseGrid);
  const visible = useShownVisible(visibleProp);
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ grid, zoomH, visible, timelineWidth });
  latest.current = { grid, zoomH, visible, timelineWidth };
  const draw = useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const p = latest.current;
    const dpr = window.devicePixelRatio || 1;
    const live = hub.live;
    // no zoom ao vivo, além do fim da timeline vai só até a borda da tela (não aumenta a área rolável)
    let span = canvasSpan(p.zoomH, p.visible, dpr, live, 32, live ? live.timelineWidth : Infinity);
    const lines = gridLines(p.grid, span.from, span.to, span.zoom);
    if (!live) {
      // Como as divs de antes: além do fim da timeline, a grade vai até a última linha da janela
      // (e aumenta a área rolável do mesmo jeito, ver pastEndReach); antes do fim, cobre a timeline.
      const last = lines.length > 0 ? lines[lines.length - 1].time * p.zoomH + 1 : -Infinity;
      const right = Math.min(p.visible.end, Math.max(p.timelineWidth, last));
      span = canvasSpan(p.zoomH, { start: p.visible.start, end: Math.max(p.visible.start, right) }, dpr, null);
    }
    placeCanvas(cv, span, 1);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const lw = Math.max(1, Math.round(dpr));
    for (const l of lines) {
      ctx.fillStyle = LINE_COLORS[l.kind];
      ctx.fillRect(canvasXAt(span, l.time), 0, lw, 1);
    }
  }, [hub]);
  useCanvasRedraw(draw, [grid, zoomH, visible, timelineWidth], hub);
  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* camada própria: redesenhar (ao rolar, a cada bloco da janela, e a cada quadro do zoom ao
          vivo) só troca a imagem do canvas, sem repintar os clipes embaixo */}
      <canvas ref={ref} className="absolute top-0 block pointer-events-none will-change-transform" style={{ height: '100%' }} />
    </div>
  );
});

/**
 * Grade sem andamento (música sem BPM): uma linha clara a cada passo da régua de tempo, por baixo
 * dos clipes, como o repeating-linear-gradient que ficava no fundo do conteúdo. No zoom ao vivo é
 * redesenhada a cada quadro, como a grade com andamento.
 */
export function StepLinesCanvas({ zoomH, visible, timelineWidth, hub }: {
  zoomH: number;
  /** Sem ela, a janela visível da timeline (o painel não redesenha a cada rolagem). */
  visible?: VisibleRange;
  timelineWidth: number;
  hub: ZoomCanvasHub;
}) {
  const shownVisible = useShownVisible(visible);
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ zoomH, visible: shownVisible, timelineWidth });
  latest.current = { zoomH, visible: shownVisible, timelineWidth };
  const draw = useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const p = latest.current;
    const dpr = window.devicePixelRatio || 1;
    const live = hub.live;
    const width = live ? live.timelineWidth : p.timelineWidth;
    const span = live
      ? canvasSpan(p.zoomH, p.visible, dpr, live, 32, width)
      : canvasSpan(p.zoomH, { start: p.visible.start, end: Math.max(p.visible.start, Math.min(p.visible.end, width)) }, dpr, null);
    placeCanvas(cv, span, 1);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const lw = Math.max(1, Math.round(dpr));
    ctx.fillStyle = STEP_LINE_COLOR;
    const stepPx = rulerStepFor(span.zoom) * span.zoom;
    for (const x of stepLinesPx(stepPx, span.left, span.left + span.cssWidth, width)) {
      ctx.fillRect(canvasX(span, x), 0, lw, 1);
    }
  }, [hub]);
  useCanvasRedraw(draw, [zoomH, shownVisible, timelineWidth], hub);
  return <canvas ref={ref} className="absolute top-0 block pointer-events-none" style={{ height: '100%' }} />;
}

interface TextStyle { font: string; color: string; lineHeight: number; tabular: boolean }
interface RulerStyles { barLine: string; beatLine: string; tickLine: string; barLabel: TextStyle; beatLabel: TextStyle; tickLabel: TextStyle }

function readTextStyle(el: Element): TextStyle {
  const cs = getComputedStyle(el);
  const size = parseFloat(cs.fontSize) || 10;
  return {
    font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
    color: cs.color,
    lineHeight: parseFloat(cs.lineHeight) || size * 1.2,
    tabular: cs.fontVariantNumeric.includes('tabular-nums'),
  };
}

/** Subida e descida da fonte e largura de um algarismo (lidas a cada desenho: a fonte pode chegar depois). */
// Medidas de fonte e largura de cada caractere, guardadas por fonte: trocar ctx.font e medir texto
// a cada número da régua custava mais de 1 s num zoom longo (medido no perfil do Electron).
const fontCache = new Map<string, { ascent: number; descent: number; digit: number; widths: Map<string, number> }>();
function fontMetrics(ctx: CanvasRenderingContext2D, font: string) {
  let m = fontCache.get(font);
  if (m) return m;
  ctx.font = font;
  const t = ctx.measureText('0');
  m = { ascent: t.fontBoundingBoxAscent, descent: t.fontBoundingBoxDescent, digit: t.width, widths: new Map() };
  fontCache.set(font, m);
  return m;
}

function charWidth(ctx: CanvasRenderingContext2D, font: string, ch: string): number {
  const m = fontMetrics(ctx, font);
  let w = m.widths.get(ch);
  if (w === undefined) { w = ctx.measureText(ch).width; m.widths.set(ch, w); }
  return w;
}

// Atlas de caracteres por estilo e densidade de pixels: os números da régua são copiados de uma
// imagem pronta (drawImage), sem trocar a fonte do canvas. Medido no Electron: cada troca de
// ctx.font custava cerca de 3,4 ms, e o canvas da régua muda de tamanho a cada quadro do zoom (o
// que apaga a fonte), então a régua gastava uns 7 ms por quadro só nisso.
const ATLAS_CHARS = '0123456789:.,-+ /|';
interface Glyph { sx: number; sw: number; w: number }
interface Atlas { canvas: HTMLCanvasElement; glyphs: Map<string, Glyph>; ascentPx: number; heightPx: number; digit: number }
const atlases = new Map<string, Atlas>();
// fonte que termina de carregar depois: refaz atlas e medidas com a fonte certa
if (typeof document !== 'undefined') {
  document.fonts?.addEventListener?.('loadingdone', () => { atlases.clear(); fontCache.clear(); });
}
function atlasFor(s: TextStyle, dpr: number): Atlas | null {
  const key = `${s.font}|${s.color}|${dpr}`;
  const hit = atlases.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = s.font;
  const t = ctx.measureText('0');
  const ascent = t.fontBoundingBoxAscent;
  const descent = t.fontBoundingBoxDescent;
  const pad = 2;
  const glyphs = new Map<string, Glyph>();
  let x = 0;
  for (const ch of ATLAS_CHARS) {
    const w = ctx.measureText(ch).width;
    const sw = Math.ceil(w * dpr) + pad * 2;
    glyphs.set(ch, { sx: x, sw, w });
    x += sw;
  }
  canvas.width = Math.max(1, x);
  canvas.height = Math.max(1, Math.ceil((ascent + descent) * dpr) + pad * 2);
  // mudar o tamanho apaga o estado: fonte e cor de novo, uma vez só
  ctx.font = s.font;
  ctx.fillStyle = s.color;
  ctx.textBaseline = 'alphabetic';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const [ch, g] of glyphs) ctx.fillText(ch, (g.sx + pad) / dpr, pad / dpr + ascent);
  const atlas: Atlas = { canvas, glyphs, ascentPx: ascent * dpr + pad, heightPx: canvas.height, digit: t.width };
  atlases.set(key, atlas);
  return atlas;
}

/** Número da régua copiado do atlas (x e baseline em px CSS); false se algum caractere não está nele. */
function drawLabelFromAtlas(ctx: CanvasRenderingContext2D, a: Atlas, text: string, x: number, baseline: number, tabular: boolean, dpr: number): boolean {
  for (const ch of text) if (!a.glyphs.has(ch)) return false;
  let at = x;
  const top = Math.round(baseline * dpr - a.ascentPx);
  for (const ch of text) {
    const g = a.glyphs.get(ch)!;
    const isDigit = ch >= '0' && ch <= '9';
    const cx = tabular && isDigit ? at + (a.digit - g.w) / 2 : at;
    ctx.drawImage(a.canvas, g.sx, 0, g.sw, a.heightPx, Math.round(cx * dpr) - 2, top, g.sw, a.heightPx);
    at += tabular && isDigit ? a.digit : g.w;
  }
  return true;
}

/** Texto com algarismos de largura fixa quando a skin usa tabular-nums (o canvas não tem a opção). */
function fillLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, tabular: boolean, digit: number, font: string) {
  if (!tabular) { ctx.fillText(text, x, y); return; }
  let at = x;
  for (const ch of text) {
    const w = charWidth(ctx, font, ch);
    if (ch >= '0' && ch <= '9') {
      ctx.fillText(ch, at + (digit - w) / 2, y);
      at += digit;
    } else {
      ctx.fillText(ch, at, y);
      at += w;
    }
  }
}

const RULER_H = 40;

// Cores e fontes da régua por skin: voltar do Modo Show remonta a timeline, e reler seis estilos
// forçava o navegador a recalcular a página inteira bem no quadro da troca.
const rulerStylesBySkin = new Map<string, RulerStyles>();

/**
 * Régua (40 px): traços e números de compasso e tempo e, embaixo, os números de tempo (m:ss), num
 * canvas do tamanho da janela visível. Cores, fonte e alturas vêm de elementos escondidos com as
 * mesmas classes das divs de antes (cada skin troca as variáveis e a fonte). As placas de BPM
 * continuam em DOM (BarRulerLayer), por cima.
 */
export const RulerCanvas = memo(function RulerCanvas({ grid: baseGrid, hasGrid, zoomH, visible: visibleProp, contentEnd, hub }: {
  grid: SongGrid | null;
  /** Com grade, os números de tempo ficam só na metade de baixo. */
  hasGrid: boolean;
  zoomH: number;
  /** Sem ela, a janela visível da timeline (o painel não redesenha a cada rolagem). */
  visible?: VisibleRange;
  contentEnd: number;
  hub: ZoomCanvasHub;
}) {
  const grid = useShownGrid(baseGrid);
  const visible = useShownVisible(visibleProp);
  const ref = useRef<HTMLCanvasElement>(null);
  const probesRef = useRef<HTMLDivElement>(null);
  const skin = useSkin();
  const stylesRef = useRef<RulerStyles | null>(null);
  const latest = useRef({ grid, hasGrid, zoomH, visible, contentEnd });
  latest.current = { grid, hasGrid, zoomH, visible, contentEnd };
  const draw = useCallback(() => {
    const cv = ref.current;
    if (!cv) return;
    const p = latest.current;
    if (!stylesRef.current) stylesRef.current = rulerStylesBySkin.get(currentSkin()) ?? null;
    if (!stylesRef.current && probesRef.current) {
      const q = (name: string) => probesRef.current!.querySelector(`[data-probe="${name}"]`)!;
      stylesRef.current = {
        barLine: getComputedStyle(q('bar-line')).borderLeftColor,
        beatLine: getComputedStyle(q('beat-line')).borderLeftColor,
        tickLine: getComputedStyle(q('tick-line')).borderLeftColor,
        barLabel: readTextStyle(q('bar-label')),
        beatLabel: readTextStyle(q('beat-label')),
        tickLabel: readTextStyle(q('tick-label')),
      };
      rulerStylesBySkin.set(currentSkin(), stylesRef.current);
    }
    const st = stylesRef.current;
    if (!st) return;
    const dpr = window.devicePixelRatio || 1;
    const span = canvasSpan(p.zoomH, p.visible, dpr, hub.live);
    const H = Math.round(RULER_H * dpr);
    placeCanvas(cv, span, H);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const lw = Math.max(1, Math.round(dpr));
    // x (px da tela) de um instante, sem arredondar: o texto fica onde o navegador poria
    const exactX = (time: number) => ((time * span.zoom - span.left) * span.scale) / dpr;
    // os textos são guardados e desenhados todos no fim, com uma transformação só e trocando a
    // fonte só quando ela muda (trocar fonte e transformação a cada número pesava no zoom)
    const labels: Array<{ label: string; x: number; boxTop: number; s: TextStyle }> = [];
    const text = (label: string, x: number, boxTop: number, s: TextStyle) => { labels.push({ label, x, boxTop, s }); };
    const flushLabels = () => {
      if (labels.length === 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // por estilo: a fonte do canvas é trocada uma vez por estilo, não a cada número
      const byStyle = new Map<TextStyle, typeof labels>();
      for (const l of labels) {
        const list = byStyle.get(l.s);
        if (list) list.push(l); else byStyle.set(l.s, [l]);
      }
      for (const [s, list] of byStyle) {
        const m = fontMetrics(ctx, s.font);
        const atlas = atlasFor(s, dpr);
        let fontSet = false;
        for (const { label, x, boxTop } of list) {
          const baseline = textBaseline(boxTop, s.lineHeight, m.ascent, m.descent);
          if (atlas) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (drawLabelFromAtlas(ctx, atlas, label, x, baseline, s.tabular, dpr)) continue;
          }
          // caractere fora do atlas (raro): desenha com a fonte, como antes
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (!fontSet) { ctx.font = s.font; ctx.fillStyle = s.color; fontSet = true; }
          fillLabel(ctx, label, x, baseline, s.tabular, m.digit, s.font);
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    if (p.grid) {
      const g = p.grid;
      const lines = gridLines(g, span.from, span.to, span.zoom);
      const beatPx = g.beat * span.zoom;
      const barPx = g.beat * g.beatsPerBar * span.zoom;
      // Com pouco espaço por compasso, mostra o número só a cada N compassos (potência de 2) para
      // nunca sobrepor os algarismos; o traço continua em todo compasso.
      const barLabelStride = Math.max(1, 2 ** Math.ceil(Math.log2(32 / Math.max(barPx, 1e-3))));
      for (const l of lines) {
        const bar = l.kind === 'bar';
        ctx.fillStyle = bar ? st.barLine : st.beatLine;
        ctx.fillRect(canvasXAt(span, l.time), 0, lw, Math.round((bar ? 20 : 10) * dpr));
        const showLabel = bar
          ? (barLabelStride <= 1 || (l.bar - 1) % barLabelStride === 0)
          : l.kind === 'beat' && beatPx >= 40; // meio tempo: só o traço, senão repete o número do tempo
        // borda de 1 px + left-1 (4 px); pt-0.5 (2 px) em cima
        if (showLabel) text(barBeatLabel(l.time, g), exactX(l.time) + 5, 2, bar ? st.barLabel : st.beatLabel);
      }
    }

    const step = rulerStepFor(span.zoom);
    const top = Math.round((p.hasGrid ? 20 : 0) * dpr);
    const tw = timelineWidthFor(p.contentEnd, span.zoom);
    for (const t of rulerTicks(step, span.zoom, span.from * span.zoom, span.to * span.zoom, tw)) {
      ctx.fillStyle = st.tickLine;
      ctx.fillRect(canvasXAt(span, t), top, lw, H - top);
      // borda de 1 px + pl-1 (4 px); a caixa do texto encosta em baixo, com pb-0.5 (2 px)
      text(formatRulerTick(t, step), exactX(t) + 5, RULER_H - 2 - st.tickLabel.lineHeight, st.tickLabel);
    }
    flushLabels();
  }, [hub]);
  // skin nova: cores e fonte lidas de novo
  useLayoutEffect(() => { stylesRef.current = null; }, [skin]);
  useCanvasRedraw(draw, [grid, hasGrid, zoomH, visible, contentEnd, skin], hub);
  return (
    <>
      <canvas ref={ref} className="absolute top-0 block pointer-events-none" style={{ height: `${RULER_H}px` }} />
      {/* mesmas classes das divs de antes: o canvas lê daqui cor, fonte e entrelinha de cada skin */}
      <div ref={probesRef} hidden aria-hidden>
        <span data-probe="bar-line" className="border-l border-logic-text-muted/60" />
        <span data-probe="beat-line" className="border-l border-logic-border-light/60" />
        <span data-probe="tick-line" className="border-l border-logic-border-dark/60" />
        <span data-probe="bar-label" className="text-2xs font-mono whitespace-nowrap leading-none text-logic-text-dim font-medium" />
        <span data-probe="beat-label" className="text-2xs font-mono whitespace-nowrap leading-none text-logic-text-muted/70" />
        <span data-probe="tick-label" className="text-2xs text-logic-text-muted font-mono pl-1 whitespace-nowrap" />
      </div>
    </>
  );
});

/**
 * Placas de BPM da régua. Enquanto uma placa é arrastada, a posição dela vai para tempoDragView
 * (fora do React): a régua, as placas e as linhas da grade acompanham sozinhas, e o painel só fica
 * sabendo ao soltar, quando a mudança é gravada.
 */
export const BarRulerLayer = memo(function BarRulerLayer({ song, grid: baseGrid, zoomH, visible: visibleProp, onEditTempo }: {
  song: Song;
  grid: SongGrid;
  zoomH: number;
  /** Sem ela, a janela visível da timeline (o painel não redesenha a cada rolagem). */
  visible?: VisibleRange;
  /** Duplo clique numa placa de BPM (ou "Editar BPM" no menu): editar a mudança de andamento daquele ponto. */
  onEditTempo?: (point: { time: number; bpm: number; x: number; y: number }) => void;
}) {
  const grid = useShownGrid(baseGrid);
  const visible = useShownVisible(visibleProp);
  const moveTempoAt = useStore((s) => s.moveTempoAt);
  const snapStep = useStore((s) => s.snapStep);
  const [menu, setMenu] = useState<{ x: number; y: number; time: number; bpm: number } | null>(null);
  const lines = gridLines(grid, visible.start / zoomH, visible.end / zoomH, zoomH);

  // Arrastar a placa leva a mudança de andamento junto, grudando perto do início dos compassos do
  // trecho de antes, sem tirar as batidas do trecho do lugar. Com Alt, a troca fica no ponto exato e
  // a grade do trecho recomeça ali. Só grava ao soltar, então o Desfazer volta tudo de uma vez.
  const startTempoDrag = (e: React.PointerEvent, time: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const segs = grid.tempoSegments;
    const index = tempoChangeIndex(segs, time);
    if (!segs || index < 1) return;
    const startX = e.clientX;
    let moved = false;
    let to = time;
    let exact = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      exact = ev.altKey;
      const raw = time + dx / zoomH;
      const snapped = ev.altKey ? raw : snapTempoChange(segs, index, raw, grid.beatsPerBar, 'bar');
      to = moveTempoChange(segs, index, snapped, { keepPhase: !exact, beatsPerBar: grid.beatsPerBar })[index].startTime;
      // grudada no mesmo compasso de antes: nada a redesenhar
      const shown = tempoDragView.get();
      if (!shown || shown.from !== time || shown.to !== to || !!shown.exact !== exact) tempoDragView.set({ from: time, to, exact });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
      tempoDragView.set(null);
      if (moved && Math.abs(to - time) > 1e-4) moveTempoAt(song.id, time, to, exact);
    };
    // na janela: a placa é redesenhada no lugar novo enquanto arrasta
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.body.style.cursor = 'grabbing';
  };
  // Anti-colisão: garante que duas placas de BPM nunca se sobreponham visualmente na régua
  let lastBadgePx = -9999;
  const MIN_BADGE_DIST_PX = 130;
  const badges: { time: number; bpm: number; px: number }[] = [];
  for (const l of lines) {
    if (!l.bpmChange) continue;
    const linePx = l.time * zoomH;
    if (linePx - lastBadgePx >= MIN_BADGE_DIST_PX) {
      badges.push({ time: l.time, bpm: l.bpmChange, px: linePx });
      lastBadgePx = linePx;
    }
  }

  // Os traços e números da régua são desenhados no RulerCanvas; aqui ficam só as placas de BPM
  // (poucas e clicáveis), no mesmo lugar de antes (a borda transparente mantém o 1 px do traço).
  return (
    <>
      {badges.map((b) => (
        <div
          key={b.time}
          className="absolute top-0 border-l border-transparent pointer-events-none"
          style={{ left: zoomPx(b.time) }}
        >
          <div
            className={`absolute top-0 left-6 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded bg-logic-bg-panel/90 border ${song.bpmSource === 'audio' ? 'border-dashed' : ''} border-amber-500/80 text-[9px] font-mono font-bold text-amber-300 shadow-md backdrop-blur-sm whitespace-nowrap select-none ${onEditTempo ? 'pointer-events-auto cursor-grab active:cursor-grabbing hover:border-amber-300 hover:text-amber-200' : 'pointer-events-none'}`}
            title={`${song.bpmSource === 'audio' ? 'Troca estimada (faixa sem click), confira. ' : ''}Mudança de andamento: ${b.bpm} BPM. Arraste para mover sem tirar as batidas do lugar (Alt: ponto exato, a grade recomeça ali). Botão direito: editar, ajustar no beat ou excluir.`}
            // a placa não move o cursor nem abre o menu da régua
            onPointerDown={(e) => startTempoDrag(e, b.time)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, time: b.time, bpm: b.bpm });
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEditTempo?.({ time: b.time, bpm: b.bpm, x: e.clientX, y: e.clientY });
            }}
          >
            <span>⚡ {b.bpm} BPM</span>
          </div>
        </div>
      ))}
      {menu && (
        <TempoChangeMenu
          song={song}
          grid={grid}
          {...menu}
          onEdit={() => onEditTempo?.({ time: menu.time, bpm: menu.bpm, x: menu.x, y: menu.y })}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
});

/** Menu do botão direito na placa amarela de mudança de andamento. */
function TempoChangeMenu({ song, grid, x, y, time, onEdit, onClose }: {
  song: Song;
  grid: SongGrid;
  x: number;
  y: number;
  time: number;
  onEdit: () => void;
  onClose: () => void;
}) {
  const moveTempoAt = useStore((s) => s.moveTempoAt);
  const removeTempoAt = useStore((s) => s.removeTempoAt);
  const removeAllTempoChanges = useStore((s) => s.removeAllTempoChanges);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const segs = grid.tempoSegments ?? [];
  const index = tempoChangeIndex(segs, time);
  const onBeat = index > 0 ? moveTempoChange(segs, index, snapTempoChange(segs, index, time, grid.beatsPerBar, 'bar'))[index].startTime : time;
  const offMs = Math.round((onBeat - time) * 1000);

  const item = 'w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none';
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[300] min-w-52 py-1 bg-logic-bg-panel border border-logic-border-light shadow-2xl rounded text-xs text-logic-text"
      style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 160) }}
      onContextMenu={(e) => e.preventDefault()}
      // o menu fica fora da régua na tela, mas os eventos do React sobem até ela: sem isto o
      // clique num item viraria "mover o cursor" na régua
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className={item} onClick={() => { onClose(); onEdit(); }}>
        <span>Editar BPM…</span>
      </button>
      <button
        className={item}
        disabled={index < 1 || offMs === 0}
        onClick={() => { onClose(); moveTempoAt(song.id, time, onBeat, true); }}
        title="Leva a mudança de andamento para o início do compasso mais perto, na grade de antes dela"
      >
        <span>Ajustar no compasso da grade</span>
        <span className="text-[10px] opacity-60 font-mono">{offMs === 0 ? 'já está' : `${offMs > 0 ? '+' : ''}${offMs} ms`}</span>
      </button>
      <div className="h-px bg-logic-border-dark my-1" />
      <button className={`${item} text-logic-lcd-red`} onClick={() => { onClose(); removeTempoAt(song.id, time); }} title="Remove só esta mudança de andamento">
        <span>Remover</span>
      </button>
      <button
        className={`${item} text-logic-lcd-red`}
        disabled={segs.length < 2}
        onClick={() => { onClose(); removeAllTempoChanges(song.id); }}
        title="Remove todas as mudanças de andamento da música; fica o BPM do começo"
      >
        <span>Remover todos os marcadores</span>
        <span className="text-[10px] opacity-60 font-mono">{Math.max(0, segs.length - 1)}</span>
      </button>
    </div>,
    document.body,
  );
}

/** "1:12" ou "8 s": quanto saiu do fim. */
function cutText(seconds: number): string {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

/** Menu do botão "Ajustar fim": esta música ou todas. */
function SongEndMenu({ x, y, hasSong, onPick, onClose }: {
  x: number;
  y: number;
  hasSong: boolean;
  onPick: (scope: 'song' | 'all') => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  const item = 'w-full flex items-center px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none';
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[300] min-w-56 py-1 bg-logic-bg-panel border border-logic-border-light shadow-2xl rounded text-xs text-logic-text"
      style={{ left: Math.min(x, window.innerWidth - 240), top: Math.max(8, Math.min(y, window.innerHeight - 80)) }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className={item}
        disabled={!hasSong}
        onClick={() => { onClose(); onPick('song'); }}
        title="Corta o silêncio do final desta música: termina 0,5 s depois do último som de harmonia (Cmd+Z desfaz)"
      >
        Ajustar fim desta música
      </button>
      <button
        className={item}
        onClick={() => { onClose(); onPick('all'); }}
        title="Faz o mesmo em todas as músicas do show (Cmd+Z desfaz tudo de uma vez)"
      >
        Ajustar fim de todas as músicas
      </button>
    </div>,
    document.body,
  );
}

const METERS: Array<{ value: 3 | 4 | 6; label: string }> = [
  { value: 4, label: '4/4' },
  { value: 3, label: '3/4' },
  { value: 6, label: '6/8' },
];

// seletores embutidos no painel, como as janelinhas de valor de uma mesa
const selectCls = 'console-well h-[20px] !rounded-[3px] border border-black text-2xs text-logic-text px-1 hover:border-logic-accent focus:outline-none focus:border-logic-accent transition-colors';

// memo: a barra só redesenha pelo que ela mesma lê (BPM do cursor, ímã), não a cada render do painel
export const GridToolbar = memo(function GridToolbar({ song, onSelectAll }: { song: Song | undefined; onSelectAll: () => void }) {
  const bpmHere = useStore((s) => (song ? bpmAt(song, s.transport.currentTime) : 0));
  const snapStep = useStore((s) => s.snapStep);
  const setSnapStep = useStore((s) => s.setSnapStep);
  const updateSong = useStore((s) => s.updateSong);
  const [lastStep, setLastStep] = useState<Exclude<SnapStep, 'off'>>('beat');
  const [measuring, setMeasuring] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const [endMenu, setEndMenu] = useState<{ x: number; y: number } | null>(null);
  const [trimming, setTrimming] = useState(false);

  const commitBpm = () => {
    const value = Number((bpmDraft ?? '').replace(',', '.'));
    if (song && Number.isFinite(value) && value >= 30 && value <= 300) {
      const bpm = Math.round(value * 100) / 100;
      const segs = song.tempoSegments;
      const same = (shown: number) => Math.round(shown * 100) / 100 === bpm;
      if (segs && segs.length > 1 && new Set(segs.map((x) => x.bpm)).size > 1) {
        // medley: o BPM digitado vale para o trecho onde o cursor está
        const at = useStore.getState().transport.currentTime;
        const here = [...segs].sort((a, b) => a.startTime - b.startTime).reduce((cur, x) => (at >= x.startTime ? x : cur));
        if (!same(here.bpm)) useStore.getState().setTempoAt(song.id, here.startTime, bpm);
      } else if (same(song.bpm)) {
        // mesmo BPM: nada muda, nem a fase da grade nem a origem da medição
      } else if (segs && segs.length > 1) {
        setSongBpm(song.id, bpm, 'manual');
        useStore.getState().updateSong(song.id, { tempoSegments: uniformSegments(segs, bpm, song.beatsPerBar ?? 4) });
      } else {
        setSongBpm(song.id, bpm, 'manual');
      }
    }
    setBpmDraft(null);
  };
  const snapOn = snapStep !== 'off';

  const toggleSnap = () => {
    if (snapOn) {
      setLastStep(snapStep as Exclude<SnapStep, 'off'>);
      setSnapStep('off');
    } else {
      setSnapStep(lastStep);
    }
  };

  const remeasure = async () => {
    if (!song || measuring) return;
    setMeasuring(true);
    setNote(null);
    const result = await remeasureSongBpm(song.id);
    setMeasuring(false);
    setNote(result === 'ok' ? null : result === 'no-source' ? 'Esta música não tem áudios' : 'BPM não encontrado — clique no BPM para digitar');
    if (result !== 'ok') window.setTimeout(() => setNote(null), 4000);
  };

  // Ajustar fim: corta o silêncio do final (desta música ou de todas)
  const trimEnd = async (scope: 'song' | 'all') => {
    if (trimming) return;
    setTrimming(true);
    setNote(scope === 'all' ? 'Ajustando o fim das músicas...' : 'Ajustando o fim...');
    try {
      if (scope === 'song') {
        if (!song) return;
        const cut = await trimSongEnd(song.id);
        setNote(cut > 0 ? `Fim ajustado: ${cutText(cut)} de silêncio cortado` : 'O fim já estava certo');
      } else {
        const r = await trimAllSongEnds((done, total) => setNote(`Ajustando o fim das músicas... ${done + 1}/${total}`));
        setNote(r.changed
          ? `${r.changed} ${r.changed === 1 ? 'música ajustada' : 'músicas ajustadas'} (${cutText(r.cut)} cortados)${r.unchanged ? `, ${r.unchanged} já ${r.unchanged === 1 ? 'estava certa' : 'estavam certas'}` : ''}`
          : 'O fim de todas as músicas já estava certo');
      }
    } catch (err) {
      setNote(`Não deu para ajustar o fim: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTrimming(false);
      window.setTimeout(() => setNote(null), 5000);
    }
  };

  // BPM do trecho onde o cursor está (muda junto com as marcações de andamento da régua)
  const bpmText = song?.bpmDetected && bpmHere
    ? `${Math.round(bpmHere * 10) / 10} BPM`
    : song?.bpmMissing ? 'BPM não encontrado' : 'BPM ?';

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        className={`console-key flex items-center justify-center w-[24px] h-[20px] ${snapOn ? 'is-lit-blue' : ''}`}
        onClick={toggleSnap}
        title={snapOn ? 'Imã na grade ligado (segure Alt para mover livre)' : 'Imã na grade desligado'}
        aria-pressed={snapOn}
      >
        <Magnet size={11} />
      </button>
      <select
        className={selectCls}
        value={snapStep}
        onChange={(e) => setSnapStep(e.target.value as SnapStep)}
        title="Passo da grade"
      >
        {(Object.keys(SNAP_LABELS) as SnapStep[]).map((k) => <option key={k} value={k}>{SNAP_LABELS[k]}</option>)}
      </select>
      <select
        className={selectCls}
        value={song?.beatsPerBar ?? 4}
        disabled={!song}
        onChange={(e) => {
          if (song) updateSong(song.id, { beatsPerBar: Number(e.target.value) as 3 | 4 | 6 });
          e.currentTarget.blur();
        }}
        title="Fórmula de compasso desta música"
      >
        {METERS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
      {bpmDraft !== null ? (
        <input
          autoFocus
          inputMode="decimal"
          className="w-[72px] px-1.5 h-[18px] rounded bg-logic-bg-deep border border-logic-accent font-mono text-logic-text focus:outline-none"
          value={bpmDraft}
          placeholder="BPM"
          onChange={(e) => setBpmDraft(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitBpm();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              setBpmDraft(null);
              e.currentTarget.blur();
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <button
          className={`console-display hidden md:flex items-center gap-1 px-1.5 h-[20px] font-stage font-semibold text-[12px] transition-colors hover:border-logic-accent disabled:pointer-events-none
            ${song?.bpmMissing && !song.bpmDetected ? '!border-logic-lcd-amber/60 text-logic-lcd-amber' : 'text-logic-lcd-amber console-glow'}`}
          onClick={(e) => {
            if (song) setBpmDraft(song.bpmDetected && bpmHere ? String(Math.round(bpmHere * 100) / 100) : '');
            e.currentTarget.blur();
          }}
          disabled={!song}
          title="Clique para digitar o BPM desta música"
        >
          {bpmText}
          {song?.bpmSource === 'click' && <span className="text-logic-lcd-green">click</span>}
          {song?.bpmSource === 'manual' && song.bpmDetected && <span className="text-logic-accent">manual</span>}
        </button>
      )}
      <button
        className="console-key flex items-center gap-1 px-2 h-[20px] text-[12px] disabled:pointer-events-none"
        onClick={remeasure}
        disabled={!song || measuring}
        title="Ler o BPM de novo pelo click (ou bateria)"
      >
        {measuring ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        <span className="hidden lg:inline">Medir BPM de novo</span>
      </button>
      <button
        className="console-key flex items-center gap-1 px-2 h-[20px] text-[12px] disabled:pointer-events-none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setEndMenu({ x: r.left, y: r.bottom + 4 });
        }}
        disabled={trimming}
        title="Corta o silêncio do final do VS, 0,5 s depois do último som de harmonia"
      >
        {trimming ? <Loader2 size={10} className="animate-spin" /> : <Scissors size={10} />}
        <span className="hidden lg:inline">Ajustar fim</span>
      </button>
      {endMenu && (
        <SongEndMenu x={endMenu.x} y={endMenu.y} hasSong={!!song} onPick={(scope) => void trimEnd(scope)} onClose={() => setEndMenu(null)} />
      )}
      <button
        className="console-key flex items-center gap-1 px-2 h-[20px] text-[12px] disabled:pointer-events-none"
        onClick={onSelectAll}
        disabled={!song}
        title={`Selecionar todos os áudios da música${shortcutLabel('edit.selectAllClips') ? ` (${shortcutLabel('edit.selectAllClips')})` : ''}`}
      >
        <CheckCheck size={10} />
        <span className="hidden lg:inline">Selecionar todos</span>
      </button>

      {note && <span className="text-logic-lcd-amber animate-[fadeIn_120ms_ease-out]">{note}</span>}
    </div>
  );
});
