import { memo } from 'react';
import { useStore } from '@/store';
import { useShortcutLabel } from '@/lib/shortcuts/runtime';

/**
 * Interruptor do Modo Show: na barra de cima ele aparece desligado (liga o Modo Show) e no painel do
 * Modo Show aparece ligado (desliga e volta). Um gesto só para entrar e sair, com cara de mesa de som.
 */
const ShowModeSwitch = memo(function ShowModeSwitch({ className = '' }: { className?: string }) {
  const on = useStore((s) => s.playlistMaximized);
  const toggle = useStore((s) => s.togglePlaylistMaximized);
  const key = useShortcutLabel('view.showMode');
  const tip = on
    ? `Desligar o Modo Show e voltar para a timeline${key ? ` (${key})` : ''}`
    : `Ligar o Modo Show: a playlist em tela cheia para o palco${key ? ` (${key})` : ''}`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Modo Show"
      title={tip}
      onClick={toggle}
      className={`console-key group h-9 pl-2.5 pr-2 shrink-0 flex items-center gap-2.5 ${className}`}
    >
      <span className="flex flex-col items-start leading-none">
        <span className={`font-mono text-[11px] font-bold tracking-[0.18em] ${on ? 'text-logic-lcd-amber console-glow' : 'text-logic-lcd-amber/80'}`}>MODO SHOW</span>
        <span className="mt-1 font-mono text-[8px] tracking-wider text-logic-text-muted">
          {on ? 'LIGADO' : 'DESLIGADO'}{key ? ` · ${key}` : ''}
        </span>
      </span>
      {/* a alavanca: trilho fundo e o botão de metal que corre de um lado para o outro */}
      <span
        aria-hidden
        className={`relative inline-block w-[42px] h-[22px] rounded-full border border-black/80 transition-colors duration-150 ${
          on ? 'bg-logic-lcd-amber/80 shadow-[inset_0_1px_3px_rgba(0,0,0,0.6),0_0_8px_rgba(245,165,36,0.45)]' : 'bg-[#0d0e11] shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]'
        }`}
      >
        <span
          className={`absolute top-[2px] h-4 w-4 rounded-full border border-black/60 bg-[linear-gradient(180deg,#f2f2f2,#9a9ca3)] shadow-[0_1px_2px_rgba(0,0,0,0.7)] transition-[left] duration-150 ${
            on ? 'left-[22px]' : 'left-[2px]'
          }`}
        />
      </span>
    </button>
  );
});

export default ShowModeSwitch;
