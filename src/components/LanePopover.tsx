import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { REGION_PRESETS } from '@/lib/regions';

/**
 * Janelinha presa logo abaixo de um elemento da timeline (região, música do medley, botão).
 * Fecha ao clicar fora ou com Esc.
 */
function Popover({ anchor, width, label, onClose, children }: {
  anchor: string; width: number; label: string; onClose: () => void; children: ReactNode;
}) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = document.querySelector(anchor);
    if (!el) { setCoords({ top: 120, left: window.innerWidth / 2 - width / 2 }); return; }
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left - 12), window.innerWidth - width - 8);
    const below = r.bottom + 6;
    setCoords({ top: Math.min(below, window.innerHeight - 80), left });
  }, [anchor, width]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  if (!coords) return null;
  // vai direto no <body>: a faixa da timeline que rola para o lado (transform) desalinhava a janela
  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[100] console-face rounded-lg border border-black shadow-2xl p-2 flex flex-col gap-2 animate-[fadeIn_120ms_ease-out] cursor-default"
      style={{ top: coords.top, left: coords.left, width }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>,
    document.body,
  );
}

export type LaneAction = { label: string; icon: ReactNode; hint?: string; danger?: boolean; onClick: () => void };

/** Menu do clique duplo: "Editar / Excluir" na região, "Renomear / Excluir" no medley. */
export function LaneActionMenu({ anchor, title, actions, onClose }: {
  anchor: string; title: string; actions: LaneAction[]; onClose: () => void;
}) {
  return (
    <Popover anchor={anchor} width={200} label={title} onClose={onClose}>
      <span className="console-legend px-1 truncate">{title}</span>
      {actions.map((a) => (
        <button
          key={a.label}
          className={`console-key w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${a.danger ? 'hover:!text-logic-lcd-red' : ''}`}
          onClick={() => { onClose(); a.onClick(); }}
        >
          <span className="shrink-0">{a.icon}</span>
          <span className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold leading-tight">{a.label}</span>
            {a.hint && <span className="text-2xs text-logic-text-muted leading-tight truncate">{a.hint}</span>}
          </span>
        </button>
      ))}
    </Popover>
  );
}

/** Janela "Região": nomes prontos (Intro, Pré-refrão, Refrão, Ponte, Solo, Final) ou um nome escrito. */
export function RegionNamePicker({ anchor, title, current, onPick, onClose }: {
  anchor: string; title: string; current?: string; onPick: (name: string) => void; onClose: () => void;
}) {
  const [custom, setCustom] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pickCustom = () => {
    const name = custom.trim();
    if (name) onPick(name);
  };
  return (
    <Popover anchor={anchor} width={252} label={title} onClose={onClose}>
      <span className="console-legend px-1">{title}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {REGION_PRESETS.map((p) => (
          <button
            key={p.name}
            className={`console-key flex items-center gap-2 h-9 px-2.5 text-[13px] font-semibold ${current === p.name ? 'is-lit-blue' : ''}`}
            onClick={() => onPick(p.name)}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_6px_currentColor]" style={{ backgroundColor: p.color, color: p.color }} />
            <span className="truncate">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 pt-1.5 border-t border-black/60">
        <input
          ref={inputRef}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickCustom(); } }}
          maxLength={40}
          placeholder="Outro nome"
          className="console-well flex-1 min-w-0 px-2 py-1.5 text-[13px] text-logic-text border border-black rounded-[5px] outline-none focus:border-logic-accent placeholder:text-logic-text-muted"
        />
        <button
          className="console-key is-lit-green h-8 px-3 text-[13px] font-semibold disabled:opacity-50"
          onClick={pickCustom}
          disabled={!custom.trim()}
        >
          OK
        </button>
      </div>
    </Popover>
  );
}
