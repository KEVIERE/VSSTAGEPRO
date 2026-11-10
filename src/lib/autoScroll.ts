// "Rolar sozinho" do Modo show da Área do Músico: onde a cifra (ou as fotos da partitura) deve
// estar em cada ponto da música, na velocidade que o músico escolheu.
// Código puro (sem React), para rodar nos testes.

/** Velocidades da tecla − / +. 1x: a cifra inteira passa ao longo da música. */
export const SCROLL_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const DEFAULT_SCROLL_SPEED = 1;

/** A linha que está tocando fica a um terço da tela: dá para ler o que vem logo abaixo. */
export const READ_LEAD = 1 / 3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Velocidade guardada no aparelho; qualquer coisa estranha volta para 1x. */
export function parseScrollSpeed(raw: string | null | undefined): number {
  const v = Number(raw);
  return (SCROLL_SPEEDS as readonly number[]).includes(v) ? v : DEFAULT_SCROLL_SPEED;
}

/** Próxima velocidade da lista (dir 1 = mais rápido), parando nas pontas. */
export function stepScrollSpeed(current: number, dir: 1 | -1): number {
  const list = SCROLL_SPEEDS as readonly number[];
  let i = list.indexOf(current);
  if (i < 0) i = list.indexOf(DEFAULT_SCROLL_SPEED);
  return list[clamp(i + dir, 0, list.length - 1)];
}

/** "1x", "1,25x", "0,5x" (vírgula, como se escreve no Brasil). */
export function scrollSpeedLabel(speed: number): string {
  return `${String(speed).replace('.', ',')}x`;
}

/**
 * Posição da rolagem (px) para o ponto `progress` (0 a 1) da música.
 * @param content tamanho total do conteúdo (scrollHeight, ou scrollWidth nas fotos lado a lado)
 * @param view    tamanho da parte visível (clientHeight / clientWidth)
 * @param speed   1 = a cifra inteira ao longo da música; 2 = na metade do tempo
 * @param offset  ajuste do músico: quando ele rola com o dedo, a rolagem segue dali (offsetFor)
 */
export function scrollTarget(progress: number, content: number, view: number, speed: number, offset = 0): number {
  const max = Math.max(0, content - view);
  if (!(max > 0)) return 0;
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  return clamp(p * content * speed - view * READ_LEAD + offset, 0, max);
}

/** O ajuste que faz a rolagem continuar de `pos` (onde o músico deixou com o dedo). */
export function offsetFor(pos: number, progress: number, content: number, view: number, speed: number): number {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  return pos - (p * content * speed - view * READ_LEAD);
}

/** Pulo maior que isto (fração da música) entre duas leituras é o diretor mudando de ponto. */
export const SEEK_JUMP = 0.05;

/**
 * O diretor pulou para outro ponto da música (voltou ao começo, repetiu um trecho, avançou):
 * o ajuste do músico e da troca de velocidade deixa de valer e a rolagem segue a música de novo.
 * O relógio normal anda bem menos que isso entre duas leituras.
 */
export function directorJumped(prevProgress: number | null, progress: number): boolean {
  return prevProgress !== null && Math.abs(progress - prevProgress) > SEEK_JUMP;
}

/**
 * Velocidade trocada no meio da música: o ajuste que mantém a rolagem no mesmo ponto (sem pular)
 * e daí em diante anda na velocidade nova.
 */
export function respeedOffset(offset: number, progress: number, content: number, oldSpeed: number, newSpeed: number): number {
  const p = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  return offset + p * content * (oldSpeed - newSpeed);
}

/**
 * Aproxima `current` de `target` sem tranco: o relógio do diretor chega 4 vezes por segundo e
 * a tela desenha 60; isto preenche os quadros do meio. `tauMs` é o tempo de reação.
 */
export function easeToward(current: number, target: number, dtMs: number, tauMs = 300): number {
  if (!(dtMs > 0)) return current;
  const k = 1 - Math.exp(-dtMs / tauMs);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < 0.5 ? target : next;
}
