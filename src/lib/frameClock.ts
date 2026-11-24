import { useEffect, useRef, type RefObject } from 'react';
import { useStore } from '@/store';

/**
 * Relógio de quadro único das barras de progresso e dos contadores de tempo.
 *
 * Antes cada barra (transporte, playlist, Modo Show) e cada contador de "falta" tinha o seu
 * requestAnimationFrame, que nunca dormia: com a música parada a tela continuava trabalhando a
 * cada quadro. Agora um laço só anda enquanto a música toca. Parado, ele dorme e acorda por um
 * quadro quando o store muda (Play, Stop, cursor arrastado, música trocada), o suficiente para
 * as barras e os contadores mostrarem o valor certo. Nenhuma conta de posição muda aqui: quem
 * assina continua lendo o relógio do áudio como antes.
 */

export type FrameFn = (now: number) => void;

export interface FrameClock {
  /** Chama `fn` a cada quadro em que o relógio anda (e no primeiro quadro depois de assinar). */
  subscribe(fn: FrameFn): () => void;
  /** Pede pelo menos mais um quadro (não faz nada se já há um pedido). */
  wake(): void;
  /** Há um quadro pedido? */
  running(): boolean;
}

export interface FrameClockDeps {
  raf: (cb: (now: number) => void) => number;
  caf: (id: number) => void;
  /** Depois deste quadro, continua andando? (música tocando) */
  isActive: () => boolean;
}

export function createFrameClock(deps: FrameClockDeps): FrameClock {
  const subs = new Set<FrameFn>();
  let id = 0;
  const loop = (now: number) => {
    id = 0;
    for (const fn of subs) {
      try { fn(now); } catch (err) { console.error('[frameClock]', err); }
    }
    if (subs.size > 0 && deps.isActive()) id = deps.raf(loop);
  };
  const wake = () => {
    if (id === 0 && subs.size > 0) id = deps.raf(loop);
  };
  return {
    subscribe(fn) {
      subs.add(fn);
      wake();
      return () => {
        subs.delete(fn);
        if (subs.size === 0 && id !== 0) {
          deps.caf(id);
          id = 0;
        }
      };
    },
    wake,
    running: () => id !== 0,
  };
}

/**
 * Preenchimento da barra por transform, sem mexer na largura (largura refaz o layout a cada
 * quadro). A barra cheia é empurrada para fora do contêiner, que corta com overflow hidden.
 * `fromRight`: a barra enche a partir da direita (a ampulheta da Próxima).
 */
export function fillTransform(pct: number, fromRight = false): string {
  const p = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const shift = fromRight ? 100 - p : p - 100;
  return `translateX(${shift.toFixed(2)}%)`;
}

let shared: FrameClock | null = null;

/** O relógio da tela (um só para o programa inteiro). */
export function frameClock(): FrameClock {
  if (shared) return shared;
  const clock = createFrameClock({
    raf: (cb) => requestAnimationFrame(cb),
    caf: (n) => cancelAnimationFrame(n),
    isActive: () => useStore.getState().transport.isPlaying,
  });
  useStore.subscribe((s, p) => {
    if (s.transport !== p.transport || s.songs !== p.songs || s.selectedSongId !== p.selectedSongId || s.playlist !== p.playlist) {
      clock.wake();
    }
  });
  shared = clock;
  return clock;
}

/** Roda `fn` no relógio de quadro enquanto o componente está montado. */
export function useFrame(fn: FrameFn): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => frameClock().subscribe((now) => ref.current(now)), []);
}

/** Barra de progresso ao vivo: escreve o transform do elemento só quando o valor muda. */
export function useLiveFill(target: RefObject<HTMLElement>, read: () => number, fromRight = false): void {
  const last = useRef('');
  useFrame(() => {
    const el = target.current;
    if (!el) return;
    const next = fillTransform(read(), fromRight);
    if (next === last.current) return;
    last.current = next;
    el.style.transform = next;
  });
}
