import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { useHoverDismiss } from '@/lib/useHoverDismiss';
import { isTimecodeTrackId, NO_OUTPUT, outputLabel, TIMECODE_TRACK_ID, usedOutputs } from '@/lib/timecode';
import type { Track } from '@/types';

interface Option { value: number; label: string; disabled: boolean; hint?: string }

function optionsFor(track: Track, tracks: Track[], count: number): Option[] {
  const physical = Array.from({ length: count }, (_, i) => i + 1);
  if (isTimecodeTrackId(track.id)) {
    const used = usedOutputs(tracks, track.id);
    return [
      { value: NO_OUTPUT, label: 'Sem Saída', disabled: false },
      ...physical.map((n) => ({
        value: n,
        label: outputLabel(n),
        disabled: used.has(n),
        hint: n <= 2 ? 'Master' : used.has(n) ? 'em uso' : undefined,
      })),
    ];
  }
  const tcOut = tracks.find((t) => t.id === TIMECODE_TRACK_ID)?.outputChannel ?? NO_OUTPUT;
  return [
    { value: 0, label: outputLabel(0), disabled: false },
    ...physical.map((n) => ({ value: n, label: outputLabel(n), disabled: n === tcOut, hint: n === tcOut ? 'timecode' : undefined })),
  ];
}

export default function OutputMenu({ track }: { track: Track }) {
  const tracks = useStore((s) => s.tracks);
  const count = useStore((s) => s.outputChannelCount);
  const setOutputChannel = useStore((s) => s.setOutputChannel);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useHoverDismiss(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hoverProps = {
    onMouseEnter: hover.cancel,
    onMouseLeave: () => { if (open) hover.schedule(); },
  };

  const isTc = isTimecodeTrackId(track.id);
  const unavailable = track.outputChannel > count;
  const unassigned = track.outputChannel === NO_OUTPUT;
  const label = unavailable ? `${outputLabel(track.outputChannel)} ?` : outputLabel(track.outputChannel);
  const tone = unassigned || unavailable
    ? 'text-logic-lcd-amber border-logic-lcd-amber/60'
    : isTc ? 'text-logic-lcd-green border-logic-border-dark' : 'text-logic-lcd-text border-logic-border-dark';
  const title = unavailable
    ? `A interface atual não tem a ${outputLabel(track.outputChannel)}. ${isTc ? 'O timecode fica mudo' : 'O som vai para o Master'} até você escolher outra saída.`
    : unassigned ? 'Escolha a saída física da interface que recebe o timecode' : 'Saída física deste canal';

  return (
    <>
      <button
        ref={buttonRef}
        {...hoverProps}
        className={`w-full text-2xs font-mono bg-logic-lcd-bg border rounded-sm px-1 py-0.5 truncate text-center hover:border-logic-accent transition-colors ${tone}`}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        title={title}
      >
        {label}
      </button>
      {open && (
          <div
            ref={listRef}
            {...hoverProps}
            className="absolute top-7 left-0 z-50 w-32 max-h-56 overflow-y-auto logic-scroll bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded text-2xs animate-[fadeIn_120ms_ease-out]"
            onWheel={(e) => e.stopPropagation()}
          >
            {count <= 2 && (
              <p className="px-2 py-1.5 text-logic-text-muted leading-snug border-b border-logic-border-dark">
                Esta saída tem só 2 canais. Escolha uma interface com mais saídas em Dispositivo de Áudio.
              </p>
            )}
            {optionsFor(track, tracks, count).map((opt) => (
              <button
                key={opt.value}
                disabled={opt.disabled}
                className={`w-full flex items-center justify-between gap-2 text-left px-2 py-1 transition-colors
                  ${opt.disabled ? 'text-logic-text-muted/50 cursor-not-allowed' : 'hover:bg-logic-accent hover:text-white'}
                  ${track.outputChannel === opt.value ? 'text-logic-accent' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (opt.disabled) return; setOutputChannel(track.id, opt.value); setOpen(false); }}
              >
                <span>{opt.label}</span>
                {opt.hint && <span className="text-[9px] uppercase tracking-wide opacity-70">{opt.hint}</span>}
              </button>
            ))}
          </div>
      )}
    </>
  );
}
