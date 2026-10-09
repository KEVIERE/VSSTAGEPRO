import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { LYRIC_FONTS, type LyricFontGroup } from '@/lib/prompterTypes';

const GROUPS: LyricFontGroup[] = ['Sem serifa', 'Condensada', 'Com serifa', 'Arredondada', 'Marcante'];

export default function FontPickerDialog({ value, color, onPick, onClose }: {
  value: string;
  color: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Escolher fonte"
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-logic-border bg-logic-bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 h-14 border-b border-logic-border shrink-0">
          <h2 className="text-sm font-semibold text-logic-text">Escolher fonte da letra</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors" aria-label="Fechar">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto logic-scroll p-5 space-y-5">
          {GROUPS.map((g) => (
            <div key={g}>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.14em] text-logic-text-muted">{g}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {LYRIC_FONTS.filter((f) => f.group === g).map((f) => {
                  const on = value === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => { onPick(f.id); onClose(); }}
                      className={`relative px-4 py-3 rounded-xl border text-left bg-black transition-all hover:-translate-y-0.5 ${on ? 'border-logic-accent ring-1 ring-logic-accent' : 'border-logic-border hover:border-logic-border-light'}`}
                    >
                      <span className="block text-2xl leading-tight truncate" style={{ fontFamily: f.css, color }}>Aa Canto</span>
                      <span className="block text-xs text-logic-text-dim mt-1">{f.label}</span>
                      {on && (
                        <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-logic-accent text-white flex items-center justify-center">
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
