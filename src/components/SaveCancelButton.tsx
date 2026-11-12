import { useStore } from '@/store';
import { cancelCurrentSave, SAVE_CANCELLING } from '@/lib/projectQuickSave';

/** Cancelar do "Salvar" e do ⌘S: discreto, aparece só enquanto o projeto está sendo gravado. */
export default function SaveCancelButton({ className = '' }: { className?: string }) {
  const status = useStore((s) => s.saveStatus);
  if (status?.kind !== 'saving') return null;
  const cancelling = status.message === SAVE_CANCELLING;
  return (
    <button
      type="button"
      disabled={cancelling}
      onClick={(e) => { e.stopPropagation(); cancelCurrentSave(); }}
      className={`px-1.5 py-px rounded-sm text-[10px] text-logic-text-muted hover:text-logic-text border border-logic-border-light/60 hover:border-logic-text-muted transition-colors shrink-0 disabled:opacity-60 disabled:cursor-wait ${className}`}
      title="Parar o salvamento"
    >
      {cancelling ? 'Cancelando...' : 'Cancelar'}
    </button>
  );
}
