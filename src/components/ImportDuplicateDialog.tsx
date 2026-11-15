import { useEffect, useState } from 'react';
import { duplicateImportPrompt, type DuplicateImportPrompt } from '@/lib/appPrompt';

/** "A música já existe no projeto": pergunta da importação, sem parar o programa (era window.confirm). */
export default function ImportDuplicateDialog() {
  const [prompt, setPrompt] = useState<DuplicateImportPrompt | null>(null);

  useEffect(() => duplicateImportPrompt.register(setPrompt), []);

  // Com a pergunta na tela, os atalhos do app (espaço toca, Delete apaga música...) não valem.
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        prompt.answer(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [prompt]);

  if (!prompt) return null;

  return (
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vs-import-dup-title"
    >
      <div className="w-96 max-w-[92vw] bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
        <div className="px-4 pt-3 pb-2">
          <div id="vs-import-dup-title" className="text-sm font-medium text-logic-text mb-1">
            Música já existe
          </div>
          <p className="text-xs text-logic-text-dim leading-relaxed">
            A música “{prompt.songName}” já existe no projeto. Deseja importá-la novamente?
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-3">
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text-muted border border-logic-border-dark hover:bg-logic-bg-panel-light hover:text-logic-text transition-colors"
            onClick={() => prompt.answer(false)}
          >
            Pular
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all"
            onClick={() => prompt.answer(true)}
            autoFocus
          >
            Importar de novo
          </button>
        </div>
      </div>
    </div>
  );
}
