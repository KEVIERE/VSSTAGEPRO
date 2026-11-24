// Portão único do trabalho pesado de fundo (IA de tom, volume igual e, depois, o preparo das
// próximas músicas). Só libera com a música parada, nenhuma música abrindo, o Play já assentado
// (audioEngine.isSettling), a importação fora da decodificação, a pessoa sem clicar, teclar ou
// rolar há um instante e alguns segundos depois de o projeto abrir. Um trabalho por vez, na ordem
// em que pediram. Não muda o resultado de nada: só adia.
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { onAudioLibraryCleared } from '@/lib/audioLibrary';
import { setPlayingCheck } from '@/lib/yieldToUi';

/** Tempos do portão. Só os testes mudam estes valores. */
export const gateTiming = {
  /** Sem clique, tecla ou rolagem há este tempo. */
  inputIdleMs: 1500,
  /** Depois de abrir um projeto (ou o programa), espera este tempo antes do primeiro trabalho. */
  openSettleMs: 4000,
  /** Botão do mouse preso (soltou fora da janela, por exemplo) deixa de contar depois disto. */
  pressedMaxMs: 15_000,
  /** De quanto em quanto tempo reconfere o que não avisa sozinho (largada do Play). */
  pollMs: 250,
  /** Reconfere o estado da tela mesmo sem aviso, por segurança. */
  showRecheckMs: 5000,
  /** Clique, abertura e importação seguram no máximo este tempo somado (nada fica parado para sempre). */
  softCapMs: 60_000,
  /** Um trabalho que passou disto perde a vez (aviso no console), para a fila nunca travar. */
  leaseMaxMs: 10 * 60_000,
};

export interface BackgroundLease {
  /** Devolve a vez. Chamar sempre, num finally. */
  release(): void;
  /** O show precisa da vez (Play, música abrindo, largada) ou o projeto trocou: parar no próximo ponto seguro. */
  shouldStop(): boolean;
  /** O projeto trocou desde que a vez foi dada: o resultado não vale mais. */
  stale(): boolean;
}

export interface GateDeps {
  now(): number;
  /** Tocando ou abrindo música, pelo estado da tela: espera o próximo aviso do estado. */
  showBusy(): boolean;
  /** Avisa a cada mudança do estado da tela. */
  subscribe(fn: () => void): () => void;
  /** Motor tocando, largando ou logo depois de largar: não avisa, então é reconferido. */
  engineBusy(): boolean;
  /** Importação decodificando arquivos. */
  importBusy(): boolean;
}

export interface BackgroundGate {
  /** Espera a vez de um trabalho pesado. */
  acquire(): Promise<BackgroundLease>;
  /** Livre agora (sem contar a fila). */
  isFree(): boolean;
  /** Clique, tecla ou rolagem da pessoa. */
  noteInput(): void;
  /** Botão do mouse apertado (true) ou solto (false). */
  notePress(down: boolean): void;
  /** Projeto aberto, novo ou trocado. */
  noteProjectOpened(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, Math.max(0, ms)); });

