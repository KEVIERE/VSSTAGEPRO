import TrackContextMenu from '@/components/TrackContextMenu';
import { useStore, ROUTABLE_TRACKS } from '@/store';
import type { Track, AudioClip, ImportProgress, FadeCurve } from '@/types';
import { Check, ChevronRight, ChevronDown, ZoomIn, ZoomOut, Plus, GripVertical, Loader2, FoldVertical, UnfoldVertical, Scissors, Link2, Mic, ArrowLeftRight, Sparkles, X, ListOrdered } from 'lucide-react';
import SaveCancelButton from '@/components/SaveCancelButton';
import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { cancelImport } from '@/lib/importManager';
import { audioEngine } from '@/lib/audioEngine';
import { audioRecorder, saveRecordingToMaestro, type MaestroInput } from '@/lib/audioRecorder';
import { savedMaestroInput } from '@/lib/maestroInput';
import MaestroInputMenu from '@/components/MaestroInputMenu';
import { masterMaestroClip } from '@/lib/voiceMastering';
import { useMeterLevel } from '@/lib/meterBus';
import { startPlayback, stopPlayback } from '@/lib/transportControl';
import Playhead from '@/components/Playhead';
import { formatRegionTime, freeSlotAt, presetColor, suggestRegionStyle } from '@/lib/regions';
import { RegionNamePicker } from '@/components/LanePopover';
import { RegionLane, RegionGuides, type RegionDrag } from '@/components/RegionLane';
import { NarrationLane, NARRATION_LANE_HEIGHT } from '@/components/NarrationLane';
import { cursorTime, lastPitch, lastVoice } from '@/lib/maestroVoice';
import { MAESTRO_IA_TRACK_ID, NARRATION_MIN_LENGTH, beatStartAt, placeNarration } from '@/lib/narrations';
import NarrationDialog from '@/components/NarrationDialog';
import CountInDialog, { type CountInTarget } from '@/components/CountInDialog';
import { MedleyLane, cutMedleyAt } from '@/components/MedleyLane';
import { ClipWaveform, routingColorOf, type VisibleRange } from '@/components/ClipWaveform';
import MiniFader from '@/components/MiniFader';
import { LedMeterH } from '@/components/MeterMask';
import { dropSlot, laneMoves, laneOffset, reorderChildren } from '@/lib/trackOrder';
import { beginGesture, endGesture } from '@/lib/undoGestures';
import { NARRATION_ROW, clipsInBox, marqueeSelection, rangeSelection, selectionRows, splitNarrationClips } from '@/lib/timelineSelection';
import { mergeFolderPeaks, type FolderPreview } from '@/lib/folderPreview';
import { BarRulerLayer, GridLinesOverlay, GridToolbar } from '@/components/TimelineGrid';
import { barBeatLabel, moveTempoChange, snapTime, songGrid, tempoChangeIndex } from '@/lib/grid';
import { clipPlayLength } from '@/lib/audioLibrary';
import { TIMECODE_TRACK_ID } from '@/lib/timecode';
import TimecodeTrackRow from '@/components/TimecodeTrackRow';
import { glueSelectedClips } from '@/lib/clipGlue';

/**
 * A coluna dos nomes das faixas e a régua de cima seguem a rolagem da timeline pelo próprio
 * navegador (animação ligada à rolagem, em src/index.css): as três andam no mesmo quadro. Antes um
 * código copiava a posição depois que a timeline já tinha rolado, e a coluna vinha atrasada.
 * Navegador sem esse recurso: fica a cópia por código.
 */
const FOLLOW_SCROLL_CSS = typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
  && CSS.supports('animation-timeline', '--vs-tl-y') && CSS.supports('timeline-scope', '--vs-tl-y');

type TrimDrag = { ids: Set<string>; delta: number; anchorId: string; end: number; label: string; side?: 'start' | 'end' } | null;
// `ghosts`: áudios indo para outra trilha (a prévia aparece na trilha de destino); `laneLabel`: para onde.
type MoveDrag = { ids: Set<string>; delta: number; anchorId: string; start: number; label: string; ghosts?: { trackId: string; clipId: string }[]; laneLabel?: string } | null;

