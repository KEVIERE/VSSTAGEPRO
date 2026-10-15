import TrackContextMenu from '@/components/TrackContextMenu';
import { useStore, ROUTABLE_TRACKS } from '@/store';
import type { Track, AudioClip, ImportProgress, FadeCurve } from '@/types';
import { Check, ChevronRight, ChevronDown, ZoomIn, ZoomOut, Folder, FolderOpen, Plus, Loader2, FoldVertical, UnfoldVertical, Scissors, Link2, Lock, Unlock, Mic } from 'lucide-react';
import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { audioEngine } from '@/lib/audioEngine';
import { audioRecorder, listInputAudioDevices, saveRecordingToMaestro, type InputAudioDevice } from '@/lib/audioRecorder';
import { useMeterLevel } from '@/lib/meterBus';
import { startPlayback, stopPlayback } from '@/lib/transportControl';
import Playhead from '@/components/Playhead';
import { formatRegionTime, freeSlotAt, suggestRegionStyle } from '@/lib/regions';
import { RegionLane, RegionGuides, type RegionDrag } from '@/components/RegionLane';
import { MedleyLane, cutMedleyAt } from '@/components/MedleyLane';
import { ClipWaveform, routingColorOf, type VisibleRange } from '@/components/ClipWaveform';
import { BarRulerLayer, GridLinesOverlay, GridToolbar } from '@/components/TimelineGrid';
import { barBeatLabel, snapTime, songGrid } from '@/lib/grid';
import { clipPlayLength } from '@/lib/audioLibrary';
import { TIMECODE_TRACK_ID } from '@/lib/timecode';
import TimecodeTrackRow from '@/components/TimecodeTrackRow';

type TrimDrag = { ids: Set<string>; delta: number; anchorId: string; end: number; label: string; side?: 'start' | 'end' } | null;
type MoveDrag = { ids: Set<string>; delta: number; anchorId: string; start: number; label: string } | null;

/** Medidor VU de LEDs estilo DAW profissional (Logic Pro / Pro Tools) para a entrada da placa */
function InputVuMeter() {
  const level = useMeterLevel('input-maestro');
  return (
    <div
      className="flex items-center gap-[1.5px] h-3.5 px-1 bg-black/60 rounded border border-white/10 shrink-0"
      title={`Nível de entrada da placa: ${Math.round(level * 100)}%`}
    >
      <div className={`w-[2.5px] h-2 rounded-[1px] transition-colors duration-75 ${level > 0.04 ? 'bg-logic-lcd-green shadow-[0_0_3px_#30d158]' : 'bg-logic-lcd-green/20'}`} />
      <div className={`w-[2.5px] h-2 rounded-[1px] transition-colors duration-75 ${level > 0.18 ? 'bg-logic-lcd-green shadow-[0_0_3px_#30d158]' : 'bg-logic-lcd-green/20'}`} />
      <div className={`w-[2.5px] h-2 rounded-[1px] transition-colors duration-75 ${level > 0.38 ? 'bg-logic-lcd-green shadow-[0_0_3px_#30d158]' : 'bg-logic-lcd-green/20'}`} />
      <div className={`w-[2.5px] h-2 rounded-[1px] transition-colors duration-75 ${level > 0.60 ? 'bg-logic-lcd-amber shadow-[0_0_3px_#ff9f0a]' : 'bg-logic-lcd-amber/20'}`} />
      <div className={`w-[2.5px] h-2 rounded-[1px] transition-colors duration-75 ${level > 0.80 ? 'bg-logic-lcd-amber shadow-[0_0_3px_#ff9f0a]' : 'bg-logic-lcd-amber/20'}`} />
      <div className={`w-[2.5px] h-2 rounded-[1px] transition-colors duration-75 ${level > 0.94 ? 'bg-logic-lcd-red shadow-[0_0_4px_#ff453a]' : 'bg-logic-lcd-red/20'}`} />
    </div>
  );
}

/** Bloco de gravação ao vivo na timeline para a faixa Maestro */
function LiveRecordingTrackBlock({ startTime, zoomH }: { startTime: number; zoomH: number }) {
  const [nowTime, setNowTime] = useState(startTime);

  useEffect(() => {
    let animId: number;
    const tick = () => {
      const cur = audioEngine.isRunning() ? audioEngine.getCurrentTime() : useStore.getState().transport.currentTime;
      setNowTime(cur);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  const widthPx = Math.max(8, (nowTime - startTime) * zoomH);

  return (
    <div
      className="absolute top-1 bottom-1 rounded border border-logic-lcd-red bg-logic-lcd-red/40 z-20 flex items-center px-2 overflow-hidden shadow-[0_0_14px_rgba(255,69,58,0.6)] select-none pointer-events-none"
      style={{
        left: `${startTime * zoomH}px`,
        width: `${widthPx}px`,
      }}
    >
      <div className="flex items-center gap-1.5 text-white font-bold text-2xs uppercase tracking-wider shrink-0 z-10 drop-shadow">
        <span className="w-2 h-2 rounded-full bg-logic-lcd-red animate-ping" />
        <span>GRAVANDO MAESTRO</span>
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,69,58,0.3)_50%,rgba(255,69,58,0.6)_100%)] animate-pulse" />
    </div>
  );
}

function ChildTrackRow({ childId, depth, expanded, onToggle, onContextMenu }: {
  childId: string; depth: number; expanded: boolean; onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
}) {
  const track = useStore((s) => s.tracks.find((t) => t.id === childId));
  if (!track) return null;
  return <TrackRow track={track} depth={depth} expanded={expanded} onToggle={onToggle} onContextMenu={onContextMenu} />;
}

