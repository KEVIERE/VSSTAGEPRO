// Aviso discreto de faixa sem áudio porque o disco atrasou a entrega.
// Atraso curto (a música ainda carregando) passa sem aviso: só entra a faixa que ficou
// sem áudio por DISK_LAG_GRACE_MS seguidos. A música segue no tempo certo; a faixa volta sozinha.

/** Quanto tempo uma faixa pode ficar sem áudio antes do aviso aparecer. */
export const DISK_LAG_GRACE_MS = 4000;

/** Faixas que passaram do tempo de espera, na ordem em que ficaram sem áudio. */
export function lateClipIds(starvedSince: ReadonlyMap<string, number>, now: number, graceMs = DISK_LAG_GRACE_MS) {
  const late: string[] = [];
  let nextCheckIn: number | null = null;
  for (const [id, since] of starvedSince) {
    const wait = since + graceMs - now;
    if (wait <= 0) late.push(id);
    else nextCheckIn = nextCheckIn === null ? wait : Math.min(nextCheckIn, wait);
  }
  return { late, nextCheckIn };
}

/** Texto curto da etiqueta: até dois nomes e "+N" para o resto. */
export function diskLagLabel(names: readonly string[]): string {
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

/** Explicação completa (dica ao passar o mouse). */
export function diskLagHint(names: readonly string[]): string {
  const one = names.length === 1;
  return `Áudio chegando atrasado do disco em: ${names.join(', ')}. A música segue no tempo certo e ${one ? 'a faixa volta' : 'as faixas voltam'} a soar assim que o áudio chegar.`;
}

const EMPTY: readonly string[] = [];
let current: readonly string[] = EMPTY;
const listeners = new Set<() => void>();

export function getDiskLag(): readonly string[] {
  return current;
}

export function subscribeDiskLag(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setDiskLag(names: readonly string[]) {
  const same = names.length === current.length && names.every((n, i) => n === current[i]);
  if (same) return;
  current = names.length === 0 ? EMPTY : [...names];
  listeners.forEach((fn) => fn());
}
