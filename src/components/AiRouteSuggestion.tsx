// Janelinha do clique direito > "Reclassificar com IA": a IA ouviu o clipe e sugere a faixa
// ("Enviar para Violões"). Só muda o clipe de faixa quando a pessoa confirma.
import { memo, useEffect, useSyncExternalStore } from 'react';
import { Sparkles } from 'lucide-react';
import { useStore } from '@/store';
import { acceptAiSuggestion, currentAiSuggestion, dismissAiSuggestion, subscribeAiSuggestion } from '@/lib/aiRouter';

const AiRouteSuggestion = memo(function AiRouteSuggestion() {
  const s = useSyncExternalStore(subscribeAiSuggestion, currentAiSuggestion);
  const trackName = useStore((st) => (s ? st.tracks.find((t) => t.id === s.result.target)?.name : undefined));

  useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissAiSuggestion(); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); acceptAiSuggestion(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [s]);

  if (!s) return null;
  const dest = trackName ?? s.result.childName;
  return (
    <div
      role="dialog"
      aria-label="Sugestão da IA"
      className="fixed left-1/2 bottom-14 -translate-x-1/2 z-[60] w-[340px] max-w-[92vw] rounded-md border border-logic-border-light bg-logic-bg-panel shadow-logic-raised p-3.5 text-xs animate-[fadeIn_120ms_ease-out]"
    >
      <p className="flex items-center gap-1.5 text-logic-text-dim">
        <Sparkles size={12} className="text-logic-accent" />
        A IA ouviu <span className="text-logic-text truncate max-w-[160px]">"{s.clipName}"</span>
      </p>
      <p className="mt-1.5 text-sm text-logic-text">
        Parece <b>{s.result.childName}</b>{dest !== s.result.childName ? <> (faixa {dest})</> : null}.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          autoFocus
          onClick={acceptAiSuggestion}
          className="flex-1 px-3 py-1.5 rounded bg-logic-accent text-white font-semibold hover:brightness-110"
        >
          Enviar para {dest}
        </button>
        <button
          type="button"
          onClick={dismissAiSuggestion}
          className="px-3 py-1.5 rounded border border-logic-border-light text-logic-text-dim hover:text-logic-text"
        >
          Deixar onde está
        </button>
      </div>
    </div>
  );
});

export default AiRouteSuggestion;
