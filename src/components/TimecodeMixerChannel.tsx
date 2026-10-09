import { Clock, Lock, LockOpen } from 'lucide-react';
import { useStore } from '@/store';
import { volumeToDb } from '@/lib/audioEngine';
import { NO_OUTPUT, TIMECODE_DEFAULT_VOLUME, TIMECODE_TRACK_ID } from '@/lib/timecode';
import MeterMask from '@/components/MeterMask';
import OutputMenu from '@/components/OutputMenu';

export default function TimecodeMixerChannel() {
  const track = useStore((s) => s.tracks.find((t) => t.id === TIMECODE_TRACK_ID));
  const setVolume = useStore((s) => s.setVolume);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleFaderLock = useStore((s) => s.toggleFaderLock);
  if (!track) return null;

  const locked = !!track.faderLocked;
  const faderPct = track.volume * 66.67;
  const db = volumeToDb(track.volume);
  const dbLabel = db === -Infinity ? '-inf' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
  const noOutput = track.outputChannel === NO_OUTPUT;

  return (
    <div className="flex flex-col items-center w-[80px] min-w-[80px] bg-[#2a2216] border-r-2 border-logic-lcd-amber/40 py-1.5 px-1 gap-1 relative">
      <OutputMenu track={track} />

      <div className="flex items-center gap-1 h-7 text-logic-lcd-amber" title="Sinal de controle para telões e luzes">
        <Clock size={14} />
        <span className="text-[9px] font-bold tracking-wider">LTC</span>
      </div>

      <span className="text-2xs font-bold text-logic-lcd-amber truncate w-full text-center" title={track.name}>TIMECODE</span>

      <div className="flex gap-1 items-end">
        <div className="relative w-3 h-[120px] bg-logic-bg-deep rounded-sm border border-logic-border-dark overflow-hidden">
          <div
            className="absolute inset-0"
            style={{ background: track.mute || noOutput ? '#555' : 'linear-gradient(to top, #30d158 0%, #30d158 62.5%, #ffd60a 75%, #ffd60a 93.75%, #ff453a 95.8%, #ff453a 100%)' }}
          />
          <MeterMask id={track.id} className="bg-logic-bg-deep" />
        </div>

        <div
          className={`relative w-5 h-[120px] bg-logic-bg-deep rounded-sm border ${locked ? 'border-logic-lcd-amber/50' : 'border-logic-border-dark'}`}
          onDoubleClick={() => { if (!locked) setVolume(track.id, TIMECODE_DEFAULT_VOLUME); }}
          title={locked ? 'Fader travado. Clique no cadeado para destravar.' : 'Duplo clique = -6 dB'}
        >
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.volume}
            disabled={locked}
            onChange={(e) => setVolume(track.id, parseFloat(e.target.value))}
            className={`absolute inset-0 w-full h-full opacity-0 ${locked ? 'cursor-not-allowed' : 'cursor-ns-resize'}`}
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          />
          <div className="absolute left-0 right-0 h-px bg-logic-border-light pointer-events-none" style={{ bottom: 'calc(53.33% - 0.5px)' }} />
          <div
            className={`absolute left-0 right-0 h-1.5 rounded-sm pointer-events-none border border-logic-border-dark transition-colors ${locked ? 'bg-logic-lcd-amber' : 'bg-logic-text'}`}
            style={{ bottom: `calc(${faderPct}% - 3px)` }}
          />
        </div>
      </div>

      <span className="text-2xs font-mono text-logic-text-muted">{dbLabel}</span>

      <button
        className={`flex items-center justify-center gap-1 w-full h-5 rounded border text-[9px] font-bold transition-colors duration-100 ${
          locked
            ? 'bg-logic-lcd-amber/15 text-logic-lcd-amber border-logic-lcd-amber/50 hover:bg-logic-lcd-amber/25'
            : 'bg-logic-bg-deep text-logic-text-muted border-logic-border-dark hover:text-logic-text'
        }`}
        onClick={() => toggleFaderLock(track.id)}
        title={locked ? 'Destravar o fader' : 'Travar o fader'}
      >
        {locked ? <Lock size={10} /> : <LockOpen size={10} />}
        {locked ? 'TRAVADO' : 'LIVRE'}
      </button>

      <button
        className={`w-full h-6 text-2xs font-bold rounded transition-colors duration-100 ${
          track.mute ? 'bg-logic-lcd-red text-black animate-pulse' : 'bg-logic-bg-deep text-logic-text-muted border border-logic-border-dark hover:text-logic-text'
        }`}
        onClick={() => toggleMute(track.id)}
        title={track.mute ? 'Timecode mudo: clique para voltar a enviar o sinal' : 'Silenciar o timecode'}
      >
        {track.mute ? 'MUDO' : 'MUTE'}
      </button>
    </div>
  );
}
