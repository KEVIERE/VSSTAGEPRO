import { Play, Pause, Square, ArrowRight, Gauge, AudioWaveform, Loader2, X, Headphones, SlidersVertical } from 'lucide-react';
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { togglePlayPause, stopPlayback } from '@/lib/transportControl';
import { effectiveBpm } from '@/lib/musicianApi';
import { bpmAdjustToAlpha } from '@/lib/timeStretch';
import { currentAndNextSlice, paramsAt } from '@/lib/medley';
import type { PlayFlow } from '@/types';

const FLOW_LABELS: Record<PlayFlow, string> = {
  'continuo': 'Contínuo',
  'bloco': 'Bloco',
  'uma-uma': 'Uma a Uma',
};

const STATUS_STYLES = {
  playing: { label: 'TOCANDO', text: 'text-logic-lcd-green text-shadow-lcd', dot: 'bg-logic-lcd-green shadow-[0_0_8px_2px_rgba(48,209,88,0.55)] animate-pulse', bar: 'bg-logic-lcd-green' },
  paused: { label: 'PAUSADO', text: 'text-logic-lcd-amber text-shadow-amber', dot: 'bg-logic-lcd-amber shadow-[0_0_6px_1px_rgba(255,159,10,0.5)]', bar: 'bg-logic-lcd-amber' },
  stopped: { label: 'PARADO', text: 'text-logic-text-dim', dot: 'bg-logic-text-muted', bar: 'bg-logic-accent' },
  loading: { label: 'CARREGANDO', text: 'text-logic-accent', dot: 'bg-logic-accent shadow-[0_0_6px_1px_rgba(10,132,255,0.5)] animate-pulse', bar: 'bg-logic-accent' },
} as const;

