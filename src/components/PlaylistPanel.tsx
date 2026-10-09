import { useState, useRef, useEffect } from 'react';
import { useStore, BLOCK_COLORS } from '@/store';
import {
  ListMusic, Plus, Music2, Flag, ArrowUp,
  FlagTriangleRight, Link, Maximize2, Minimize2, SlidersHorizontal, Loader2, AlertTriangle, FolderDown, Gauge, AudioWaveform,
  ChevronRight, ChevronsDownUp, ChevronsUpDown, CheckCircle2,
} from 'lucide-react';
import { formatTime, toneLabel, bpmLabel } from '@/components/ShowRundown';
import { SongAdjuster } from '@/components/AdjustmentsTower';
import ImportVSDialog from '@/components/ImportVSDialog';
import { SectionPads } from '@/components/SectionPads';
import { MedleySlices } from '@/components/MedleySlices';
import { isMedley, playedDuration } from '@/lib/medley';
import { useCollapsedRows } from '@/lib/useCollapsedRows';
import { groupDroppedEntries, importSongGroups, takeDroppedEntries } from '@/lib/importManager';

const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
const NARROW_TOWER_W = 104;

export default function PlaylistPanel() {
  const playlist = useStore((s) => s.playlist);
  const playlistOrder = useStore((s) => s.playlistOrder);
  const blocks = useStore((s) => s.blocks);
  const selectedSongId = useStore((s) => s.selectedSongId);
  const selectedBlockId = useStore((s) => s.selectedBlockId);
  const currentSongIdSel = useStore((s) => s.transport.currentSongId);
  const nextSongIdSel = useStore((s) => s.transport.nextSongId);
  const playFlow = useStore((s) => s.transport.playFlow);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const transport = { currentSongId: currentSongIdSel, nextSongId: nextSongIdSel, playFlow, isPlaying };
  const songs = useStore((s) => s.songs);
  const { collapsed: collapsedRows, toggle: toggleRow, setAll: setAllRows } = useCollapsedRows(isPlaying ? currentSongIdSel : null);
  const playlistVisible = useStore((s) => s.playlistVisible);
  const showBpmTower = useStore((s) => s.showBpmTower);
  const showTunerTower = useStore((s) => s.showTunerTower);

  const selectSong = useStore((s) => s.selectSong);
  const reorderPlaylist = useStore((s) => s.reorderPlaylist);
  const createBlock = useStore((s) => s.createBlock);
  const setNextSong = useStore((s) => s.setNextSong);
  const mixerVisible = useStore((s) => s.mixerVisible);
  const incompleteSongIds = useStore((s) => s.incompleteSongIds);
  const instantPrep = useStore((s) => s.instantPrep);
  const toggleMixer = useStore((s) => s.toggleMixer);
  const renameBlock = useStore((s) => s.renameBlock);
  const setBlockColor = useStore((s) => s.setBlockColor);
  const deleteBlock = useStore((s) => s.deleteBlock);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [dropPos, setDropPos] = useState<{ type: 'top' | 'song' | 'block' | 'blockInsert'; id: string | null; half: 'before' | 'after' } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingBlockId, setRenamingBlockId] = useState<string | null>(null);
  const [renameBlockValue, setRenameBlockValue] = useState('');
  const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; blockId: string } | null>(null);
  const [colorPickerBlock, setColorPickerBlock] = useState<string | null>(null);
  const blockMenuRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [fileDragOver, setFileDragOver] = useState(false);
  const fileDragDepth = useRef(0);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (blockMenuRef.current && !blockMenuRef.current.contains(e.target as Node)) setBlockMenu(null);
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) setColorPickerBlock(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const fileDragHandlers = {
    onDragEnterCapture: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      fileDragDepth.current++;
      setFileDragOver(true);
    },
    onDragLeaveCapture: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
      if (fileDragDepth.current === 0) setFileDragOver(false);
    },
    onDragOverCapture: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    // captura antes das linhas da lista, que tratam só o reordenar músicas
    onDropCapture: (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      fileDragDepth.current = 0;
      setFileDragOver(false);
      const entries = takeDroppedEntries(e.dataTransfer);
      void groupDroppedEntries(entries).then(importSongGroups);
    },
  };

  const handleDrop = (index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      reorderPlaylist(dragIndex, index);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // resolve a ação de soltar a partir da posição marcada durante o drag
  const resolveDrop = () => {
    if (!dropPos) return;
    if (dragIndex !== null) {
      const dragEntry = playlist[dragIndex];
      const without = playlist.filter((_, i) => i !== dragIndex);
      let insertIdx: number;

      if (dropPos.type === 'top') {
        insertIdx = 0;
      } else if (dropPos.type === 'song') {
        const tIdx = playlist.findIndex((p) => p.songId === dropPos.id);
        if (tIdx === -1) { clearDrag(); return; }
        const origPos = dropPos.half === 'before' ? tIdx : tIdx + 1;
        insertIdx = origPos > dragIndex ? origPos - 1 : origPos;
      } else if (dropPos.type === 'block') {
        // soltou sobre o cabeçalho de um bloco: vira a 1ª música do bloco
        const block = blocks.find((b) => b.id === dropPos.id);
        if (block) {
          const firstInBlock = playlist.find((p) => p.blockId === block.id);
          useStore.getState().moveSongTo(dragEntry.songId, firstInBlock?.songId ?? null, block.id);
        }
        clearDrag();
        return;
      } else {
        clearDrag();
        return;
      }

      if (insertIdx < 0) insertIdx = 0;
      if (insertIdx > without.length) insertIdx = without.length;
      const beforeSongId = without[insertIdx]?.songId ?? null;
      if (beforeSongId !== dragEntry.songId) {
        // a música herda o bloco da música que fica logo acima dela
        const prev = insertIdx > 0 ? without[insertIdx - 1] : null;
        useStore.getState().moveSongTo(dragEntry.songId, beforeSongId, prev?.blockId ?? null);
      }
    } else if (dragBlockId) {
      let beforeSongId: string | null = null;
      if (dropPos.type === 'top') {
        beforeSongId = playlist[0]?.songId ?? null;
      } else if (dropPos.type === 'blockInsert' || dropPos.type === 'song') {
        const tIdx = playlist.findIndex((p) => p.songId === dropPos.id);
        if (tIdx === -1) { clearDrag(); return; }
        beforeSongId = dropPos.half === 'before' ? dropPos.id : (playlist[tIdx + 1]?.songId ?? null);
      } else if (dropPos.type === 'block') {
        // soltou sobre o cabeçalho de outro bloco: posiciona antes da 1ª música dele
        if (dragBlockId !== dropPos.id) {
          beforeSongId = playlist.find((p) => p.blockId === dropPos.id)?.songId ?? null;
        } else { clearDrag(); return; }
      }
      useStore.getState().moveBlockTo(dragBlockId, beforeSongId);
    }
    clearDrag();
  };

  const clearDrag = () => { setDropPos(null); setDragIndex(null); setDragBlockId(null); setDragOverBlockId(null); setDragOverIndex(null); };

  const DropLine = ({ active }: { active: boolean }) => (
    <div className={`h-0.5 -my-px transition-colors ${active ? 'bg-logic-accent' : 'bg-transparent'}`} />
  );

  const handleDoubleClick = (entry: typeof playlist[0]) => {
    setRenamingId(entry.songId);
    setRenameValue(entry.name);
  };

  const handleRenameSubmit = () => {
    if (renamingId && renameValue.trim()) {
      useStore.getState().renameSong(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const currentSongId = transport.currentSongId;
  const nextSongId = transport.nextSongId;

  const playlistMaximized = useStore((s) => s.playlistMaximized);
  const togglePlaylistMaximized = useStore((s) => s.togglePlaylistMaximized);

  if (!playlistVisible && !playlistMaximized) return null;

  // a duração do bloco é a soma das músicas entre o cabeçalho dele e o próximo bloco
  const getBlockDuration = (blockId: string): number => {
    let active: string | null = null;
    const totals: Record<string, number> = {};
    for (const p of playlist) {
      if (p.blockId) active = p.blockId;
      if (!active) continue;
      const song = songs.find((sg) => sg.id === p.songId);
      totals[active] = (totals[active] ?? 0) + (song?.duration ?? p.duration);
    }
    return totals[blockId] ?? 0;
  };

  const starts: number[] = [];
  playlist.reduce((acc, p) => {
    starts.push(acc);
    return acc + playedDuration(songs.find((sg) => sg.id === p.songId), p.duration);
  }, 0);
  const currentIndex = currentSongId && transport.isPlaying ? playlist.findIndex((p) => p.songId === currentSongId) : -1;
  const wide = playlistMaximized;
  const wideCols = `48px minmax(0,1fr) 72px 80px 72px 72px${showBpmTower ? ' 112px' : ''}${showTunerTower ? ' 112px' : ''}`;
  const towerCount = (showBpmTower ? 1 : 0) + (showTunerTower ? 1 : 0);
  const narrowWidth = 360 + towerCount * NARROW_TOWER_W;
  const hasDetails = (sg: typeof songs[number] | undefined) => !!sg && (isMedley(sg) || (sg.regions?.length ?? 0) > 0);
  const expandableIds = playlist.filter((p) => hasDetails(songs.find((sg) => sg.id === p.songId))).map((p) => p.songId);
  const allCollapsed = expandableIds.length > 0 && expandableIds.every((id) => collapsedRows.has(id));

  return (
    <div
      {...fileDragHandlers}
      className={`relative flex flex-col h-full bg-logic-bg-panel border-r border-logic-border-dark transition-[width] duration-200 ${playlistMaximized ? 'w-full' : 'flex-shrink-0'}`}
      style={playlistMaximized ? undefined : { width: narrowWidth }}
    >
      {fileDragOver && (
        <div className="pointer-events-none absolute inset-2 z-40 flex flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-logic-accent bg-logic-bg-deep/90 text-logic-text">
          <FolderDown size={28} className="text-logic-accent animate-bounce" />
          <span className="text-sm font-medium">Solte para importar</span>
          <span className="text-2xs text-logic-text-dim px-4 text-center">Cada pasta vira uma música no repertório</span>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center px-3 h-10 bg-logic-bg-deep border-b border-logic-border-dark relative">
        <div className="flex items-center min-w-0">
          <ListMusic size={13} className="text-logic-text-dim mr-2 flex-shrink-0" />
          <span className="text-xs font-medium text-logic-text-dim uppercase tracking-wider whitespace-nowrap flex-shrink-0">Playlist do Show</span>
        </div>
        <div className="flex items-center gap-1 ml-auto pl-2 flex-shrink-0">
          <button
            className={`transition-colors ${selectedSongId ? 'text-logic-text-muted hover:text-logic-text' : 'text-logic-text-muted/30 cursor-not-allowed'}`}
            onClick={() => { if (selectedSongId) createBlock(selectedSongId); }}
            disabled={!selectedSongId}
            title={selectedSongId ? 'Criar Bloco a partir da música selecionada' : 'Selecione uma música para criar um bloco'}
          >
            <Flag size={14} />
          </button>
          {playlistMaximized && expandableIds.length > 0 && (
            <button
              className="text-logic-text-muted hover:text-logic-text transition-colors"
              onClick={() => setAllRows(expandableIds, !allCollapsed)}
              title={allCollapsed ? 'Expandir todas as músicas' : 'Recolher todas as músicas'}
            >
              {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            </button>
          )}
          {playlistMaximized && (
            <button
              className={`transition-colors ${mixerVisible ? 'text-logic-accent' : 'text-logic-text-muted hover:text-logic-text'}`}
              onClick={toggleMixer}
              title={mixerVisible ? 'Fechar Mixer (M)' : 'Abrir Mixer (M)'}
              aria-pressed={mixerVisible}
            >
              <SlidersHorizontal size={14} />
            </button>
          )}
          <button
            className="text-logic-text-muted hover:text-logic-text transition-colors"
            onClick={() => setImportOpen(true)}
            title="Importar VS"
          >
            <Plus size={14} />
          </button>
          <button
            className={`transition-colors ${nextSongId ? 'text-logic-lcd-amber' : 'text-logic-text-muted hover:text-logic-text'}`}
            onClick={() => {
              if (transport.playFlow === 'uma-uma') return;
              setNextSong(selectedSongId && selectedSongId !== nextSongId ? selectedSongId : null);
            }}
            title={transport.playFlow === 'uma-uma' ? 'Fluxo Uma a Uma: sem próxima engatilhada' : selectedSongId === nextSongId ? 'Remover Próxima' : 'Definir Selecionada como Próxima'}
          >
            <Link size={14} />
          </button>
          <button
            className="text-logic-text-muted hover:text-logic-text transition-colors"
            onClick={togglePlaylistMaximized}
            title={playlistMaximized ? 'Sair do modo show (Esc)' : 'Modo show: playlist em tela cheia'}
          >
            {playlistMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <ImportVSDialog open={importOpen} onClose={() => setImportOpen(false)} />
        </div>
      </div>

      {instantPrep?.ready && (
        <div
          className="flex items-center gap-2 px-3 h-6 bg-logic-bg-deep border-b border-logic-border-dark text-2xs whitespace-nowrap overflow-hidden animate-[fadeIn_200ms_ease-out]"
          title={instantPrep.failed ? 'Essas músicas tocam normalmente, só levam um instante a mais para começar' : 'Todas as músicas começam na hora'}
        >
          <CheckCircle2 size={11} className="flex-shrink-0 text-logic-lcd-green" />
          <span className="flex-shrink-0 text-logic-lcd-green">Pronto para o show</span>
          {!!instantPrep.failed && (
            <span className="min-w-0 truncate text-logic-lcd-amber">
              {instantPrep.failed === 1 ? '1 música abre no Play' : `${instantPrep.failed} músicas abrem no Play`}
            </span>
          )}
        </div>
      )}

      {instantPrep && !instantPrep.ready && (
        <div
          className="relative flex items-center gap-2 px-3 h-6 bg-logic-bg-deep border-b border-logic-border-dark text-2xs text-logic-text-muted whitespace-nowrap overflow-hidden animate-[fadeIn_200ms_ease-out]"
          title="Deixando o começo de cada música pronto para o Play sair na hora"
        >
          <Loader2 size={10} className="animate-spin flex-shrink-0" />
          <span className="flex-shrink-0">Preparando o show</span>
          {instantPrep.name && <span className="min-w-0 truncate text-logic-text-dim">{instantPrep.name}</span>}
          <span className="ml-auto pl-2 flex-shrink-0 font-mono tabular-nums text-logic-text-dim">
            {instantPrep.done} de {instantPrep.total} prontas
          </span>
          <span
            className="absolute left-0 bottom-0 h-px bg-logic-lcd-green/60 transition-[width] duration-300"
            style={{ width: `${(instantPrep.done / Math.max(1, instantPrep.total)) * 100}%` }}
          />
        </div>
      )}

      {wide && playlist.length > 0 && (
        <div className="grid items-center gap-3 px-6 h-8 bg-logic-bg-deep border-b border-logic-border-dark text-2xs font-medium uppercase tracking-[0.12em] text-logic-text-muted" style={{ gridTemplateColumns: wideCols }}>
          <span>#</span><span>Música</span><span className="text-right">BPM</span><span className="text-right">Tom</span><span className="text-right">Duração</span><span className="text-right">Entra em</span>
          {showBpmTower && <span className="text-center text-logic-lcd-amber/80">Ajuste BPM</span>}
          {showTunerTower && <span className="text-center text-logic-lcd-amber/80">Tuner</span>}
        </div>
      )}

      {!wide && towerCount > 0 && playlist.length > 0 && (
        <div className="flex items-center gap-2 px-2 h-7 bg-logic-bg-deep border-b border-logic-border-dark text-2xs font-medium uppercase tracking-wider text-logic-text-muted">
          <span className="flex-1">Música</span>
          {showBpmTower && <span className="flex items-center justify-center gap-1 text-logic-lcd-amber/80" style={{ width: NARROW_TOWER_W - 8 }}><Gauge size={11} /> BPM</span>}
          {showTunerTower && <span className="flex items-center justify-center gap-1 text-logic-lcd-amber/80" style={{ width: NARROW_TOWER_W - 8 }}><AudioWaveform size={11} /> Tuner</span>}
        </div>
      )}

      {/* List */}
      <div
        className="flex-1 overflow-y-auto logic-scroll"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            selectSong(null);
            useStore.getState().selectBlock(null);
          }
        }}
      >
        {playlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-logic-text-muted text-xs gap-2 px-4">
            <Music2 size={24} className="opacity-30" />
            <span className="text-center">Nenhuma música na playlist</span>
            <span className="text-2xs text-center opacity-60">Clique em + para importar VS ou arraste pastas para cá</span>
          </div>
        ) : (
          <div onDragOver={(e) => { if (dragIndex !== null || dragBlockId) e.preventDefault(); }}>

            {/* zona de soltar no topo: acima de qualquer bloco */}
            <div
              onDragOver={(e) => {
                if (dragIndex === null && !dragBlockId) return;
                e.preventDefault();
                setDropPos({ type: 'top', id: null, half: 'before' });
              }}
              onDrop={(e) => { e.preventDefault(); resolveDrop(); }}
              onDragEnd={clearDrag}
              className={dropPos?.type === 'top' ? 'h-2' : 'h-0'}
            >
              <DropLine active={dropPos?.type === 'top'} />
            </div>

            {playlist.map((entry, index) => {
              const isCurrent = entry.songId === currentSongId && transport.isPlaying;
              const isNext = entry.songId === nextSongId;
              const isSelected = selectedSongId === entry.songId;
              const block = entry.blockId ? blocks.find((b) => b.id === entry.blockId) : null;
              const song = songs.find((sg) => sg.id === entry.songId);
              const prevEntry = index > 0 ? playlist[index - 1] : null;
              const showBlock = block && (!prevEntry || prevEntry.blockId !== block.id);
              const isPlayed = currentIndex >= 0 && index < currentIndex;
              const canExpand = hasDetails(song);
              const expanded = canExpand && !collapsedRows.has(entry.songId);
              const audioStatus = incompleteSongIds.includes(entry.songId) ? (
                <span title="Faltou memória para abrir todos os áudios desta música. Ela não será tocada pela metade." className="inline-flex flex-shrink-0 text-logic-lcd-red">
                  <AlertTriangle size={wide ? 14 : 11} />
                </span>
              ) : null;

              return (
                <div key={entry.songId}>
                  {showBlock && block && (
                    <div
                      data-selectable="block"
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDragBlockId(block.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', block.id);
                      }}
                      onDragOver={(e) => {
                        if (!dragBlockId) return;
                        e.preventDefault();
                        e.stopPropagation();
                        setDropPos({ type: 'block', id: block.id, half: 'before' });
                      }}
                      onDrop={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        resolveDrop();
                      }}
                      onDragEnd={clearDrag}
                      className={`relative flex items-center gap-1.5 border-b ${wide ? 'px-6 h-9 mt-2' : 'px-2 h-7'} border-logic-border-dark ${dragOverBlockId === block.id && dragBlockId !== block.id ? 'ring-1 ring-logic-accent' : ''} ${dropPos?.type === 'block' && dropPos.id === block.id && dragIndex !== null ? 'ring-1 ring-logic-accent' : ''}`}
                      style={{ backgroundColor: block.color, borderLeft: `4px solid ${blockEdge(block.color)}` }}
                      onClick={() => useStore.getState().selectBlock(block.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setRenamingBlockId(block.id);
                        setRenameBlockValue(block.name);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setBlockMenu({ x: e.clientX, y: e.clientY, blockId: block.id });
                      }}
                    >
                      <div className={`flex-1 min-w-0 flex items-center gap-1.5 justify-center ${wide ? 'px-16' : ''}`}>
                        <FlagTriangleRight size={10} className="flex-shrink-0" style={{ color: blockInk(block.color) }} />
                        {renamingBlockId === block.id ? (
                          <input
                            autoFocus
                            value={renameBlockValue}
                            onChange={(e) => setRenameBlockValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={() => {
                              const n = renameBlockValue.trim();
                              if (n) renameBlock(block.id, n);
                              setRenamingBlockId(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const n = renameBlockValue.trim();
                                if (n) renameBlock(block.id, n);
                                setRenamingBlockId(null);
                              } else if (e.key === 'Escape') {
                                setRenamingBlockId(null);
                              }
                            }}
                            className="flex-1 min-w-0 bg-logic-bg-deep text-xs text-white px-1 py-0.5 rounded border border-logic-accent outline-none text-center"
                          />
                        ) : (
                          <span className={`font-bold truncate ${wide ? 'text-xs uppercase tracking-[0.14em]' : 'text-xs'}`} style={{ color: blockInk(block.color) }}>
                            {block.name}
                          </span>
                        )}
                      </div>
                      <span className={`text-2xs font-mono opacity-60 flex-shrink-0 ${wide ? 'absolute right-6 top-1/2 -translate-y-1/2' : ''}`} style={{ color: blockInk(block.color) }}>
                        {formatTime(getBlockDuration(block.id))}
                      </span>
                    </div>
                  )}

                  {/* Song row */}
                  <div
                    data-selectable="song"
                    data-song-id={entry.songId}
                    draggable
                    onDragStart={(e) => {
                      if (dragBlockId) { e.preventDefault(); return; }
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', entry.songId);
                      setDragIndex(index);
                    }}
                    onDragOver={(e) => {
                      if (dragIndex !== null) {
                        if (dragIndex === index) return;
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const half = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                        setDragOverIndex(index);
                        setDropPos({ type: 'song', id: entry.songId, half });
                      } else if (dragBlockId) {
                        // arrastando um bloco: permite soltá-lo entre as músicas
                        e.preventDefault();
                        const rect = e.currentTarget.getBoundingClientRect();
                        const half = e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                        setDropPos({ type: 'blockInsert', id: entry.songId, half });
                      }
                    }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); resolveDrop(); }}
                    onDragEnd={clearDrag}
                    onClick={() => selectSong(entry.songId)}
                    onDoubleClick={() => handleDoubleClick(entry)}
                    className={`group flex flex-col border-b border-logic-border-dark cursor-pointer transition-colors duration-75 relative
                      ${isCurrent ? 'bg-[#1a3a1a]' : isNext ? 'bg-[#3a2a0a]' : isSelected ? 'bg-white/[0.08]' : 'hover:bg-logic-bg-panel-light'}
                      ${isPlayed && !isSelected ? 'opacity-45 hover:opacity-80' : ''}
                      ${dropPos?.type === 'song' && dropPos.id === entry.songId ? (dropPos.half === 'before' ? 'border-t-2 border-t-logic-accent' : 'border-b-2 border-b-logic-accent') : ''}
                      ${dropPos?.type === 'blockInsert' && dropPos.id === entry.songId ? (dropPos.half === 'before' ? 'border-t-2 border-t-logic-lcd-amber' : 'border-b-2 border-b-logic-lcd-amber') : ''}`}
                  >
                    {wide && renamingId !== entry.songId ? (
                      <div className="grid items-center gap-3 px-6 h-14 tabular-nums" style={{ gridTemplateColumns: wideCols }}>
                        <span className="flex items-center gap-1">
                          <span className={`text-xs font-medium ${isCurrent ? 'text-logic-lcd-green' : 'text-logic-text-muted'}`}>{String(index + 1).padStart(2, '0')}</span>
                          {canExpand && (
                            <button
                              className="w-5 h-5 rounded flex items-center justify-center text-logic-text-muted hover:text-logic-text hover:bg-white/10 transition-colors"
                              onClick={(e) => { e.stopPropagation(); toggleRow(entry.songId); }}
                              onDoubleClick={(e) => e.stopPropagation()}
                              aria-expanded={expanded}
                              title={expanded ? 'Recolher' : 'Expandir'}
                            >
                              <ChevronRight size={14} className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
                            </button>
                          )}
                        </span>
                        <span className={`text-lg font-semibold truncate ${isCurrent ? 'text-logic-lcd-green' : isNext ? 'text-logic-lcd-amber' : isSelected ? 'text-white' : 'text-logic-text'}`}>
                          {entry.name}
                          {audioStatus && <span className="ml-2 align-middle">{audioStatus}</span>}
                          {isCurrent && <span className="ml-3 text-2xs font-medium uppercase tracking-[0.14em] text-logic-lcd-green/80">No ar</span>}
                          {isNext && <span className="ml-3 text-2xs font-medium uppercase tracking-[0.14em] text-logic-lcd-amber/80">Próxima</span>}
                        </span>
                        <span className="text-xs text-right text-logic-text-dim">{bpmLabel(song)}</span>
                        <span className={`text-xs text-right ${song && song.tuner !== 0 ? 'text-logic-lcd-amber' : 'text-logic-text-dim'}`}>{song ? toneLabel(song.tuner) : '-'}</span>
                        <span className="text-xs text-right text-logic-text">{formatTime(playedDuration(song, entry.duration))}</span>
                        <span className="text-xs text-right text-logic-text-muted">{formatTime(starts[index])}</span>
                        {showBpmTower && <div className="flex justify-center"><SongAdjuster songId={entry.songId} kind="bpm" value={song?.bpmAdjust ?? 0} /></div>}
                        {showTunerTower && <div className="flex justify-center"><SongAdjuster songId={entry.songId} kind="tuner" value={song?.tuner ?? 0} /></div>}
                      </div>
                    ) : (
                    <div className="flex items-center gap-2 px-2 h-10">
                      <span className={`text-2xs font-mono flex-shrink-0 w-4 ${isSelected ? 'text-white' : 'text-logic-text-muted'}`}>{index + 1}</span>

                      {renamingId === entry.songId ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={handleRenameSubmit}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 bg-logic-bg-deep text-xs text-white px-1 py-0.5 rounded border border-logic-accent outline-none min-w-0"
                        />
                      ) : (
                        <div className="flex-1 min-w-0 flex items-center">
                          <span className={`text-sm font-bold truncate block text-left ${isCurrent ? 'text-logic-lcd-green' : isNext ? 'text-logic-lcd-amber' : isSelected ? 'text-white' : 'text-logic-text'}`}>
                            {entry.name}
                          </span>
                          {audioStatus && <span className="ml-1">{audioStatus}</span>}
                          {song && (
                            <span className={`text-2xs font-mono ml-auto flex-shrink-0 pl-1 ${isSelected ? 'text-white' : 'text-logic-text-muted'}`}>{formatTime(song.duration)}</span>
                          )}
                        </div>
                      )}
                      {showBpmTower && <div className="flex justify-center flex-shrink-0 border-l border-logic-border-dark/60 h-full items-center" style={{ width: NARROW_TOWER_W - 8 }}><SongAdjuster songId={entry.songId} kind="bpm" value={song?.bpmAdjust ?? 0} /></div>}
                      {showTunerTower && <div className="flex justify-center flex-shrink-0 border-l border-logic-border-dark/60 h-full items-center" style={{ width: NARROW_TOWER_W - 8 }}><SongAdjuster songId={entry.songId} kind="tuner" value={song?.tuner ?? 0} /></div>}
                    </div>
                    )}

                    {wide && expanded && isCurrent && song && <SectionPads song={song} />}
                    {wide && expanded && song && isMedley(song) && (
                      <MedleySlices song={song} songNumber={index + 1} showStart={starts[index]} isCurrent={isCurrent} cols={wideCols} showBpm={showBpmTower} showTuner={showTunerTower} />
                    )}
                    {wide && isCurrent && <CurrentProgressBar />}
                    {wide && isNext && transport.isPlaying && song && (
                      <NextCountdownBar currentDuration={songs.find((sg) => sg.id === currentSongId)?.duration ?? 1} />
                    )}
                  </div>
                </div>
              );
            })}

            {/* zona de soltar no fim da lista */}
            <div
              onDragOver={(e) => {
                if (dragIndex === null && !dragBlockId) return;
                e.preventDefault();
                const lastId = playlist[playlist.length - 1]?.songId ?? null;
                if (dragBlockId) setDropPos({ type: 'song', id: lastId, half: 'after' });
                else setDropPos({ type: 'song', id: lastId, half: 'after' });
              }}
              onDrop={(e) => { e.preventDefault(); resolveDrop(); }}
              onDragEnd={clearDrag}
              className={dropPos?.type === 'song' && dropPos.half === 'after' && dropPos.id === playlist[playlist.length - 1]?.songId ? 'h-2' : 'h-0'}
            >
              <DropLine active={dropPos?.type === 'song' && dropPos.half === 'after' && dropPos.id === playlist[playlist.length - 1]?.songId} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {!wide && <div className="flex items-center justify-between px-3 h-7 bg-logic-bg-deep border-t border-logic-border-dark text-2xs text-logic-text-muted">
        <span>{playlist.length} música(s)</span>
        <span>{blocks.length} bloco(s)</span>
      </div>}

      {/* Block context menu */}
      {blockMenu && (
        <div
          ref={blockMenuRef}
          className="fixed z-[100] min-w-44 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded text-xs"
          style={{ left: blockMenu.x, top: blockMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-logic-accent hover:text-white transition-colors"
            onClick={() => {
              const b = blocks.find((b) => b.id === blockMenu.blockId);
              if (b) {
                setRenamingBlockId(b.id);
                setRenameBlockValue(b.name);
              }
              setBlockMenu(null);
            }}
          >
            Renomear
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-logic-accent hover:text-white transition-colors"
            onClick={() => { setColorPickerBlock(blockMenu.blockId); setBlockMenu(null); }}
          >
            Mudar Cor
          </button>
          <div className="h-px bg-logic-border-dark my-1" />
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-logic-lcd-red hover:text-white transition-colors"
            onClick={() => { deleteBlock(blockMenu.blockId); setBlockMenu(null); }}
          >
            Excluir Bloco
          </button>
        </div>
      )}

      {/* Color picker */}
      {colorPickerBlock && (
        <div
          ref={colorPickerRef}
          className="fixed z-[100] p-2 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded"
          style={{ left: blockMenu?.x ?? 100, top: (blockMenu?.y ?? 100) + 60 }}
        >
          <div className="grid grid-cols-5 gap-1.5">
            {BLOCK_COLORS.map((color) => (
              <button
                key={color}
                className={`w-6 h-6 rounded border hover:scale-110 transition-transform ${blocks.find((b) => b.id === colorPickerBlock)?.color === color ? 'ring-2 ring-white ring-offset-1 ring-offset-logic-bg-panel border-transparent' : 'border-logic-border-light'}`}
                style={{ backgroundColor: color }}
                onClick={() => { setBlockColor(colorPickerBlock, color); setColorPickerBlock(null); }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function blockInk(hex: string): string {
  return luminance(hex) > 0.18 ? '#111111' : '#ffffff';
}

function blockEdge(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const lighten = luminance(hex) < 0.03;
  const ch = (v: number) => Math.round(lighten ? v + (255 - v) * 0.3 : v * 0.65).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

function CurrentProgressBar() {
  const progress = useStore((s) => s.transport.songProgress);
  return (
    <div className="h-1 bg-[#0a1a0a]">
      <div
        className="h-full bg-logic-lcd-green transition-all duration-150 ease-linear"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

function NextCountdownBar({ currentDuration }: { currentDuration: number }) {
  const countdown = useStore((s) => s.transport.nextSongCountdown);
  if (countdown <= 0) return null;
  return (
    <div className="h-1 bg-[#1a1000]">
      <div
        className="h-full bg-logic-lcd-amber ml-auto transition-all duration-150 ease-linear"
        style={{ width: `${Math.min(100, (1 - countdown / currentDuration) * 100)}%` }}
      />
    </div>
  );
}
