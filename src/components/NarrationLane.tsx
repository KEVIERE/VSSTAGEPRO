import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, Mic, Sparkles } from 'lucide-react';
import { useStore } from '@/store';
import type { MaestroNarration, Song } from '@/types';
import {
  FAST_WPM, NARRATION_MIN_LENGTH, freeRunAt, narrationBounds, placeNarration, sortedNarrations, syncedToCursor, wpmForSpan,
} from '@/lib/narrations';
import {
  canGenerate, cursorTime, generateNarration, generatingSnapshot, hasVoiceEngine, isGenerating, moveNarration, narrationBuffer,
  narrationOverflows, narrationState, playPreview, removeCountGroup, scheduleGeneration, subscribeGenerating, voiceLabel,
} from '@/lib/maestroVoice';
import { snapTime, songGrid } from '@/lib/grid';
import { formatRegionTime } from '@/lib/regions';
import { seekToPosition } from '@/lib/transportControl';
import { audioEngine } from '@/lib/audioEngine';
import { masterAudioClip } from '@/lib/clipMastering';
import { MASTER_PROFILES } from '@/lib/mastering';
import { ClipWaveform } from '@/components/ClipWaveform';

/** Altura da régua do Maestro por IA (a coluna de nomes das faixas usa a mesma). */
export const NARRATION_LANE_HEIGHT = 30;

const DRAG_THRESHOLD_PX = 3;
const EDGE_PX = 6;
/** Tamanho de uma marcação criada com clique duplo (s): dá espaço para uma fala curta. */
const DEFAULT_SECONDS = 2;
type DragMode = 'move' | 'start' | 'end';

interface NarrationLaneProps {
  song: Song;
  zoomH: number;
  /** Altura da régua em px. Quem desenha passa a altura das faixas vezes o zoom, para a régua
   *  continuar alinhada com a coluna dos nomes. */
  height?: number;
  /** Janela (px) da linha do tempo que está na tela, para só desenhar o que aparece. */
  visible: { start: number; end: number };
  /** Abre o editor da fala. */
  onEdit: (narration: MaestroNarration) => void;
  /** Arrastar (ou clique duplo) numa área vazia cria uma marcação ali. */
  onCreate: (start: number, end: number) => void;
  /** Botão direito numa marcação da contagem → editar a contagem inteira. */
  onEditCount?: (group: string) => void;
  /** Arraste da seleção de clipes em andamento: as falas cujo áudio está nela andam junto. */
  move?: { ids: Set<string>; delta: number } | null;
}

/**
 * Régua das falas do Maestro por IA, logo abaixo da faixa Maestro. Cada marcação mostra o texto
 * e, depois de gerada, a forma de onda da voz.
 *
 * - Arrastar numa área vazia marca o trecho (clique duplo cria uma marcação de 2 s).
 * - Arrastar o meio leva a marcação para outro lugar (o áudio vai junto).
 * - Arrastar as bordas muda o tamanho, e o tamanho define a velocidade da fala:
 *   menor = mais rápido, maior = mais devagar. A voz é gerada de novo sozinha.
 * - Clique duplo abre o editor; botão direito tem "Sincar no beat do cursor". Alt desliga o ímã.
 */
