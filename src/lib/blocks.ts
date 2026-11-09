import type { Block, PlaylistEntry } from '@/types';

// Blocos funcionam como divisórias: o cabeçalho fica em cima de uma música e o bloco vale
// para ela e todas as de baixo, até o próximo cabeçalho. Cada música guarda o bloco a que
// pertence (blockId), e essas funções mantêm isso sempre coerente com os cabeçalhos.

/** Primeira música de cada bloco, na ordem da playlist (bloco → música do cabeçalho). */
export function blockHeaders(playlist: PlaylistEntry[]): Map<string, string> {
  const headers = new Map<string, string>();
  for (const p of playlist) {
    if (p.blockId && !headers.has(p.blockId)) headers.set(p.blockId, p.songId);
  }
  return headers;
}

/** Recalcula o bloco de cada música a partir dos cabeçalhos: vale o cabeçalho mais próximo acima. */
export function applyHeaders(playlist: PlaylistEntry[], headers: Map<string, string>): PlaylistEntry[] {
  const atSong = new Map<string, string>();
  headers.forEach((songId, blockId) => atSong.set(songId, blockId));
  let active: string | null = null;
  return playlist.map((p, i) => {
    const start = atSong.get(p.songId);
    if (start) active = start;
    return p.blockId === active && p.order === i ? p : { ...p, blockId: active, order: i };
  });
}

/** Deixa a playlist coerente: uma música no meio de um bloco nunca aponta para um bloco de cima. */
export function resolveBlocks(playlist: PlaylistEntry[]): PlaylistEntry[] {
  return applyHeaders(playlist, blockHeaders(playlist));
}

const AUTO_NAME = /^Bloco\s+\d+$/i;

export function autoBlockName(position: number): string {
  return `Bloco ${position.toString().padStart(2, '0')}`;
}

/**
 * Coloca os blocos na ordem em que aparecem na playlist e renumera os de nome automático
 * ("Bloco 01", "Bloco 02"...) pela posição. Nomes escolhidos à mão ficam como estão.
 */
export function orderBlocks(blocks: Block[], playlist: PlaylistEntry[]): Block[] {
  const position = new Map<string, number>();
  blockHeaders(playlist).forEach((_, blockId) => position.set(blockId, position.size));
  const inList = blocks.filter((b) => position.has(b.id)).sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  const rest = blocks.filter((b) => !position.has(b.id));
  const next = [...inList, ...rest].map((b, i) => {
    const pos = position.get(b.id);
    const name = pos !== undefined && AUTO_NAME.test(b.name.trim()) ? autoBlockName(pos + 1) : b.name;
    return b.order === i && b.name === name ? b : { ...b, order: i, name };
  });
  const same = next.length === blocks.length && next.every((b, i) => b === blocks[i]);
  return same ? blocks : next;
}
