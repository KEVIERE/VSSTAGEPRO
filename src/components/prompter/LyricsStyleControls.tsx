import { useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Check, Type } from 'lucide-react';
import FontPickerDialog from '@/components/prompter/FontPickerDialog';
import { LYRIC_COLORS, LYRIC_FONTS, type LyricAlign, type PrompterState } from '@/lib/prompterTypes';

const ALIGNS: { id: LyricAlign; label: string; icon: typeof AlignLeft }[] = [
  { id: 'left', label: 'Esquerda', icon: AlignLeft },
  { id: 'center', label: 'Centro', icon: AlignCenter },
  { id: 'right', label: 'Direita', icon: AlignRight },
];

export default function LyricsStyleControls({ state, update, compact = false }: {
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
  /** Em linha, no quadro "Toda a letra" do topo (sempre à vista). */
  compact?: boolean;
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

  if (compact) {
    return (
      <>
        <span className="flex items-center gap-1.5" title="Cor da letra na TV">
          <span className="text-xs text-logic-text">Cor</span>
          {LYRIC_COLORS.map((c) => {
            const on = state.lyricColor === c;
            return (
              <button
                key={c}
                onClick={() => update((s) => ({ ...s, lyricColor: c }))}
                className={`w-5 h-5 rounded-full shrink-0 transition-transform hover:scale-110 ${on ? 'ring-2 ring-offset-1 ring-offset-logic-bg-panel ring-logic-lcd-amber' : 'ring-1 ring-white/15'}`}
                style={{ background: c }}
                aria-label="Escolher cor"
                aria-pressed={on}
              />
            );
          })}
        </span>
        <button
          onClick={() => setFontOpen(true)}
          className="flex items-center gap-2 h-8 px-2.5 rounded-md border-2 border-black bg-black/40 hover:bg-white/5 shrink-0"
          title={`Fonte da letra (${LYRIC_FONTS.length} fontes)`}
        >
          <span className="text-base leading-none font-semibold" style={{ fontFamily: font.css, color: state.lyricColor }}>Aa</span>
          <span className="text-xs text-logic-text">{font.label}</span>
        </button>
        <span className="flex items-center h-8 rounded-md border-2 border-black bg-black/40 overflow-hidden shrink-0" role="group" aria-label="Alinhamento">
          {ALIGNS.map(({ id, label, icon: Icon }) => {
            const on = state.lyricAlign === id;
            return (
              <button
                key={id}
                onClick={() => update((s) => ({ ...s, lyricAlign: id }))}
                className={`w-8 h-full flex items-center justify-center ${on ? 'bg-white/10 text-logic-lcd-amber' : 'text-logic-text-dim hover:text-logic-text hover:bg-white/5'}`}
                title={`Alinhar à ${label.toLowerCase()}`.replace('à centro', 'ao centro')}
                aria-pressed={on}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </span>
        {fontDialog}
      </>
    );
  }

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