// Alça fina no topo/fim de uma faixa: por padrão arrasta a altura de TODAS as faixas de
// uma vez (igual à alça da borda direita); segurando ⌘ (Cmd), muda só a altura desta faixa.
// Duplo clique: tamanho padrão — de todas, ou só desta se segurar ⌘.
function TrackHeightHandle({ trackId, edge }: { trackId: string; edge: 'top' | 'bottom' }) {
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const sign = edge === 'top' ? -1 : 1;
    const individual = e.metaKey || e.ctrlKey;

    if (individual) {
      const track = useStore.getState().tracks.find((t) => t.id === trackId);
      const startHeight = track?.height ?? 40;
      const move = (ev: PointerEvent) => {
        const deltaPx = (ev.clientY - startY) * sign;
        useStore.getState().setTrackHeight(trackId, startHeight + deltaPx);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        target.removeEventListener('pointercancel', up);
        try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
      target.addEventListener('pointercancel', up);
      return;
    }

    const startZoom = useStore.getState().zoomV;
    const move = (ev: PointerEvent) => {
      const deltaPx = (ev.clientY - startY) * sign;
      // ~120px de arraste dobra ou reduz à metade a altura das faixas.
      const next = startZoom * Math.pow(2, deltaPx / 120);
      useStore.getState().setZoomV(next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, [trackId, edge]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) useStore.getState().setTrackHeight(trackId, 40);
    else useStore.getState().setZoomV(1);
  }, [trackId]);

  return (
    <div
      className={`absolute left-0 right-0 h-1.5 ${edge === 'top' ? '-top-0.5' : '-bottom-0.5'} z-30 cursor-row-resize group/trackHeightHandle`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
      title="Arraste para ajustar a altura de todas as faixas. ⌘+arraste: só esta faixa. Duplo clique: tamanho padrão (⌘ para só esta)."
    >
      <div className={`absolute left-0 right-0 h-px ${edge === 'top' ? 'top-0.5' : 'bottom-0.5'} bg-logic-border-dark opacity-0 group-hover/trackHeightHandle:opacity-100 group-hover/trackHeightHandle:bg-logic-accent transition-opacity`} />
    </div>
  );
}

function TrackRow({ track, depth = 0, expanded = true, onToggle, onContextMenu }: {
  track: Track; depth?: number; expanded?: boolean; onToggle?: () => void;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
}) {
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const zoomV = useStore((s) => s.zoomV);
  const childClipCount = useStore((s) => {
    if (!track.isSubgroup) return 0;
    const childIds = new Set(track.children);
    return s.clips.filter((c) => childIds.has(c.trackId)).length;
  });

  // Gravação na faixa Maestro (REC, Input da placa de áudio e VU Meter)
  const isMaestro = track.id === 'track-maestro';
  const recordingMaestro = useStore((s) => s.recordingMaestro);
  const setRecordingMaestro = useStore((s) => s.setRecordingMaestro);
  const isRecording = isMaestro && !!recordingMaestro?.isRecording;
  const [inputDevices, setInputDevices] = useState<InputAudioDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [showInputMenu, setShowInputMenu] = useState(false);
  const inputMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMaestro) return;
    listInputAudioDevices().then((devs) => {
      setInputDevices(devs);
      if (devs.length > 0 && !selectedInputId) {
        setSelectedInputId(devs[0].deviceId);
      }
    });
  }, [isMaestro, selectedInputId]);

  // Inicia monitor de VU meter suavemente quando a track Maestro é exibida
  useEffect(() => {
    if (!isMaestro) return;
    audioRecorder.startMonitoring(selectedInputId || undefined).catch(() => {});
  }, [isMaestro, selectedInputId]);

  useEffect(() => {
    if (!showInputMenu) return;
    const handleDown = (e: MouseEvent) => {
      if (inputMenuRef.current && !inputMenuRef.current.contains(e.target as Node)) {
        setShowInputMenu(false);
      }
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [showInputMenu]);

  const handleToggleRec = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const st = useStore.getState();
    const activeSongId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;
    if (!activeSongId) return;

    if (isRecording) {
      try {
        const startPos = recordingMaestro?.startTime ?? 0;
        setRecordingMaestro(null);
        const res = await audioRecorder.stop();
        stopPlayback();
        if (res && res.audioBuffer) {
          await saveRecordingToMaestro(activeSongId, startPos, res.audioBuffer);
          st.setImportProgress({
            clipId: 'maestro',
            status: 'done',
            message: 'Gravação da voz do Maestro adicionada à timeline!',
          });
          setTimeout(() => st.setImportProgress(null), 3000);
        }
      } catch (err) {
        console.error('[Maestro REC] erro ao salvar gravação:', err);
        setRecordingMaestro(null);
        stopPlayback();
      }
    } else {
      try {
        const cursor = st.transport.isPlaying && st.transport.currentSongId === activeSongId
          ? audioEngine.getCurrentTime()
          : st.transport.currentTime;
        await audioRecorder.start(selectedInputId || undefined);
        setRecordingMaestro({
          isRecording: true,
          songId: activeSongId,
          startTime: cursor,
          inputDeviceId: selectedInputId,
        });
        if (!st.transport.isPlaying) {
          startPlayback();
        }
      } catch (err) {
        console.error('[Maestro REC] erro ao iniciar gravação:', err);
        alert('Não foi possível acessar a entrada de áudio. Verifique as permissões de microfone.');
      }
    }
  };

  const isSelected = selectedTrackId === track.id;
  const trackHeight = Math.round((track.height ?? 40) * zoomV);
  const isFolder = track.isSubgroup;

  return (
    <div
      data-selectable="track"
      className={`group relative flex items-center border-b border-logic-border-dark cursor-pointer transition-colors duration-75
        ${isSelected ? 'bg-logic-accent-dim' : isFolder ? 'bg-logic-bg-deep/60 hover:bg-logic-bg-panel-light' : 'hover:bg-logic-bg-panel-light'}`}
      style={{ paddingLeft: `${8 + depth * 16}px`, height: `${trackHeight}px` }}
      onClick={() => selectTrack(track.id)}
      onDoubleClick={(e) => { if (isFolder) { e.stopPropagation(); onToggle?.(); } }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, track);
        }
      }}
      title={isFolder ? 'Pasta: clique direito para renomear, mudar cor ou opções' : 'Faixa: clique direito para renomear, mudar cor, rotear saída ou mover para pasta'}
    >
      {!isFolder && <TrackHeightHandle trackId={track.id} edge="top" />}
      {!isFolder && <TrackHeightHandle trackId={track.id} edge="bottom" />}
      {isFolder ? (
        <button
          className="mr-1 text-logic-text-muted hover:text-logic-text flex items-center"
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          aria-label={expanded ? 'Recolher pasta' : 'Expandir pasta'}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="w-4" />
      )}

      {isFolder ? (
        <span className="mr-1.5 flex items-center" style={{ color: track.color }}>
          {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
        </span>
      ) : (
        <div
          className="w-1 h-6 rounded-sm mr-2 flex-shrink-0"
          style={{ backgroundColor: track.color }}
        />
      )}

      <span className={`text-xs flex-1 truncate ${isSelected ? 'text-white' : isFolder ? 'text-logic-text font-medium uppercase tracking-wide' : 'text-logic-text'}`}>
        {track.name}
        {isFolder && (
          <span className="ml-1.5 text-2xs text-logic-text-muted font-normal normal-case tracking-normal">
            ({childClipCount})
          </span>
        )}
      </span>

      <div className="flex items-center gap-1 mr-1">
        {isMaestro && (
          <div className="flex items-center gap-1 relative" ref={inputMenuRef}>
            <button
              type="button"
              className={`w-5 h-5 rounded flex items-center justify-center font-bold text-xs transition-all ${
                isRecording
                  ? 'bg-logic-lcd-red text-white animate-pulse shadow-[0_0_8px_rgba(255,69,58,0.9)]'
                  : 'bg-logic-bg-deep text-logic-text-muted hover:text-logic-lcd-red hover:bg-logic-lcd-red/10'
              }`}
              onClick={handleToggleRec}
              title={isRecording ? 'Gravando voz do Maestro: clique para parar e salvar' : 'Gravar áudio na faixa Maestro (REC)'}
            >
              <span className="text-[11px] leading-none">●</span>
            </button>
            <button
              type="button"
              className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                showInputMenu ? 'bg-logic-accent text-white' : 'bg-logic-bg-deep text-logic-text-muted hover:text-white'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                setShowInputMenu(!showInputMenu);
              }}
              title="Selecionar entrada da placa de áudio (Input)"
            >
              <Mic size={11} />
            </button>
            {showInputMenu && (
              <div
                className="absolute right-0 top-full mt-1 z-[300] py-1 bg-[#161720] border border-white/20 rounded-xl shadow-2xl text-2xs min-w-[220px] max-w-[300px] animate-[fadeIn_100ms_ease-out]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 text-logic-text-muted font-bold border-b border-white/10 uppercase tracking-wider text-[9px]">
                  Entrada da Placa de Áudio (Input)
                </div>
                {inputDevices.length === 0 ? (
                  <div className="px-3 py-2 text-logic-text-dim text-[11px]">
                    Nenhuma entrada de áudio detectada
                  </div>
                ) : (
                  inputDevices.map((d) => (
                    <button
                      key={d.deviceId}
                      type="button"
                      className={`w-full px-3 py-1.5 text-left truncate flex items-center justify-between hover:bg-white/10 transition ${
                        (selectedInputId === d.deviceId || (!selectedInputId && inputDevices[0]?.deviceId === d.deviceId))
                          ? 'text-logic-lcd-green font-bold bg-white/[0.04]'
                          : 'text-white'
                      }`}
                      onClick={() => {
                        setSelectedInputId(d.deviceId);
                        setShowInputMenu(false);
                      }}
                    >
                      <span className="truncate">{d.label}</span>
                      {(selectedInputId === d.deviceId || (!selectedInputId && inputDevices[0]?.deviceId === d.deviceId)) && (
                        <Check size={12} className="text-logic-lcd-green shrink-0 ml-1.5" />
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
            {isMaestro && <InputVuMeter />}
          </div>
        )}
        <button
          className={`w-6 h-5 text-2xs font-bold rounded transition-colors duration-75 ${track.mute ? 'bg-logic-lcd-amber text-black' : 'bg-logic-bg-deep text-logic-text-muted hover:text-logic-text'}`}
          onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
        >M</button>
        <button
          className={`w-6 h-5 text-2xs font-bold rounded transition-colors duration-75 ${track.solo ? 'bg-logic-lcd-amber text-black' : 'bg-logic-bg-deep text-logic-text-muted hover:text-logic-text'}`}
          onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
        >S</button>
      </div>
    </div>
  );
}

function FolderGroup({ track, onContextMenu }: {
  track: Track;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  return (
    <>
      <TrackRow track={track} depth={0} expanded={expanded} onToggle={toggle} onContextMenu={onContextMenu} />
      {expanded && track.children.map((childId) => (
        <ChildTrackRow key={childId} childId={childId} depth={1} expanded={true} onToggle={() => {}} onContextMenu={onContextMenu} />
      ))}
    </>
  );
}

// Knob minúsculo de ganho do clipe (modo DAW):
// - Centro (12h / 0°): 0dB (ganho original 1x)
// - Lado direito (até +135°): +12dB (~3.98x)
// - Lado esquerdo (até -135°): silêncio total (-inf dB / 0 volume)
function ClipGainKnob({ clipId, gain }: { clipId: string; gain: number }) {
  const setClipGain = useStore((s) => s.setClipGain);

  const angle = useMemo(() => {
    if (gain <= 0.0001) return -135;
    if (gain >= 1) {
      const db = Math.min(12, 20 * Math.log10(gain));
      return (db / 12) * 135;
    } else {
      const db = Math.max(-48, 20 * Math.log10(gain));
      return (db / 48) * 135; // negativo
    }
  }, [gain]);

  const db = gain <= 0.0001 ? -Infinity : 20 * Math.log10(gain);
  const dbLabel = db === -Infinity ? '-inf (Mudo)' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}dB`;
  const pointerColor = db === -Infinity ? '#ff453a' : db > 0.1 ? '#30d158' : db < -0.1 ? '#ff9f0a' : '#ffffff';

  return (
    <div
      className="w-4 h-4 relative cursor-ns-resize select-none shrink-0"
      onDoubleClick={(e) => { e.stopPropagation(); setClipGain(clipId, 1); }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startGain = gain;
        const move = (ev: PointerEvent) => {
          const deltaY = startY - ev.clientY;
          const startDb = startGain <= 0.0001 ? -48 : 20 * Math.log10(startGain);
          const nextDb = Math.min(12, startDb + deltaY * 0.3);
          if (nextDb <= -42) {
            setClipGain(clipId, 0);
          } else {
            const nextGain = Math.round(Math.pow(10, nextDb / 20) * 100) / 100;
            setClipGain(clipId, nextGain);
          }
        };
        const up = () => {
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
      }}
      onClick={(e) => e.stopPropagation()}
      title={`Ganho do clipe: ${dbLabel} (arraste = ajustar, duplo clique = 0dB)`}
    >
      <svg viewBox="0 0 28 28" className="absolute inset-0 w-full h-full pointer-events-none">
        <circle cx="14" cy="14" r="12.5" fill="#1a1a1c" stroke="#3a3a3e" strokeWidth="1" />
        <circle cx="14" cy="14" r="9" fill="#26262a" stroke="#111" strokeWidth="0.5" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '14px 14px' }}>
          <line x1="14" y1="14" x2="14" y2="5" stroke={pointerColor} strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}

// Botões minúsculos de mudo/solo do clipe (modo DAW). Solo isola o clipe só dentro da
// própria música (não afeta outras músicas abertas).
function ClipMuteSolo({ clip }: { clip: AudioClip }) {
  const toggleClipMute = useStore((s) => s.toggleClipMute);
  const toggleClipSolo = useStore((s) => s.toggleClipSolo);
  return (
    <div className="flex gap-0.5 shrink-0">
      <button
        className={`w-4 h-3.5 text-[8px] font-bold rounded-sm leading-none flex items-center justify-center transition-colors ${clip.mute ? 'bg-logic-lcd-amber text-black' : 'bg-black/40 text-white/70 hover:text-white'}`}
        onClick={(e) => { e.stopPropagation(); toggleClipMute(clip.id); }}
        title="Mudo deste clipe"
      >M</button>
      <button
        className={`w-4 h-3.5 text-[8px] font-bold rounded-sm leading-none flex items-center justify-center transition-colors ${clip.solo ? 'bg-logic-lcd-amber text-black' : 'bg-black/40 text-white/70 hover:text-white'}`}
        onClick={(e) => { e.stopPropagation(); toggleClipSolo(clip.id); }}
        title="Solo deste clipe (dentro da música)"
      >S</button>
    </div>
  );
}

const FADE_CURVE_OPTIONS: Array<{
  id: FadeCurve;
  label: string;
  desc: string;
}> = [
  { id: 'linear', label: 'Linear', desc: 'Reta uniforme padrão' },
  { id: 'exponential', label: 'Exponencial', desc: 'Curva rápida (Equal Power)' },
  { id: 's-curve', label: 'Curva em S', desc: 'S-Curve suave sem cliques' },
  { id: 'logarithmic', label: 'Logarítmica', desc: 'Curva lenta suave no topo' },
];

// Alça do fade in/out com linha vertical marcando o final e menu de botão direito para escolha de curva
function FadeHandle({
  clipId,
  side,
  seconds,
  curve = 'linear',
  playLength,
  zoomH,
  editable,
}: {
  clipId: string;
  side: 'in' | 'out';
  seconds: number;
  curve?: FadeCurve;
  playLength: number;
  zoomH: number;
  editable: boolean;
}) {
  const setClipFade = useStore((s) => s.setClipFade);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const widthPx = Math.max(0, Math.min(playLength, seconds)) * zoomH;

  useEffect(() => {
    if (!menuPos) return;
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [menuPos]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startSeconds = seconds;
    const move = (ev: PointerEvent) => {
      const deltaPx = side === 'in' ? ev.clientX - startX : startX - ev.clientX;
      const next = Math.max(0, Math.min(playLength, startSeconds + deltaPx / zoomH));
      setClipFade(clipId, side === 'in' ? { fadeIn: next } : { fadeOut: next });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  // Paths em viewBox 0 0 100 100
  // y = 0 é o topo do clipe (100% volume); y = 100 é a base (0% volume)
  const { linePath, maskPath } = useMemo(() => {
    if (widthPx <= 1) return { linePath: '', maskPath: '' };
    if (side === 'in') {
      let line = 'M 0,100 L 100,0';
      let mask = 'M 0,0 L 100,0 L 0,100 Z';
      if (curve === 'exponential') {
        line = 'M 0,100 Q 80,100 100,0';
        mask = 'M 0,0 L 100,0 Q 80,100 0,100 Z';
      } else if (curve === 'logarithmic') {
        line = 'M 0,100 Q 15,0 100,0';
        mask = 'M 0,0 L 100,0 Q 15,0 0,100 Z';
      } else if (curve === 's-curve') {
        line = 'M 0,100 C 45,100 55,0 100,0';
        mask = 'M 0,0 L 100,0 C 55,0 45,100 0,100 Z';
      }
      return { linePath: line, maskPath: mask };
    } else {
      let line = 'M 0,0 L 100,100';
      let mask = 'M 0,0 L 100,0 L 100,100 Z';
      if (curve === 'exponential') {
        line = 'M 0,0 Q 20,100 100,100';
        mask = 'M 0,0 L 100,0 L 100,100 Q 20,100 0,0 Z';
      } else if (curve === 'logarithmic') {
        line = 'M 0,0 Q 85,0 100,100';
        mask = 'M 0,0 L 100,0 L 100,100 Q 85,0 0,0 Z';
      } else if (curve === 's-curve') {
        line = 'M 0,0 C 45,0 55,100 100,100';
        mask = 'M 0,0 L 100,0 L 100,100 C 55,100 45,0 0,0 Z';
      }
      return { linePath: line, maskPath: mask };
    }
  }, [widthPx, side, curve]);

  return (
    <>
      {widthPx > 1 && (
        <div
          className="absolute top-0 bottom-0 pointer-events-none overflow-hidden"
          style={{
            [side === 'in' ? 'left' : 'right']: 0,
            width: `${widthPx}px`,
          }}
        >
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {/* Máscara escura preenchida que segue fielmente a forma da curva do fade */}
            <path d={maskPath} fill="rgba(0, 0, 0, 0.65)" />
            {/* Linha branca brilhante de 2.5px que destaca a curva */}
            <path
              d={linePath}
              stroke="#ffffff"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              fill="none"
              style={{ filter: 'drop-shadow(0px 0px 2px rgba(0,0,0,0.9))' }}
            />
          </svg>
        </div>
      )}

      {editable && (
        <>
          {/* Alça e Ícone de Fade no topo da aresta */}
          <div
            className={`absolute top-0 w-7 h-[18px] cursor-ew-resize z-40 group/fadeHandle flex items-center justify-center select-none ${
              side === 'in' ? 'left-0' : 'right-0'
            }`}
            onPointerDown={handlePointerDown}
            onContextMenu={handleContextMenu}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => { e.stopPropagation(); setClipFade(clipId, side === 'in' ? { fadeIn: 0 } : { fadeOut: 0 }); }}
            title={`Fade ${side === 'in' ? 'In (Entrada)' : 'Out (Saída)'}: ${seconds.toFixed(2)}s (${curve}) — Arraste para criar/ajustar, botão direito para mudar a curva`}
          >
            <div
              className={`w-5 h-3.5 rounded-sm flex items-center justify-center transition-all ${
                seconds > 0
                  ? 'bg-logic-lcd-amber/35 border border-logic-lcd-amber/90 text-logic-lcd-amber shadow'
                  : 'bg-black/70 border border-white/40 text-white/90 opacity-0 group-hover/clip:opacity-75 group-hover/fadeHandle:opacity-100 group-hover/fadeHandle:bg-logic-accent group-hover/fadeHandle:border-white shadow'
              }`}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                {side === 'in' ? (
                  <path d="M 2 13 Q 8 13 14 3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                ) : (
                  <path d="M 2 3 Q 8 13 14 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                )}
              </svg>
            </div>
          </div>

          {/* LINHA VERTICAL NO FINAL DO FADE (indicador visual + arrastável) */}
          {widthPx > 2 && (
            <div
              className="absolute top-0 bottom-0 z-20 group/fadeLine cursor-ew-resize select-none"
              style={{
                [side === 'in' ? 'left' : 'right']: `${widthPx}px`,
                transform: side === 'in' ? 'translateX(-50%)' : 'translateX(50%)',
                width: '16px',
              }}
              onPointerDown={handlePointerDown}
              onContextMenu={handleContextMenu}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => { e.stopPropagation(); setClipFade(clipId, side === 'in' ? { fadeIn: 0 } : { fadeOut: 0 }); }}
              title={`Final do Fade (${seconds.toFixed(2)}s, curva: ${curve}) — Arraste para alterar, botão direito para mudar a curva`}
            >
              {/* Linha vertical visível */}
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-white group-hover/fadeLine:bg-logic-lcd-amber group-hover/fadeLine:w-[3px] transition-all shadow-[0_0_5px_rgba(0,0,0,0.9)]" />
              {/* Pegador no centro */}
              <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-2.5 h-5 rounded-full bg-white group-hover/fadeLine:bg-logic-lcd-amber border border-black shadow flex items-center justify-center">
                <div className="w-0.5 h-2 bg-black/60 rounded-full" />
              </div>
            </div>
          )}

          {/* Menu de Contexto ao clicar com botão direito na linha do Fade */}
          {menuPos && (
            <div
              ref={menuRef}
              className="fixed z-[400] py-1.5 bg-[#13141a] border border-white/20 rounded-xl shadow-2xl text-xs text-white min-w-[210px] animate-[fadeIn_100ms_ease-out]"
              style={{ left: menuPos.x, top: menuPos.y }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-logic-text-muted border-b border-white/10 tracking-wider">
                Curva de Fade {side === 'in' ? 'Entrada' : 'Saída'}
              </div>
              {FADE_CURVE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setClipFade(clipId, side === 'in' ? { fadeCurveIn: opt.id } : { fadeCurveOut: opt.id });
                    setMenuPos(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-white/10 transition ${
                    curve === opt.id ? 'text-logic-lcd-green font-bold bg-white/[0.04]' : 'text-white'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {opt.id === 'linear' && <span>📈</span>}
                      {opt.id === 'exponential' && <span>📉</span>}
                      {opt.id === 's-curve' && <span>〰️</span>}
                      {opt.id === 'logarithmic' && <span>📊</span>}
                      <span>{opt.label}</span>
                    </span>
                    <span className="text-[10px] text-logic-text-dim font-normal">{opt.desc}</span>
                  </div>
                  {curve === opt.id && <Check size={14} className="text-logic-lcd-green shrink-0 ml-2" />}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ClipBlock({ clip, isSelected, onSelect, onTrimStart, onMoveStart, trim, move, trackHeight, zoomH, visible, allowMove, timelineLocked }: {
  clip: AudioClip; isSelected: boolean; onSelect: (additive: boolean) => void;
  onTrimStart: (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip, side: 'start' | 'end') => void;
  onMoveStart: (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip) => void;
  trim: TrimDrag; move: MoveDrag; trackHeight: number; zoomH: number; visible: VisibleRange; allowMove: boolean; timelineLocked: boolean;
}) {
  const dawMode = useStore((s) => s.dawMode);
  const trimming = !!trim && trim.ids.has(clip.id);
  const isTrimStart = trimming && trim.side === "start";
  const isTrimEnd = trimming && trim.side !== "start";
  const trimStart = isTrimStart
    ? Math.max(0, (clip.trimStart ?? 0) + trim.delta)
    : clip.trimStart ?? 0;
  const trimEnd = isTrimEnd
    ? Math.max(0, Math.min(clip.duration - 0.05, (clip.trimEnd ?? 0) - trim.delta))
    : clip.trimEnd ?? 0;
  const playLength = clipPlayLength({ duration: clip.duration, trimStart, trimEnd });
  const moving = !!move && move.ids.has(clip.id);
  const effectiveStart = moving
    ? Math.max(0, clip.startTime + move.delta)
    : isTrimStart
      ? Math.max(0, clip.startTime + trim.delta)
      : clip.startTime;
  const left = effectiveStart * zoomH;
  const fullWidth = Math.max(30, clip.duration * zoomH);
  const width = Math.max(8, playLength * zoomH);
  if (left > visible.end || left + fullWidth < visible.start) return null;
  const isMuted = !!clip.mute;
  const routingColor = isMuted ? '#666670' : routingColorOf(clip);
  const innerHeight = trackHeight - 4;
  const labelLeft = Math.max(0, visible.start - left);
  const labelWidth = Math.min(width, visible.end - left) - labelLeft;
  const isTrimmed = trimEnd > 0.001;
  const hasAdjustments = isMuted || clip.solo || (clip.gain !== undefined && clip.gain !== 1) || !!clip.fadeIn || !!clip.fadeOut;
  const showControls = dawMode && innerHeight >= 20;

  return (
    <>
      {trimStart > 0.001 && (
        <div
          className="absolute rounded-sm border border-dashed pointer-events-none"
          style={{
            left: `${(effectiveStart - trimStart) * zoomH}px`,
            top: '2px',
            width: `${trimStart * zoomH}px`,
            height: `${innerHeight}px`,
            borderColor: isMuted ? '#4b4b52' : routingColor,
            opacity: isTrimStart ? 0.35 : 0.15,
          }}
          title="Início cortado (esquerda)"
        />
      )}
      {trimEnd > 0.001 && (
        <div
          className="absolute rounded-sm border border-dashed pointer-events-none"
          style={{
            left: `${left + width}px`,
            top: '2px',
            width: `${trimEnd * zoomH}px`,
            height: `${innerHeight}px`,
            borderColor: isMuted ? '#4b4b52' : routingColor,
            opacity: isTrimEnd ? 0.35 : 0.15,
          }}
          title="Fim cortado (direita)"
        />
      )}
      <div
        data-selectable="clip"
        className={`group/clip absolute rounded-sm border overflow-hidden ${
          isSelected
            ? 'bg-white/15 shadow-[0_0_14px_rgba(255,255,255,0.45)] brightness-110 z-20'
            : isMuted
              ? 'bg-[#18181c]/90 opacity-55 grayscale'
              : clip.routingMethod === 'ai'
                ? 'bg-[#0a84ff]/15'
                : 'bg-black/30'
        } ${allowMove ? 'cursor-grab active:cursor-grabbing hover:border-white' : timelineLocked ? 'cursor-default' : 'cursor-pointer'}`}
        style={{
          left: `${left}px`,
          top: '2px',
          width: `${width}px`,
          height: `${innerHeight}px`,
          borderColor: isSelected ? '#ffffff' : (isMuted ? '#52525b' : routingColor),
          borderWidth: isSelected ? '2px' : '1px',
          lineHeight: 0,
        }}
        onClick={(e) => {
          e.stopPropagation();
          // Clicar no clipe mantem selecionado ou expande com ctrl/cmd
          onSelect(e.ctrlKey || e.metaKey);
        }}
        onPointerDown={(e) => {
          if (allowMove && e.button === 0) {
            onMoveStart(e, clip);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const openMenu = (window as unknown as { __openClipContextMenu?: (e: MouseEvent, clipId: string) => void }).__openClipContextMenu;
          openMenu?.(e.nativeEvent, clip.id);
        }}
      >
        {/* Alça de corte inicial com ícone de setas ↔ (Abaixo da área de fade no topo) */}
        {!timelineLocked && (
          <div
            className={`group/trimStart absolute top-[20px] left-0 bottom-0 w-3.5 cursor-ew-resize flex items-center justify-start z-30 transition-opacity ${
              isSelected || isTrimStart ? "opacity-100" : "opacity-0 group-hover/clip:opacity-100"
            }`}
            onPointerDown={(e) => onTrimStart(e, clip, "start")}
            onClick={(e) => e.stopPropagation()}
            title="Cortar início do áudio (arraste para a direita para cortar)"
          >
            <div className="w-[3px] h-full bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.7)] rounded-full transition-transform group-hover/trimStart:scale-x-125" />
            <div className="absolute top-1/2 -translate-y-1/2 left-0.5 px-0.5 py-0.5 rounded bg-black/85 border border-white/60 text-[8px] font-mono text-white leading-none opacity-0 group-hover/trimStart:opacity-100 shadow transition-opacity pointer-events-none">
              ↔
            </div>
          </div>
        )}
        {/* Forma de onda deslocada por -trimStart para que o corte no início mantenha o áudio travado na timeline */}
        <div
          className="absolute top-0 bottom-0 pointer-events-none overflow-hidden"
          style={{
            left: `${-(trimStart || 0) * zoomH}px`,
            width: `${fullWidth}px`,
            height: `${innerHeight}px`,
          }}
        >
          <ClipWaveform clip={clip} left={left - (trimStart || 0) * zoomH} width={fullWidth} height={innerHeight} visible={visible} />
        </div>
        <FadeHandle
          clipId={clip.id} side="in" seconds={clip.fadeIn ?? 0}
          curve={clip.fadeCurveIn ?? 'linear'}
          playLength={playLength} zoomH={zoomH}
          editable={showControls && !timelineLocked}
        />
        <FadeHandle
          clipId={clip.id} side="out" seconds={clip.fadeOut ?? 0}
          curve={clip.fadeCurveOut ?? 'linear'}
          playLength={playLength} zoomH={zoomH}
          editable={showControls && !timelineLocked}
        />
        <div
          className="absolute top-0 bottom-0 flex items-start justify-start px-1.5 pt-0.5 text-xs font-medium pointer-events-none"
          style={{ left: `${labelLeft}px`, width: `${Math.max(0, labelWidth)}px`, color: isMuted ? '#a1a1aa' : routingColor, textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
        >
          <span className="truncate flex items-center gap-1.5">
            <span>{clip.name}</span>
            {clip.routingMethod === 'ai' && (
              <span className="px-1 py-0.2 rounded bg-[#0a84ff]/30 text-[8px] font-bold text-[#0a84ff] border border-[#0a84ff]/50 uppercase tracking-wider">
                IA
              </span>
            )}
            {isMuted && (
              <span className="px-1 py-0.2 rounded bg-logic-lcd-amber/20 text-[9px] font-bold text-logic-lcd-amber uppercase">
                MUDO
              </span>
            )}
          </span>
        </div>
        {clip.groupId && (
          <div
            className="absolute top-0.5 right-6 px-1.5 py-0.5 rounded bg-logic-accent/90 text-[9px] font-bold text-white tracking-wider flex items-center gap-0.5 z-10 pointer-events-none shadow"
            title="Áudio agrupado (Cmd+G para agrupar, Cmd+U para desagrupar)"
          >
            <Link2 size={8} />
            <span>GRP</span>
          </div>
        )}
        {isSelected && (
          <div className="absolute bottom-0.5 right-6 px-1.5 py-0.5 rounded bg-logic-lcd-green text-[8px] font-bold text-black uppercase tracking-wider z-10 pointer-events-none shadow">
            SELECIONADO
          </div>
        )}
        {showControls && (
          <div className="absolute bottom-0.5 left-1 flex items-center gap-1 z-10">
            <ClipGainKnob clipId={clip.id} gain={clip.gain ?? 1} />
            <ClipMuteSolo clip={clip} />
          </div>
        )}
        {!showControls && hasAdjustments && (
          <div
            className="absolute bottom-0.5 left-1 w-1.5 h-1.5 rounded-full bg-logic-lcd-amber z-10"
            title="Este clipe tem ajustes do modo DAW (ganho, mudo, solo ou fade)"
          />
        )}
        {isSelected && <div className="absolute inset-0 ring-2 ring-white shadow-[inset_0_0_10px_rgba(255,255,255,0.35)] rounded-sm pointer-events-none" />}
        {/* Alça de corte final com ícone de setas ↔ (Abaixo da área de fade no topo) */}
        {!timelineLocked && (
          <div
            className={`group/trimEnd absolute top-[20px] right-0 bottom-0 w-3.5 cursor-ew-resize flex items-center justify-end z-30 transition-opacity ${
              isSelected || isTrimEnd ? "opacity-100" : "opacity-0 group-hover/clip:opacity-100"
            }`}
            onPointerDown={(e) => onTrimStart(e, clip, "end")}
            onClick={(e) => e.stopPropagation()}
            title="Cortar fim do áudio (arraste para a esquerda para cortar)"
          >
            <div className="w-[3px] h-full bg-white/90 shadow-[0_0_6px_rgba(255,255,255,0.7)] rounded-full transition-transform group-hover/trimEnd:scale-x-125" />
            <div className="absolute top-1/2 -translate-y-1/2 right-0.5 px-0.5 py-0.5 rounded bg-black/85 border border-white/60 text-[8px] font-mono text-white leading-none opacity-0 group-hover/trimEnd:opacity-100 shadow transition-opacity pointer-events-none">
              ↔
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FooterProgress({ importProgress, exportProgress }: {
  importProgress: ImportProgress | null;
  exportProgress: { active: boolean; message: string } | null;
}) {
  const item = importProgress
    ? {
        message: importProgress.message,
        count: importProgress.total ? `${importProgress.current ?? 0}/${importProgress.total}` : null,
        status: importProgress.status,
        pct: importProgress.total
          ? Math.round(((importProgress.current ?? 0) / importProgress.total) * 100)
          : importProgress.status === 'done' ? 100 : null,
      }
    : exportProgress
      ? { message: exportProgress.message, count: null, status: exportProgress.active ? 'working' : 'done', pct: exportProgress.active ? null : 100 }
      : null;
  if (!item) return <div className="flex-1" />;
  const done = item.status === 'done';
  const failed = item.status === 'error';
  const tone = done ? 'bg-logic-lcd-green' : failed ? 'bg-logic-lcd-red' : 'bg-logic-accent';
  return (
    <div className="flex-1 min-w-0 flex items-center justify-center gap-2 px-4 animate-[fadeIn_120ms_ease-out]" role="status">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${tone} ${!done && !failed ? 'animate-pulse' : ''}`} />
      <span className={`truncate max-w-[50%] ${failed ? 'text-logic-lcd-red' : 'text-logic-text-dim'}`}>{item.message}</span>
      {item.count && <span className="font-mono flex-shrink-0">{item.count}</span>}
      <div className="w-32 h-1 bg-logic-border-dark rounded-full overflow-hidden flex-shrink-0">
        {item.pct === null ? (
          <div className={`h-full w-1/3 rounded-full ${tone} animate-pulse`} />
        ) : (
          <div className={`h-full rounded-full transition-all duration-300 ${tone}`} style={{ width: `${item.pct}%` }} />
        )}
      </div>
    </div>
  );
}

const VIEW_MARGIN_PX = 600;

export default function TimelinePanel() {
  const tracks = useStore((s) => s.tracks);
  const [trackContextMenu, setTrackContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null);

  const handleOpenTrackMenu = useCallback((e: React.MouseEvent, tr: Track) => {
    e.preventDefault();
    e.stopPropagation();
    setTrackContextMenu({ track: tr, x: e.clientX, y: e.clientY });
  }, []);
  const songs = useStore((s) => s.songs);
  const playlist = useStore((s) => s.playlist);
  const clips = useStore((s) => s.clips);
  const selectedSongId = useStore((s) => s.selectedSongId);
  const selectedClipIds = useStore((s) => s.selectedClipIds);
  const selectClip = useStore((s) => s.selectClip);
  const selectClips = useStore((s) => s.selectClips);
  const trimClips = useStore((s) => s.trimClips);
  const snapStep = useStore((s) => s.snapStep);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const importProgress = useStore((s) => s.importProgress);
  const exportProgress = useStore((s) => s.exportProgress);
  const loadingSongIds = useStore((s) => s.loadingSongIds);
  const zoomH = useStore((s) => s.zoomH);
  const zoomV = useStore((s) => s.zoomV);
  const setZoomH = useStore((s) => s.setZoomH);
  const setZoomV = useStore((s) => s.setZoomV);
  const HEADER_W = useStore((s) => s.trackHeaderWidth);
  const setTrackHeaderWidth = useStore((s) => s.setTrackHeaderWidth);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const addSongRegion = useStore((s) => s.addSongRegion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [regionDrag, setRegionDrag] = useState<RegionDrag>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  const [visible, setVisible] = useState<VisibleRange>({ start: 0, end: 4000 });
  const [noSpaceHint, setNoSpaceHint] = useState(false);
  const [trimDrag, setTrimDrag] = useState<TrimDrag>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag>(null);
  const updateClip = useStore((s) => s.updateClip);
  const updateClips = useStore((s) => s.updateClips);
  const splitClipAt = useStore((s) => s.splitClipAt);
  const splitClipsAt = useStore((s) => s.splitClipsAt);
  const removeClips = useStore((s) => s.removeClips);
  const recordingMaestro = useStore((s) => s.recordingMaestro);
  const timelineLocked = useStore((s) => s.timelineLocked);
  const toggleTimelineLocked = useStore((s) => s.toggleTimelineLocked);
  const groupClips = useStore((s) => s.groupClips);
  const ungroupClips = useStore((s) => s.ungroupClips);
  const zoomAnchorRef = useRef<{ time: number; mouseX: number } | null>(null);
  const [openMenu, setOpenMenu] = useState<'edit' | 'functions' | 'view' | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handleCloseMenu = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleCloseMenu);
    return () => document.removeEventListener('mousedown', handleCloseMenu);
  }, [openMenu]);

  const activeSongId = selectedSongId ?? playlist[0]?.songId ?? null;
  const song = songs.find((sg) => sg.id === activeSongId);
  const grid = useMemo(() => songGrid(song), [song]);
  const isSongLoading = !!song && loadingSongIds.includes(song.id);
  const songClips = useMemo(() =>
    song ? clips.filter((c) => c.songId === song.id) : [],
    [clips, song]
  );
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const selectAllSongClips = useCallback(() => {
    selectClips(songClips.map((c) => c.id));
  }, [selectClips, songClips]);

  const handleSplitAtCursor = useCallback(() => {
    if (!song || timelineLocked) return;
    const st = useStore.getState();
    const cursor = st.transport.isPlaying && st.transport.currentSongId === song.id
      ? audioEngine.getCurrentTime()
      : st.transport.currentTime;

    // Todos os clipes da música que cruzam o cursor no momento
    const crossingClips = songClips.filter(
      (c) => cursor > c.startTime && cursor < c.startTime + clipPlayLength(c)
    );
    if (crossingClips.length === 0) return;

    // Clipes selecionados que cruzam o cursor
    const selectedCrossing = crossingClips.filter((c) => selectedSet.has(c.id));

    // Se houver algum clipe selecionado cruzando o cursor, divide eles.
    // Se nenhum estiver selecionado (ou se todos estiverem), divide todos os que cruzam o cursor!
    const targetIds = selectedCrossing.length > 0
      ? selectedCrossing.map((c) => c.id)
      : crossingClips.map((c) => c.id);

    const ok = splitClipsAt(targetIds, cursor);
    if (ok) {
      audioEngine.invalidatePrepared(song.id);
    }
  }, [song, songClips, selectedSet, splitClipsAt, timelineLocked]);

  const handleDeleteSelectedClips = useCallback(() => {
    if (timelineLocked || selectedClipIds.length === 0) return;
    const targetIds = [...selectedClipIds];
    audioEngine.stopClipsLive(targetIds);
    removeClips(targetIds);
    if (song) audioEngine.invalidatePrepared(song.id);
  }, [timelineLocked, selectedClipIds, removeClips, song]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Tecla Delete ou Backspace exclui clipes selecionados
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.length > 0 && !timelineLocked) {
          e.preventDefault();
          handleDeleteSelectedClips();
          return;
        }
      }

      // Atalho S (Split): corta o áudio no meio/cursor
      if ((!ctrl && key === 's') || (ctrl && key === 't')) {
        e.preventDefault();
        handleSplitAtCursor();
        return;
      }

      if (!ctrl) return;

      if (key === 'a') {
        e.preventDefault();
        selectAllSongClips();
      } else if (key === 'g') {
        e.preventDefault();
        if (selectedClipIds.length >= 2) {
          groupClips(selectedClipIds);
        }
      } else if (key === 'u') {
        e.preventDefault();
        if (selectedClipIds.length > 0) {
          ungroupClips(selectedClipIds);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectAllSongClips, selectedClipIds, groupClips, ungroupClips, handleSplitAtCursor, handleDeleteSelectedClips, timelineLocked]);

  const handleTrimStart = (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip, side: "start" | "end" = "end") => {
    if (timelineLocked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Trimming opera exclusivamente no clipe clicado (ou nos membros do seu grupo se estiver agrupado com Cmd+G)
    const targets = clip.groupId
      ? songClips.filter((c) => c.groupId === clip.groupId)
      : [clip];
    const idSet = new Set(targets.map((c) => c.id));
    selectClips(targets.map((c) => c.id));

    const isStart = side === "start";
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    let delta = 0;

    if (isStart) {
      // Arrastar a aresta esquerda para a direita (+X) corta o início do áudio
      const maxCut = clipPlayLength(clip) - 0.05; // não deixa o clipe sumir
      const maxRestore = clip.trimStart ?? 0; // não deixa expandir além do início original
      const origStart = clip.startTime;
      const describe = (st: number) => (grid ? `${formatRegionTime(st)} | ${barBeatLabel(st, grid)}` : formatRegionTime(st));
      const move = (ev: PointerEvent) => {
        const raw = origStart + (ev.clientX - startX) / zoomH;
        const snapped = snapTime(raw, grid, ev.altKey ? "off" : snapStep);
        delta = Math.max(-maxRestore, Math.min(maxCut, snapped - origStart));
        const newStart = origStart + delta;
        setTrimDrag({ ids: idSet, delta, anchorId: clip.id, end: newStart, label: describe(newStart), side: "start" });
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        setTrimDrag(null);
        if (Math.abs(delta) < 1e-4) return;
        updateClips(targets.map((c) => ({
          id: c.id,
          patch: {
            startTime: Math.max(0, c.startTime + delta),
            trimStart: Math.max(0, (c.trimStart ?? 0) + delta),
          },
        })));
        audioEngine.invalidatePrepared(song?.id);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    } else {
      // Arrastar a aresta direita para a esquerda (-X) corta o fim do áudio
      const maxCut = clipPlayLength(clip) - 0.05; // não deixa o clipe sumir
      const maxRestore = clip.trimEnd ?? 0; // não deixa expandir além do fim original
      const origEnd = clip.startTime + clipPlayLength(clip);
      const describe = (end: number) => (grid ? `${formatRegionTime(end)} | ${barBeatLabel(end, grid)}` : formatRegionTime(end));
      const move = (ev: PointerEvent) => {
        const raw = origEnd + (ev.clientX - startX) / zoomH;
        const snapped = snapTime(raw, grid, ev.altKey ? "off" : snapStep);
        delta = Math.max(-maxCut, Math.min(maxRestore, snapped - origEnd));
        const end = origEnd + delta;
        setTrimDrag({ ids: idSet, delta, anchorId: clip.id, end, label: describe(end), side: "end" });
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        setTrimDrag(null);
        if (Math.abs(delta) < 1e-4) return;
        updateClips(targets.map((c) => ({
          id: c.id,
          patch: {
            trimEnd: Math.max(0, (c.trimEnd ?? 0) - delta),
          },
        })));
        audioEngine.invalidatePrepared(song?.id);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const handleMoveStart = (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip) => {
    if (timelineLocked) return;
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("button, input, [role=\"button\"], .group\\/fadeLine")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const additive = e.ctrlKey || e.metaKey;
    let ids = selectedClipIds.filter((id) => songClips.some((c) => c.id === id));
    if (!ids.includes(clip.id)) {
      const groupMembers = clip.groupId
        ? songClips.filter((c) => c.groupId === clip.groupId).map((c) => c.id)
        : [clip.id];
      ids = additive ? [...ids, ...groupMembers] : groupMembers;
      selectClips(ids);
    } else {
      const targetClips = songClips.filter((c) => ids.includes(c.id));
      const groupIds = new Set(targetClips.map((c) => c.groupId).filter(Boolean));
      if (groupIds.size > 0) {
        for (const c of songClips) {
          if (c.groupId && groupIds.has(c.groupId) && !ids.includes(c.id)) {
            ids.push(c.id);
          }
        }
        selectClips(ids);
      }
    }
    const idSet = new Set(ids);
    const targets = songClips.filter((c) => idSet.has(c.id));
    if (targets.length === 0) return;

    // Menor startTime entre os alvos para nao deixar arrastar antes de zero
    const minStart = Math.min(...targets.map((c) => c.startTime));
    const origStart = clip.startTime;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    let delta = 0;

    const describe = (st: number) => (grid ? `${formatRegionTime(st)} | ${barBeatLabel(st, grid)}` : formatRegionTime(st));
    const move = (ev: PointerEvent) => {
      const raw = origStart + (ev.clientX - startX) / zoomH;
      const snapped = snapTime(raw, grid, ev.altKey ? "off" : snapStep);
      delta = Math.max(-minStart, snapped - origStart);
      const newStart = origStart + delta;
      setMoveDrag({ ids: idSet, delta, anchorId: clip.id, start: newStart, label: describe(newStart) });
      // Reposiciona o som ao vivo em tempo real durante o arraste (padrao DAW profissional)
      for (const c of targets) {
        audioEngine.updateLiveClipPosition(c.id, Math.max(0, c.startTime + delta));
      }
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setMoveDrag(null);
      if (Math.abs(delta) < 1e-4) return;
      updateClips(targets.map((c) => ({
        id: c.id,
        patch: { startTime: Math.max(0, c.startTime + delta) },
      })));
      audioEngine.invalidatePrepared(song?.id);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  useEffect(() => {
    setEditingRegionId(null);
    setRegionDrag(null);
  }, [activeSongId]);

  useEffect(() => {
    if (!noSpaceHint) return;
    const t = window.setTimeout(() => setNoSpaceHint(false), 2200);
    return () => window.clearTimeout(t);
  }, [noSpaceHint]);

  const handleCutMedleyAtCursor = () => {
    if (!song) return;
    const st = useStore.getState();
    const cursor = st.transport.isPlaying && st.transport.currentSongId === song.id
      ? audioEngine.getCurrentTime()
      : st.transport.currentTime;
    if (!cutMedleyAt(song, cursor)) setNoSpaceHint(true);
  };

  const handleAddRegionAtCursor = () => {
    if (!song) return;
    const st = useStore.getState();
    const cursor = st.transport.isPlaying && st.transport.currentSongId === song.id
      ? audioEngine.getCurrentTime()
      : st.transport.currentTime;
    const slot = freeSlotAt(song, snapTime(cursor, grid, snapStep));
    const id = `region-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const style = suggestRegionStyle(song.regions ?? []);
    if (slot && addSongRegion(song.id, { id, ...style, start: slot.start, end: slot.end, loop: false })) {
      setEditingRegionId(id);
    } else {
      setNoSpaceHint(true);
    }
  };

  const allVisibleTracks = useMemo(() => {
    const result: Track[] = [];
    const tc = tracks.find((t) => t.id === TIMECODE_TRACK_ID);
    if (tc) result.push(tc);
    for (const id of ROUTABLE_TRACKS) {
      const track = tracks.find((t) => t.id === id);
      if (!track) continue;
      result.push(track);
      if (track.isSubgroup) {
        for (const childId of track.children) {
          const child = tracks.find((t) => t.id === childId);
          if (child) result.push(child);
        }
      }
    }
    return result;
  }, [tracks]);

  const trackHeight = Math.round(40 * zoomV);
  const contentEnd = useMemo(() => {
    let end = song?.duration ?? 0;
    for (const c of songClips) end = Math.max(end, c.startTime + c.duration);
    for (const r of song?.regions ?? []) end = Math.max(end, r.end);
    return end;
  }, [song, songClips]);
  const timelineWidth = Math.max(200, Math.ceil(contentEnd * zoomH));

  const rulerStep = useMemo(() => {
    const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find((step) => step * zoomH >= 60) ?? 600;
  }, [zoomH]);
  const stepPx = rulerStep * zoomH;

  const visibleTicks = useMemo(() => {
    const first = Math.max(0, Math.floor(visible.start / stepPx));
    const last = Math.min(Math.ceil(timelineWidth / stepPx), Math.ceil(visible.end / stepPx));
    const out: number[] = [];
    for (let i = first; i <= last; i++) out.push(i * rulerStep);
    return out;
  }, [visible, stepPx, rulerStep, timelineWidth]);

  const formatTick = (sec: number): string => {
    if (rulerStep < 1) {
      const whole = Math.floor(sec);
      const frac = Math.round((sec - whole) * 10);
      return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}.${frac}`;
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Quantizado para só re-renderizar quando a janela visível muda de bloco.
  const updateVisible = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const quantum = 256;
    const start = Math.max(0, Math.floor((el.scrollLeft - VIEW_MARGIN_PX) / quantum) * quantum);
    const end = Math.ceil((el.scrollLeft + el.clientWidth - HEADER_W + VIEW_MARGIN_PX) / quantum) * quantum;
    setVisible((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current && headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
    updateVisible();
  }, [updateVisible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateVisible);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateVisible]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (el && anchor) {
      el.scrollLeft = Math.max(0, anchor.time * zoomH - anchor.mouseX);
      zoomAnchorRef.current = null;
    }
    if (el && headerScrollRef.current) headerScrollRef.current.scrollLeft = el.scrollLeft;
    updateVisible();
  }, [zoomH, timelineWidth, updateVisible]);

  const zoomAround = useCallback((factor: number, mouseX: number) => {
    const el = scrollRef.current;
    const current = useStore.getState().zoomH;
    if (el) zoomAnchorRef.current = { time: (el.scrollLeft + mouseX) / current, mouseX };
    setZoomH(Math.round(current * factor * 100) / 100);
  }, [setZoomH]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = Math.max(0, e.clientX - rect.left - HEADER_W);
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.01);
      zoomAround(factor, mouseX);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  const zoomButton = (factor: number) => {
    const el = scrollRef.current;
    const st = useStore.getState();
    const playheadX = st.transport.currentTime * st.zoomH - (el?.scrollLeft ?? 0);
    const viewW = el ? el.clientWidth - HEADER_W : 0;
    zoomAround(factor, playheadX >= 0 && playheadX <= viewW ? playheadX : viewW / 2);
  };

  // Alça na borda direita do painel de faixas: arrastar para os lados ajusta a largura
  // dessa coluna (nomes + botões M/S) de todas as faixas de uma vez. Duplo clique volta
  // ao tamanho padrão.
  const handleHeaderWidthPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = useStore.getState().trackHeaderWidth;
    const move = (ev: PointerEvent) => {
      useStore.getState().setTrackHeaderWidth(startWidth + (ev.clientX - startX));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, []);
  const resetHeaderWidth = useCallback(() => setTrackHeaderWidth(192), [setTrackHeaderWidth]);

  const handleRulerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const rect = target.getBoundingClientRect();
    const computeTime = (clientX: number, free = false) =>
      snapTime(Math.max(0, (clientX - rect.left) / zoomH), grid, free ? 'off' : snapStep);
    const startTime = computeTime(e.clientX, e.altKey);
    audioEngine.beginUserSeek(startTime);
    setCurrentTime(startTime);

    const move = (ev: PointerEvent) => {
      const t = computeTime(ev.clientX, ev.altKey);
      audioEngine.beginUserSeek(t);
      setCurrentTime(t);
    };
    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const finalT = computeTime(ev.clientX, ev.altKey);
      setCurrentTime(finalT);
      if (isPlaying && song) {
        audioEngine.seekTo(finalT);
      } else {
        audioEngine.endUserSeek();
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }, [zoomH, setCurrentTime, isPlaying, song, grid, snapStep]);

  const gridStyle = grid ? {} : {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${stepPx - 1}px, rgba(255,255,255,0.045) ${stepPx - 1}px, rgba(255,255,255,0.045) ${stepPx}px)`,
  };

  return (
    <div className="flex flex-col h-full bg-logic-bg flex-1 min-w-0 relative">
      <div className="flex bg-logic-bg-deep border-b border-logic-border-dark">
        <div className="flex flex-col border-r border-logic-border-dark shrink-0" style={{ width: `${HEADER_W}px` }} ref={menuBarRef}>
          {/* Linha 1: Menus estilo Logic Pro 11 (Editar, Funções, Visualizar) + Trava da Timeline */}
          <div className="h-6 flex items-center justify-between px-2 border-b border-logic-border-dark/60 gap-1 bg-logic-bg-deep relative">
            <div className="flex items-center gap-0.5 text-2xs">
              {/* Menu Editar */}
              <div className="relative">
                <button
                  type="button"
                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    openMenu === 'edit'
                      ? 'bg-logic-accent text-white'
                      : 'text-logic-text-muted hover:text-white hover:bg-logic-bg-elevated'
                  }`}
                  onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
                >
                  Editar ▾
                </button>
                {openMenu === 'edit' && (
                  <div className="absolute left-0 top-full mt-1 z-[400] py-1 bg-[#161720] border border-white/20 rounded-lg shadow-2xl text-2xs min-w-[210px] animate-[fadeIn_80ms_ease-out]">
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        useStore.temporal.getState().undo();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Desfazer</span>
                      <span className="text-logic-text-muted text-[10px]">⌘Z</span>
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        useStore.temporal.getState().redo();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Refazer</span>
                      <span className="text-logic-text-muted text-[10px]">⇧⌘Z</span>
                    </button>
                    <div className="h-px bg-white/10 my-1" />
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        selectAllSongClips();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Selecionar Tudo</span>
                      <span className="text-logic-text-muted text-[10px]">⌘A</span>
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        handleSplitAtCursor();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Dividir no Cursor</span>
                      <span className="text-logic-text-muted text-[10px]">S</span>
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-logic-lcd-red hover:text-white"
                      onClick={() => {
                        handleDeleteSelectedClips();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Excluir Selecionados</span>
                      <span className="text-logic-text-muted text-[10px]">Del</span>
                    </button>
                    <div className="h-px bg-white/10 my-1" />
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        if (selectedClipIds.length >= 2) groupClips(selectedClipIds);
                        setOpenMenu(null);
                      }}
                    >
                      <span>Agrupar Clipes</span>
                      <span className="text-logic-text-muted text-[10px]">⌘G</span>
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        if (selectedClipIds.length > 0) ungroupClips(selectedClipIds);
                        setOpenMenu(null);
                      }}
                    >
                      <span>Desagrupar Clipes</span>
                      <span className="text-logic-text-muted text-[10px]">⌘U</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Menu Funções */}
              <div className="relative">
                <button
                  type="button"
                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    openMenu === 'functions'
                      ? 'bg-logic-accent text-white'
                      : 'text-logic-text-muted hover:text-white hover:bg-logic-bg-elevated'
                  }`}
                  onClick={() => setOpenMenu(openMenu === 'functions' ? null : 'functions')}
                >
                  Funções ▾
                </button>
                {openMenu === 'functions' && (
                  <div className="absolute left-0 top-full mt-1 z-[400] py-1 bg-[#161720] border border-white/20 rounded-lg shadow-2xl text-2xs min-w-[210px] animate-[fadeIn_80ms_ease-out]">
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        handleSplitAtCursor();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Dividir Áudio Selecionado</span>
                      <Scissors size={12} className="text-logic-text-muted" />
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        handleCutMedleyAtCursor();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Fatiar Medley no Cursor</span>
                      <Scissors size={12} className="text-logic-text-muted" />
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        handleAddRegionAtCursor();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Nova Região no Cursor</span>
                      <Plus size={12} className="text-logic-text-muted" />
                    </button>
                    <div className="h-px bg-white/10 my-1" />
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        toggleTimelineLocked();
                        setOpenMenu(null);
                      }}
                    >
                      <span>{timelineLocked ? 'Destravar Timeline' : 'Travar Timeline (Cadeado)'}</span>
                      {timelineLocked ? <Unlock size={12} /> : <Lock size={12} />}
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        resetHeaderWidth();
                        setOpenMenu(null);
                      }}
                    >
                      <span>Largura Padrão das Faixas</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Menu Visualizar */}
              <div className="relative">
                <button
                  type="button"
                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    openMenu === 'view'
                      ? 'bg-logic-accent text-white'
                      : 'text-logic-text-muted hover:text-white hover:bg-logic-bg-elevated'
                  }`}
                  onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
                >
                  Visualizar ▾
                </button>
                {openMenu === 'view' && (
                  <div className="absolute left-0 top-full mt-1 z-[400] py-1 bg-[#161720] border border-white/20 rounded-lg shadow-2xl text-2xs min-w-[210px] animate-[fadeIn_80ms_ease-out]">
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        zoomButton(1.35);
                        setOpenMenu(null);
                      }}
                    >
                      <span>Aproximar Zoom Horizontal</span>
                      <span className="text-logic-text-muted text-[10px]">+</span>
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        zoomButton(0.75);
                        setOpenMenu(null);
                      }}
                    >
                      <span>Afastar Zoom Horizontal</span>
                      <span className="text-logic-text-muted text-[10px]">-</span>
                    </button>
                    <div className="h-px bg-white/10 my-1" />
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        setZoomV(Math.min(3, Math.round(zoomV * 1.25 * 100) / 100));
                        setOpenMenu(null);
                      }}
                    >
                      <span>Aumentar Altura das Faixas</span>
                      <UnfoldVertical size={12} className="text-logic-text-muted" />
                    </button>
                    <button
                      type="button"
                      className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-white/10 text-white"
                      onClick={() => {
                        setZoomV(Math.max(0.5, Math.round(zoomV * 0.8 * 100) / 100));
                        setOpenMenu(null);
                      }}
                    >
                      <span>Diminuir Altura das Faixas</span>
                      <FoldVertical size={12} className="text-logic-text-muted" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Trava da Timeline: Cadeado discreto */}
            <button
              onClick={toggleTimelineLocked}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-semibold transition-all ${
                timelineLocked
                  ? 'bg-logic-lcd-amber/20 border border-logic-lcd-amber/60 text-logic-lcd-amber shadow-[0_0_8px_rgba(255,159,10,0.3)]'
                  : 'text-logic-text-muted hover:text-white hover:bg-logic-bg-elevated border border-transparent'
              }`}
              title={
                timelineLocked
                  ? 'Timeline travada: clique para destravar e permitir mover/cortar áudios'
                  : 'Travar timeline: impede movimentar ou cortar áudios acidentalmente'
              }
            >
              {timelineLocked ? <Lock size={11} className="text-logic-lcd-amber" /> : <Unlock size={11} />}
              <span className="text-[9px] font-bold hidden md:inline">{timelineLocked ? 'TRAVADA' : ''}</span>
            </button>
          </div>

          {/* Linha 2: Ações Rápidas Padronizadas - Rigorosamente com o mesmo tamanho */}
          <div className="h-6 flex items-center justify-between px-2 border-b border-logic-border-dark/60 gap-1.5">
            <button
              className="flex-1 h-[20px] rounded flex items-center justify-center gap-1 text-2xs font-semibold text-logic-text-dim bg-logic-bg-elevated border border-logic-border-light hover:text-white hover:border-logic-accent hover:bg-white/[0.04] transition-all disabled:opacity-40 disabled:pointer-events-none truncate"
              onClick={handleSplitAtCursor}
              disabled={!song || timelineLocked}
              title="Dividir áudios selecionados no cursor (Split - atalho S)"
            >
              <Scissors size={10} className="shrink-0" />
              <span>Dividir</span>
            </button>
            <button
              className="flex-1 h-[20px] rounded flex items-center justify-center gap-1 text-2xs font-semibold text-logic-text-dim bg-logic-bg-elevated border border-logic-border-light hover:text-white hover:border-logic-accent hover:bg-white/[0.04] transition-all disabled:opacity-40 disabled:pointer-events-none truncate"
              onClick={handleCutMedleyAtCursor}
              disabled={!song || timelineLocked}
              title="Fatiar medley no cursor: separa uma música da outra"
            >
              <Scissors size={10} className="shrink-0" />
              <span>Medley</span>
            </button>
            <button
              className="flex-1 h-[20px] rounded flex items-center justify-center gap-1 text-2xs font-semibold text-logic-text-dim bg-logic-bg-elevated border border-logic-border-light hover:text-white hover:border-logic-accent hover:bg-white/[0.04] transition-all disabled:opacity-40 disabled:pointer-events-none truncate"
              onClick={handleAddRegionAtCursor}
              disabled={!song || timelineLocked}
              title="Nova região de 4 compassos a partir do cursor"
            >
              <Plus size={11} className="shrink-0" />
              <span>Região</span>
            </button>
          </div>

          {/* Linha 3: Navegação, Altura e Zoom Horizontal */}
          <div className="h-10 flex items-center justify-between px-3">
            <div className="flex items-center gap-1">
              <button className="text-logic-text-muted hover:text-logic-text disabled:opacity-30 p-1 rounded hover:bg-logic-bg-elevated" disabled={zoomV <= 0.5} onClick={() => setZoomV(Math.max(0.5, Math.round(zoomV * 0.8 * 100) / 100))} title="Diminuir altura das tracks"><FoldVertical size={13} /></button>
              <button className="text-logic-text-muted hover:text-logic-text disabled:opacity-30 p-1 rounded hover:bg-logic-bg-elevated" disabled={zoomV >= 3} onClick={() => setZoomV(Math.min(3, Math.round(zoomV * 1.25 * 100) / 100))} title="Aumentar altura das tracks"><UnfoldVertical size={13} /></button>
            </div>
            <div className="text-[10px] text-logic-text-muted select-none font-mono">
              {noSpaceHint ? <span className="text-logic-lcd-amber font-sans">Sem espaço</span> : `${Math.round(zoomH * 10)}%`}
            </div>
            <div className="flex items-center gap-1">
              <button className="text-logic-text-muted hover:text-logic-text px-1.5 py-0.5 rounded hover:bg-logic-bg-elevated font-mono font-bold text-xs leading-none" onClick={() => zoomButton(0.75)} title="Diminuir zoom horizontal (-)">−</button>
              <button className="text-logic-text-muted hover:text-logic-text px-1.5 py-0.5 rounded hover:bg-logic-bg-elevated font-mono font-bold text-xs leading-none" onClick={() => zoomButton(1.35)} title="Aumentar zoom horizontal (+)">+</button>
              <button className="text-logic-text-muted hover:text-logic-text p-1 rounded hover:bg-logic-bg-elevated" onClick={() => zoomButton(1.35)} title="Aproximar (Cmd + roda do mouse)"><ZoomIn size={13} /></button>
              <button className="text-logic-text-muted hover:text-logic-text p-1 rounded hover:bg-logic-bg-elevated" onClick={() => zoomButton(0.75)} title="Afastar (Cmd + roda do mouse)"><ZoomOut size={13} /></button>
            </div>
          </div>
        </div>
        <div ref={headerScrollRef} className="flex-1 overflow-hidden">
          <div style={{ width: `${timelineWidth + 24}px` }}>
            {song ? (
              <MedleyLane song={song} zoomH={zoomH} />
            ) : (
              <div className="h-6 border-b border-logic-border-dark/60" />
            )}
            {song ? (
              <RegionLane
                song={song}
                zoomH={zoomH}
                drag={regionDrag}
                onDragChange={setRegionDrag}
                editingId={editingRegionId}
                onEdit={setEditingRegionId}
              />
            ) : (
              <div className="h-6 border-b border-logic-border-dark/60" />
            )}
            <div
              className="relative h-10 cursor-pointer select-none"
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={handleRulerPointerDown}
            >
              {grid && song && <BarRulerLayer song={song} grid={grid} zoomH={zoomH} visible={visible} />}
              {visibleTicks.map((tick) => (
                <div
                  key={tick}
                  className={`absolute bottom-0 border-l border-logic-border-dark/60 flex items-end pb-0.5 pointer-events-none ${grid ? 'top-5' : 'top-0'}`}
                  style={{ left: `${tick * zoomH}px` }}
                >
                  <span className="text-2xs text-logic-text-muted font-mono pl-1 whitespace-nowrap">{formatTick(tick)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto logic-scroll relative"
        onScroll={handleScroll}
      >
        {!song ? (
          <div className="flex items-center justify-center h-full text-logic-text-muted text-xs">
            Importe um VS ou selecione uma música para ver a timeline
          </div>
        ) : (
          <div className="flex" style={{ minHeight: '100%', width: `${timelineWidth + HEADER_W}px` }}>
            <div className="bg-logic-bg-panel border-r border-logic-border-dark sticky left-0 z-40 shrink-0" style={{ width: `${HEADER_W}px` }}>
              <TimecodeTrackRow songId={song.id} />
              {ROUTABLE_TRACKS.map((id) => {
                const track = tracks.find((t) => t.id === id);
                if (!track) return null;
                if (track.isSubgroup) return <FolderGroup key={track.id} track={track} onContextMenu={handleOpenTrackMenu} />;
                return <TrackRow key={track.id} track={track} depth={0} onContextMenu={handleOpenTrackMenu} />;
              })}
              <div
                className="absolute top-0 right-0 bottom-0 w-1.5 -mr-0.5 z-50 cursor-col-resize group/widthHandle"
                onPointerDown={handleHeaderWidthPointerDown}
                onDoubleClick={resetHeaderWidth}
                title="Arraste para os lados para ajustar a largura do painel de faixas. Duplo clique: tamanho padrão."
              >
                <div className="absolute top-0 right-0 bottom-0 w-px bg-logic-border-dark opacity-0 group-hover/widthHandle:opacity-100 group-hover/widthHandle:bg-logic-accent transition-opacity" />
              </div>
            </div>

            <div
              className="relative flex-shrink-0"
              style={{ width: `${timelineWidth}px`, ...gridStyle }}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                if (!target.closest('[data-selectable="clip"], button, input, [role="button"], .group\\/widthHandle')) {
                  if (!e.ctrlKey && !e.metaKey && e.button === 0) {
                    selectClip(null);
                  }
                }
              }}
            >
              {grid && <GridLinesOverlay grid={grid} zoomH={zoomH} visible={visible} />}
              {allVisibleTracks.map((track) => {
                const isFolder = track.isSubgroup;
                const isTc = track.id === TIMECODE_TRACK_ID;
                const trackClips = isFolder ? [] : songClips.filter((c) => c.trackId === track.id);
                const rowHeight = isTc ? trackHeight : Math.round((track.height ?? 40) * zoomV);
                return (
                  <div
                    key={track.id}
                    className={`relative overflow-hidden ${isTc ? 'border-b-2 border-logic-lcd-amber/40 bg-logic-lcd-amber/[0.04]' : 'border-b border-logic-border-dark'} ${isFolder ? 'bg-logic-bg-deep/40 pointer-events-none' : ''}`}
                    style={{ height: `${rowHeight}px` }}
                  >
                    {trackClips.map((clip) => (
                      <ClipBlock
                        key={clip.id}
                        clip={clip}
                        isSelected={selectedSet.has(clip.id)}
                        onSelect={(additive) => selectClip(clip.id, additive)}
                        onTrimStart={handleTrimStart}
                        onMoveStart={handleMoveStart}
                        trim={trimDrag}
                        move={moveDrag}
                        trackHeight={rowHeight}
                        zoomH={zoomH}
                        visible={visible}
                        allowMove={!timelineLocked}
                        timelineLocked={timelineLocked}
                      />
                    ))}
                    {track.id === 'track-maestro' && recordingMaestro?.isRecording && recordingMaestro.songId === song.id && (
                      <LiveRecordingTrackBlock startTime={recordingMaestro.startTime} zoomH={zoomH} />
                    )}
                  </div>
                );
              })}

              <RegionGuides song={song} zoomH={zoomH} drag={regionDrag} />

              {trimDrag && (
                <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: `${trimDrag.end * zoomH}px` }}>
                  <div className="absolute top-0 bottom-0 w-px bg-logic-lcd-amber/80" />
                  <span className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-logic-bg-elevated border border-logic-lcd-amber/60 text-2xs font-mono text-logic-text whitespace-nowrap shadow-lg">
                    Fim {trimDrag.label}{trimDrag.ids.size > 1 ? ` (${trimDrag.ids.size} áudios)` : ''}
                  </span>
                </div>
              )}

              {moveDrag && (
                <div className="absolute top-0 bottom-0 z-30 pointer-events-none" style={{ left: `${moveDrag.start * zoomH}px` }}>
                  <div className="absolute top-0 bottom-0 w-[2px] bg-logic-lcd-green shadow-[0_0_8px_rgba(48,209,88,0.8)]" />
                  <span className="absolute top-1 left-1.5 px-1.5 py-0.5 rounded bg-logic-bg-elevated border border-logic-lcd-green/60 text-2xs font-mono text-logic-lcd-green font-bold whitespace-nowrap shadow-lg">
                    Início: {moveDrag.label}{moveDrag.ids.size > 1 ? ` (${moveDrag.ids.size} faixas)` : ''}
                  </span>
                </div>
              )}

              <Playhead zoomH={zoomH} songId={song.id} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-3 h-7 bg-logic-bg-deep border-t border-logic-border-dark text-2xs text-logic-text-muted">
        <GridToolbar song={song} onSelectAll={selectAllSongClips} />
        <FooterProgress importProgress={importProgress} exportProgress={exportProgress} />
        <span className="flex-shrink-0 hidden sm:inline">
          {selectedClipIds.length > 0 ? `${selectedClipIds.length} selecionado${selectedClipIds.length > 1 ? 's' : ''} | ` : ''}
          {songClips.length} clips | Zoom {Math.round(zoomH)}px/s
        </span>
      </div>

      {isSongLoading && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-logic-bg-panel/95 backdrop-blur-sm border border-logic-border-light shadow-lg text-2xs text-logic-text-dim animate-[fadeIn_120ms_ease-out]">
            <Loader2 size={12} className="animate-spin text-logic-accent" />
            Carregando música...
          </div>
        </div>
      )}

      {trackContextMenu && (
        <TrackContextMenu
          track={trackContextMenu.track}
          x={trackContextMenu.x}
          y={trackContextMenu.y}
          onClose={() => setTrackContextMenu(null)}
        />
      )}

    </div>
  );
}
