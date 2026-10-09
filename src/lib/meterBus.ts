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

export function useMeterLevel(id: string): number {
  return useSyncExternalStore(subscribe, () => levels.get(id) ?? 0);
}
