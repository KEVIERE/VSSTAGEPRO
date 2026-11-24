import { useSyncExternalStore } from 'react';
import { moveTempoChange, tempoChangeIndex, type SongGrid } from './grid.ts';
import type { RegionLayout } from './regions.ts';

/**
 * Janela visível da timeline (em px do zoom atual, em blocos de VISIBLE_QUANTUM), fora do React.
 * O painel grava aqui; as ondas dos clipes leem direto, sem o ClipBlock re-renderizar a cada
 * rolagem ou zoom. Gravada no mesmo instante que o zoom (flushSync do applyZoom): a render já
 * sai com zoom e janela novos juntos.
 */
export interface TimelineVisible {
  start: number;
  end: number;
}

let current: TimelineVisible = { start: 0, end: 4000 };
const listeners = new Set<() => void>();

export function getTimelineVisible(): TimelineVisible {
  return current;
}

export function setTimelineVisible(next: TimelineVisible): void {
  if (next.start === current.start && next.end === current.end) return;
  current = { start: next.start, end: next.end };
  for (const l of listeners) l();
}

export function subscribeTimelineVisible(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTimelineVisible(): TimelineVisible {
  return useSyncExternalStore(subscribeTimelineVisible, getTimelineVisible);
}

/**
 * Um valor da vista da timeline fora do React (arraste em curso, janela vertical). Quem desenha
 * assina só a parte que usa: mexer o mouse num arraste redesenha só o que muda com ele, e não o
 * painel inteiro (antes cada pointermove era um setState no TimelinePanel).
 */
export interface ViewValue<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createViewValue<T>(initial: T): ViewValue<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of [...subs]) l();
    },
    subscribe: (listener) => {
      subs.add(listener);
      return () => { subs.delete(listener); };
    },
  };
}

/**
 * Lê um ViewValue no React. `select` tem de devolver o próprio valor, um pedaço estável dele (o
 * mesmo objeto enquanto o valor não muda) ou um primitivo: o componente só redesenha quando o
 * resultado muda.
 */
export function useViewValue<T, S = T>(view: ViewValue<T>, select?: (value: T) => S): S {
  const read = () => (select ? select(view.get()) : (view.get() as unknown as S));
  return useSyncExternalStore(view.subscribe, read);
}

/** Corte em curso (alças do começo ou do fim do clipe). */
export type TrimDrag = { ids: Set<string>; delta: number; anchorId: string; end: number; label: string; side?: 'start' | 'end' } | null;
// `ghosts`: áudios indo para outra trilha (a prévia aparece na trilha de destino); `laneLabel`: para onde.
export type MoveDrag = { ids: Set<string>; delta: number; anchorId: string; start: number; label: string; ghosts?: { trackId: string; clipId: string }[]; laneLabel?: string } | null;

export const trimDragView = createViewValue<TrimDrag>(null);
export const moveDragView = createViewValue<MoveDrag>(null);

/** O arraste, se ele leva este clipe; null para os outros clipes (que assim não redesenham). */
export function dragOf<D extends { ids: Set<string> }>(drag: D | null, clipId: string): D | null {
  return drag && drag.ids.has(clipId) ? drag : null;
}

/**
 * Região sendo arrastada (RegionLane): a faixa das regiões e as guias por cima dos clipes assinam
 * sozinhas. Antes cada movimento do mouse era um setState do TimelinePanel e redesenhava a timeline
 * inteira (todas as trilhas, clipes e a régua).
 */
export type RegionDrag = { id: string; start: number; end: number; layout?: RegionLayout | null } | null;
export const regionDragView = createViewValue<RegionDrag>(null);

/** Placa de BPM sendo arrastada: de onde saiu e onde está agora. */
export type TempoDrag = { from: number; to: number; exact?: boolean } | null;
export const tempoDragView = createViewValue<TempoDrag>(null);

/**
 * A grade com a mudança de andamento no lugar novo enquanto a placa é arrastada (a mesma conta que
 * o painel fazia). Sem arraste, a própria grade.
 */
export function draggedGrid<G extends SongGrid | null | undefined>(grid: G, drag: TempoDrag): G {
  if (!grid?.tempoSegments || !drag) return grid;
  const index = tempoChangeIndex(grid.tempoSegments, drag.from);
  return index < 1 ? grid : { ...grid, tempoSegments: moveTempoChange(grid.tempoSegments, index, drag.to, { keepPhase: !drag.exact, beatsPerBar: grid.beatsPerBar }) };
}

/**
 * Faixa vertical da timeline que monta clipes (px do conteúdo): a tela e mais uma tela de folga
 * em cima e embaixo, em blocos de ROWS_QUANTUM (só redesenha quando muda de bloco).
 */
export interface TimelineRows {
  top: number;
  bottom: number;
}
export const ROWS_QUANTUM = 256;

export function rowsWindow(scrollTop: number, clientHeight: number): TimelineRows {
  const margin = Math.max(200, clientHeight);
  const q = ROWS_QUANTUM;
  return {
    top: Math.max(0, Math.floor((scrollTop - margin) / q) * q),
    bottom: Math.ceil((scrollTop + clientHeight + margin) / q) * q,
  };
}

/** null: ainda não medido (o painel acabou de abrir). */
export const timelineRowsView = createViewValue<TimelineRows | null>(null);

export function setTimelineRows(next: TimelineRows | null): void {
  const prev = timelineRowsView.get();
  if (prev && next && prev.top === next.top && prev.bottom === next.bottom) return;
  timelineRowsView.set(next);
}

/** Linha (topo e altura em px do conteúdo) cruza a faixa que monta clipes. */
export function rowInRows(top: number, height: number, rows: TimelineRows): boolean {
  return top < rows.bottom && top + height > rows.top;
}

/** Topo de cada linha, na ordem da tela, a partir das alturas. */
export function rowTops(heights: number[]): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h;
  }
  return tops;
}

/** Mesma lista de ids, na mesma ordem (seleção que não mudou). */
export function sameIdList(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
