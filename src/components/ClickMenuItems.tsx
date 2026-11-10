import { clickAddBlocker, isClickToolRunning, startClickTool, type ClickToolKind } from '@/lib/clickTools';

interface ClickMenuItemsProps {
  songId: string | null;
  onClose: () => void;
  /** Classe dos botões, para seguir o visual de cada menu. */
  itemClass: string;
}

const ITEMS: { kind: ClickToolKind; label: string; tip: string }[] = [
  { kind: 'bar', label: 'Adicionar um compasso antes do início', tip: 'Empurra o VS inteiro 1 compasso para a direita e põe 1 compasso de click antes' },
  { kind: 'remake', label: 'Recriar metrônomo', tip: 'Usa o click desta faixa como guia e troca o som pelo metrônomo padrão do VS Stage, batida por batida' },
];

/** Os comandos do click, nos menus de botão direito da faixa Click e do clipe de click. */
export default function ClickMenuItems({ songId, onClose, itemClass }: ClickMenuItemsProps) {
  const busy = isClickToolRunning();
  return (
    <>
      {ITEMS.map((item) => {
        const blocker = !songId ? 'Abra uma música primeiro'
          : busy ? 'Já há um comando do click em andamento'
            : clickAddBlocker(songId, item.kind);
        return (
          <button
            key={item.kind}
            type="button"
            className={itemClass}
            disabled={!!blocker}
            title={blocker ?? item.tip}
            onClick={(e) => {
              e.stopPropagation();
              if (songId) void startClickTool(songId, item.kind);
              onClose();
            }}
          >
            <span>{item.label}</span>
          </button>
        );
      })}
    </>
  );
}
