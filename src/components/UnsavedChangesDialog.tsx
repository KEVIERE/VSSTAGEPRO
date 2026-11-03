import { useEffect, useState } from 'react';
import { onSavePrompt, type SavePrompt } from '@/lib/unsavedChanges';

/** "Salvar as alterações?" antes de trocar o projeto aberto (abrir outro, novo projeto, atualizar). */
export default function UnsavedChangesDialog() {
  const [prompt, setPrompt] = useState<SavePrompt | null>(null);

  useEffect(() => onSavePrompt(setPrompt), []);

  // Com a pergunta na tela, os atalhos do app (espaço toca, Delete apaga música...) não valem.
  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        prompt.answer('cancel');
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
      aria-labelledby="vs-unsaved-title"
    >
      <div className="w-96 max-w-[92vw] bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
        <div className="px-4 pt-3 pb-2">
          <div id="vs-unsaved-title" className="text-sm font-medium text-logic-text mb-1">
            Salvar as alterações?
          </div>
          <p className="text-xs text-logic-text-dim leading-relaxed">
            O projeto “{prompt.projectName || 'Sem Nome'}” tem alterações que ainda não foram salvas.
            Se não salvar, elas serão perdidas.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            className="mr-auto px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text border border-logic-border-dark hover:bg-logic-bg-panel-light transition-colors"
            onClick={() => prompt.answer('discard')}
          >
            Não salvar
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text-muted border border-logic-border-dark hover:bg-logic-bg-panel-light hover:text-logic-text transition-colors"
            onClick={() => prompt.answer('cancel')}
          >
            Cancelar
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all"
            onClick={() => prompt.answer('save')}
            autoFocus
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
