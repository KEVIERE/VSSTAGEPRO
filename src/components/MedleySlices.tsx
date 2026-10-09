import { Check, CornerDownRight } from 'lucide-react';
import { useStore } from '@/store';
import type { Song } from '@/types';
import { isSliceEnabled, medleySlices, sliceAt, sliceDuration, sliceParams } from '@/lib/medley';
import { formatTime } from '@/components/ShowRundown';
import { SongAdjuster } from '@/components/AdjustmentsTower';
import { seekToPosition } from '@/lib/transportControl';

interface MedleySlicesProps {
  song: Song;
  songNumber: number;
  showStart: number;
  isCurrent: boolean;
  cols: string;
  showBpm: boolean;
  showTuner: boolean;
}

export function MedleySlices({ song, songNumber, showStart, isCurrent, cols, showBpm, showTuner }: MedleySlicesProps) {
  const slices = medleySlices(song);
  const currentTime = useStore((s) => (isCurrent ? s.transport.currentTime : -1));
  const updateMedleyPart = useStore((s) => s.updateMedleyPart);
  const selectSong = useStore((s) => s.selectSong);
  if (slices.length === 0) return null;

  const playing = isCurrent ? sliceAt(slices, currentTime) : null;
  const enabledCount = slices.filter(isSliceEnabled).length;
  let elapsed = 0;

  const handleClick = (start: number) => {
    if (isCurrent) seekToPosition(song.id, start);
    else selectSong(song.id);
  };

  return (
    <div className="pb-2" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {slices.map((s, i) => {
        const enabled = isSliceEnabled(s);
        const isPlaying = playing?.id === s.id;
        const locked = enabled && enabledCount <= 1;
        const params = sliceParams(song, s);
        const duration = sliceDuration(song, s);
        const at = showStart + elapsed;
        if (enabled) elapsed += duration;
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`w-full grid items-center gap-3 px-6 h-9 text-left tabular-nums cursor-pointer transition-[background-color,opacity] duration-200 ${
              isPlaying ? 'bg-logic-lcd-green/10' : 'hover:bg-white/5'
            }`}
            style={{ gridTemplateColumns: cols }}
            onClick={() => handleClick(s.start)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleClick(s.start); }}
            title={isCurrent ? 'Ir para esta música do medley' : 'Selecionar esta música'}
          >
            <span className="flex justify-center">
              <button
                className={`w-[18px] h-[18px] rounded flex items-center justify-center border transition-all duration-150 ${
                  enabled
                    ? 'bg-logic-lcd-green/20 border-logic-lcd-green/70 text-logic-lcd-green hover:bg-logic-lcd-green/30'
                    : 'bg-transparent border-logic-border-light text-transparent hover:border-logic-text-dim'
                } ${locked ? 'opacity-60 cursor-not-allowed' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!locked) updateMedleyPart(song.id, s.id, { enabled: !enabled });
                }}
                aria-pressed={enabled}
                aria-label={enabled ? `Não tocar ${s.name}` : `Tocar ${s.name}`}
                title={locked ? 'Pelo menos uma música do medley precisa tocar' : enabled ? 'Vai tocar. Clique para pular esta música' : 'Pulada. Clique para tocar esta música'}
              >
                <Check size={12} strokeWidth={3} />
              </button>
            </span>
            <span className={`flex items-center gap-2 min-w-0 pl-2 transition-opacity ${enabled || isPlaying ? '' : 'opacity-40'}`}>
              <CornerDownRight size={13} className={isPlaying ? 'text-logic-lcd-green' : 'text-logic-text-muted'} />
              <span className="text-xs font-mono text-logic-text-muted">{songNumber}.{i + 1}</span>
              <span className={`text-sm font-medium truncate ${isPlaying ? 'text-logic-lcd-green' : 'text-logic-text'} ${enabled ? '' : 'line-through decoration-logic-text-muted/60'}`}>{s.name}</span>
              {isPlaying && <span className="text-2xs font-medium uppercase tracking-[0.14em] text-logic-lcd-green/80 animate-[fadeIn_200ms_ease-out]">No ar</span>}
              {!enabled && !isPlaying && <span className="text-2xs font-medium uppercase tracking-[0.14em] text-logic-text-muted">Pulada</span>}
            </span>
            <span />
            <span />
            <span className={`text-xs text-right text-logic-text-dim ${enabled ? '' : 'opacity-40'}`}>{formatTime(duration)}</span>
            <span className="text-xs text-right text-logic-text-muted">{enabled ? formatTime(at) : '–'}</span>
            {showBpm && (
              <div className="flex justify-center">
                <SongAdjuster songId={song.id} partId={s.id} kind="bpm" value={params.bpmAdjust} inherited={s.bpmAdjust === undefined} />
              </div>
            )}
            {showTuner && (
              <div className="flex justify-center">
                <SongAdjuster songId={song.id} partId={s.id} kind="tuner" value={params.tuner} inherited={s.tuner === undefined} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