export function NarrationLane({ song, zoomH, height = NARRATION_LANE_HEIGHT, visible, onEdit, onCreate, onEditCount, move }: NarrationLaneProps) {
  const updateNarration = useStore((s) => s.updateNarration);
  const snapStep = useStore((s) => s.snapStep);
  const clips = useStore((s) => s.clips);
  const selectedClipIds = useStore((s) => s.selectedClipIds);
  useSyncExternalStore(subscribeGenerating, generatingSnapshot);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; start: number; end: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  // Fala selecionada com um clique: Delete (ou Backspace) apaga ela e o áudio dela.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const removeNarration = useStore((s) => s.removeNarration);
  const laneRef = useRef<HTMLDivElement>(null);
  const narrations = sortedNarrations(song.narrations);
  const grid = songGrid(song);
  const snap = (t: number, free: boolean) => snapTime(t, grid, free ? 'off' : snapStep);

  useEffect(() => {
    if (!selectedId) return;
    // clicar fora da fala tira a seleção
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(`[data-narration-id="${selectedId}"]`)) return;
      setSelectedId(null);
    };
    // Delete ou Backspace apaga a fala selecionada (com o áudio dela; Cmd+Z traz de volta).
    // Roda antes dos outros atalhos para não apagar também os áudios selecionados.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const st = useStore.getState();
      if (st.timelineLocked) return;
      const n = song.narrations?.find((x) => x.id === selectedId);
      if (!n) return;
      e.preventDefault();
      e.stopPropagation();
      if (n.clipId) audioEngine.stopClipsLive([n.clipId]);
      removeNarration(song.id, n.id);
      audioEngine.invalidatePrepared(song.id);
      setSelectedId(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [selectedId, song.id, song.narrations, removeNarration]);

  // outra música aberta: nada fica selecionado
  useEffect(() => { setSelectedId(null); }, [song.id]);

  /** A posição (s) de um ponto da tela: a régua anda junto com a linha do tempo. */
  const timeAt = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect();
    const raw = rect ? (clientX - rect.left) / zoomH : 0;
    return Math.min(song.duration, Math.max(0, raw));
  };

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>, n: MaestroNarration) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setSelectedId(n.id);
    if (useStore.getState().selectedClipIds.length > 0) useStore.getState().selectClips([]);
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    // barra estreita demais para três zonas: o meio sempre move
    const edges = rect.width > EDGE_PX * 3;
    const mode: DragMode = edges && localX <= EDGE_PX ? 'start' : edges && localX >= rect.width - EDGE_PX ? 'end' : 'move';
    const startX = e.clientX;
    const { min, max } = narrationBounds(song, n.id);
    const length = n.end - n.start;
    let moved = false;
    let latest = { start: n.start, end: n.end };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const dt = dx / zoomH;
      if (mode === 'move') {
        // por cima de outra marcação, cai no espaço livre mais perto
        const placed = placeNarration(song, n.id, snap(n.start + dt, ev.altKey), length);
        if (placed !== null) latest = { start: placed, end: placed + length };
      } else if (mode === 'start') {
        const s = Math.min(Math.max(min, snap(n.start + dt, ev.altKey)), n.end - NARRATION_MIN_LENGTH);
        latest = { start: Math.max(min, s), end: n.end };
      } else {
        const en = Math.max(Math.min(max, snap(n.end + dt, ev.altKey)), n.start + NARRATION_MIN_LENGTH);
        latest = { start: n.start, end: Math.min(max, en) };
      }
      setDragging({ id: n.id, ...latest });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setDragging(null);
      if (!moved) {
        seekToPosition(song.id, n.start);
        return;
      }
      if (latest.start === n.start && latest.end === n.end) return;
      if (mode === 'move') {
        // o áudio vai junto, com o ataque da voz no início da marcação
        moveNarration(song.id, n.id, latest);
      } else {
        updateNarration(song.id, n.id, latest);
        // mudou o tamanho: a velocidade muda, então a voz é gerada de novo
        scheduleGeneration(song.id, n.id);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // Área vazia: arrastar marca o trecho; clique simples só leva o cursor (como no resto da timeline).
  const handleLanePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = laneRef.current;
    if (!el) return;
    const anchor = snap(timeAt(e.clientX), e.altKey);
    const free = freeRunAt(song, anchor);
    const startX = e.clientX;
    let moved = false;
    let latest: { start: number; end: number } | null = null;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      if (!free) return;
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      const t = Math.min(free.hi, Math.max(free.lo, snap(timeAt(ev.clientX), ev.altKey)));
      latest = { start: Math.min(anchor, t), end: Math.max(anchor, t) };
      setDraft(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setDraft(null);
      if (moved && latest && free) {
        const end = Math.min(free.hi, Math.max(latest.end, latest.start + NARRATION_MIN_LENGTH));
        if (end - latest.start >= NARRATION_MIN_LENGTH - 1e-6) onCreate(latest.start, end);
      } else {
        seekToPosition(song.id, timeAt(e.clientX));
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const handleLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-narration-id]')) return;
    const anchor = snap(timeAt(e.clientX), e.altKey);
    const free = freeRunAt(song, anchor);
    if (!free || free.hi - anchor < NARRATION_MIN_LENGTH) return;
    onCreate(anchor, Math.min(free.hi, anchor + DEFAULT_SECONDS));
  };

  const engine = hasVoiceEngine();
  const emptyHint = engine
    ? 'Maestro por IA: arraste aqui para marcar onde o maestro fala (ou clique duplo)'
    : 'Maestro por IA: marque aqui as falas (a voz é gerada no app do Mac)';

  return (
    <div
      ref={laneRef}
      data-narration-lane
      className="relative border-b border-logic-border-dark bg-[#10161d] cursor-crosshair select-none"
      style={{ height: `${height}px` }}
      onPointerDown={handleLanePointerDown}
      onDoubleClick={handleLaneDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      {narrations.length === 0 && !draft && (
        <div
          className="absolute top-0 h-full flex items-center gap-1.5 px-3 text-2xs text-logic-text-muted pointer-events-none whitespace-nowrap"
          style={{ left: `${Math.max(0, visible.start)}px` }}
        >
          <Sparkles size={10} className="text-sky-300/70" />
          <span>{emptyHint}</span>
        </div>
      )}
      {narrations.map((n) => {
        const isDragging = dragging?.id === n.id;
        // junto com a seleção (Cmd+A): aparece selecionada e anda no arraste dos clipes
        const inSelection = !!n.clipId && selectedClipIds.includes(n.clipId);
        const shift = n.clipId && move?.ids.has(n.clipId) ? move.delta : 0;
        const start = isDragging ? dragging!.start : n.start + shift;
        const end = isDragging ? dragging!.end : n.end + shift;
        // fora da tela: fica de fora do desenho
        if (start * zoomH > visible.end || end * zoomH < visible.start) return null;
        const width = Math.max(6, (end - start) * zoomH);
        const span = end - start;
        const wpm = wpmForSpan(n.text, span);
        const busy = isGenerating(n.id);
        const state = narrationState(n);
        const failed = n.status === 'error' || state === 'missing';
        const stale = state === 'stale' && !busy;
        const over = !isDragging ? narrationOverflows(n) : 0;
        const clip = n.clipId ? clips.find((c) => c.id === n.clipId) : undefined;
        const tip = [
          n.text || '(sem texto: clique duplo para escrever)',
          `${formatRegionTime(start)}–${formatRegionTime(end)} · ${span.toFixed(2)}s · ${wpm} palavras/min · voz ${voiceLabel(n.voice)}${n.voiceName ? ` (${n.voiceName})` : ''}`,
          wpm > FAST_WPM ? 'Rápido demais: pode ficar difícil de entender. Aumente a marcação.' : '',
          over > 0 ? `A fala passa ${over.toFixed(1)}s do fim da marcação: encurte o texto ou aumente a marcação.` : '',
          n.status === 'error' && n.error ? `Erro: ${n.error}` : '',
          busy ? 'Gerando a voz...'
            : state === 'missing' ? 'O áudio desta fala sumiu do projeto: clique duplo e gere de novo.'
              : stale ? (n.text ? 'Falta gerar a voz: clique duplo e "Gerar e ouvir".' : '')
                : 'Voz pronta.',
          'Clique para selecionar (Delete apaga). Arraste o meio para mudar de lugar; as bordas mudam a velocidade. Botão direito: sincar no beat do cursor.',
        ].filter(Boolean).join('\n');
        const tone = failed
          ? 'border-logic-lcd-red/70 bg-logic-lcd-red/20'
          : stale
            ? 'border-logic-lcd-amber/70 bg-logic-lcd-amber/15'
            : 'border-sky-400/70 bg-sky-500/20';
        return (
          <div
            key={n.id}
            data-narration-id={n.id}
            className={`absolute top-[3px] bottom-[3px] rounded-sm flex items-center select-none touch-none group overflow-hidden border hover:brightness-125 ${tone} ${
              isDragging ? 'cursor-grabbing z-20 shadow-lg' : 'cursor-grab z-10'
            } ${inSelection || selectedId === n.id ? 'ring-2 ring-white/80 brightness-125' : ''} ${clip?.mute ? 'opacity-45 saturate-0' : ''}`}
            style={{ left: `${start * zoomH}px`, width: `${width}px` }}
            onPointerDown={(e) => handleBarPointerDown(e, n)}
            onDoubleClick={(e) => { e.stopPropagation(); onEdit(n); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, id: n.id }); }}
            title={tip}
          >
            {clip && !isDragging && clip.waveformPeaks?.length > 0 && (
              // No lugar real do áudio (ele começa um pouco antes da marcação: o ataque cai na grade).
              // Mesmo desenho dos outros áudios: lê o áudio de verdade, masterizado quando foi, e
              // aplica o volume da fala. Antes a onda era esticada até o alto e nunca mudava.
              <div
                className="absolute top-0 bottom-0 pointer-events-none opacity-60"
                style={{ left: `${(clip.startTime + shift - (clip.trimStart ?? 0) - start) * zoomH}px`, width: `${Math.max(1, clip.duration * zoomH)}px` }}
              >
                <ClipWaveform
                  clip={clip}
                  left={(clip.startTime + shift - (clip.trimStart ?? 0)) * zoomH}
                  width={Math.max(1, clip.duration * zoomH)}
                  height={Math.max(4, height - 8)}
                  visible={visible}
                  color={clip.mute ? '#8a8f98' : '#bae6fd'}
                />
              </div>
            )}
            <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize group-hover:bg-white/25" />
            <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize group-hover:bg-white/25" />
            <div className="relative flex items-center gap-1 pl-2 pr-1.5 flex-1 min-w-0 text-2xs font-medium text-white/95 pointer-events-none">
              {busy ? <Loader2 size={10} className="animate-spin shrink-0 text-sky-200" />
                : failed ? <AlertTriangle size={10} className="shrink-0 text-logic-lcd-red" />
                  : <Mic size={10} className={`shrink-0 ${stale ? 'text-logic-lcd-amber' : 'text-sky-200'}`} />}
              {n.master && !isDragging && (
                <span className="shrink-0 text-amber-300 text-[10px] leading-none" title="Áudio masterizado com IA">✨</span>
              )}
              <span className="truncate drop-shadow">
                {isDragging
                  ? `${formatRegionTime(start)} · ${span.toFixed(1)}s · ${wpm} p/m`
                  : n.text || <span className="italic opacity-70">Escreva a fala…</span>}
              </span>
              {over > 0 && <span className="shrink-0 text-logic-lcd-amber text-[9px] font-mono">+{over.toFixed(1)}s</span>}
            </div>
          </div>
        );
      })}
      {draft && (
        <div
          className="absolute top-[3px] bottom-[3px] rounded-sm border border-dashed border-sky-300 bg-sky-400/20 pointer-events-none flex items-center px-1.5 text-[9px] font-mono text-sky-100 whitespace-nowrap overflow-hidden"
          style={{ left: `${draft.start * zoomH}px`, width: `${Math.max(2, (draft.end - draft.start) * zoomH)}px` }}
        >
          {(draft.end - draft.start).toFixed(1)}s
        </div>
      )}
      {menu && (() => {
        const n = narrations.find((x) => x.id === menu.id);
        return n ? (
          <NarrationMenu
            song={song}
            narration={n}
            x={menu.x}
            y={menu.y}
            onEdit={() => onEdit(n)}
            onEditCount={n.countGroup && onEditCount ? () => onEditCount(n.countGroup!) : undefined}
            onClose={() => setMenu(null)}
          />
        ) : null;
      })()}
    </div>
  );
}

