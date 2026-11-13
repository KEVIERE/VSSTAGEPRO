import { useSyncExternalStore } from 'react';

const levels = new Map<string, number>();
const listeners = new Set<() => void>();

export function publishMeters(next: Map<string, number>) {
  let changed = false;
  next.forEach((v, k) => {
    if (Math.abs((levels.get(k) ?? 0) - v) > 0.002) {
      levels.set(k, v);
      changed = true;
    }
  });
  if (changed) listeners.forEach((l) => l());
}

export function resetMeters() {
  if (levels.size === 0) return;
  levels.clear();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Nível atual de um canal fora do React (o VS Stage Remote lê daqui). */
export function meterLevel(id: string): number {
  return levels.get(id) ?? 0;
}

/** Avisa a cada publicação dos níveis, fora do React (o medidor de LED escreve direto no estilo). */
export function subscribeMeters(listener: () => void): () => void {
  return subscribe(listener);
}

/**
 * Quanto da coluna do medidor de LED fica apagado, de 0 (cheia, 0 dBFS ou mais) a 1 (toda
 * apagada, -48 dBFS ou menos). Arredondado em 0,1% para não mexer no estilo à toa.
 */
export function meterMaskCover(level: number): number {
  if (!(level > 0)) return 1;
  const db = 20 * Math.log10(level);
  if (db <= -48) return 1;
  const lit = Math.min(100, ((db + 48) / 48) * 100);
  return Math.round((100 - lit) * 10) / 1000;
}

export function useMeterLevel(id: string): number {
  return useSyncExternalStore(subscribe, () => levels.get(id) ?? 0);
}
