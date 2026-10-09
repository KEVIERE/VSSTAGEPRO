import { useRef, useState } from 'react';
import { AlertTriangle, Clock, Loader2, Upload } from 'lucide-react';
import { useStore } from '@/store';
import { hasSliceParams } from '@/lib/medley';
import { NO_OUTPUT, TIMECODE_TRACK_ID } from '@/lib/timecode';
import { importTimecodeForSong } from '@/lib/timecodeImport';
import { friendlyError } from '@/lib/friendlyError';

export default function TimecodeTrackRow({ songId }: { songId: string }) {
  const track = useStore((s) => s.tracks.find((t) => t.id === TIMECODE_TRACK_ID));
  const song = useStore((s) => s.songs.find((sg) => sg.id === songId));
  const clip = useStore((s) => s.clips.find((c) => c.songId === songId && c.trackId === TIMECODE_TRACK_ID));
  const zoomV = useStore((s) => s.zoomV);
  const toggleMute = useStore((s) => s.toggleMute);
  const setPlaybackError = useStore((s) => s.setPlaybackError);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!track) return null;

  const tempoChanged = !!song && ((song.bpmAdjust ?? 0) !== 0 || hasSliceParams(song));
  const noOutput = track.outputChannel === NO_OUTPUT;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await importTimecodeForSong(songId, file);
    } catch (err) {
      setPlaybackError(friendlyError(err, 'Não consegui importar o timecode.'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      className="flex items-center gap-1.5 pl-2 pr-1 border-b-2 border-logic-lcd-amber/40 bg-[#2a2216]"
      style={{ height: `${Math.round(40 * zoomV)}px` }}
      title="Faixa fixa de timecode: não muda com BPM nem tom e não vai para o Master"
    >
      <Clock size={13} className="text-logic-lcd-amber flex-shrink-0" />
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[11px] font-bold text-logic-lcd-amber whitespace-nowrap">TIMECODE (LTC)</div>
        <div className={`text-[9px] truncate ${noOutput ? 'text-logic-lcd-amber/80' : 'text-logic-text-muted'}`}>
          {clip ? clip.fileName : 'Sem arquivo nesta música'}
          {noOutput ? ' · Sem saída' : ''}
        </div>
      </div>
      {tempoChanged && clip && (
        <span title="O BPM desta música foi alterado: os stems mudaram de velocidade, mas o timecode continua no tempo original e vai se desalinhar.">
          <AlertTriangle size={13} className="text-logic-lcd-red flex-shrink-0 animate-pulse" />
        </span>
      )}
      <button
        className="flex items-center justify-center flex-shrink-0 w-6 h-5 rounded border border-logic-lcd-amber/50 text-logic-lcd-amber bg-logic-lcd-amber/10 hover:bg-logic-lcd-amber/25 transition-colors disabled:opacity-50"
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        disabled={busy}
        title={clip ? 'Trocar o arquivo de timecode desta música' : 'Importar o arquivo de timecode (.wav) desta música'}
        aria-label={clip ? 'Trocar timecode' : 'Importar timecode'}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
      </button>
      <button
        className={`flex-shrink-0 w-6 h-5 text-2xs font-bold rounded transition-colors duration-75 ${track.mute ? 'bg-logic-lcd-red text-black' : 'bg-logic-bg-deep text-logic-text-muted hover:text-logic-text'}`}
        onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
        title="Silenciar o timecode"
      >M</button>
      <input
        ref={inputRef}
        type="file"
        accept=".wav,.wave,.aif,.aiff,audio/wav,audio/x-wav,audio/aiff"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}
