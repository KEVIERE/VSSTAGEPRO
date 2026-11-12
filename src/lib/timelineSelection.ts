// Seleção de áudios na timeline, como numa DAW:
// - arrastar na grade vazia desenha um retângulo e seleciona tudo que ele pega;
// - Cmd+clique soma ou tira um áudio da seleção;
// - Shift+clique seleciona do áudio clicado antes até o clicado agora (as linhas entre os dois,
//   no trecho de tempo entre eles).
// As falas do Maestro IA entram junto: a régua delas é uma linha logo abaixo da faixa Maestro.
// Faz a conta pelas linhas e pelo tempo, não pelo que está desenhado (áudio fora da tela também
// entra). Sem tela, para dar para testar.

/** A linha da régua das falas do Maestro IA. */
export const NARRATION_ROW = '__falas-maestro-ia__';

export interface SelectableClip {
  id: string;
  trackId: string;
  startTime: number;
}

/**
 * Linhas da timeline na ordem da tela: as trilhas visíveis e, logo depois da faixa Maestro, a
 * régua das falas do Maestro IA.
 */
export function selectionRows(trackIds: string[], maestroTrackId = 'track-maestro'): string[] {
  const rows: string[] = [];
  for (const id of trackIds) {
    rows.push(id);
    if (id === maestroTrackId) rows.push(NARRATION_ROW);
  }
  return rows;
}

/** A linha de um áudio: a trilha dele, ou a régua das falas para a voz do Maestro IA. */
export function rowOf(clip: Pick<SelectableClip, 'trackId'>, narrationTrackId: string): string {
  return clip.trackId === narrationTrackId ? NARRATION_ROW : clip.trackId;
}

/**
 * Os áudios das linhas `rows` que encostam no trecho de `t0` a `t1` (segundos). `minOverlap`: quanto
 * precisam encostar (0 = qualquer pedaço). `extraRows` mapeia uma linha para outras que ela
 * representa (pasta recolhida: as trilhas de dentro).
 */
export function clipsInBox<T extends SelectableClip>(
  clips: T[],
  rows: Iterable<string>,
  t0: number,
  t1: number,
  length: (c: T) => number,
  narrationTrackId: string,
  opts: { minOverlap?: number; extraRows?: Map<string, string[]> } = {},
): string[] {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  const want = new Set<string>();
  for (const r of rows) {
    want.add(r);
    for (const x of opts.extraRows?.get(r) ?? []) want.add(x);
  }
  const min = opts.minOverlap ?? 0;
  return clips
    .filter((c) => {
      if (!want.has(rowOf(c, narrationTrackId))) return false;
      const overlap = Math.min(c.startTime + length(c), hi) - Math.max(c.startTime, lo);
      return min > 0 ? overlap > min : overlap > 0 || (hi === lo && c.startTime <= lo && lo <= c.startTime + length(c));
    })
    .map((c) => c.id);
}

/** As linhas entre duas (inclusive), na ordem da tela; vazio se alguma não está na tela. */
export function rowsBetween(rows: string[], a: string, b: string): string[] {
  const i = rows.indexOf(a);
  const j = rows.indexOf(b);
  if (i < 0 || j < 0) return [];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/**
 * Shift+clique: tudo entre o áudio clicado antes e o de agora (as linhas entre eles, no trecho de
 * tempo que vai do começo do primeiro ao fim do último).
 */
export function rangeSelection<T extends SelectableClip>(
  clips: T[],
  rows: string[],
  from: T,
  to: T,
  length: (c: T) => number,
  narrationTrackId: string,
  extraRows?: Map<string, string[]>,
): string[] {
  const between = rowsBetween(rows, rowOf(from, narrationTrackId), rowOf(to, narrationTrackId));
  if (between.length === 0) return [to.id];
  const t0 = Math.min(from.startTime, to.startTime);
  const t1 = Math.max(from.startTime + length(from), to.startTime + length(to));
  return clipsInBox(clips, between, t0, t1, length, narrationTrackId, { minOverlap: 0.05, extraRows });
}

/** Seleção do retângulo: soma com a de antes (Cmd ou Shift no começo) ou fica só com a nova. */
export function marqueeSelection(before: string[], picked: string[], additive: boolean): string[] {
  return additive ? [...new Set([...before, ...picked])] : picked;
}

/** Separa a seleção em áudios comuns e falas do Maestro IA (que se apagam pela fala). */
export function splitNarrationClips(ids: string[], narrationClipIds: Set<string>): { clips: string[]; narrations: string[] } {
  return {
    clips: ids.filter((id) => !narrationClipIds.has(id)),
    narrations: ids.filter((id) => narrationClipIds.has(id)),
  };
}