export default function TransportBar() {
  const transport = useStore((s) => s.transport);
  const cyclePlayFlow = useStore((s) => s.cyclePlayFlow);
  const toggleBpmTower = useStore((s) => s.toggleBpmTower);
  const toggleTunerTower = useStore((s) => s.toggleTunerTower);
  const showBpmTower = useStore((s) => s.showBpmTower);
  const showTunerTower = useStore((s) => s.showTunerTower);
  const mixerVisible = useStore((s) => s.mixerVisible);
  const toggleMixer = useStore((s) => s.toggleMixer);
  const songs = useStore((s) => s.songs);
  const playbackError = useStore((s) => s.playbackError);
  const setPlaybackError = useStore((s) => s.setPlaybackError);
  const preparingParams = useStore((s) => s.preparingParams);
  const isLoading = useStore((s) => {
    const id = s.transport.currentSongId ?? s.selectedSongId;
    return !!id && s.loadingSongIds.includes(id);
  });
  const soloActive = useStore((s) => s.tracks.some((t) => t.solo));
  const currentSong = songs.find((sg) => sg.id === transport.currentSongId);
  const nextSong = songs.find((sg) => sg.id === transport.nextSongId);
  const progressPct = Math.round(transport.songProgress * 100);
  const hasNextSong = transport.isPlaying && transport.playFlow !== 'uma-uma' && !!nextSong;
  const statusKey = isLoading ? 'loading' : transport.isPlaying ? 'playing' : transport.isPaused ? 'paused' : 'stopped';
  const status = STATUS_STYLES[statusKey];
  const showCurrent = !!currentSong && !transport.isStopped;
  const baseBpm = currentSong?.bpmDetected && currentSong.bpm ? Math.round(currentSong.bpm) : null;
  const slice = currentAndNextSlice(currentSong, transport.currentTime).current;
  const sliceBpmAdjust = currentSong ? paramsAt(currentSong, transport.currentTime).bpmAdjust : 0;
  const liveBpm = currentSong ? effectiveBpm(currentSong.bpm, currentSong.bpmDetected, sliceBpmAdjust) : null;
  const bpmDelta = baseBpm !== null && liveBpm !== null ? liveBpm - baseBpm : 0;
  const secondsLeft = showCurrent && currentSong
    ? Math.max(0, (currentSong.duration - transport.currentTime) * bpmAdjustToAlpha(currentSong.bpmAdjust ?? 0))
    : Infinity;
  const finalCountdown = transport.isPlaying && secondsLeft <= 10 ? Math.ceil(secondsLeft) : null;

  const toggleClass = (active: boolean) =>
    `w-8 h-8 rounded border flex items-center justify-center transition-all duration-150 ${
      active
        ? 'bg-logic-lcd-amber/15 border-logic-lcd-amber/70 text-logic-lcd-amber'
        : 'bg-logic-bg-elevated border-logic-border-light text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light'
    }`;

  return (
    <div className="relative flex items-center gap-2 px-3 h-[68px] py-2 bg-logic-bg-panel border-b border-logic-border-dark">
      {playbackError && (
        <div
          role="alert"
          className="absolute left-1/2 top-full mt-2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-md border border-logic-lcd-red/60 bg-logic-bg-deep text-xs text-logic-text shadow-lg"
        >
          <span>{playbackError}</span>
          <button
            onClick={() => setPlaybackError(null)}
            className="text-logic-text-muted hover:text-logic-text transition-colors"
            aria-label="Fechar aviso"
          >
            OK
          </button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          className={`logic-btn-transport transition-colors ${
            transport.isPlaying
              ? 'bg-logic-lcd-amber/20 border-logic-lcd-amber text-logic-lcd-amber'
              : transport.isPaused ? 'border-logic-lcd-green/70 text-logic-lcd-green' : ''
          }`}
          onClick={togglePlayPause}
          title={transport.isPlaying ? 'Pausar (Espaço)' : 'Tocar (Espaço)'}
          aria-label={transport.isPlaying ? 'Pausar' : 'Tocar'}
        >
          {isLoading && transport.isPlaying ? <Loader2 size={14} className="animate-spin" /> : transport.isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>
        <button
          className="logic-btn-transport"
          onClick={stopPlayback}
          title="Stop (Esc): volta ao último marcador ou ao início"
          aria-label="Stop"
        >
          <Square size={14} fill="currentColor" />
        </button>
      </div>

      {soloActive && (
        <span
          role="status"
          title="Há faixas em solo: as outras estão mudas"
          className="flex items-center gap-1 h-7 px-2 rounded border border-logic-lcd-amber/70 bg-logic-lcd-amber/15 text-2xs font-semibold uppercase tracking-wider text-logic-lcd-amber shrink-0 animate-pulse"
        >
          <Headphones size={12} /> Solo ativo
        </span>
      )}

      <div className="flex items-center gap-1 ml-1 shrink-0">
        <span className="text-2xs text-logic-text-muted uppercase tracking-wider">Fluxo</span>
        <ArrowRight size={11} className="text-logic-text-muted" />
        <button
          className="px-2 py-1.5 text-xs font-medium bg-logic-bg-elevated border border-logic-border-light rounded hover:bg-logic-bg-panel-light transition-colors duration-100 w-24 lg:w-28 text-center shrink-0"
          onClick={cyclePlayFlow}
          title="Alternar fluxo de reprodução"
        >
          {FLOW_LABELS[transport.playFlow]}
        </button>
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-0 ml-2">
        <div className="logic-lcd h-[52px] px-2.5 lg:px-3.5 flex flex-col justify-center gap-1 flex-1 basis-0 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 h-3">
            <span className="text-2xs leading-3 text-logic-text-muted uppercase tracking-wider">Tocando</span>
            <span className="text-2xs leading-3 tabular-nums whitespace-nowrap" title="BPM lido da música e o ajuste atual">
              {showCurrent && baseBpm !== null ? (
                <>
                  <span className="text-logic-text-dim">{baseBpm}</span>
                  {bpmDelta !== 0 && (
                    <span className="ml-1 font-semibold text-logic-lcd-amber">{bpmDelta > 0 ? `+${bpmDelta}` : bpmDelta}</span>
                  )}
                  <span className="ml-1 text-logic-text-muted">BPM</span>
                </>
              ) : (
                <span className="text-logic-text-muted">--- BPM</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 h-5 min-w-0">
            <span className="flex-1 min-w-0 block text-[15px] leading-5 font-medium truncate" style={{ color: transport.isPlaying ? '#30d158' : transport.isPaused ? '#ff9f0a' : '#555' }}>
              {showCurrent && currentSong ? (
                slice ? (
                  <>
                    <span className="inline-block align-[1px] mr-1.5 px-1 rounded-[3px] border border-current text-[9px] leading-[11px] font-semibold tracking-[0.14em] opacity-80">MEDLEY</span>
                    <span key={slice.id} className="inline-block animate-[fadeIn_250ms_ease-out]">{slice.name}</span>
                    <span className="text-logic-text-muted font-normal"> · {currentSong.name}</span>
                  </>
                ) : currentSong.name
              ) : '---'}
            </span>
            {finalCountdown !== null && (
              <span
                className="shrink-0 px-1.5 h-4 rounded bg-logic-lcd-red/15 border border-logic-lcd-red/50 text-2xs leading-[14px] font-semibold uppercase tracking-wider text-logic-lcd-red tabular-nums animate-pulse"
                role="timer"
                aria-live="polite"
              >
                Restam {finalCountdown}s
              </span>
            )}
          </div>
          <div className="h-1 shrink-0 bg-logic-bg-deep rounded-full overflow-hidden">
            <div
              className={`h-full transition-[width] duration-100 ${finalCountdown !== null ? 'bg-logic-lcd-red' : 'bg-logic-lcd-green'}`}
              style={{ width: `${showCurrent ? progressPct : 0}%` }}
            />
          </div>
        </div>

        <div className="logic-lcd h-[52px] px-2.5 lg:px-3.5 flex flex-col justify-center gap-1 flex-1 basis-0 min-w-0 overflow-hidden">
          <div className="flex items-center h-3">
            <span className="text-2xs leading-3 text-logic-text-muted uppercase tracking-wider">Próxima</span>
          </div>
          <span className="block h-5 text-[15px] leading-5 font-medium truncate" style={{ color: hasNextSong ? '#ff9f0a' : '#555' }}>
            {hasNextSong && nextSong ? nextSong.name : '---'}
          </span>
          <div className="h-1 shrink-0 bg-logic-bg-deep rounded-full overflow-hidden flex justify-end">
            <div
              className="h-full bg-logic-lcd-amber transition-[width] duration-100"
              style={{ width: `${hasNextSong && currentSong ? progressPct : 0}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 ml-2 shrink-0">
        <button className={toggleClass(mixerVisible)} onClick={toggleMixer} title="Mostrar/ocultar o Mixer (M)" aria-label="Mixer" aria-pressed={mixerVisible}>
          <SlidersVertical size={15} />
        </button>
        <button className={toggleClass(showBpmTower)} onClick={toggleBpmTower} title="Mostrar/ocultar coluna de BPM" aria-label="Coluna de BPM" aria-pressed={showBpmTower}>
          <Gauge size={15} />
        </button>
        <button className={toggleClass(showTunerTower)} onClick={toggleTunerTower} title="Mostrar/ocultar coluna do Afinador" aria-label="Coluna do Afinador" aria-pressed={showTunerTower}>
          <AudioWaveform size={15} />
        </button>

        <div className="group logic-lcd relative h-7 ml-1 w-[100px] overflow-hidden flex flex-col items-center justify-center" role="status" aria-live="polite">
          <span key={status.label} className="flex items-center justify-center gap-1.5 animate-[fadeIn_160ms_ease-out]">
            <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-200 ${status.dot}`} />
            <span className={`text-[10px] leading-3 font-semibold tracking-[0.12em] ${status.text}`}>{status.label}</span>
          </span>
          {preparingParams && (
            <>
              <span className="text-[8px] leading-none mt-px uppercase tracking-[0.1em] text-logic-accent/90 tabular-nums animate-[fadeIn_200ms_ease-out]">
                {preparingParams.total > 0 ? `Ajustando ${preparingParams.done}/${preparingParams.total}` : 'Ajustando'}
              </span>
              <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-logic-accent/15 overflow-hidden">
                <span className={`absolute inset-y-0 left-0 w-2/5 rounded-full ${status.bar} animate-[statusSweep_1.2s_ease-in-out_infinite]`} />
              </span>
              <button
                className="absolute right-0.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded flex items-center justify-center text-logic-text-muted bg-logic-bg-deep/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-logic-accent transition-opacity duration-150"
                onClick={() => audioEngine.cancelAllRenders()}
                title="Refinando o som do novo BPM/tom em segundo plano. O ajuste já está valendo. Clique para cancelar."
                aria-label="Cancelar refinamento de BPM/tom"
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