export function createBackgroundGate(deps: GateDeps, timing: typeof gateTiming = gateTiming): BackgroundGate {
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let pressedAt: number | null = null;
  let openedAt = deps.now();
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();

  const hardBusy = () => deps.showBusy() || deps.engineBusy();

  /** Quanto falta pelas condições leves (0 ou menos: liberado). */
  function softWait(now: number): number {
    let wait = Math.max(lastInputAt + timing.inputIdleMs - now, openedAt + timing.openSettleMs - now);
    if (pressedAt !== null && now - pressedAt < timing.pressedMaxMs) wait = Math.max(wait, timing.pollMs);
    if (deps.importBusy()) wait = Math.max(wait, timing.pollMs);
    return wait;
  }

  /** Espera o próximo aviso do estado que tira o show da frente (ou o tempo de reconferir). */
  function showSettles(): Promise<void> {
    return new Promise<void>((resolve) => {
      let finished = false;
      let off: () => void = () => {};
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (finished) return;
        finished = true;
        off();
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(finish, timing.showRecheckMs);
      off = deps.subscribe(() => { if (!deps.showBusy()) finish(); });
      if (!deps.showBusy()) finish();
    });
  }

  async function waitFree(): Promise<void> {
    let softWaited = 0;
    for (;;) {
      if (deps.showBusy()) { await showSettles(); continue; }
      if (deps.engineBusy()) { await sleep(timing.pollMs); continue; }
      if (softWaited >= timing.softCapMs) return;
      const wait = softWait(deps.now());
      if (wait <= 0) return;
      const step = Math.min(Math.max(wait, 10), 1000);
      await sleep(step);
      softWaited += step;
    }
  }

  async function acquire(): Promise<BackgroundLease> {
    let open: () => void = () => {};
    const mine = new Promise<void>((resolve) => { open = resolve; });
    const before = tail;
    tail = before.then(() => mine);
    await before;
    try {
      await waitFree();
    } catch (err) {
      open();
      throw err;
    }
    const myGeneration = generation;
    let released = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (released) return;
      released = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      open();
    };
    watchdog = setTimeout(() => {
      if (released) return;
      console.warn('[fundo] um trabalho passou do tempo máximo; a vez passa para o próximo');
      release();
    }, timing.leaseMaxMs);
    return {
      release,
      shouldStop: () => released || generation !== myGeneration || hardBusy(),
      stale: () => generation !== myGeneration,
    };
  }

  return {
    acquire,
    isFree: () => !hardBusy() && softWait(deps.now()) <= 0,
    noteInput: () => { lastInputAt = deps.now(); },
    notePress: (down) => {
      const now = deps.now();
      lastInputAt = now;
      pressedAt = down ? now : null;
    },
    noteProjectOpened: () => {
      generation++;
      openedAt = deps.now();
    },
  };
}

// Estados da importação em que ela ainda está lendo e decodificando arquivos.
const IMPORT_WORKING = new Set(['decoding', 'detecting-bpm', 'classifying', 'routing']);

function songOnAir(): boolean {
  return useStore.getState().transport.isPlaying || audioEngine.isRunning();
}

export const backgroundGate: BackgroundGate = createBackgroundGate({
  now: () => performance.now(),
  showBusy: () => {
    const s = useStore.getState();
    return s.transport.isPlaying || s.loadingSongIds.length > 0;
  },
  subscribe: (fn) => useStore.subscribe(fn),
  engineBusy: () => audioEngine.isRunning() || audioEngine.isSettling(),
  importBusy: () => IMPORT_WORKING.has(useStore.getState().importProgress?.status ?? ''),
});

// Quem cede a vez à tela (yieldToUi) passa a saber se há música tocando.
setPlayingCheck(songOnAir);

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const opts = { passive: true, capture: true } as const;
  window.addEventListener('pointerdown', () => backgroundGate.notePress(true), opts);
  window.addEventListener('pointerup', () => backgroundGate.notePress(false), opts);
  window.addEventListener('pointercancel', () => backgroundGate.notePress(false), opts);
  window.addEventListener('blur', () => backgroundGate.notePress(false), opts);
  window.addEventListener('wheel', () => backgroundGate.noteInput(), opts);
  window.addEventListener('keydown', () => backgroundGate.noteInput(), opts);
}

// Projeto aberto ou novo: a biblioteca de áudio é limpa (store.loadProject e newProject). Liga
// depois de todos os módulos carregarem, para não depender da ordem de import.
let wired = false;
function wireProjectOpen() {
  if (wired) return;
  wired = true;
  onAudioLibraryCleared(() => backgroundGate.noteProjectOpened());
}
setTimeout(wireProjectOpen, 0);

/** Espera a vez de um trabalho pesado de fundo. Sempre chamar release() num finally. */
export function acquireBackgroundTurn(): Promise<BackgroundLease> {
  wireProjectOpen();
  return backgroundGate.acquire();
}
