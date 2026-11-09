import { useSyncExternalStore } from 'react';
import { Check, Loader2, Scissors, X } from 'lucide-react';
import { cancelClipStemSplit, dismissStemSplit, getStemSplitStatus, subscribeStemSplit } from '@/lib/clipStemSplit';

/** Painel no canto da tela enquanto a IA separa os stems de um áudio (clique direito → Separar stems). */
export default function StemSplitStatus() {
  const st = useSyncExternalStore(subscribeStemSplit, getStemSplitStatus);
  if (st.state === 'idle') return null;
  const working = st.state === 'working';
  const lit = st.state === 'error' ? 'is-on-amber' : 'is-on-green';
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[120] w-[320px] console-face rounded-lg border border-black shadow-2xl p-3 flex flex-col gap-2 animate-[fadeIn_150ms_ease-out]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`console-led ${lit} ${working ? 'animate-pulse' : ''}`} />
        <Scissors size={13} className="shrink-0 text-logic-text-dim" />
        <span className="console-legend shrink-0">Separar stems</span>
        <span className="flex-1 min-w-0 truncate text-[12px] text-logic-text-dim">{st.clipName}</span>
        {!working && (
          <button className="p-1 rounded text-logic-text-muted hover:text-logic-text" onClick={dismissStemSplit} aria-label="Fechar">
            <X size={13} />
          </button>
        )}
      </div>
      <p className={`text-[13px] leading-snug ${st.state === 'error' ? 'text-logic-lcd-amber' : 'text-logic-text'}`}>
        {working && <Loader2 size={12} className="inline mr-1.5 -mt-0.5 animate-spin" />}
        {st.state === 'done' && <Check size={13} className="inline mr-1 -mt-0.5 text-logic-lcd-green" />}
        {st.message}
      </p>
      {working && (
        <>
          <div className="led-bar h-1.5" aria-hidden>
            <div className="led-bar-fill" style={{ width: `${Math.max(3, st.percent)}%` }} />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-stage text-[13px] tabular-nums text-logic-text-dim">{Math.round(st.percent)}%</span>
            <button className="console-key h-7 px-3 text-[12px] hover:!text-logic-lcd-red" onClick={cancelClipStemSplit}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
