import { useState } from 'react';
import { Check, UserPlus, X } from 'lucide-react';
import { directorRemoveMusician, directorSetStatus } from '@/lib/musicianApi';
import type { DirectorMusician } from '@/lib/musicianTypes';
import { friendlyError } from '@/lib/friendlyError';

/**
 * Aviso no topo do programa quando um músico pede para entrar no show (só na primeira vez dele).
 * O diretor aceita ou recusa ali mesmo, sem abrir o Show online; aparece também no Modo Show.
 */
export default function JoinRequestsBanner({ show, pending, onChanged, onOpenList }: {
  show: { showId: string; directorKey: string } | null;
  pending: DirectorMusician[];
  onChanged: () => void;
  onOpenList: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!show || pending.length === 0) return null;
  const m = pending[0];
  const more = pending.length - 1;

  const decide = async (accept: boolean) => {
    setBusyId(m.id); setError(null);
    try {
      if (accept) await directorSetStatus(show.showId, show.directorKey, m.id, 'approved');
      else await directorRemoveMusician(show.showId, show.directorKey, m.id);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  };

  const busy = busyId === m.id;
  return (
    <div
      role="status"
      className="console-rail flex items-center gap-3 px-3 py-1.5 border-b border-black animate-[fadeIn_200ms_ease-out]"
    >
      <span className="console-led is-on-amber animate-pulse shrink-0" />
      <UserPlus size={14} className="shrink-0 text-logic-lcd-amber" />
      <p className="flex-1 min-w-0 truncate text-[13px] text-logic-text">
        <span className="font-semibold text-logic-lcd-amber">{m.name}</span>
        {m.instrument && <span className="text-logic-text-dim"> ({m.instrument})</span>}
        {' '}criou a conta e pediu para entrar no show.
        {more > 0 && (
          <button className="ml-2 underline text-logic-text-dim hover:text-logic-text" onClick={onOpenList}>
            e mais {more} {more === 1 ? 'pedido' : 'pedidos'}
          </button>
        )}
        {error && <span className="ml-2 text-logic-lcd-red">{error}</span>}
      </p>
      <button
        className="console-key is-lit-green flex items-center gap-1 h-7 px-3 text-[13px] disabled:opacity-50"
        onClick={() => decide(true)}
        disabled={busy}
      >
        <Check size={13} /> Aceitar
      </button>
      <button
        className="console-key flex items-center gap-1 h-7 px-3 text-[13px] hover:!text-logic-lcd-red disabled:opacity-50"
        onClick={() => decide(false)}
        disabled={busy}
      >
        <X size={13} /> Recusar
      </button>
    </div>
  );
}
