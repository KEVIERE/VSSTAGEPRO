import { useState, useSyncExternalStore } from 'react';
import { diskLagHint, diskLagLabel, getDiskLag, subscribeDiskLag } from '@/lib/diskLag';

/**
 * Etiqueta pequena no canto: faixa esperando o áudio do disco (só depois do tempo de espera).
 * Some sozinha quando o áudio chega; um clique esconde até outra faixa atrasar.
 */
export default function DiskLagNotice({ className = '' }: { className?: string }) {
  const names = useSyncExternalStore(subscribeDiskLag, getDiskLag);
  const [hidden, setHidden] = useState<readonly string[] | null>(null);
  if (names.length === 0 || hidden === names) return null;
  return (
    <button
      type="button"
      role="status"
      aria-live="polite"
      title={`${diskLagHint(names)} Clique para esconder.`}
      onClick={() => setHidden(names)}
      className={`console-face flex items-center gap-1.5 h-6 max-w-[260px] px-2 rounded border border-black shadow-lg animate-[fadeIn_150ms_ease-out] ${className}`}
    >
      <span className="console-led is-on-amber animate-pulse shrink-0" />
      <span className="console-legend !text-logic-lcd-amber uppercase shrink-0">Disco atrasado</span>
      <span className="min-w-0 truncate text-[11px] text-logic-text-dim">{diskLagLabel(names)}</span>
    </button>
  );
}
