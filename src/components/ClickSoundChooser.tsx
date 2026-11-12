import { useEffect, useState, useSyncExternalStore } from 'react';
import { Timer, X } from 'lucide-react';
import { playClickPreview, stopClickPreview } from '@/lib/clickGenerator';
import { CLICK_SOUNDS, rememberedClickSound, type ClickSoundId } from '@/lib/clickSounds';
import { clickAddBlocker, closeClickChooser, getClickChooser, isClickToolRunning, startClickTool, subscribeClickChooser } from '@/lib/clickTools';
import { useStore } from '@/store';

/**
 * Janela do Recriar metrônomo: escolhe o som do click. Apertar um som já toca 1 compasso dele
 * no andamento da música; Recriar troca o click da faixa por esse som, batida por batida.
 */
export default function ClickSoundChooser() {
  const songId = useSyncExternalStore(subscribeClickChooser, getClickChooser);
  if (!songId) return null;
  return <Chooser songId={songId} />;
}

function Chooser({ songId }: { songId: string }) {
  const bpm = useStore((s) => s.songs.find((x) => x.id === songId)?.bpm ?? 120);
  const beatsPerBar = useStore((s) => s.songs.find((x) => x.id === songId)?.beatsPerBar ?? 4);
  const [sound, setSound] = useState<ClickSoundId>(rememberedClickSound);
  const [playing, setPlaying] = useState<ClickSoundId | null>(null);
  const blocker = isClickToolRunning() ? 'Já há um comando do click em andamento' : clickAddBlocker(songId, 'remake');
  const label = CLICK_SOUNDS.find((s) => s.id === sound)?.label ?? '';

  const close = () => {
    stopClickPreview();
    closeClickChooser();
  };
  const confirm = () => {
    if (blocker) return;
    close();
    void startClickTool(songId, 'remake', sound);
  };
  const listen = (id: ClickSoundId) => {
    setSound(id);
    setPlaying(id);
    void playClickPreview(id, bpm, beatsPerBar, () => setPlaying((p) => (p === id ? null : p)));
  };

  // Esc fecha e Enter recria, antes dos atalhos da timeline
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else confirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => () => stopClickPreview(), []);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-3 animate-[fadeIn_120ms_ease-out]"
      onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recriar metrônomo"
        className="w-[440px] max-w-full console-face rounded-lg border border-black shadow-2xl overflow-hidden"
      >
        <div className="console-rail flex items-center gap-2 px-3 py-2">
          <span className="console-led is-on-amber" />
          <Timer size={13} className="shrink-0 text-logic-text-dim" />
          <span className="console-legend flex-1 uppercase">Recriar metrônomo</span>
          <button className="p-1 rounded text-logic-text-muted hover:text-logic-text" onClick={close} title="Fechar (Esc)" aria-label="Fechar">
            <X size={13} />
          </button>
        </div>

        <div className="p-3 flex flex-col gap-3">
          <p className="text-[12px] leading-snug text-logic-text-dim">
            Escolha o som do click. Cada batida fica no mesmo lugar do click que está na faixa.
            Aperte um som para ouvir.
          </p>

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Som do metrônomo">
            {CLICK_SOUNDS.map((s) => {
              const on = s.id === sound;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={s.tip}
                  onClick={() => listen(s.id)}
                  className={`console-pad text-left px-2.5 py-2 flex flex-col gap-1 min-w-0 ${on ? 'is-active' : ''}`}
                  style={{ ['--pad-color' as string]: '#ffab1f' }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`console-led shrink-0 ${playing === s.id ? 'is-on-green animate-pulse' : on ? 'is-on-amber' : ''}`} />
                    <span className={`font-stage font-bold text-[13px] leading-none truncate ${on ? 'text-[#ffd48a]' : 'text-logic-text'}`}>{s.label}</span>
                    {s.id === 'vs' && <span className="console-legend ml-auto shrink-0 text-[9px]">PADRÃO</span>}
                    {s.twoSounds && <span className="console-legend ml-auto shrink-0 text-[9px]">2 SONS</span>}
                  </span>
                  <span className={`text-[10.5px] leading-snug ${on ? 'text-[#cdbf9c]' : 'text-logic-text-muted'}`}>{s.tip}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-logic-text-muted">
            <span className="console-legend">OUVIR EM</span>
            <span className="console-readout text-logic-lcd-amber">{Math.round(bpm)} BPM</span>
            <span className="flex-1 truncate">o andamento da música</span>
          </div>

          {blocker && (
            <div className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber text-[11px]">{blocker}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/60">
            <button type="button" className="console-key h-8 px-3 text-[12px]" onClick={close}>Cancelar</button>
            <button
              type="button"
              className="console-key is-lit-amber h-8 px-4 text-[12px]"
              disabled={!!blocker}
              onClick={confirm}
              title="Troca o click da faixa por este som (Enter)"
            >
              Recriar com {label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
