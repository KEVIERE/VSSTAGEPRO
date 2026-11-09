import { useMemo, useState } from 'react';
import { ClipboardPaste, X } from 'lucide-react';
import { linesFromChordText, type NotebookLine } from '@/lib/notebook';

const EXAMPLE = `[Intro] G  D  Em  C

[Primeira Parte]
G              D
Quão grande és tu
       Em        C
Meu Deus e Senhor

Ou com acordes no texto: Eu [G]sei que [D]vais`;

/** Cola uma cifra em texto (de site, WhatsApp ou bloco de notas) e transforma em linhas do caderno. */
export default function PasteChordsDialog({ onClose, onInsert }: {
  onClose: () => void;
  onInsert: (lines: NotebookLine[]) => void;
}) {
  const [text, setText] = useState('');
  const lines = useMemo(() => linesFromChordText(text), [text]);
  const chords = lines.reduce((n, l) => n + (l.kind === 'chords' ? l.chords.length : 0), 0);
  const sections = lines.filter((l) => l.kind === 'section').length;
  const lyricRows = lines.filter((l) => l.kind === 'chords' && l.lyric).length;

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch { /* sem permissão: o músico cola com o teclado */ }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6 animate-[fadeIn_140ms_ease-out]" onClick={onClose}>
      <div className="w-full max-w-lg max-h-full flex flex-col rounded-xl bg-logic-bg-panel border border-logic-border-light shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <p className="text-sm font-semibold text-logic-text">Colar cifra</p>
          <button onClick={onClose} title="Fechar" className="p-1 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors"><X size={15} /></button>
        </div>
        <p className="px-4 text-xs text-logic-text-muted leading-relaxed">
          Cole a cifra de um site, do WhatsApp ou do bloco de notas. Os acordes de cima vão para as palavras certas da letra, e as seções viram títulos.
        </p>
        <div className="px-4 pt-3 flex-1 min-h-0 flex flex-col">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            spellCheck={false}
            className="w-full flex-1 min-h-[220px] resize-none rounded-lg bg-black/30 border border-logic-border-dark focus:border-logic-accent outline-none p-3 text-[13px] leading-snug text-logic-text font-mono whitespace-pre overflow-auto logic-scroll"
          />
          <div className="flex items-center gap-2 mt-2 text-2xs text-logic-text-muted min-h-[18px]">
            {text.trim()
              ? <span>{lyricRows} {lyricRows === 1 ? 'linha' : 'linhas'} de letra · {chords} {chords === 1 ? 'acorde' : 'acordes'} · {sections} {sections === 1 ? 'seção' : 'seções'}</span>
              : <span>Dica: use letra de largura fixa para os acordes ficarem alinhados.</span>}
          </div>
        </div>
        <div className="flex gap-2 p-4 pt-3">
          <button onClick={pasteFromClipboard} className="h-9 px-3 rounded-lg bg-logic-bg-deep border border-logic-border-dark text-xs font-semibold text-logic-text-dim hover:text-logic-text transition-colors flex items-center gap-1.5">
            <ClipboardPaste size={14} /> Colar
          </button>
          <span className="flex-1" />
          <button onClick={onClose} className="h-9 px-3 rounded-lg bg-logic-bg-deep border border-logic-border-dark text-xs font-semibold text-logic-text-dim hover:text-logic-text transition-colors">Cancelar</button>
          <button
            onClick={() => onInsert(lines)}
            disabled={!lines.length}
            className="h-9 px-4 rounded-lg bg-logic-accent text-white text-xs font-semibold hover:brightness-110 active:scale-95 transition-all disabled:opacity-40"
          >
            Colocar no caderno
          </button>
        </div>
      </div>
    </div>
  );
}
