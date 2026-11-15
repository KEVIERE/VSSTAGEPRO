import { Music2 } from 'lucide-react';
import type { SongGroup } from '@/lib/importManager';

const songCount = (n: number) => (n === 1 ? '1 música' : `${n} músicas`);

/** Lista das músicas encontradas, com Cancelar e o botão de confirmar. */
export default function SongGroupsConfirm({
  groups,
  notice,
  intro,
  confirmLabel,
  cancelLabel = 'Cancelar',
  onCancel,
  onConfirm,
}: {
  groups: SongGroup[];
  notice?: string;
  /** Frase acima da lista; recebe "1 música" ou "N músicas". */
  intro: (count: string) => React.ReactNode;
  confirmLabel: (count: string) => string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = songCount(groups.length);
  return (
    <div className="flex flex-col gap-3">
      {groups.length === 0 ? (
        <p className="text-xs text-logic-text-dim leading-relaxed">
          {notice ?? 'Não encontrei nenhum arquivo de áudio nessa pasta. Confira se escolheu a pasta certa.'}
        </p>
      ) : (
        <>
          <p className="text-xs text-logic-text-dim">{intro(count)}</p>
          <ul className="max-h-64 overflow-y-auto logic-scroll rounded border border-logic-border-dark bg-logic-bg-deep divide-y divide-logic-border-dark">
            {groups.map((g, i) => (
              <li key={`${i}-${g.name}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="w-5 text-right text-logic-text-muted tabular-nums">{i + 1}</span>
                <Music2 size={12} className="text-logic-text-muted shrink-0" />
                <span className="flex-1 truncate text-logic-text">{g.name}</span>
                <span className="text-2xs text-logic-text-muted">{g.files.length} {g.files.length === 1 ? 'áudio' : 'áudios'}</span>
              </li>
            ))}
          </ul>
          {notice && <p className="text-2xs text-logic-text-muted leading-relaxed">{notice}</p>}
        </>
      )}
      <div className="flex justify-end gap-2">
        <button className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text-muted border border-logic-border-dark hover:bg-logic-bg-panel-light hover:text-logic-text transition-colors" onClick={onCancel}>
          {cancelLabel}
        </button>
        {groups.length > 0 && (
          <button className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white hover:brightness-110 transition-all" onClick={onConfirm}>
            {confirmLabel(count)}
          </button>
        )}
      </div>
    </div>
  );
}