/** Medidor VU de LEDs estilo DAW profissional (Logic Pro / Pro Tools) para a entrada da placa */
function InputVuMeter({ trackHeight = 40 }: { trackHeight?: number }) {
  // mesma escala dos medidores do mixer: de -48 dB (apagado) a 0 dB (tudo aceso)
  const amp = useMeterLevel('input-maestro');
  const db = amp > 0 ? 20 * Math.log10(amp) : -Infinity;
  const level = db <= -48 ? 0 : Math.min(1, (db + 48) / 48);
  const isLarge = trackHeight > 55;
  const isExtraLarge = trackHeight > 75;
  const count = isExtraLarge ? 14 : isLarge ? 11 : 8;
  const hCls = isExtraLarge ? 'h-5' : isLarge ? 'h-4' : 'h-3.5';
  const wLed = isExtraLarge ? 'w-[3px]' : isLarge ? 'w-[2.5px]' : 'w-[2px]';

  return (
    <div
      className={`flex items-center gap-[1.5px] ${hCls} px-1.5 bg-black/75 rounded border border-white/15 shrink-0 shadow-inner transition-all duration-100`}
      title={`Nível de entrada da placa: ${Math.round(level * 100)}%`}
    >
      {Array.from({ length: count }).map((_, i) => {
        const threshold = (i + 1) / (count + 1);
        const isActive = level >= threshold;
        const isRed = i >= count - 2;
        const isAmber = !isRed && i >= count - (isExtraLarge ? 5 : 4);
        const colorCls = isRed
          ? (isActive ? 'bg-[#ff453a] shadow-[0_0_5px_#ff453a]' : 'bg-[#ff453a]/20')
          : isAmber
          ? (isActive ? 'bg-[#ff9f0a] shadow-[0_0_4px_#ff9f0a]' : 'bg-[#ff9f0a]/20')
          : (isActive ? 'bg-[#30d158] shadow-[0_0_4px_#30d158]' : 'bg-[#30d158]/20');

        return (
          <div
            key={i}
            className={`${wLed} h-full max-h-[85%] rounded-[1px] transition-colors duration-75 ${colorCls}`}
          />
        );
      })}
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

function ChildTrackRow({ childId, depth, expanded, onToggle, onContextMenu, groupColor, isLastChild, onReorderStart, dragging }: {
  childId: string; depth: number; expanded: boolean; onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
  groupColor?: string; isLastChild?: boolean;
  onReorderStart?: (e: React.PointerEvent<HTMLDivElement>, trackId: string) => void;
  dragging?: boolean;
}) {
  const track = useStore((s) => s.tracks.find((t) => t.id === childId));
  if (!track) return null;
  return <TrackRow track={track} depth={depth} expanded={expanded} onToggle={onToggle} onContextMenu={onContextMenu} groupColor={groupColor} isLastChild={isLastChild} onReorderStart={onReorderStart} dragging={dragging} />;
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

/**
 * Nome da régua do Maestro por IA na coluna das faixas (mesma altura da régua, para tudo ficar
 * alinhado). Tem o mudo das falas e o botão de criar uma fala no beat do cursor.
 */
function MaestroIaHeader({ songId, onAdd, onCount }: { songId: string; onAdd: () => void; onCount: () => void }) {
  const count = useStore((s) => s.songs.find((sg) => sg.id === songId)?.narrations?.length ?? 0);
  const iaTrack = useStore((s) => s.tracks.find((t) => t.id === MAESTRO_IA_TRACK_ID));
  const toggleMute = useStore((s) => s.toggleMute);
  // A altura acompanha o tamanho das faixas (zoom vertical), igual à régua do Maestro na timeline.
  // Com altura fixa, TODA linha abaixo do Maestro saía deslocada da coluna dos nomes.
  const zoomV = useStore((s) => s.zoomV);
  return (
    <div
      className="flex items-center gap-1.5 border-b border-logic-border-dark bg-[#161b22] pr-2 text-2xs select-none"
      style={{ height: `${Math.round(NARRATION_LANE_HEIGHT * zoomV)}px`, paddingLeft: '16px' }}
      title={`Maestro por IA: falas escritas por você e geradas por voz (${count} nesta música). O som sai pela faixa Maestro (mesma saída e volume).`}
    >
      <Sparkles size={11} className="text-sky-300 shrink-0" />
      <span className="font-semibold text-sky-200 whitespace-nowrap">Maestro IA</span>
      <div className="flex-1" />
      <button
        className="h-5 w-5 rounded border border-sky-400/50 text-sky-200 hover:bg-sky-500/20 shrink-0 flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); onCount(); }}
        title="Contagem no click: 1, 2, 3, 4... a partir do tempo do cursor, um número em cada click da grade"
        aria-label="Contagem no click a partir do cursor"
      >
        <ListOrdered size={11} />
      </button>
      <button
        className="h-5 w-5 rounded border border-sky-400/50 text-sky-200 hover:bg-sky-500/20 shrink-0 flex items-center justify-center"
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        title="Nova fala começando no beat do cursor"
        aria-label="Nova fala no beat do cursor"
      >
        <Plus size={11} />
      </button>
      {iaTrack && (
        <button
          className={`h-5 w-5 rounded border text-[9px] font-bold shrink-0 ${iaTrack.mute ? 'bg-logic-lcd-amber/30 border-logic-lcd-amber text-logic-lcd-amber' : 'border-logic-border-light text-logic-text-muted hover:text-logic-text'}`}
          onClick={(e) => { e.stopPropagation(); toggleMute(iaTrack.id); }}
          title={iaTrack.mute ? 'Falas do Maestro IA mudas: clique para ligar' : 'Deixar as falas do Maestro IA mudas'}
          aria-pressed={iaTrack.mute}
        >
          M
        </button>
      )}
    </div>
  );
}

function TrackRow({ track, depth = 0, expanded = true, onToggle, onContextMenu, groupColor, isLastChild, onReorderStart, dragging }: {
  track: Track; depth?: number; expanded?: boolean; onToggle?: () => void;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
  /** Cor da faixa mãe (faixas de dentro de um multigrupo) */
  groupColor?: string;
  /** Última faixa de dentro do multigrupo: a guia termina nela */
  isLastChild?: boolean;
  /** Faixa de dentro: apertar e arrastar para cima ou para baixo muda a ordem na pasta */
  onReorderStart?: (e: React.PointerEvent<HTMLDivElement>, trackId: string) => void;
  /** Esta faixa está sendo arrastada */
  dragging?: boolean;
}) {
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectTrack = useStore((s) => s.selectTrack);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const setVolume = useStore((s) => s.setVolume);
  const headerWidth = useStore((s) => s.trackHeaderWidth);
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
  const hasMaestroClip = useStore((s) => {
    if (!isMaestro) return false;
    const activeId = s.selectedSongId ?? s.playlist[0]?.songId;
    return s.clips.some((c) => c.songId === activeId && c.trackId === 'track-maestro');
  });
  // Entrada da gravação: placa e canal dela (guardados no computador; ver maestroInput)
  const [input, setInput] = useState<MaestroInput>(savedMaestroInput);
  const [inputMenuAnchor, setInputMenuAnchor] = useState<HTMLElement | null>(null);
  const closeInputMenu = useCallback(() => setInputMenuAnchor(null), []);

  // O medidor de entrada fica ligado enquanto grava (o menu da entrada liga o dele sozinho)
  useEffect(() => {
    if (!isMaestro || isRecording || inputMenuAnchor) return;
    audioRecorder.stopMonitoring();
  }, [isMaestro, isRecording, inputMenuAnchor]);

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
        await audioRecorder.start(input);
        setRecordingMaestro({
          isRecording: true,
          songId: activeSongId,
          startTime: cursor,
          inputDeviceId: input.deviceId,
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
  // Faixa de dentro de um multigrupo: visual simples, preso à faixa mãe por uma guia na cor dela.
  const isChild = depth > 0;
  // Linha baixa (zoom vertical pequeno): some o medidor e as teclas encolhem.
  const compact = trackHeight < 30;

  const onRowContextMenu = (e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, track);
    }
  };
  const rowTitle = isFolder ? 'Pasta: clique direito para renomear, mudar cor ou opções' : 'Faixa: clique direito para renomear, mudar cor, rotear saída ou mover para pasta';

  // Maestro com altura normal: REC e microfone ficam em cima do M e S (REC sobre o M, microfone
  // sobre o S), e sobra lugar para o fader como nas outras faixas. Linha baixa: tudo numa fileira.
  const stackMaestro = isMaestro && !isChild && !compact && trackHeight >= 36;
  const maestroKey = stackMaestro ? 'w-[22px] h-4' : `w-[18px] ${compact ? 'h-4' : 'h-[18px]'}`;

  // REC e entrada da placa da faixa Maestro (mesmas teclas de borracha do mixer)
  const maestroControls = isMaestro && (
    <div className="flex items-center gap-[3px] shrink-0">
      <button
        type="button"
        className={`console-key ${maestroKey} flex items-center justify-center leading-none ${
          isRecording ? 'is-lit-red animate-pulse' : 'text-[#ff4136]/80 hover:!text-[#ff4136]'
        }`}
        onClick={handleToggleRec}
        title={isRecording ? 'Gravando voz do Maestro: clique para parar e salvar' : 'Gravar áudio na faixa Maestro (REC)'}
      >
        <span className="text-[10px] leading-none">●</span>
      </button>
      <button
        type="button"
        className={`console-key ${maestroKey} flex items-center justify-center ${inputMenuAnchor ? 'is-lit-blue' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          setInputMenuAnchor((cur) => (cur ? null : btn));
        }}
        aria-expanded={!!inputMenuAnchor}
        title={`Entrada da gravação: escolher a placa de áudio e o canal (agora: canal ${input.channel + 1})`}
      >
        <Mic size={10} />
      </button>
      {inputMenuAnchor && (
        <MaestroInputMenu
          anchor={inputMenuAnchor}
          input={input}
          recording={isRecording}
          onChange={setInput}
          onClose={closeInputMenu}
        />
      )}
    </div>
  );

  if (isChild) {
    return (
      <div
        data-selectable="track"
        data-child-row={track.id}
        className={`console-row-child group relative flex items-center gap-1.5 pr-1.5 cursor-grab active:cursor-grabbing overflow-hidden ${isSelected ? 'is-selected' : ''} ${dragging ? 'opacity-40' : ''}`}
        style={{ paddingLeft: `${10 + depth * 16}px`, height: `${trackHeight}px` }}
        onClick={() => selectTrack(track.id)}
        onPointerDown={(e) => onReorderStart?.(e, track.id)}
        onContextMenu={onRowContextMenu}
        title={`${rowTitle}. Arraste para cima ou para baixo para mudar a ordem.`}
      >
        <TrackHeightHandle trackId={track.id} edge="top" />
        <TrackHeightHandle trackId={track.id} edge="bottom" />
        {/* Guia do grupo: desce da tecla da faixa mãe e faz um "L" na última faixa de dentro */}
        <span
          className="absolute top-0 w-[2px] pointer-events-none"
          style={{ left: `${depth * 16 - 1}px`, bottom: isLastChild ? '50%' : 0, backgroundColor: groupColor ?? track.color, opacity: 0.6 }}
        />
        <span
          className="absolute h-[2px] w-[7px] pointer-events-none"
          style={{ left: `${depth * 16 - 1}px`, top: 'calc(50% - 1px)', backgroundColor: groupColor ?? track.color, opacity: 0.6 }}
        />
        {/* Ponto da cor; com o mouse em cima vira a alça de arrastar */}
        <span className="relative w-2.5 h-3 shrink-0 flex items-center justify-center">
          <span
            className="w-1.5 h-1.5 rounded-full group-hover:opacity-0 transition-opacity"
            style={{ backgroundColor: track.color, boxShadow: `0 0 4px ${track.color}80` }}
          />
          <GripVertical size={11} className="absolute text-logic-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        </span>
        <span className={`text-[11px] flex-1 min-w-0 truncate ${isSelected ? 'text-white' : 'text-logic-text/80'}`}>
          {track.name}
        </span>
        {maestroControls}
        <div className="flex items-center gap-[3px] shrink-0">
          <button
            className={`console-flatkey w-[18px] h-[15px] text-[10px] leading-none ${track.mute ? 'is-lit-amber' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
            aria-pressed={track.mute}
            title={track.mute ? 'Faixa muda: clique para voltar' : 'Silenciar a faixa'}
          >M</button>
          <button
            className={`console-flatkey w-[18px] h-[15px] text-[10px] leading-none ${track.solo ? 'is-lit-amber' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
            aria-pressed={track.solo}
            title={track.solo ? 'Solo ligado: clique para desligar' : 'Ouvir só esta faixa (solo)'}
          >S</button>
        </div>
      </div>
    );
  }

  // Faixa mãe (multigrupo, ou canal de topo como Guia, Click e Maestro): um canal do mixer
  // deitado, com a fita crepe do nome, o fader, o medidor de LED e as teclas M e S.
  // O fader some quando a coluna está estreita. O Maestro em linha baixa (REC e microfone na
  // mesma fileira do M e S) precisa de mais espaço.
  const showFader = headerWidth >= (isMaestro && !stackMaestro ? 240 : 170);
  return (
    <div
      data-selectable="track"
      className={`console-row group relative flex items-center gap-1 pl-2 pr-1.5 cursor-pointer overflow-hidden ${isSelected ? 'is-selected' : ''}`}
      style={{ height: `${trackHeight}px` }}
      onClick={() => selectTrack(track.id)}
      onDoubleClick={(e) => { if (isFolder) { e.stopPropagation(); onToggle?.(); } }}
      onContextMenu={onRowContextMenu}
      title={rowTitle}
    >
      {!isFolder && <TrackHeightHandle trackId={track.id} edge="top" />}
      {!isFolder && <TrackHeightHandle trackId={track.id} edge="bottom" />}
      {/* Cor da faixa: friso na borda esquerda */}
      <span className="absolute left-0 top-0 bottom-0 w-[3px] pointer-events-none" style={{ backgroundColor: track.color }} />

      {isFolder ? (
        <button
          className="console-key w-4 h-4 shrink-0 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          aria-label={expanded ? 'Recolher pasta' : 'Expandir pasta'}
          title={expanded ? 'Recolher as faixas de dentro' : 'Mostrar as faixas de dentro'}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}

      {/* Nome na fita crepe, como no mixer */}
      <div className={`console-tape flex-1 min-w-0 flex items-center gap-1 px-1.5 ${compact ? 'h-4' : 'h-5'}`}>
        <span className="truncate uppercase">{track.name}</span>
        {isFolder && (
          <span className="ml-auto shrink-0 opacity-50 tabular-nums text-[9.5px]" title={`${childClipCount} áudio(s) nas faixas de dentro`}>
            {childClipCount}
          </span>
        )}
      </div>

      {!stackMaestro && maestroControls}
      {/* gravando sem lugar para o fader: o medidor da entrada fica aqui */}
      {isRecording && !showFader && <InputVuMeter trackHeight={trackHeight} />}

      {showFader && (
        <div className="flex flex-col gap-[3px] shrink-0">
          <MiniFader
            value={track.volume}
            onChange={(v) => setVolume(track.id, v)}
            onReset={() => setVolume(track.id, 0.8)}
            width={44}
            height={compact ? 12 : 14}
            tone={track.isSubgroup && track.id !== 'track-guia' ? 'band' : 'cue'}
          />
          {/* gravando, o medidor mostra o sinal que entra da placa */}
          {!compact && (isRecording
            ? <LedMeterH id="input-maestro" width={44} title="Sinal da entrada da gravação" />
            : <LedMeterH id={track.id} off={track.mute} width={44} title="Nível do sinal deste canal" />)}
        </div>
      )}

      <div className={`flex shrink-0 ${stackMaestro ? 'flex-col gap-[2px]' : 'items-center gap-[3px]'}`}>
        {stackMaestro && maestroControls}
        <div className="flex items-center gap-[3px]">
          <button
            className={`console-key ${compact ? 'w-5 h-4 text-[10px]' : stackMaestro ? 'w-[22px] h-4 text-[10.5px]' : 'w-[22px] h-[18px] text-[11px]'} leading-none ${track.mute ? 'is-lit-amber' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
            aria-pressed={track.mute}
            title={track.mute ? 'Canal mudo: clique para voltar' : 'Silenciar o canal'}
          >M</button>
          <button
            className={`console-key ${compact ? 'w-5 h-4 text-[10px]' : stackMaestro ? 'w-[22px] h-4 text-[10.5px]' : 'w-[22px] h-[18px] text-[11px]'} leading-none ${track.solo ? 'is-lit-amber' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
            aria-pressed={track.solo}
            title={track.solo ? 'Solo ligado: clique para desligar' : 'Ouvir só este canal (solo)'}
          >S</button>
        </div>
      </div>
    </div>
  );
}

function FolderGroup({ track, expanded = true, onToggle, onContextMenu }: {
  track: Track;
  expanded?: boolean;
  onToggle?: () => void;
  onContextMenu?: (e: React.MouseEvent, track: Track) => void;
}) {
  const reorderChildTrack = useStore((s) => s.reorderChildTrack);
  const listRef = useRef<HTMLDivElement>(null);
  // Trilha sendo arrastada, a posição onde ela vai entrar e a altura da linha âmbar que mostra isso
  const [drag, setDrag] = useState<{ id: string; slot: number; y: number } | null>(null);

  // Apertar numa trilha de dentro e arrastar para cima ou para baixo muda a ordem dela na pasta.
  // Só começa depois de andar alguns pixels: um clique continua só selecionando.
  const startReorder = useCallback((e: React.PointerEvent<HTMLDivElement>, childId: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    const list = listRef.current;
    if (!list) return;
    const startY = e.clientY;
    let active = false;
    let slot = -1;
    const move = (ev: PointerEvent) => {
      if (!active && Math.abs(ev.clientY - startY) < 5) return;
      active = true;
      ev.preventDefault();
      const rows = [...list.querySelectorAll<HTMLElement>(':scope > [data-child-row]')].map((r) => {
        const b = r.getBoundingClientRect();
        return { top: b.top, height: b.height };
      });
      if (rows.length === 0) return;
      slot = dropSlot(rows, ev.clientY);
      const top = list.getBoundingClientRect().top;
      const last = rows[rows.length - 1];
      const y = slot < rows.length ? rows[slot].top - top : last.top + last.height - top;
      // soltar onde ela já está não muda nada: não mostra a linha
      const ids = [...list.querySelectorAll<HTMLElement>(':scope > [data-child-row]')].map((r) => r.dataset.childRow ?? '');
      const changes = reorderChildren(ids, childId, slot) !== ids;
      setDrag({ id: childId, slot: changes ? slot : -1, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      if (active && slot >= 0) reorderChildTrack(childId, slot);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [reorderChildTrack]);

  return (
    <>
      <TrackRow track={track} depth={0} expanded={expanded} onToggle={onToggle} onContextMenu={onContextMenu} />
      {expanded && track.children.length > 0 && (
        <div ref={listRef} className="relative">
          {track.children.map((childId, i) => (
            <ChildTrackRow
              key={childId}
              childId={childId}
              depth={1}
              expanded={true}
              onToggle={() => {}}
              onContextMenu={onContextMenu}
              groupColor={track.color}
              isLastChild={i === track.children.length - 1}
              onReorderStart={startReorder}
              dragging={drag?.id === childId}
            />
          ))}
          {drag && drag.slot >= 0 && (
            <div
              className="absolute left-1 right-1 h-[2px] -translate-y-1/2 rounded-full z-40 pointer-events-none bg-[#ffab1f] shadow-[0_0_6px_rgba(255,171,31,0.8)]"
              style={{ top: `${drag.y}px` }}
            />
          )}
        </div>
      )}
    </>
  );
}

// Knob minúsculo de ganho do clipe (modo DAW):
// - Centro (12h / 0°): 0dB (ganho original 1x)
// - Lado direito (até +135°): +12dB (~3.98x)
// - Lado esquerdo (até -135°): silêncio total (-inf dB / 0 volume)
function ClipGainKnob({ clipId, gain }: { clipId: string; gain: number }) {
  const setClipGain = useStore((s) => s.setClipGain);
  const selectedClipIds = useStore((s) => s.selectedClipIds);

  const targets = useMemo(() => {
    return selectedClipIds.includes(clipId) && selectedClipIds.length > 1
      ? selectedClipIds
      : [clipId];
  }, [selectedClipIds, clipId]);

  const applyGain = (g: number) => {
    targets.forEach((id) => setClipGain(id, g));
  };

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
      className="w-4 h-4 p-0.5 relative cursor-ns-resize select-none shrink-0 hover:scale-125 hover:brightness-125 transition-transform z-10"
      onDoubleClick={(e) => { e.stopPropagation(); applyGain(1); }}
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
            applyGain(0);
          } else {
            const nextGain = Math.round(Math.pow(10, nextDb / 20) * 100) / 100;
            applyGain(nextGain);
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
      title={targets.length > 1 ? `Ganho em lote (${targets.length} áudios): ${dbLabel}` : `Ganho do clipe: ${dbLabel} (arraste = ajustar, duplo clique = 0dB)`}
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
  const selectedClipIds = useStore((s) => s.selectedClipIds);

  const targets = useMemo(() => {
    return selectedClipIds.includes(clipId) && selectedClipIds.length > 1
      ? selectedClipIds
      : [clipId];
  }, [selectedClipIds, clipId]);

  const applyFade = (patch: { fadeIn?: number; fadeOut?: number; fadeCurveIn?: FadeCurve; fadeCurveOut?: FadeCurve }) => {
    targets.forEach((id) => setClipFade(id, patch));
  };

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
      applyFade(side === 'in' ? { fadeIn: next } : { fadeOut: next });
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
            onDoubleClick={(e) => { e.stopPropagation(); applyFade(side === 'in' ? { fadeIn: 0 } : { fadeOut: 0 }); }}
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
              onDoubleClick={(e) => { e.stopPropagation(); applyFade(side === 'in' ? { fadeIn: 0 } : { fadeOut: 0 }); }}
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
                    applyFade(side === 'in' ? { fadeCurveIn: opt.id } : { fadeCurveOut: opt.id });
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

function ClipBlock({ clip, isSelected, onTrimStart, onMoveStart, trim, move, trackHeight, zoomH, visible, allowMove, timelineLocked }: {
  clip: AudioClip; isSelected: boolean;
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
  // indo para outra trilha: aqui fica só a sombra, a prévia aparece na trilha de destino
  const leaving = moving && !!move?.ghosts?.some((g) => g.clipId === clip.id);
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
  const clipTrack = useStore.getState().tracks.find((t) => t.id === clip.trackId);
  const trackColor = clipTrack?.color || routingColorOf(clip);
  const routingColor = isMuted ? '#666670' : trackColor;
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
          ...(leaving ? { opacity: 0.3 } : {}),
        }}
        onClick={(e) => {
          e.stopPropagation();
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
          <ClipWaveform clip={clip} left={left - (trimStart || 0) * zoomH} width={fullWidth} height={innerHeight} visible={visible} color={routingColor} />
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
          <div className="absolute bottom-1 left-5 flex items-center gap-1.5 z-10 pointer-events-auto">
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

// Prévia da pasta recolhida: um bloco na cor da pasta com a onda de todos os áudios de dentro.
// Só para ver; para mexer nos áudios, abre a pasta.
function FolderPreviewBlock({ folder, songId, preview, count, height, zoomH, visible }: {
  folder: Track;
  songId: string;
  preview: FolderPreview;
  count: number;
  height: number;
  zoomH: number;
  visible: VisibleRange;
}) {
  const left = preview.start * zoomH;
  const width = Math.max(8, preview.duration * zoomH);
  if (left > visible.end || left + width < visible.start) return null;
  // um "clipe" de mentira só para o desenho da onda (sem áudio na memória, usa os picos)
  const summary = {
    id: `folder-preview-${folder.id}`, songId, waveformPeaks: preview.peaks, duration: preview.duration, gain: 1,
  } as unknown as AudioClip;
  return (
    <div
      className="absolute rounded-sm border overflow-hidden pointer-events-none"
      style={{
        left: `${left}px`,
        top: '2px',
        width: `${width}px`,
        height: `${height}px`,
        borderColor: `${folder.color}aa`,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        backgroundImage: `linear-gradient(180deg, ${folder.color}1f, ${folder.color}0a)`,
      }}
    >
      <ClipWaveform clip={summary} left={left} width={width} height={height} visible={visible} color={folder.color} />
      {height >= 20 && (
        <span
          className="absolute top-0.5 px-1 rounded-sm bg-black/70 text-[10px] font-semibold leading-tight whitespace-nowrap"
          style={{ left: `${Math.max(0, visible.start - left) + 3}px`, color: folder.color }}
        >
          {folder.name} · {count} {count === 1 ? 'áudio' : 'áudios'}
        </span>
      )}
    </div>
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
  const isImportActive = importProgress && !done && !failed;

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
      {!isImportActive && <SaveCancelButton className="ml-2" />}
      {isImportActive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            cancelImport();
          }}
          className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-logic-lcd-red/20 text-logic-lcd-red hover:bg-logic-lcd-red/35 border border-logic-lcd-red/40 transition flex items-center gap-1 shrink-0"
          title="Cancelar importação do VS"
        >
          <X size={10} />
          Cancelar
        </button>
      )}
    </div>
  );
}

/** Barra de rolagem horizontal nativa customizada (exclusiva para as faixas, sem alças de zoom) */
function TimelineHorizontalScrollbar({
  scrollRef,
  timelineWidth,
  headerWidth,
  zoomH,
  onDoubleClickFit,
  onZoomTo,
}: {
  scrollRef: React.RefObject<HTMLDivElement>;
  timelineWidth: number;
  headerWidth: number;
  zoomH: number;
  onDoubleClickFit?: () => void;
  /** Novo zoom (px/s) mantendo o instante `anchorTime` (s) no ponto `anchorX` (px) da tela. */
  onZoomTo?: (zoom: number, anchorTime: number, anchorX: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [clientWidth, setClientWidth] = useState(1000);
  const [scrollWidth, setScrollWidth] = useState(2000);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setScrollLeft(el.scrollLeft);
      setClientWidth(el.clientWidth);
      setScrollWidth(el.scrollWidth);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [scrollRef, headerWidth, timelineWidth]);

  // A área visível da timeline (exclusiva das faixas)
  const viewW = Math.max(10, clientWidth);
  const totalW = Math.max(viewW, timelineWidth);
  const maxScroll = Math.max(1, scrollWidth - clientWidth);

  // Proporção do thumb
  const ratio = Math.min(1, Math.max(0.06, viewW / totalW));
  const thumbWidthPct = ratio * 100;
  const maxThumbLeftPct = 100 - thumbWidthPct;
  const scrollRatio = Math.max(0, Math.min(1, scrollLeft / maxScroll));
  const thumbLeftPct = scrollRatio * maxThumbLeftPct;

  // Arraste suave do thumb
  const handleThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startScroll = scrollRef.current?.scrollLeft ?? 0;
    const barW = barRef.current?.clientWidth ?? 1;

    let rafId: number | null = null;
    const move = (ev: PointerEvent) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const deltaX = ev.clientX - startX;
        const availablePx = barW * (1 - ratio);
        if (availablePx > 0 && scrollRef.current) {
          const scrollDelta = (deltaX / availablePx) * maxScroll;
          scrollRef.current.scrollLeft = Math.max(0, Math.min(maxScroll, startScroll + scrollDelta));
        }
      });
    };

    const up = () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Alças nas pontas do controle (como no Logic/Reaper): arrastar uma ponta muda o zoom e a
  // outra ponta fica parada no mesmo instante da música.
  const handleEdgePointerDown = (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !scrollRef.current || !barRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    const barW = barRef.current.clientWidth || 1;
    const zoom0 = zoomH;
    const contentSec = Math.max(0.1, timelineWidth / zoom0);
    const view = Math.max(10, el.clientWidth);
    const leftTime = el.scrollLeft / zoom0;
    const rightTime = (el.scrollLeft + view) / zoom0;
    const thumb0 = Math.max(24, ratio * barW);
    const startX = e.clientX;
    let rafId: number | null = null;
    const move = (ev: PointerEvent) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const dx = ev.clientX - startX;
        const thumb = Math.max(12, Math.min(barW, thumb0 + (side === 'right' ? dx : -dx)));
        // largura do controle = parte visível da música: mais largo, menos zoom
        const visibleSec = (thumb / barW) * contentSec;
        const zoom = Math.max(1, Math.min(500, view / Math.max(0.05, visibleSec)));
        if (side === 'right') onZoomTo?.(zoom, leftTime, 0);
        else onZoomTo?.(zoom, rightTime, view);
      });
    };
    const up = () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Clique na pista para pular para a posição
  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !barRef.current || !scrollRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const clickRatio = (e.clientX - rect.left) / rect.width;
    const targetScroll = (clickRatio - ratio / 2) * maxScroll / Math.max(0.01, 1 - ratio);
    scrollRef.current.scrollLeft = Math.max(0, Math.min(maxScroll, targetScroll));
  };

  return (
    <div
      ref={barRef}
      className="flex-1 h-full bg-[#121212] relative cursor-pointer overflow-hidden border-l border-logic-border-dark select-none"
      onPointerDown={handleTrackPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClickFit?.();
      }}
      title="Rolar a timeline. Pontas do controle: zoom. Duplo clique: a música inteira cabe na tela (vale também para as próximas músicas que você selecionar, até mudar o zoom à mão)"
    >
      <div
        className="absolute top-1/2 -translate-y-1/2 h-[8px] rounded-full bg-[#3e3e3e] hover:bg-[#525252] active:bg-[#626262] border border-white/[0.08] shadow-sm cursor-grab active:cursor-grabbing transition-colors"
        style={{
          left: `${thumbLeftPct}%`,
          width: `${thumbWidthPct}%`,
          minWidth: '24px',
        }}
        onPointerDown={handleThumbPointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClickFit?.();
        }}
      >
        {(['left', 'right'] as const).map((side) => (
          <div
            key={side}
            className={`absolute top-[-3px] bottom-[-3px] w-[7px] cursor-ew-resize group/edge ${side === 'left' ? 'left-0' : 'right-0'}`}
            onPointerDown={handleEdgePointerDown(side)}
            onDoubleClick={(e) => { e.stopPropagation(); onDoubleClickFit?.(); }}
            title="Arraste para dar zoom na timeline"
          >
            <div className={`absolute top-1/2 -translate-y-1/2 h-[10px] w-[3px] rounded-full bg-white/35 group-hover/edge:bg-logic-accent ${side === 'left' ? 'left-[2px]' : 'right-[2px]'}`} />
          </div>
        ))}
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
  const updateSong = useStore((s) => s.updateSong);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const trackHeadersRef = useRef<HTMLDivElement>(null);
  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const [regionDrag, setRegionDrag] = useState<RegionDrag>(null);
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null);
  // Editor da marcação de fala do Maestro por IA (texto, voz e ritmo)
  const [readingNarrationId, setReadingNarrationId] = useState<string | null>(null);
  // Contagem do Maestro IA (1, 2, 3, 4... nos clicks da grade): nova ou editando uma existente
  const [countTarget, setCountTarget] = useState<CountInTarget | null>(null);
  const addNarration = useStore((s) => s.addNarration);
  // Último recurso manual: cravar o BPM a partir de um ponto da régua quando a detecção automática
  // não conseguir sincronizar um trecho (ex.: medley com transições muito sutis ou sem click).
  const [manualTempoPoint, setManualTempoPoint] = useState<{ time: number; x: number; y: number; existingBpm?: number; editing?: boolean } | null>(null);
  const [tempoDrag, setTempoDrag] = useState<{ from: number; to: number } | null>(null);
  const setTempoAt = useStore((s) => s.setTempoAt);
  const removeTempoAt = useStore((s) => s.removeTempoAt);
  const [visible, setVisible] = useState<VisibleRange>({ start: 0, end: 4000 });
  const [noSpaceHint, setNoSpaceHint] = useState(false);
  const [trimDrag, setTrimDrag] = useState<TrimDrag>(null);
  const [moveDrag, setMoveDrag] = useState<MoveDrag>(null);
  const updateClip = useStore((s) => s.updateClip);
  const updateClips = useStore((s) => s.updateClips);
  const moveClipsToTracks = useStore((s) => s.moveClipsToTracks);
  const splitClipAt = useStore((s) => s.splitClipAt);
  const splitClipsAt = useStore((s) => s.splitClipsAt);
  const removeClips = useStore((s) => s.removeClips);
  const removeNarration = useStore((s) => s.removeNarration);
  // Retângulo de seleção (arrastar na grade vazia), em pixels da área da timeline
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const recordingMaestro = useStore((s) => s.recordingMaestro);
  const timelineLocked = useStore((s) => s.timelineLocked);
  const groupClips = useStore((s) => s.groupClips);
  const ungroupClips = useStore((s) => s.ungroupClips);
  const zoomAnchorRef = useRef<{ time: number; mouseX: number } | null>(null);
  const lastSelectedClipIdRef = useRef<string | null>(null);

  // Controle de expansão/recolhimento sincronizado entre a barra de cabeçalhos e as faixas da timeline
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  const activeSongId = selectedSongId ?? playlist[0]?.songId ?? null;
  const song = songs.find((sg) => sg.id === activeSongId);
  const createNarration = useCallback((start: number, end: number) => {
    if (!song) return;
    const id = `narracao-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const pitch = lastPitch();
    addNarration(song.id, { id, text: '', voice: lastVoice(), start, end, status: 'pending', ...(pitch ? { pitch } : {}) });
    setReadingNarrationId(id);
  }, [song, addNarration]);
  // "+ Fala": nasce no começo do beat em que o cursor está (ou no espaço livre mais perto)
  const addNarrationAtCursor = useCallback(() => {
    if (!song) return;
    const at = beatStartAt(song, cursorTime(song.id) ?? 0);
    const length = Math.min(2, Math.max(NARRATION_MIN_LENGTH, song.duration - at));
    const start = placeNarration(song, '', at, length);
    if (start !== null) createNarration(start, start + length);
  }, [song, createNarration]);
  const isSongLoading = !!song && loadingSongIds.includes(song.id);
  const songClips = useMemo(() =>
    song ? clips.filter((c) => c.songId === song.id) : [],
    [clips, song]
  );
  // Pasta recolhida: uma forma de onda só, com todos os áudios das trilhas de dentro
  const folderPreviews = useMemo(() => {
    const out = new Map<string, { preview: FolderPreview; count: number }>();
    for (const folderId of collapsedFolders) {
      const folder = tracks.find((t) => t.id === folderId);
      if (!folder?.isSubgroup || folder.children.length === 0) continue;
      const inside = new Set(folder.children);
      const own = songClips.filter((c) => inside.has(c.trackId));
      const preview = mergeFolderPeaks(own);
      if (preview) out.set(folderId, { preview, count: own.length });
    }
    return out;
  }, [collapsedFolders, tracks, songClips]);
  const clickClip = useMemo(() => {
    return songClips.find(
      (c) => c.trackId === 'track-click' || /cli[cqk]|klick|metr[oô]|\bclk/i.test(c.fileName) || /cli[cqk]|klick|metr[oô]|\bclk/i.test(c.name)
    );
  }, [songClips]);
  const grid = useMemo(() => songGrid(song, clickClip), [song, clickClip]);
  // enquanto a plaquinha amarela é arrastada, a grade mostra a mudança de andamento no lugar novo
  const shownGrid = useMemo(() => {
    if (!grid?.tempoSegments || !tempoDrag) return grid;
    const index = tempoChangeIndex(grid.tempoSegments, tempoDrag.from);
    return index < 1 ? grid : { ...grid, tempoSegments: moveTempoChange(grid.tempoSegments, index, tempoDrag.to) };
  }, [grid, tempoDrag]);
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);

  const allVisibleTracks = useMemo(() => {
    const result: Track[] = [];
    const tc = tracks.find((t) => t.id === TIMECODE_TRACK_ID);
    if (tc) result.push(tc);
    for (const id of ROUTABLE_TRACKS) {
      const track = tracks.find((t) => t.id === id);
      if (!track) continue;
      result.push(track);
      if (track.isSubgroup && !collapsedFolders.has(track.id)) {
        for (const childId of track.children) {
          const child = tracks.find((t) => t.id === childId);
          if (child) result.push(child);
        }
      }
    }
    return result;
  }, [tracks, collapsedFolders]);

  // Pasta recolhida: a linha dela vale pelas trilhas de dentro (na seleção por retângulo e no Shift)
  const collapsedRows = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const folderId of collapsedFolders) {
      const folder = tracks.find((t) => t.id === folderId);
      if (folder?.isSubgroup) out.set(folderId, folder.children);
    }
    return out;
  }, [collapsedFolders, tracks]);

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
    // fala do Maestro IA selecionada sai inteira (marcação e voz); os outros áudios, como sempre
    const narrationOf = new Map((song?.narrations ?? []).filter((n) => n.clipId).map((n) => [n.clipId as string, n.id]));
    const { clips: plain, narrations } = splitNarrationClips(targetIds, new Set(narrationOf.keys()));
    beginGesture();
    if (plain.length > 0) removeClips(plain);
    if (song) for (const clipId of narrations) removeNarration(song.id, narrationOf.get(clipId)!);
    endGesture();
    if (song) audioEngine.invalidatePrepared(song.id);
  }, [timelineLocked, selectedClipIds, removeClips, removeNarration, song]);

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
        if (e.shiftKey) {
          // Atalho ⌘+Shift+G (ou Ctrl+Shift+G): Emendar / Unir clipes de áudio (Glue)
          void glueSelectedClips();
        } else if (selectedClipIds.length >= 2) {
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

    // Se o clipe já fizer parte de uma seleção múltipla, corta todos os selecionados em lote
    const isMultiSelected = selectedSet.has(clip.id) && selectedClipIds.length > 1;
    const targets = isMultiSelected
      ? songClips.filter((c) => selectedSet.has(c.id))
      : clip.groupId
        ? songClips.filter((c) => c.groupId === clip.groupId)
        : [clip];
    const idSet = new Set(targets.map((c) => c.id));
    if (!isMultiSelected) {
      selectClips(targets.map((c) => c.id));
    }

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
        if (song && !audioEngine.refreshPreparedAfterEndCut(song.id)) audioEngine.invalidatePrepared(song.id);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
  };

  const handleSelectClip = (clip: AudioClip, additive: boolean, isShift: boolean) => {
    let currentSelection = selectedClipIds.filter((id) => songClips.some((c) => c.id === id));
    const groupMembers = clip.groupId
      ? songClips.filter((c) => c.groupId === clip.groupId).map((c) => c.id)
      : [clip.id];

    if (isShift && lastSelectedClipIdRef.current) {
      // Shift + clique: tudo entre o áudio clicado antes e este (as linhas entre os dois, falas do
      // Maestro IA incluídas, no trecho de tempo entre eles)
      const prevClip = songClips.find((c) => c.id === lastSelectedClipIdRef.current);
      if (prevClip) {
        const rows = selectionRows(allVisibleTracks.map((t) => t.id));
        const range = rangeSelection(songClips, rows, prevClip, clip, clipPlayLength, MAESTRO_IA_TRACK_ID, collapsedRows);
        selectClips(additive ? Array.from(new Set([...currentSelection, ...range])) : range);
        return;
      }
    }

    if (additive) {
      // Toggle aditivo individual com Command / Ctrl (adiciona ou remove do conjunto)
      if (selectedSet.has(clip.id)) {
        currentSelection = currentSelection.filter((id) => !groupMembers.includes(id));
      } else {
        currentSelection = Array.from(new Set([...currentSelection, ...groupMembers]));
      }
      selectClips(currentSelection);
      lastSelectedClipIdRef.current = clip.id;
    } else {
      // Clique normal: seleciona este clipe (ou grupo)
      selectClips(groupMembers);
      lastSelectedClipIdRef.current = clip.id;
    }
  };

  /** Clique numa fala do Maestro IA: entra na mesma seleção dos clipes (Cmd soma, Shift vai até ela). */
  const handleNarrationSelect = (clipId: string, mods: { additive: boolean; shift: boolean }) => {
    const clip = songClips.find((c) => c.id === clipId);
    if (!clip) return;
    if (mods.additive || mods.shift) {
      handleSelectClip(clip, mods.additive, mods.shift);
    } else {
      selectClips([clip.id]);
      lastSelectedClipIdRef.current = clip.id;
    }
  };

  /**
   * Arrastar na grade vazia: retângulo de seleção, como numa DAW. Pega os áudios das linhas que ele
   * cobre (falas do Maestro IA e trilhas de pasta recolhida inclusive) no trecho de tempo dele.
   * Com Cmd ou Shift no começo, soma com a seleção de antes.
   */
  const startMarquee = (e: React.PointerEvent<HTMLDivElement>, additive: boolean, onClick?: () => void) => {
    const content = e.currentTarget;
    const r0 = content.getBoundingClientRect();
    const sx = e.clientX - r0.left;
    const sy = e.clientY - r0.top;
    const before = additive ? useStore.getState().selectedClipIds : [];
    const clipsNow = songClips;
    let active = false;
    const move = (ev: PointerEvent) => {
      const rect = content.getBoundingClientRect();
      const cx = ev.clientX - rect.left;
      const cy = ev.clientY - rect.top;
      if (!active && Math.hypot(cx - sx, cy - sy) < 5) return;
      active = true;
      const left = Math.max(0, Math.min(sx, cx));
      const top = Math.max(0, Math.min(sy, cy));
      const width = Math.abs(cx - sx);
      const height = Math.abs(cy - sy);
      setMarquee({ left, top, width, height });
      const yA = rect.top + top;
      const yB = rect.top + top + height;
      const rows: string[] = [];
      content.querySelectorAll<HTMLElement>('[data-lane-track-id], [data-narration-lane]').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.bottom > yA && b.top < yB) rows.push(el.hasAttribute('data-narration-lane') ? NARRATION_ROW : (el.dataset.laneTrackId ?? ''));
      });
      const picked = clipsInBox(clipsNow, rows, left / zoomH, (left + width) / zoomH, clipPlayLength, MAESTRO_IA_TRACK_ID, { extraRows: collapsedRows });
      selectClips(marqueeSelection(before, picked, additive));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setMarquee(null);
      if (active) lastSelectedClipIdRef.current = null;
      else onClick?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const handleMoveStart = (e: React.PointerEvent<HTMLDivElement>, clip: AudioClip) => {
    if (timelineLocked) return;
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("button, input, [role=\"button\"], .group\\/fadeLine, .group\\/trimStart, .group\\/trimEnd")) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const additive = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    const isAlreadySelected = selectedSet.has(clip.id);
    // Seleção e membros do grupo ANTES de qualquer troca de seleção abaixo — usados em up()
    // para decidir se um clique simples (sem arrastar) deve focar só este clipe.
    const currentSelection = selectedClipIds.filter((id) => songClips.some((c) => c.id === id));
    const groupMembers = clip.groupId
      ? songClips.filter((c) => c.groupId === clip.groupId).map((c) => c.id)
      : [clip.id];

    if (isShift || additive || !isAlreadySelected) {
      handleSelectClip(clip, additive, isShift);
    }

    const activeSelection = useStore.getState().selectedClipIds.filter((id) => songClips.some((c) => c.id === id));
    const idSet = new Set(activeSelection.length > 0 ? activeSelection : [clip.id]);
    const targets = songClips.filter((c) => idSet.has(c.id));
    if (targets.length === 0) return;

    // Menor startTime entre os alvos para nao deixar arrastar antes de zero
    const minStart = Math.min(...targets.map((c) => c.startTime));
    const origStart = clip.startTime;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    const startY = e.clientY;
    let delta = 0;
    let hasMoved = false;

    // Arrastar para cima ou para baixo leva os áudios para outra trilha. Recebem áudio as trilhas
    // de verdade, na ordem da tela (pasta e timecode não). Vários áudios andam o mesmo tanto.
    const lanes = allVisibleTracks.filter((t) => !t.isSubgroup && t.id !== TIMECODE_TRACK_ID).map((t) => t.id);
    const anchorLane = lanes.indexOf(clip.trackId);
    // fala do Maestro IA não troca de trilha: só os clipes contam para o arraste para cima/baixo
    const sourceLanes = targets.filter((c) => c.trackId !== MAESTRO_IA_TRACK_ID).map((c) => lanes.indexOf(c.trackId));
    let offset = 0;
    let laneMovesNow: { clipId: string; trackId: string }[] = [];
    const laneUnder = (y: number): string | null => {
      const root = scrollRef.current;
      if (!root) return null;
      for (const row of root.querySelectorAll<HTMLElement>('[data-lane-track-id]')) {
        const b = row.getBoundingClientRect();
        if (y >= b.top && y < b.bottom) return row.dataset.laneTrackId ?? null;
      }
      return null;
    };

    const describe = (st: number) => (grid ? `${formatRegionTime(st)} | ${barBeatLabel(st, grid)}` : formatRegionTime(st));
    const move = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (!hasMoved && dist < 4) return;
      hasMoved = true;

      const raw = origStart + (ev.clientX - startX) / zoomH;
      const snapped = snapTime(raw, grid, ev.altKey ? "off" : snapStep);
      delta = Math.max(-minStart, snapped - origStart);
      // em cima de pasta ou do timecode, fica na última trilha válida
      const over = laneUnder(ev.clientY);
      const overIndex = over ? lanes.indexOf(over) : -1;
      if (overIndex >= 0) offset = laneOffset(anchorLane, overIndex, sourceLanes, lanes.length);
      laneMovesNow = laneMoves(lanes, targets, offset);
      // Indo para outra trilha, o áudio só sobe ou desce: o tempo fica onde estava, para não
      // sair do compasso. Para os lados, só arrastando dentro da mesma trilha.
      if (laneMovesNow.length > 0) delta = 0;
      const newStart = origStart + delta;
      const anchorTo = laneMovesNow.find((m) => m.clipId === clip.id)?.trackId;
      const toNames = new Set(laneMovesNow.map((m) => m.trackId));
      const laneLabel = laneMovesNow.length === 0
        ? undefined
        : toNames.size === 1
          ? tracks.find((t) => t.id === anchorTo)?.name ?? ''
          : `${toNames.size} trilhas`;
      setMoveDrag({
        ids: idSet, delta, anchorId: clip.id, start: newStart, label: describe(newStart),
        ghosts: laneMovesNow.map((m) => ({ trackId: m.trackId, clipId: m.clipId })),
        laneLabel,
      });
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

      // Se não moveu e foi clique simples sem Command em um item de uma seleção múltipla anterior, foca só nele
      if (!hasMoved && !additive && !isShift && isAlreadySelected && currentSelection.length > 1) {
        selectClips(groupMembers);
        lastSelectedClipIdRef.current = clip.id;
        return;
      }

      const timeMoved = Math.abs(delta) >= 1e-4;
      if (!timeMoved && laneMovesNow.length === 0) return;
      // tempo e trilha voltam juntos num Cmd+Z só
      beginGesture();
      if (timeMoved) {
        updateClips(targets.map((c) => ({
          id: c.id,
          patch: { startTime: Math.max(0, c.startTime + delta) },
        })));
      }
      if (laneMovesNow.length > 0) moveClipsToTracks(laneMovesNow);
      endGesture();
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

  // Botão Região: guarda o ponto do cursor e abre a janela de nomes (Intro, Refrão...); a região
  // só é criada depois que a pessoa escolhe o nome.
  const [regionSlot, setRegionSlot] = useState<{ songId: string; start: number; end: number } | null>(null);
  const handleAddRegionAtCursor = () => {
    if (!song) return;
    const st = useStore.getState();
    const cursor = st.transport.isPlaying && st.transport.currentSongId === song.id
      ? audioEngine.getCurrentTime()
      : st.transport.currentTime;
    const slot = freeSlotAt(song, snapTime(cursor, grid, snapStep));
    if (!slot) { setNoSpaceHint(true); return; }
    setRegionSlot({ songId: song.id, ...slot });
  };
  const createRegionNamed = (name: string) => {
    const slot = regionSlot;
    setRegionSlot(null);
    if (!song || !slot || slot.songId !== song.id) return;
    const id = `region-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const color = presetColor(name) ?? suggestRegionStyle(song.regions ?? []).color;
    if (!addSongRegion(song.id, { id, name, color, start: slot.start, end: slot.end, loop: false })) setNoSpaceHint(true);
  };

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
    const end = Math.ceil((el.scrollLeft + el.clientWidth + VIEW_MARGIN_PX) / quantum) * quantum;
    setVisible((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  /**
   * A coluna dos nomes anda junto com a timeline. Feito dentro do quadro de pintura (em vez de no
   * evento de rolagem): o navegador desenha as duas no mesmo quadro, senão a coluna esquerda
   * "ficava para trás" por um quadro a cada rolagem e o olho lia isso como folga.
   */
  const followRange = useRef({ x: -1, y: -1 });
  /**
   * Quanto a timeline rola no máximo, nos dois sentidos: é o tamanho do caminho que a coluna dos
   * nomes e a régua andam junto (src/index.css). Muda com faixas, zoom e janela, e também durante a
   * rolagem (a grade desenhada mais à frente aumenta a área rolável): por isso é conferido também a
   * cada rolagem, mas só grava quando mudou.
   */
  const applyFollowRange = useCallback(() => {
    const el = scrollRef.current;
    const root = timelinePanelRef.current;
    if (!el || !root) return;
    const x = Math.max(0, el.scrollWidth - el.clientWidth);
    const y = Math.max(0, el.scrollHeight - el.clientHeight);
    if (x !== followRange.current.x) root.style.setProperty('--vs-follow-max-x', String(x));
    if (y !== followRange.current.y) root.style.setProperty('--vs-follow-max-y', String(y));
    followRange.current = { x, y };
  }, []);

  const syncHeaders = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (FOLLOW_SCROLL_CSS) { applyFollowRange(); return; }
    if (headerScrollRef.current && headerScrollRef.current.scrollLeft !== el.scrollLeft) {
      headerScrollRef.current.scrollLeft = el.scrollLeft;
    }
    if (trackHeadersRef.current && trackHeadersRef.current.scrollTop !== el.scrollTop) {
      trackHeadersRef.current.scrollTop = el.scrollTop;
    }
  }, [applyFollowRange]);

  const handleScroll = useCallback(() => {
    syncHeaders();
    updateVisible();
  }, [updateVisible, syncHeaders]);

  // Rolar com dois dedos (pad) na coluna dos nomes: a rolagem é sempre a da timeline.
  useEffect(() => {
    const at = (e: Event) => {
      syncHeaders();
      updateVisible();
    };
    const heads = trackHeadersRef.current;
    const main = scrollRef.current;
    heads?.addEventListener('scroll', at, { passive: true });
    main?.addEventListener('scroll', at, { passive: true });
    return () => {
      heads?.removeEventListener('scroll', at);
      main?.removeEventListener('scroll', at);
    };
  }, [syncHeaders, updateVisible]);

  // A coluna das faixas só existe com uma música aberta: o rolar com dois dedos é ligado sempre
  // que ela aparece (antes era ligado uma vez só, na abertura — sem música ainda, nunca ligava).
  const hasSong = !!song;
  useEffect(() => {
    const el = trackHeadersRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // pinça / Ctrl + rolar é zoom (tratado no painel inteiro)
      if (e.ctrlKey) return;
      e.preventDefault();
      if (scrollRef.current) {
        // Ao rolar em cima das tracks, rola estritamente na vertical (nunca na horizontal)
        const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        const delta = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * el.clientHeight : raw;
        scrollRef.current.scrollTop += delta;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasSong]);

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
    if (el && headerScrollRef.current && !FOLLOW_SCROLL_CSS) headerScrollRef.current.scrollLeft = el.scrollLeft;
    updateVisible();
  }, [zoomH, timelineWidth, updateVisible]);

  // O caminho da coluna dos nomes e da régua acompanha faixas, zoom e tamanho da janela.
  useEffect(() => {
    if (!FOLLOW_SCROLL_CSS) return;
    const el = scrollRef.current;
    if (!el) return;
    followRange.current = { x: -1, y: -1 };
    applyFollowRange();
    const ro = new ResizeObserver(applyFollowRange);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [hasSong, timelineWidth, zoomH, applyFollowRange]);
  // a grade e as ondas desenhadas mais à frente mudam a área rolável sem mudar o tamanho de nada
  useLayoutEffect(() => {
    if (FOLLOW_SCROLL_CSS) applyFollowRange();
  }, [visible, applyFollowRange]);

  const zoomAround = useCallback((factor: number, mouseX: number) => {
    const el = scrollRef.current;
    const current = useStore.getState().zoomH;
    if (el) zoomAnchorRef.current = { time: (el.scrollLeft + mouseX) / current, mouseX };
    setZoomH(Math.round(current * factor * 100) / 100);
  }, [setZoomH]);

  // Zoom da timeline com os dois dedos no trackpad do Mac (pinch-to-zoom e wheel com Ctrl)
  useEffect(() => {
    const el = timelinePanelRef.current;
    if (!el) return;

    // O trackpad manda vários eventos por quadro; junta todos e aplica o zoom uma vez só por quadro.
    let pendingZoom: { factor: number; mouseX: number } | null = null;
    let zoomFrame = 0;
    const queueZoom = (factor: number, mouseX: number) => {
      pendingZoom = { factor: (pendingZoom?.factor ?? 1) * factor, mouseX };
      if (zoomFrame) return;
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = 0;
        const pending = pendingZoom;
        pendingZoom = null;
        if (pending) zoomAround(pending.factor, pending.mouseX);
      });
    };

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const scrollEl = scrollRef.current;
      const rect = scrollEl ? scrollEl.getBoundingClientRect() : el.getBoundingClientRect();
      const mouseX = Math.max(0, e.clientX - rect.left);
      const factor = Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.015);
      queueZoom(factor, mouseX);
    };

    // Suporte a gestos nativos de pinça (pinch) no Safari e Chromium do macOS
    let gestureStartZoom = 1;
    const onGestureStart = (e: any) => {
      e.preventDefault();
      gestureStartZoom = useStore.getState().zoomH;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      const scrollEl = scrollRef.current;
      const rect = scrollEl ? scrollEl.getBoundingClientRect() : el.getBoundingClientRect();
      const mouseX = Math.max(0, e.clientX - rect.left);
      const targetZoom = Math.max(1, Math.min(200, gestureStartZoom * (e.scale || 1)));
      const currentZoom = useStore.getState().zoomH * (pendingZoom?.factor ?? 1);
      const factor = targetZoom / Math.max(0.1, currentZoom);
      queueZoom(factor, mouseX);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    return () => {
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, [zoomAround]);

  const zoomButton = (factor: number) => {
    const el = scrollRef.current;
    const st = useStore.getState();
    const playheadX = st.transport.currentTime * st.zoomH - (el?.scrollLeft ?? 0);
    const viewW = el ? el.clientWidth : 0;
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
  const resetHeaderWidth = useCallback(() => setTrackHeaderWidth(220), [setTrackHeaderWidth]);

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

  // Duplo clique na barra de rolagem horizontal: a música inteira (até o último clipe) cabe na
  // tela. Liga o modo "caber na tela": cada música selecionada depois também se ajusta sozinha,
  // até a pessoa mudar o zoom à mão.
  const fitModeRef = useRef(false);
  const fitZoomRef = useRef<number | null>(null);
  const fitToScreen = useCallback(() => {
    if (!song || contentEnd <= 0.1 || !scrollRef.current) return;
    const clientW = scrollRef.current.clientWidth ?? 1000;
    const availableW = Math.max(300, clientW - 40);
    const targetZoom = Math.round(Math.max(1, Math.min(200, availableW / contentEnd)) * 100) / 100;
    fitZoomRef.current = targetZoom;
    setZoomH(targetZoom);
    scrollRef.current.scrollLeft = 0;
  }, [song, contentEnd, setZoomH]);
  const handleFitSongToScreen = useCallback(() => {
    fitModeRef.current = true;
    fitToScreen();
  }, [fitToScreen]);
  useEffect(() => {
    if (fitModeRef.current) fitToScreen();
    // só ao trocar de música (ou ela mudar de tamanho), não a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, contentEnd]);
  useEffect(() => {
    // zoom diferente do ajustado = mexeram no zoom à mão: o modo desliga
    if (fitModeRef.current && fitZoomRef.current !== null && Math.abs(zoomH - fitZoomRef.current) > 0.011) fitModeRef.current = false;
  }, [zoomH]);
  const zoomToAnchor = useCallback((zoom: number, anchorTime: number, anchorX: number) => {
    zoomAnchorRef.current = { time: anchorTime, mouseX: anchorX };
    setZoomH(Math.round(zoom * 100) / 100);
  }, [setZoomH]);

  const gridStyle = grid ? {} : {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${stepPx - 1}px, rgba(255,255,255,0.045) ${stepPx - 1}px, rgba(255,255,255,0.045) ${stepPx}px)`,
  };

  return (
    <div ref={timelinePanelRef} className={`flex flex-col h-full bg-logic-bg flex-1 min-w-0 relative ${FOLLOW_SCROLL_CSS ? 'timeline-follow-scope' : ''}`}>
      <div className="flex bg-logic-bg-deep border-b border-logic-border-dark">
        <div className="flex flex-col border-r border-logic-border-dark shrink-0" style={{ width: `${HEADER_W}px` }}>
          {/* Ações rápidas: teclas de mesa (Dividir, Medley, Regiões) */}
          <div className="h-10 flex items-center px-2 border-b border-logic-border-dark/60 bg-logic-bg-deep">
            <div className="flex items-center w-full h-[26px] select-none gap-1">
              <button
                className="console-key flex-1 h-full flex items-center justify-center gap-1 px-1 text-[12px] disabled:pointer-events-none"
                onClick={handleSplitAtCursor}
                disabled={!song || timelineLocked}
                title="Dividir áudios selecionados no cursor (Split - atalho S)"
              >
                <Scissors size={11} className="shrink-0" />
                <span className="leading-none">Dividir</span>
              </button>
              <button
                className="console-key flex-1 h-full flex items-center justify-center gap-1 px-1 text-[12px] disabled:pointer-events-none"
                onClick={handleCutMedleyAtCursor}
                disabled={!song || timelineLocked}
                title="Fatiar medley no cursor: separa uma música da outra"
              >
                <ArrowLeftRight size={11} className="shrink-0" />
                <span className="leading-none">Medley</span>
              </button>
              <button
                data-region-button
                className={`console-key flex-1 h-full flex items-center justify-center gap-1 px-1 text-[12px] disabled:pointer-events-none ${regionSlot ? 'is-lit-blue' : ''}`}
                onClick={handleAddRegionAtCursor}
                disabled={!song || timelineLocked}
                title="Nova região no cursor: escolha Intro, Pré-refrão, Refrão, Ponte, Solo, Final ou escreva outro nome"
              >
                <Plus size={12} className="shrink-0" />
                <span className="leading-none">Região</span>
              </button>
            </div>
            {regionSlot && (
              <RegionNamePicker
                anchor="[data-region-button]"
                title="Nova região"
                onPick={createRegionNamed}
                onClose={() => setRegionSlot(null)}
              />
            )}
          </div>

          {/* Linha 2: Navegação, Altura e Zoom Horizontal */}
          <div className="h-9 flex items-center justify-between px-3">
            <div className="flex items-center gap-1">
              <button className="text-logic-text-muted hover:text-logic-text disabled:opacity-30 p-1 rounded hover:bg-logic-bg-elevated" disabled={zoomV <= 0.5} onClick={() => setZoomV(Math.max(0.5, Math.round(zoomV * 0.8 * 100) / 100))} title="Diminuir altura das tracks"><FoldVertical size={13} /></button>
              <button className="text-logic-text-muted hover:text-logic-text disabled:opacity-30 p-1 rounded hover:bg-logic-bg-elevated" disabled={zoomV >= 3} onClick={() => setZoomV(Math.min(3, Math.round(zoomV * 1.25 * 100) / 100))} title="Aumentar altura das tracks"><UnfoldVertical size={13} /></button>
            </div>
            <div className="text-[10px] text-logic-text-muted select-none font-mono">
              {noSpaceHint ? <span className="text-logic-lcd-amber font-sans">Sem espaço</span> : `${Math.round(zoomH * 10)}%`}
            </div>
            <div className="flex items-center gap-1">
              <button className="text-logic-text-muted hover:text-white p-1 rounded hover:bg-logic-bg-elevated transition-colors" onClick={() => zoomButton(0.75)} title="Diminuir zoom horizontal (Afastar)"><ZoomOut size={13} /></button>
              <button className="text-logic-text-muted hover:text-white p-1 rounded hover:bg-logic-bg-elevated transition-colors" onClick={() => zoomButton(1.35)} title="Aumentar zoom horizontal (Aproximar)"><ZoomIn size={13} /></button>
            </div>
          </div>
        </div>
        <div ref={headerScrollRef} className="flex-1 overflow-hidden">
          <div className={FOLLOW_SCROLL_CSS ? 'timeline-follow-x' : undefined} style={{ width: `${timelineWidth + 24}px` }}>
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
              onContextMenu={(e) => {
                e.preventDefault();
                if (!song || !grid) return;
                if (e.shiftKey) {
                  // Shift + botão direito: cravar início de compasso (comportamento original)
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const clickTime = Math.max(0, clickX / zoomH);
                  const barDuration = grid.beatsPerBar * grid.beat;
                  const newDownbeat = clickTime % barDuration;
                  updateSong(song.id, { downbeat: Math.round(newDownbeat * 1000) / 1000 });
                  return;
                }
                // Botão direito simples: último recurso manual — abre o campo para cravar o
                // andamento (BPM) a partir deste ponto exato da régua (ideal para medleys).
                const rect = e.currentTarget.getBoundingClientRect();
                const clickTime = Math.max(0, (e.clientX - rect.left) / zoomH);
                const segs = grid.tempoSegments;
                const existingBpm = segs?.find((s) => clickTime >= s.startTime && clickTime < s.endTime)?.bpm ?? song.bpm;
                setManualTempoPoint({ time: clickTime, x: e.clientX, y: e.clientY, existingBpm });
              }}
              title="Clique para posicionar cursor. Botão direito: cravar o andamento neste ponto (último recurso). Shift + botão direito: cravar início de compasso."
            >
              {shownGrid && song && (
                <BarRulerLayer
                  song={song}
                  grid={shownGrid}
                  zoomH={zoomH}
                  visible={visible}
                  onTempoDrag={setTempoDrag}
                  onEditTempo={({ time, bpm, x, y }) => {
                    // a mudança fica exatamente no início do trecho com esse andamento
                    const seg = grid?.tempoSegments?.reduce((best, sg) => (Math.abs(sg.startTime - time) < Math.abs(best.startTime - time) ? sg : best));
                    setManualTempoPoint({ time: seg?.startTime ?? time, x, y, existingBpm: bpm, editing: true });
                  }}
                />
              )}
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

      <div className="flex-1 flex overflow-hidden relative">
        {!song ? (
          <div className="flex items-center justify-center h-full w-full text-logic-text-muted text-xs">
            Importe um VS ou selecione uma música para ver a timeline
          </div>
        ) : (
          <>
            {/* Coluna da esquerda (Tracks): LARGURA FIXA, 100% IMÓVEL HORIZONTALMENTE */}
            <div
              ref={trackHeadersRef}
              className={`bg-[#1e1e24] border-r border-logic-border-dark shrink-0 overflow-x-hidden ${FOLLOW_SCROLL_CSS ? 'overflow-y-hidden' : 'overflow-y-auto'} no-scrollbar select-none relative z-20 shadow-[4px_0_16px_rgba(0,0,0,0.6)]`}
              style={{ width: `${HEADER_W}px` }}
            >
              <div className={FOLLOW_SCROLL_CSS ? 'timeline-follow-y' : undefined}>
              {/* A primeira linha é a de timecode, alinhada com a primeira linha de áudios à direita.
                  A MedleyLane e a RegionLane ficam no cabeçalho fixo de cima, não aqui. */}
              <TimecodeTrackRow songId={song.id} />
              {ROUTABLE_TRACKS.map((id) => {
                const track = tracks.find((t) => t.id === id);
                if (!track) return null;
                if (track.isSubgroup) {
                  return (
                    <FolderGroup
                      key={track.id}
                      track={track}
                      expanded={!collapsedFolders.has(track.id)}
                      onToggle={() => toggleFolder(track.id)}
                      onContextMenu={handleOpenTrackMenu}
                    />
                  );
                }
                if (track.id === 'track-maestro') {
                  return (
                    <div key={track.id}>
                      <TrackRow track={track} depth={0} onContextMenu={handleOpenTrackMenu} />
                      <MaestroIaHeader songId={song.id} onAdd={addNarrationAtCursor} onCount={() => setCountTarget({ kind: 'new', start: cursorTime(song.id) ?? 0 })} />
                    </div>
                  );
                }
                return <TrackRow key={track.id} track={track} depth={0} onContextMenu={handleOpenTrackMenu} />;
              })}
              </div>
              <div
                className="absolute top-0 right-0 bottom-0 w-1.5 -mr-0.5 z-50 cursor-col-resize group/widthHandle"
                onPointerDown={handleHeaderWidthPointerDown}
                onDoubleClick={resetHeaderWidth}
                title="Arraste para os lados para ajustar a largura do painel de faixas. Duplo clique: tamanho padrão."
              >
                <div className="absolute top-0 right-0 bottom-0 w-px bg-logic-border-dark opacity-0 group-hover/widthHandle:opacity-100 group-hover/widthHandle:bg-logic-accent transition-opacity" />
              </div>
            </div>

            {/* Coluna da direita (Timeline & Clipes): Rola horizontalmente e verticalmente */}
            <div
              ref={scrollRef}
              className={`flex-1 overflow-x-scroll overflow-y-auto timeline-scroll-container relative z-10 ${FOLLOW_SCROLL_CSS ? 'timeline-follow-source' : ''}`}
              onScroll={handleScroll}
            >
              <div
                data-selectable="timeline"
                className="relative flex-shrink-0 z-10"
                style={{ width: `${timelineWidth}px`, minHeight: '100%', ...gridStyle }}
                onPointerDown={(e) => {
                  const target = e.target as HTMLElement;
                  if (!target.closest('[data-selectable="clip"], button, input, [role="button"], .group\\/widthHandle')) {
                    if (e.button !== 0) return;
                    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey;
                    let onClick: (() => void) | undefined;
                    if (plain) {
                      e.stopPropagation();
                      selectClip(null);
                      lastSelectedClipIdRef.current = null;
                      // Clique (sem arrastar) em lugar vazio da timeline: leva o cursor para a posição
                      // clicada, sem trocar a música atual. Arrastando, é seleção e o cursor fica.
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const clickTime = snapTime(Math.max(0, clickX / zoomH), grid, e.altKey ? 'off' : snapStep);
                      onClick = () => {
                        setCurrentTime(clickTime);
                        if (isPlaying && song) audioEngine.seekTo(clickTime);
                      };
                    }
                    // arrastar na grade vazia desenha o retângulo de seleção (Cmd ou Shift: soma)
                    startMarquee(e, !plain, onClick);
                  }
                }}
              >
                {/* retângulo de seleção (arrastar na grade vazia) */}
                {marquee && (
                  <div
                    className="absolute z-50 pointer-events-none rounded-[2px] border border-[#5aaaff] bg-[#5aaaff]/15 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
                    style={marquee}
                  />
                )}
                {allVisibleTracks.map((track) => {
                  const isFolder = track.isSubgroup;
                  const isTc = track.id === TIMECODE_TRACK_ID;
                  const trackClips = isFolder ? [] : songClips.filter((c) => c.trackId === track.id);
                  const rowHeight = isTc ? trackHeight : Math.round((track.height ?? 40) * zoomV);
                  // Logo abaixo da faixa Maestro fica a régua do Maestro por IA (falas geradas por voz).
                  // Ela acompanha a altura das faixas: com altura fixa, cada linha daqui para baixo
                  // saía deslocada da coluna dos nomes assim que se mudava o tamanho das tracks.
                  const isMaestroRow = track.id === 'track-maestro';
                  const maestroLaneHeight = Math.round(NARRATION_LANE_HEIGHT * zoomV);
                  // Pasta recolhida é UMA linha só, aqui e na coluna dos nomes (as filhas saem das
                  // duas). Antes a timeline guardava a altura de todas as filhas enquanto a coluna
                  // mostrava uma linha, e tudo abaixo da pasta ficava desalinhado.
                  return (
                    <div key={track.id}>
                    <div
                      data-lane-track-id={track.id}
                      className={`relative overflow-hidden ${isTc ? 'border-b-2 border-logic-lcd-amber/40 bg-logic-lcd-amber/[0.04]' : 'border-b border-logic-border-dark'} ${isFolder ? 'bg-logic-bg-deep/40 pointer-events-none' : ''} ${moveDrag?.ghosts?.some((g) => g.trackId === track.id) ? 'bg-[#ffab1f]/[0.07] shadow-[inset_0_0_0_1px_rgba(255,171,31,0.55)]' : ''}`}
                      style={{ height: `${rowHeight}px` }}
                    >
                      {/* Prévia dos áudios que vão cair nesta trilha */}
                      {moveDrag?.ghosts?.filter((g) => g.trackId === track.id).map((g) => {
                        const c = songClips.find((x) => x.id === g.clipId);
                        if (!c) return null;
                        return (
                          <div
                            key={`ghost-${g.clipId}`}
                            className="absolute rounded-sm border border-dashed border-[#ffab1f] bg-[#ffab1f]/15 pointer-events-none z-20 flex items-start px-1.5 pt-0.5 text-[10px] font-semibold text-[#ffcf7a] truncate"
                            style={{
                              left: `${Math.max(0, c.startTime + moveDrag.delta) * zoomH}px`,
                              top: '2px',
                              width: `${Math.max(8, clipPlayLength(c) * zoomH)}px`,
                              height: `${rowHeight - 4}px`,
                            }}
                          >
                            {c.name}
                          </div>
                        );
                      })}
                      {isFolder && folderPreviews.has(track.id) && (
                        <FolderPreviewBlock
                          folder={track}
                          songId={song.id}
                          preview={folderPreviews.get(track.id)!.preview}
                          count={folderPreviews.get(track.id)!.count}
                          height={rowHeight - 4}
                          zoomH={zoomH}
                          visible={visible}
                        />
                      )}
                      {trackClips.map((clip) => (
                        <ClipBlock
                          key={clip.id}
                          clip={clip}
                          isSelected={selectedSet.has(clip.id)}
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
                    {isMaestroRow && (
                      <NarrationLane
                        song={song}
                        zoomH={zoomH}
                        height={maestroLaneHeight}
                        visible={visible}
                        onEdit={(n) => setReadingNarrationId(n.id)}
                        onCreate={createNarration}
                        onEditCount={(group) => setCountTarget({ kind: 'edit', group })}
                        move={moveDrag}
                        onSelectClip={handleNarrationSelect}
                      />
                    )}
                    </div>
                  );
                })}

                {shownGrid && <GridLinesOverlay grid={shownGrid} zoomH={zoomH} visible={visible} />}

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
                      Início: {moveDrag.label}{moveDrag.ids.size > 1 ? ` (${moveDrag.ids.size} faixas)` : ''}{moveDrag.laneLabel ? ` · para ${moveDrag.laneLabel}` : ''}
                    </span>
                  </div>
                )}

                <Playhead zoomH={zoomH} songId={song.id} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Barra de Rodapé com Navegador de Scroll Horizontal (exclusivo para as faixas, da aresta direita das tracks em diante) */}
      <div className="flex items-center h-[20px] bg-logic-bg-deep border-t border-logic-border-dark text-2xs text-logic-text-muted select-none">
        {/* Espaço reservado exatamente para a largura das Tracks (aresta esquerda não tem scrollbar) */}
        <div
          className="flex items-center justify-between px-2 shrink-0 border-r border-logic-border-dark/60 h-full bg-logic-bg-deep"
          style={{ width: `${HEADER_W}px` }}
        >
          <span className="text-[10px] text-logic-text-muted truncate">
            {selectedClipIds.length > 0 ? `${selectedClipIds.length} sel.` : `${songClips.length} clips`}
          </span>
          <span className="text-[10px] font-mono text-logic-text-muted">
            {Math.round(zoomH)}px/s
          </span>
        </div>

        {/* Scrollbar Horizontal da Timeline, com alças de zoom nas pontas (a partir da aresta direita das faixas) */}
        <TimelineHorizontalScrollbar
          scrollRef={scrollRef}
          timelineWidth={timelineWidth}
          headerWidth={HEADER_W}
          zoomH={zoomH}
          onDoubleClickFit={handleFitSongToScreen}
          onZoomTo={zoomToAnchor}
        />
      </div>

      {/* Barra de Ferramentas da Grade e Progresso */}
      <div className="flex items-center justify-between gap-3 px-3 h-7 bg-[#121318] border-t border-logic-border-dark text-2xs text-logic-text-muted">
        <GridToolbar song={song} onSelectAll={selectAllSongClips} />
        <FooterProgress importProgress={importProgress} exportProgress={exportProgress} />
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

      {manualTempoPoint && song && (
        <ManualTempoPopover
          point={manualTempoPoint}
          onClose={() => setManualTempoPoint(null)}
          onApply={(bpm) => { setTempoAt(song.id, manualTempoPoint.time, bpm); setManualTempoPoint(null); }}
          onRemove={() => { removeTempoAt(song.id, manualTempoPoint.time); setManualTempoPoint(null); }}
        />
      )}

      {/* Editor da fala do Maestro por IA */}
      {song && countTarget && (
        <CountInDialog song={song} target={countTarget} onClose={() => setCountTarget(null)} />
      )}
      {song && readingNarrationId && (() => {
        const n = (song.narrations ?? []).find((x) => x.id === readingNarrationId);
        return n ? <NarrationDialog song={song} narration={n} onClose={() => setReadingNarrationId(null)} /> : null;
      })()}

    </div>
  );
}

// Último recurso manual: define/corrige o andamento (BPM) a partir de um ponto exato da régua,
// para medleys ou trocas de andamento que a detecção automática do click não conseguiu identificar.
function ManualTempoPopover({ point, onClose, onApply, onRemove }: {
  point: { time: number; x: number; y: number; existingBpm?: number; editing?: boolean };
  onClose: () => void;
  onApply: (bpm: number) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(String(Math.round((point.existingBpm ?? 120) * 10) / 10));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const submit = () => {
    const bpm = Number(value.replace(',', '.'));
    if (Number.isFinite(bpm) && bpm >= 30 && bpm <= 320) onApply(bpm);
  };

  return (
    <div
      ref={ref}
      className="fixed z-[200] bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl p-3 w-56"
      style={{ left: `${Math.min(point.x, window.innerWidth - 240)}px`, top: `${Math.min(point.y, window.innerHeight - 140)}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-2xs font-semibold text-logic-text-dim uppercase tracking-wider mb-2">
        {point.editing ? 'Editar mudança de andamento' : 'Cravar andamento neste ponto'}
      </div>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="flex-1 bg-logic-bg-deep border border-logic-border-light rounded px-2 h-8 text-sm font-mono text-logic-text outline-none focus:border-logic-accent"
          placeholder="BPM"
        />
        <span className="text-2xs text-logic-text-muted">BPM</span>
      </div>
      <p className="text-2xs text-logic-text-muted mt-2 leading-snug">
        {point.editing
          ? 'Digite o novo BPM a partir deste ponto, ou exclua a mudança (o trecho volta a seguir o andamento anterior).'
          : 'Último recurso: use só quando a sincronização automática não acertar este trecho (ex.: medley).'}
      </p>
      <div className="flex gap-2 mt-3">
        <button
          onClick={submit}
          className="flex-1 h-8 rounded-md bg-logic-accent text-white text-xs font-semibold hover:brightness-110 transition"
        >
          {point.editing ? 'Salvar' : 'Cravar aqui'}
        </button>
        <button
          onClick={onRemove}
          className="h-8 px-3 rounded-md border border-logic-border-light text-logic-text-dim text-xs font-semibold hover:text-logic-text hover:bg-logic-bg-elevated transition"
          title={point.editing ? 'Exclui esta mudança de andamento' : 'Remove a mudança de andamento manual mais próxima'}
        >
          {point.editing ? 'Excluir' : 'Remover'}
        </button>
      </div>
    </div>
  );
}
