// Pico escolhido no botão IGUALAR (em dB): a faixa válida e como ler o que o usuário digita.
// Sem dependências, para poder ser testado direto no Node.

/** Faixa aceita para o pico escolhido: acima de 0 dB o som clipa. */
export const TARGET_DB_MIN = -24;
export const TARGET_DB_MAX = 0;
/** Pico usado quando o usuário ainda não escolheu um. */
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