/** Menu do botão direito numa marcação. */
function NarrationMenu({ song, narration, x, y, onEdit, onEditCount, onClose }: {
  song: Song; narration: MaestroNarration; x: number; y: number; onEdit: () => void; onEditCount?: () => void; onClose: () => void;
}) {
  const removeNarration = useStore((s) => s.removeNarration);
  const updateNarration = useStore((s) => s.updateNarration);
  const normalizeClip = useStore((s) => s.normalizeClip);
  const setClipGain = useStore((s) => s.setClipGain);
  const toggleClipMute = useStore((s) => s.toggleClipMute);
  const dawMode = useStore((s) => s.dawMode);
  const clip = useStore((s) => (narration.clipId ? s.clips.find((c) => c.id === narration.clipId) : undefined));
  const [masterOpen, setMasterOpen] = useState(false);
  const [normalizeOpen, setNormalizeOpen] = useState(false);
  const [normalizeDb, setNormalizeDb] = useState('-2');
  const ref = useRef<HTMLDivElement>(null);
  const cursor = cursorTime(song.id);
  const engine = canGenerate(narration.voice);
  const state = narrationState(narration);
  // as mesmas ferramentas dos outros áudios só valem com a voz já gerada
  const audioReady = !!clip && state !== 'missing';
  const gainDb = clip ? 20 * Math.log10(Math.max(1e-4, clip.gain ?? 1)) : 0;
  const masterOptions: Array<{ id: NonNullable<MaestroNarration['master']>; label: string; hint: string }> = [
    { id: 'manter', label: 'Manter o volume', hint: 'voz · recomendado' },
    { id: 'equilibrado', label: MASTER_PROFILES.equilibrado.label, hint: '-10 LUFS' },
    { id: 'show', label: MASTER_PROFILES.show.label, hint: '-8 LUFS · mais alto' },
    { id: 'streaming', label: MASTER_PROFILES.streaming.label, hint: '-14 LUFS · plataformas' },
  ];
  // A escolha fica guardada na fala: a voz gerada de novo é masterizada do mesmo jeito.
  const master = (choice: NonNullable<MaestroNarration['master']>) => {
    if (!clip) return;
    onClose();
    updateNarration(song.id, narration.id, { master: choice });
    void masterAudioClip(clip.id, choice);
  };
  const keyCls = 'console-key w-5 h-[18px] text-[11px] leading-none flex items-center justify-center';

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const item = 'w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none';
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[300] min-w-52 py-1 bg-logic-bg-panel border border-logic-border-light shadow-2xl rounded text-xs text-logic-text"
      style={{ left: Math.min(x, window.innerWidth - 230), top: Math.max(8, Math.min(y, window.innerHeight - (audioReady ? (dawMode ? 420 : 300) : 200))) }}
      onContextMenu={(e) => e.preventDefault()}
      // o menu fica fora da régua na tela, mas os eventos do React sobem até ela: sem isto o
      // clique num item viraria "criar marcação" / "mover o cursor" na régua
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className={item} onClick={() => { onClose(); onEdit(); }}>
        <span>Editar fala…</span>
      </button>
      {onEditCount && (
        <button className={item} onClick={() => { onClose(); onEditCount(); }} title="Voz e velocidade da contagem inteira">
          <span>Editar contagem…</span>
        </button>
      )}
      <button
        className={item}
        disabled={cursor == null}
        onClick={() => {
          onClose();
          if (cursor == null) return;
          const placed = syncedToCursor(song, narration.id, cursor);
          if (placed) moveNarration(song.id, narration.id, placed);
        }}
        title="Leva o início da marcação para o começo do beat em que o cursor está"
      >
        <span>Sincar no beat do cursor</span>
        {cursor != null && <span className="text-[10px] opacity-60 font-mono">{formatRegionTime(cursor)}</span>}
      </button>
      <button
        className={item}
        disabled={state !== 'fresh'}
        onClick={() => {
          onClose();
          void narrationBuffer(narration).then((b) => { if (b) playPreview(b); });
        }}
      >
        <span>Ouvir a fala</span>
      </button>
      <button
        className={item}
        disabled={!engine || !narration.text.trim()}
        onClick={() => { onClose(); void generateNarration(song.id, narration.id).catch(() => {}); }}
      >
        <span>Gerar a voz de novo</span>
      </button>
      {audioReady && clip && (
        <>
          <div className="h-px bg-logic-border-dark my-1" />
          <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-logic-text-muted">Áudio da fala</div>
          <div className="relative" onMouseEnter={() => setMasterOpen(true)} onMouseLeave={() => setMasterOpen(false)}>
            <button
              className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-amber-400 hover:bg-amber-500 hover:text-black font-semibold transition-colors duration-75"
              title="A IA ouve a voz e escolhe EQ, compressão e limitador. Fica guardado: gerando a voz de novo, ela é masterizada igual."
              onClick={() => master(narration.master ?? 'manter')}
            >
              <span>✨ Masterizar com IA</span>
              <span className="text-[10px] opacity-75 font-normal">
                {narration.master ? masterOptions.find((o) => o.id === narration.master)?.label : <>&rarr;</>}
              </span>
            </button>
            {masterOpen && (
              <div className="absolute left-full top-0 min-w-56 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded">
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-logic-text-muted">Volume da master</div>
                {masterOptions.map((o) => (
                  <button
                    key={o.id}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-amber-500 hover:text-black transition-colors duration-75 ${narration.master === o.id ? 'text-amber-300' : ''}`}
                    onClick={() => master(o.id)}
                  >
                    <span className="font-semibold">{o.label}</span>
                    <span className="text-[10px] opacity-75 tabular-nums">{o.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {narration.master && (
            <button
              className={item}
              disabled={!engine || !narration.text.trim()}
              title="Gera a voz de novo, sem masterização"
              onClick={() => {
                onClose();
                updateNarration(song.id, narration.id, { master: undefined });
                void generateNarration(song.id, narration.id).catch(() => {});
              }}
            >
              <span>Tirar a masterização</span>
            </button>
          )}
          {dawMode && (
            <>
              {normalizeOpen ? (
                <form
                  className="px-3 py-1.5 flex items-center gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const db = parseFloat(normalizeDb.replace(',', '.'));
                    if (Number.isFinite(db)) normalizeClip(clip.id, Math.min(0, db));
                    onClose();
                  }}
                >
                  <span className="text-logic-text-dim whitespace-nowrap">Pico em</span>
                  <input
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={normalizeDb}
                    onChange={(e) => setNormalizeDb(e.target.value)}
                    className="w-14 bg-logic-bg-deep border border-logic-border-light rounded px-1.5 py-0.5 text-right outline-none focus:border-logic-accent"
                  />
                  <span className="text-logic-text-dim">dB</span>
                  <button type="submit" className="ml-1 px-2 py-0.5 rounded bg-logic-accent text-white hover:brightness-110 transition">OK</button>
                </form>
              ) : (
                <button className={item} onClick={() => setNormalizeOpen(true)}>
                  <span>Normalizar…</span>
                </button>
              )}
              {/* Volume da fala, de 1 em 1 dB (o mesmo ganho do botão giratório dos outros áudios) */}
              <div className="flex items-center justify-between gap-3 px-3 py-1">
                <span>Volume</span>
                <div className="flex items-center gap-1">
                  <button className={keyCls} onClick={() => setClipGain(clip.id, Math.pow(10, (gainDb - 1) / 20))} title="Baixar 1 dB">−</button>
                  <button
                    className="console-readout console-glow text-logic-lcd-green min-w-[46px]"
                    onClick={() => setClipGain(clip.id, 1)}
                    title="Clique: volta para 0 dB"
                  >
                    {`${gainDb > 0.05 ? '+' : ''}${gainDb.toFixed(1)} dB`}
                  </button>
                  <button className={keyCls} onClick={() => setClipGain(clip.id, Math.pow(10, (gainDb + 1) / 20))} title="Subir 1 dB">+</button>
                </div>
              </div>
              <button className={item} onClick={() => { onClose(); toggleClipMute(clip.id); }}>
                <span>{clip.mute ? 'Voltar o som da fala' : 'Silenciar a fala'}</span>
                {clip.mute && <span className="text-[10px] text-logic-lcd-amber">muda</span>}
              </button>
            </>
          )}
        </>
      )}
      <div className="h-px bg-logic-border-dark my-1" />
      <button className={`${item} text-logic-lcd-red`} onClick={() => { onClose(); removeNarration(song.id, narration.id); }}>
        <span>Apagar marcação</span>
      </button>
      {narration.countGroup && (
        <button className={`${item} text-logic-lcd-red`} onClick={() => { onClose(); removeCountGroup(song.id, narration.countGroup!); }}>
          <span>Apagar contagem inteira</span>
        </button>
      )}
    </div>,
    document.body,
  );
}
