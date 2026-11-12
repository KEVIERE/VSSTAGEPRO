// Arrastar na timeline: mudar a ordem das trilhas dentro de um multigrupo e levar áudios de
// uma trilha para outra. Funções puras, sem a store, para dar para testar.

/**
 * Nova ordem das trilhas de dentro de uma pasta depois de arrastar `id` para a posição `slot`.
 * `slot` conta na lista como ela está antes de arrastar: 0 = antes da primeira, `children.length`
 * = depois da última. Devolve a mesma lista quando nada muda.
 */
export function reorderChildren(children: string[], id: string, slot: number): string[] {
  const from = children.indexOf(id);
  if (from < 0) return children;
  const clamped = Math.max(0, Math.min(children.length, Math.round(slot)));
  // soltar logo antes ou logo depois dela mesma não muda nada
  if (clamped === from || clamped === from + 1) return children;
  const rest = children.filter((c) => c !== id);
  rest.splice(clamped > from ? clamped - 1 : clamped, 0, id);
  return rest;
}

/**
 * Posição de soltar numa lista de linhas empilhadas: a linha cujo meio fica abaixo do mouse
 * recebe a trilha antes dela; abaixo de todas, vai para o fim.
 */
export function dropSlot(rows: { top: number; height: number }[], y: number): number {
  for (let i = 0; i < rows.length; i++) {
    if (y < rows[i].top + rows[i].height / 2) return i;
  }
  return rows.length;
}

/**
 * Quantas trilhas os áudios descem (positivo) ou sobem (negativo) ao arrastar. `lanes` são as
 * trilhas que podem receber áudio, na ordem da tela. O mouse está sobre `hoverIndex` e o áudio
 * pego estava em `anchorIndex`. Com vários áudios de trilhas diferentes, todos andam o mesmo
 * tanto, e o deslocamento para na beirada: nenhum sai da lista.
 */
export function laneOffset(anchorIndex: number, hoverIndex: number, sourceIndexes: number[], laneCount: number): number {
  if (anchorIndex < 0 || hoverIndex < 0 || sourceIndexes.some((i) => i < 0)) return 0;
  const want = hoverIndex - anchorIndex;
  const min = -Math.min(...sourceIndexes);
  const max = laneCount - 1 - Math.max(...sourceIndexes);
  return Math.max(min, Math.min(max, want));
}

/** Para onde cada áudio vai com o deslocamento `offset` (só os que mudam de trilha). */
export function laneMoves(
  lanes: string[],
  clips: { id: string; trackId: string }[],
  offset: number,
): { clipId: string; trackId: string }[] {
  if (offset === 0) return [];
  const moves: { clipId: string; trackId: string }[] = [];
  for (const c of clips) {
    const i = lanes.indexOf(c.trackId);
    const to = lanes[i + offset];
    if (i < 0 || !to || to === c.trackId) continue;
    moves.push({ clipId: c.id, trackId: to });
  }
  return moves;
}
