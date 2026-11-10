import type { AudioClip } from '@/types';

// Ajustar fim: corta o silêncio do final do VS logo depois do último som de harmonia.
// Só contas, sem áudio, para dar para testar.

/** -60 dBFS numa amostra de 16 bits (o áudio dos clipes fica guardado em Int16). */
export const SILENCE_INT16 = 33;

/** Folga depois do último som. */
export const END_TAIL = 0.5;

/** Índice da última amostra acima de `threshold` (em qualquer canal), ou -1 se for tudo silêncio. */
export function lastSoundIndex(channels: ArrayLike<number>[], threshold: number): number {
  if (!channels.length) return -1;
  const len = Math.min(...channels.map((c) => c.length));
  for (let i = len - 1; i >= 0; i--) {
    for (const ch of channels) {
      const v = ch[i];
      if (v >= threshold || v <= -threshold) return i;
    }
  }
  return -1;
}

function playLength(clip: Pick<AudioClip, 'duration' | 'trimStart' | 'trimEnd'>): number {
  return Math.max(0.05, clip.duration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0));
}

export interface SongEndPlan {
  /** Onde a música passa a acabar (segundos da música). */
  end: number;
  /** Quanto tempo de música saiu. */
  cut: number;
  trims: { id: string; trimEnd: number }[];
  removeIds: string[];
}

/**
 * Plano de corte do fim de uma música.
 * @param clips      os clipes da música
 * @param lastSound  último som de cada clipe, em segundos a partir do começo do trecho que toca
 *                   (null = clipe em silêncio ou mudo)
 * @param harmonyIds clipes das faixas de harmonia (a referência)
 * @param otherIds   clipes que servem de referência quando não há harmonia com som
 * @returns null quando não há o que cortar (menos de 0,1 s)
 */
export function planSongEnd(
  clips: AudioClip[],
  lastSound: Map<string, number | null>,
  harmonyIds: Set<string>,
  otherIds: Set<string>,
  tail = END_TAIL,
): SongEndPlan | null {
  const lastOf = (ids: Set<string>) => {
    let end = -1;
    for (const c of clips) {
      if (!ids.has(c.id)) continue;
      const t = lastSound.get(c.id);
      if (t == null) continue;
      end = Math.max(end, c.startTime + Math.min(t, playLength(c)));
    }
    return end;
  };
  let sound = lastOf(harmonyIds);
  if (sound < 0) sound = lastOf(otherIds);
  if (sound < 0) return null;

  const end = sound + tail;
  const songEnd = clips.reduce((m, c) => Math.max(m, c.startTime + playLength(c)), 0);
  if (songEnd - end < 0.1) return null;

  const trims: SongEndPlan['trims'] = [];
  const removeIds: string[] = [];
  for (const c of clips) {
    const clipEnd = c.startTime + playLength(c);
    if (clipEnd <= end + 1e-6) continue;
    if (c.startTime >= end - 1e-6) { removeIds.push(c.id); continue; }
    trims.push({ id: c.id, trimEnd: (c.trimEnd ?? 0) + (clipEnd - end) });
  }
  return { end, cut: songEnd - end, trims, removeIds };
}
