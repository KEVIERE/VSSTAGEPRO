// Perguntas do app em janela própria, respondidas por Promise. window.confirm e alert param o
// programa inteiro enquanto estão na tela (a tela deixa de alimentar o áudio e a música engasga);
// aqui a pergunta aparece numa janela do React e o resto do programa segue rodando.

export type PromptShower<P> = (prompt: P | null) => void;

export interface PromptChannel<P, R> {
  /** A janela se registra aqui ao montar; devolve a função de saída. */
  register(show: PromptShower<P>): () => void;
  /**
   * Faz a pergunta. `build` monta o que a janela mostra e recebe `answer`.
   * Sem janela montada, espera até `waitMs` por ela; se não aparecer, devolve `fallback`.
   */
  ask(build: (answer: (r: R) => void) => P, fallback: R): Promise<R>;
}

interface Pending<P, R> {
  build: (answer: (r: R) => void) => P;
  resolve: (r: R) => void;
  fallback: R;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createPromptChannel<P, R>(waitMs = 3000): PromptChannel<P, R> {
  let show: PromptShower<P> | null = null;
  // uma pergunta por vez na tela; as outras esperam na fila
  let current: { item: Pending<P, R>; shower: PromptShower<P>; finish: (r: R) => void } | null = null;
  const queue: Pending<P, R>[] = [];

  // sem janela, cada pergunta da fila espera no máximo waitMs; com janela, espera a vez dela
  const arm = (item: Pending<P, R>) => {
    if (item.timer !== null) return;
    item.timer = setTimeout(() => {
      item.timer = null;
      const i = queue.indexOf(item);
      if (i < 0) return;
      queue.splice(i, 1);
      item.resolve(item.fallback);
    }, waitMs);
  };
  const disarm = (item: Pending<P, R>) => {
    if (item.timer !== null) clearTimeout(item.timer);
    item.timer = null;
  };

  const pump = () => {
    if (current || !show) return;
    const item = queue.shift();
    if (!item) return;
    const shower = show;
    let done = false;
    const finish = (r: R) => {
      if (done) return;
      done = true;
      current = null;
      shower(null);
      item.resolve(r);
      pump();
    };
    current = { item, shower, finish };
    shower(item.build(finish));
  };

  return {
    register(fn) {
      show = fn;
      queue.forEach(disarm);
      pump();
      return () => {
        if (show !== fn) return;
        show = null;
        queue.forEach(arm);
        // a janela saiu com a pergunta aberta: ninguém mais responderia
        if (current && current.shower === fn) current.finish(current.item.fallback);
      };
    },
    ask(build, fallback) {
      return new Promise<R>((resolve) => {
        const item: Pending<P, R> = { build, resolve, fallback, timer: null };
        queue.push(item);
        if (!show) arm(item);
        pump();
      });
    },
  };
}

export interface DuplicateImportPrompt {
  songName: string;
  answer: (importAgain: boolean) => void;
}

/** "A música já existe no projeto. Importar de novo?" (ImportDuplicateDialog responde). */
export const duplicateImportPrompt = createPromptChannel<DuplicateImportPrompt, boolean>();

/** Sem a janela na tela, não importa de novo (o mesmo que responder "Pular"). */
export function askImportAgain(songName: string): Promise<boolean> {
  return duplicateImportPrompt.ask((answer) => ({ songName, answer }), false);
}

export interface MidiImportOption {
  fileName: string;
  /** Resumo do que o arquivo traz; null quando ele não pôde ser lido. */
  summary: import('./midiSong.ts').MidiSummary | null;
  error?: string;
}

/** Resposta: qual MIDI ler (e se o SMPTE offset desloca o MIDI), ou null para ignorar. */
export type MidiImportAnswer = { index: number; applySmpte: boolean } | null;

export interface MidiImportPrompt {
  songName: string;
  /** Músicas que a resposta vale (projeto do REAPER com várias músicas). */
  songCount: number;
  options: MidiImportOption[];
  answer: (r: MidiImportAnswer) => void;
}

/** "O VS veio com arquivo MIDI. Ler o MIDI?" (MidiImportDialog responde). */
export const midiImportPrompt = createPromptChannel<MidiImportPrompt, MidiImportAnswer>();

/** Sem a janela na tela, o MIDI fica de fora e a importação segue como sempre. */
export function askMidiImport(prompt: Omit<MidiImportPrompt, 'answer'>): Promise<MidiImportAnswer> {
  return midiImportPrompt.ask((answer) => ({ ...prompt, answer }), null);
}
