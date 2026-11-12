import type { LyricPage } from '@/lib/prompterTypes';

/**
 * Tela do palco: tamanho da letra e a rolagem de karaokê entre os trechos (StageScreen).
 * Sem React aqui, para dar para testar (tests/karaoke.test.mjs).
 */

/** Tamanho da letra (cqh) que faz o trecho caber na tela. */
export function fitSize(text: string, scale: number): number {
  const lines = text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const byLines = 52 / Math.max(2, lines.length);
  const byWidth = 150 / longest;
  return Math.max(3.2, Math.min(11, byLines, byWidth)) * scale;
}

export const KARAOKE_MS = 520;
export const LINE_HEIGHT = 1.2;
/** Tamanho da prévia (o próximo trecho) e do trecho que está saindo, em relação ao atual. */
const NEXT_SCALE = 0.42;
const GONE_SCALE = 0.55;
/** Respiro (cqh) entre o trecho do centro e a prévia. */
const GAP = 5;

export type KaraokeSlot = 'gone' | 'center' | 'below';

/** Altura aproximada (cqh) de um trecho no tamanho cheio. */
export function textHeight(text: string, scale: number): number {
  return fitSize(text, scale) * Math.max(1, text.split('\n').length) * LINE_HEIGHT;
}

/** Meia altura (cqh) da área da letra na tela do palco: medida, 412 px numa tela de 558 px (74%). */
export const HALF_AREA = 36;

/**
 * Onde cada trecho fica na tela: o anterior acima (saindo), o atual e o próximo (pequeno, embaixo).
 * O par "atual + prévia" fica centralizado na área da letra, para os dois caberem sempre; sem
 * prévia (último trecho), o atual fica no centro. O que sai vai para cima do atual, sem cruzar
 * com ele. Se o trecho atual for grande demais para caber com a prévia, a prévia fica cortada
 * embaixo (ela é só uma dica), nunca o atual.
 */
export function karaokeSlots(pages: LyricPage[], idx: number, fontScale: number, half = HALF_AREA) {
  const cur = pages[idx];
  const hCur = textHeight(cur.text, fontScale);
  const next = pages[idx + 1];
  const hNext = next ? textHeight(next.text, fontScale) * NEXT_SCALE : 0;
  // centro do trecho atual: o par centralizado, sem deixar o topo do atual sair da tela
  const pair = next ? hCur + GAP + hNext : hCur;
  const center = Math.max(-half + hCur / 2, -pair / 2 + hCur / 2);
  const out: { page: LyricPage; slot: KaraokeSlot; offset: number; scale: number; opacity: number }[] = [];
  const prev = pages[idx - 1];
  if (prev) {
    const offset = center - hCur / 2 - GAP * 2 - (textHeight(prev.text, fontScale) * GONE_SCALE) / 2;
    out.push({ page: prev, slot: 'gone', offset, scale: GONE_SCALE, opacity: 0 });
  }
  out.push({ page: cur, slot: 'center', offset: center, scale: 1, opacity: 1 });
  if (next) {
    out.push({ page: next, slot: 'below', offset: center + hCur / 2 + GAP + hNext / 2, scale: NEXT_SCALE, opacity: 0.32 });
  }
  return out;
}
