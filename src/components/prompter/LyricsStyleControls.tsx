import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Check, ChevronDown, Type } from 'lucide-react';
import FontPickerDialog from '@/components/prompter/FontPickerDialog';
import { LYRIC_COLORS, LYRIC_FONTS, type LyricAlign, type PrompterState } from '@/lib/prompterTypes';

const ALIGNS: { id: LyricAlign; label: string; icon: typeof AlignLeft }[] = [
  { id: 'left', label: 'Esquerda', icon: AlignLeft },
  { id: 'center', label: 'Centro', icon: AlignCenter },
  { id: 'right', label: 'Direita', icon: AlignRight },
];

export default function LyricsStyleControls({ state, update }: {
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
}) {
  const [fontOpen, setFontOpen] = useState(false);
  const font = LYRIC_FONTS.find((f) => f.id === state.lyricFont) ?? LYRIC_FONTS[0];
  const fontDialog = fontOpen && (
    <FontPickerDialog
      value={font.id}
      color={state.lyricColor}
      onPick={(id) => update((s) => ({ ...s, lyricFont: id }))}
      onClose={() => setFontOpen(false)}
    />
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-logic-text-dim mb-2">Cor da letra</p>
        <div className="flex flex-wrap gap-2">
          {LYRIC_COLORS.map((c) => {
            const on = state.lyricColor === c;
            return (
              <button
                key={c}
                onClick={() => update((s) => ({ ...s, lyricColor: c }))}
                className={`relative w-9 h-9 rounded-full transition-transform hover:scale-110 active:scale-95 ${on ? 'ring-2 ring-offset-2 ring-offset-logic-bg-panel ring-logic-accent' : 'ring-1 ring-white/15'}`}
                style={{ background: c }}
                title="Escolher cor"
                aria-pressed={on}
              >
                {on && <Check size={16} className="absolute inset-0 m-auto text-black/70" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-xs text-logic-text-dim mb-2">Fonte</p>
        <button
          onClick={() => setFontOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-logic-border bg-logic-bg-deep hover:border-logic-border-light transition-colors text-left"
        >
          <span className="text-xl leading-none font-semibold" style={{ fontFamily: font.css, color: state.lyricColor }}>Aa</span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm text-logic-text">{font.label}</span>
            <span className="block text-[11px] text-logic-text-muted">{LYRIC_FONTS.length} fontes disponíveis</span>
          </span>
          <Type size={15} className="text-logic-text-muted" />
        </button>
        {fontDialog}
      </div>

      <div>
        <p className="text-xs text-logic-text-dim mb-2">Alinhamento</p>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-logic-bg-deep border border-logic-border">
          {ALIGNS.map(({ id, label, icon: Icon }) => {
            const on = state.lyricAlign === id;
            return (
              <button
                key={id}
                onClick={() => update((s) => ({ ...s, lyricAlign: id }))}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-md text-sm transition-colors ${on ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-dim hover:text-logic-text'}`}
              >
                <Icon size={15} /> {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** "Cor e fonte" no quadro "Toda a letra": um botão só, que abre cor, fonte e alinhamento. */
export function LyricStyleButton({ state, update }: {
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const font = LYRIC_FONTS.find((f) => f.id === state.lyricFont) ?? LYRIC_FONTS[0];
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 h-8 px-2.5 rounded-md border-2 border-black hover:bg-white/5 ${open ? 'bg-white/10' : 'bg-black/40'}`}
        title="Cor, fonte e alinhamento da letra na TV"
        aria-expanded={open}
      >
        <span className="text-base leading-none font-semibold" style={{ fontFamily: font.css, color: state.lyricColor }}>Aa</span>
        <span className="text-xs text-logic-text">Cor e fonte</span>
        <ChevronDown size={12} className="text-logic-text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-[300px] rounded-lg border-2 border-black bg-logic-bg-panel p-3 shadow-2xl">
          <LyricsStyleControls state={state} update={update} />
        </div>
      )}
    </span>
  );
}
