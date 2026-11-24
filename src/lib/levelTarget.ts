// Alvo do botão IGUALAR: a faixa válida, como ler o que o usuário digita e quais faixas ficam de
// fora. Sem dependências, para poder ser testado direto no Node.

/** Faixa do pico usado pelas versões antigas do IGUALAR (o valor segue salvo no projeto). */
export const TARGET_DB_MIN = -24;
export const TARGET_DB_MAX = 0;
export const TARGET_DB_DEFAULT = -1;
/** Quanto uma música pode subir, no máximo (gravação quase muda não vira só ruído). */
export const MAX_BOOST_DB = 24;

export function clampTarget(db: number): number {
  return Math.max(TARGET_DB_MIN, Math.min(TARGET_DB_MAX, db));
}

/**
 * Lê o que o usuário digitou como pico em dB ("-2", "-2,5", "-2 dB"). Pico acima de 0 dB clipa,
 * então "2" vale como "-2" (é o jeito comum de falar "dois dB abaixo"). Null se não for número.
 */
export function parseTargetDb(text: string): number | null {
  const db = parseFloat(text.replace(',', '.').replace(/db/i, '').trim());
  if (!Number.isFinite(db)) return null;
  return clampTarget(db > 0 ? -db : db);
}

/** Volume percebido (LUFS) em que a banda de todas as músicas fica. */
export const TARGET_LUFS_MIN = -30;
export const TARGET_LUFS_MAX = -8;
export const TARGET_LUFS_DEFAULT = -14;
/** Teto do pico real depois do ganho: a música que subiria além disso fica um pouco abaixo. */
export const LEVEL_CEILING_DBTP = -1;

export function clampLufs(lufs: number): number {
  return Math.max(TARGET_LUFS_MIN, Math.min(TARGET_LUFS_MAX, Math.round(lufs)));
}

/** Lê o alvo digitado ("-14", "14", "-14 LUFS"). LUFS é sempre negativo. Null se não for número. */
export function parseTargetLufs(text: string): number | null {
  const v = parseFloat(text.replace(',', '.').replace(/lufs|lu/i, '').trim());
  if (!Number.isFinite(v)) return null;
  return clampLufs(v > 0 ? -v : v);
}

/** Referências do músico: nunca mudam de volume com o IGUALAR, nem entram na medida. */
const FIXED_LEVEL_ROOTS = new Set(['track-guia', 'track-click', 'track-maestro', 'track-timecode']);

/** A faixa é click, guia, Maestro ou timecode (ou está dentro de uma dessas pastas)? */
export function isFixedLevelTrack(trackId: string, tracks: ReadonlyArray<{ id: string; parentId?: string | null }>): boolean {
  let id: string | null | undefined = trackId;
  for (let depth = 0; id && depth < 8; depth++) {
    if (FIXED_LEVEL_ROOTS.has(id)) return true;
    const current: string = id;
    id = tracks.find((t) => t.id === current)?.parentId;
  }
  return false;
}
