import { Send, Megaphone } from 'lucide-react';
import type { PrompterState } from '@/lib/prompterTypes';
import { withNotice } from '@/lib/prompterView';

/** Atalho da aba Tela: manda um aviso pronto para a TV com um toque (faixa inferior, até tirar). */
export default function QuickNotices({ state, update, now, onManage }: {
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  now: number;
  onManage: () => void;
}) {
  const active = state.notice;
  const remaining = active && active.durationSec > 0 ? Math.ceil(active.durationSec - (now - active.sentAt) / 1000) : null;
  const live = active && (remaining === null || remaining > 0) ? active : null;

  return (
    <div className="space-y-2">
      {live && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-logic-lcd-amber/70 bg-logic-lcd-amber/10 animate-[fadeIn_160ms_ease-out]">
          <span className="w-2 h-2 rounded-full bg-logic-lcd-amber animate-pulse flex-shrink-0" />
          <span className="flex-1 min-w-0 text-sm text-logic-text truncate" title={live.text}>{live.text}</span>
          <button
            onClick={() => update((s) => ({ ...s, notice: null }))}
            className="px-3 py-1.5 rounded-md bg-logic-lcd-amber text-black text-xs font-semibold hover:brightness-110 transition-all"
          >
            Tirar
          </button>
        </div>
      )}

      {state.presets.length === 0 ? (
        <p className="text-sm text-logic-text-dim">
          Nenhum aviso pronto ainda.{' '}
          <button onClick={onManage} className="text-logic-accent hover:underline">Criar na aba Avisos</button>
        </p>
      ) : (
        <ul className="max-h-64 overflow-y-auto logic-scroll space-y-1.5 pr-1">
          {state.presets.map((p) => {
            const onScreen = live?.text === p;
            return (
              <li key={p}>
                <button
                  onClick={() => update((s) => withNotice(s, p, { level: 'info', layout: 'bar', durationSec: 0 }) ?? s)}
                  className={`group w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors active:scale-[0.99] ${onScreen ? 'border-logic-lcd-amber/60 bg-logic-lcd-amber/5' : 'border-logic-border bg-logic-bg-deep hover:border-logic-accent/60 hover:bg-logic-accent/5'}`}
                  title="Mandar para a tela"
                >
                  <Megaphone size={14} className="text-logic-text-muted flex-shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-logic-text truncate">{p}</span>
                  <span className="flex items-center gap-1 text-xs font-medium text-logic-text-muted group-hover:text-logic-accent transition-colors">
                    <Send size={13} /> {onScreen ? 'Na tela' : 'Mandar'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
