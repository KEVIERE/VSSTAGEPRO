import { useEffect, useRef } from 'react';

// Animações que seguem a rolagem do site. Um único "relógio" (requestAnimationFrame) mede só os
// blocos que estão perto da tela e escreve dois números no próprio elemento, como variáveis CSS:
//   --p   0 quando o topo do bloco aparece embaixo da tela, 1 quando a base some por cima;
//   --sp  progresso dentro de uma cena "grudada" (bloco mais alto que a tela): 0 quando o topo
//         encosta no topo da tela, 1 quando a base encosta na base. Em blocos baixos, vai de 0
//         (topo embaixo da tela) a 1 (topo no topo da tela).
// O CSS usa esses números para mexer as coisas; assim o React não precisa redesenhar nada.

export type ScrollProgress = { p: number; sp: number };
type VarNames = { p: string; sp: string };
type Entry = { el: HTMLElement; near: boolean; vars: VarNames; cb?: (pr: ScrollProgress) => void };
const DEFAULT_VARS: VarNames = { p: '--p', sp: '--sp' };

const entries = new Set<Entry>();
let ticking = false;
let listening = false;
let io: IntersectionObserver | null = null;

const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function measure() {
  ticking = false;
  const vh = window.innerHeight || 800;
  entries.forEach((e) => {
    if (!e.near) return;
    const r = e.el.getBoundingClientRect();
    const p = clamp((vh - r.top) / (vh + r.height));
    const sp = r.height > vh * 1.05 ? clamp(-r.top / (r.height - vh)) : clamp((vh - r.top) / vh);
    e.el.style.setProperty(e.vars.p, p.toFixed(4));
    e.el.style.setProperty(e.vars.sp, sp.toFixed(4));
    e.cb?.({ p, sp });
  });
}

function request() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(measure);
}

function start() {
  if (listening) return;
  listening = true;
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver((list) => {
      list.forEach((it) => {
        entries.forEach((e) => { if (e.el === it.target) e.near = it.isIntersecting; });
      });
      request();
    }, { rootMargin: '25% 0px 25% 0px' });
  }
}

function stop() {
  if (!listening || entries.size) return;
  listening = false;
  window.removeEventListener('scroll', request);
  window.removeEventListener('resize', request);
  io?.disconnect();
  io = null;
}

function register(el: HTMLElement, vars: VarNames, cb?: (pr: ScrollProgress) => void) {
  start();
  // sem IntersectionObserver (navegador muito antigo), mede sempre
  const entry: Entry = { el, near: !io, vars, cb };
  entries.add(entry);
  io?.observe(el);
  request();
  return () => {
    entries.delete(entry);
    io?.unobserve(el);
    stop();
  };
}

/**
 * Liga um elemento ao relógio da rolagem. `onProgress` é opcional (para trocar de passo, por exemplo).
 * `vars` troca o nome das variáveis CSS (útil num elemento dentro de outra cena, para não esconder
 * o --sp que vem de fora).
 */
export function useScrollScene<T extends HTMLElement = HTMLDivElement>(onProgress?: (pr: ScrollProgress) => void, vars: VarNames = DEFAULT_VARS) {
  const ref = useRef<T>(null);
  const cb = useRef(onProgress);
  cb.current = onProgress;
  const names = useRef(vars);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return register(el, names.current, (pr) => cb.current?.(pr));
  }, []);
  return ref;
}

/** true quando a pessoa pediu ao sistema para reduzir animações. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
