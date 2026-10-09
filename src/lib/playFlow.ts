import type { PlayFlow, PlaylistEntry } from '@/types';

// Contínuo: arma a próxima música da playlist (se houver).
// Bloco: arma a próxima enquanto não houver um cabeçalho de bloco entre ela e a atual,
// do mesmo jeito que a playlist mostra as divisórias.
// Uma a Uma: nunca arma — toca e para.
export function computeNextSongId(
  currentSongId: string | null,
  playlist: PlaylistEntry[],
  playlistOrder: string[],
  playFlow: PlayFlow
): string | null {
  if (playFlow === 'uma-uma') return null;
  const idx = playlistOrder.indexOf(currentSongId ?? '');
  if (idx === -1) return null;
  const nextId = playlistOrder[idx + 1] ?? null;
  if (!nextId) return null;
  if (playFlow === 'bloco') {
    const curBlock = playlist.find((p) => p.songId === currentSongId)?.blockId ?? null;
    const nextBlock = playlist.find((p) => p.songId === nextId)?.blockId ?? null;
    if (nextBlock && nextBlock !== curBlock) return null;
  }
  return nextId;
}
