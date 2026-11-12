import { X } from 'lucide-react';
import { useStore } from '@/store';
import { cancelCurrentSave, SAVE_CANCELLING } from '@/lib/projectQuickSave';

/** Cancelar do "Salvar" e do ⌘S: aparece só enquanto o projeto está sendo gravado. */
export default function SaveCancelButton({ className = '' }: { className?: string }) {
  const status = useStore((s) => s.saveStatus);
  if (status?.kind !== 'saving') return null;
  const cancelling = status.message === SAVE_CANCELLING;
  return (
    <button
      type="button"
      disabled={cancelling}
      onClick={(e) => { e.stopPropagation(); cancelCurrentSave(); }}
      className={`px-2 py-0.5 rounded text-[10px] font-bold bg-logic-lcd-red/20 text-logic-lcd-red hover:bg-logic-lcd-red/35 border border-logic-lcd-red/40 transition flex items-center gap-1 shrink-0 disabled:opacity-60 disabled:cursor-wait ${className}`}
      title="Parar o salvamento"
    >
      <X size={10} />
      {cancelling ? 'Cancelando...' : 'Cancelar'}
    </button>
  );
}
