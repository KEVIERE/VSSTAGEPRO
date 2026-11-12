import { Timer, Type } from 'lucide-react';

const LEAD_MAX = 3;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;

/** Botões − valor + no estilo da mesa. */
function Stepper({ label, onMinus, onPlus, minusOff, plusOff, minusLabel, plusLabel }: {
  label: string; onMinus: () => void; onPlus: () => void; minusOff: boolean; plusOff: boolean; minusLabel: string; plusLabel: string;
}) {
  return (
    <span className="flex items-center h-8 rounded-md border-2 border-black bg-black/40 overflow-hidden shrink-0">
      <button onClick={onMinus} disabled={minusOff} className="w-8 h-full text-logic-text-dim hover:text-logic-text hover:bg-white/5 disabled:opacity-30" aria-label={minusLabel}>−</button>
      <span className="font-stage text-xs tabular-nums text-logic-lcd-amber min-w-[46px] text-center">{label}</span>
      <button onClick={onPlus} disabled={plusOff} className="w-8 h-full text-logic-text-dim hover:text-logic-text hover:bg-white/5 disabled:opacity-30" aria-label={plusLabel}>+</button>
    </span>
  );
}

/**
 * Ajustes gerais da letra, para todas as músicas do show (ficam no topo da aba Letras, fora das
 * músicas e das páginas):
 * - Tamanho da letra: o tamanho geral. Página com tamanho próprio aplica o dela por cima deste.
 * - Atraso da tela sem fio: a letra sai esse tempo antes da hora marcada (PrompterState.lyricLead).
 *   Uma configuração só; nenhuma página ou música tem valor próprio.
 */
export default function LyricLeadControl({ lead, onLead, scale, onScale }: {
  lead: number; onLead: (seconds: number) => void;
  scale: number; onScale: (scale: number) => void;
}) {
  const setLead = (v: number) => onLead(Math.round(Math.min(LEAD_MAX, Math.max(0, v)) * 10) / 10);
  const setScale = (v: number) => onScale(Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)) * 100) / 100);
  const leadText = lead.toFixed(1).replace('.', ',');
  return (
    <div className="rounded-lg border border-logic-border bg-logic-bg-panel px-3 py-2">
      <p className="console-legend !text-[10px] mb-1.5">Toda a letra · vale para todas as músicas</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2" title="Tamanho geral da letra na TV. Página com tamanho próprio aplica o dela por cima deste.">
          <Type size={14} className="text-logic-lcd-amber shrink-0" />
          <span className="text-xs text-logic-text">Tamanho</span>
          <Stepper
            label={`${Math.round(scale * 100)}%`}
            onMinus={() => setScale(scale - 0.1)} onPlus={() => setScale(scale + 0.1)}
            minusOff={scale <= MIN_SCALE} plusOff={scale >= MAX_SCALE}
            minusLabel="Diminuir a letra de todas as músicas" plusLabel="Aumentar a letra de todas as músicas"
          />
        </span>
        <span
          className="flex items-center gap-2"
          title="A tela sem fio do palco mostra a imagem com um pequeno atraso. A letra de todas as músicas sai esse tempo antes da hora marcada, para chegar na TV no momento certo."
        >
          <Timer size={14} className="text-logic-lcd-amber shrink-0" />
          <span className="text-xs text-logic-text">Atraso da tela sem fio: sai antes</span>
          <Stepper
            label={`${leadText} s`}
            onMinus={() => setLead(lead - 0.1)} onPlus={() => setLead(lead + 0.1)}
            minusOff={lead <= 0} plusOff={lead >= LEAD_MAX}
            minusLabel="Letra sai menos antes" plusLabel="Letra sai mais antes"
          />
        </span>
      </div>
    </div>
  );
}
