import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  Edit2,
  Folder,
  FolderInput,
  FolderOpen,
  Headphones,
  Palette,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useStore } from '@/store';
import { isCurrentOutput, isTimecodeTrackId, outputOptions, TIMECODE_TRACK_ID } from '@/lib/timecode';
import type { Track } from '@/types';

const DAW_COLORS = [
  '#30d158', // Verde
  '#0a84ff', // Azul
  '#ff9f0a', // Laranja
  '#ff453a', // Vermelho
  '#bf5af2', // Roxo
  '#ffd60a', // Amarelo
  '#64d2ff', // Ciano
  '#ff375f', // Rosa
  '#5e5ce6', // Índigo
  '#32d74b', // Verde Limão
  '#ac8e68', // Marrom / Madeira
  '#8e8e93', // Cinza Estúdio
];

interface TrackContextMenuProps {
  track: Track;
  x: number;
  y: number;
  onClose: () => void;
}

export default function TrackContextMenu({ track, x, y, onClose }: TrackContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tracks = useStore((s) => s.tracks);
  const count = useStore((s) => s.outputChannelCount);
  const renameTrack = useStore((s) => s.renameTrack);
  const setTrackColor = useStore((s) => s.setTrackColor);
  const moveTrackToFolder = useStore((s) => s.moveTrackToFolder);
  const setOutputChannel = useStore((s) => s.setOutputChannel);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);

  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(track.name);
  const [activeSubmenu, setActiveSubmenu] = useState<'color' | 'folder' | 'output' | null>(null);
  const isTc = isTimecodeTrackId(track.id);
  // Lista mostrada no submenu de saída: mono ou pares estéreo
  const [stereoView, setStereoView] = useState(!isTc && !!track.outputStereo);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nameValue.trim()) {
      renameTrack(track.id, nameValue.trim());
    }
    setRenaming(false);
    onClose();
  };

  // Pastas disponíveis para enviar
  const availableFolders = tracks.filter((t) => t.isSubgroup && t.id !== track.id && t.id !== TIMECODE_TRACK_ID);
  const currentParent = track.parentId ? tracks.find((t) => t.id === track.parentId) : null;

  // Opções de saída de áudio
  const outputs = outputOptions(track, tracks, count, stereoView);

  // Ajusta posição do menu na tela para não vazar da borda
  const menuWidth = 230;
  const menuHeight = 280;
  const posX = Math.max(10, Math.min(x, window.innerWidth - menuWidth - 10));
  const posY = Math.max(10, Math.min(y, window.innerHeight - menuHeight - 10));

  return (
    <div
      ref={ref}
      className="fixed z-[350] bg-[#16171d] border border-white/20 rounded-xl shadow-2xl text-xs text-white select-none overflow-visible animate-[fadeIn_100ms_ease-out] w-56 py-1.5"
      style={{ left: posX, top: posY }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Cabeçalho da Faixa */}
      <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: track.color }} />
          <span className="font-bold text-white truncate text-xs">{track.name}</span>
        </div>
        <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase tracking-wider bg-white/10 text-logic-text-dim shrink-0">
          {track.isSubgroup ? 'Pasta' : 'Faixa'}
        </span>
      </div>

      {/* 1. RENOMEAR */}
      {renaming ? (
        <form onSubmit={handleRenameSubmit} className="p-2 border-b border-white/10 flex items-center gap-1.5">
          <input
            type="text"
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            className="flex-1 bg-black/60 border border-logic-lcd-green rounded px-2 py-1 text-xs text-white outline-none"
            placeholder="Nome da faixa..."
          />
          <button
            type="submit"
            className="px-2 py-1 bg-logic-lcd-green text-black font-bold text-2xs rounded hover:brightness-110"
          >
            OK
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="w-full px-3 py-2 text-left hover:bg-white/10 flex items-center gap-2 text-white/90 hover:text-white transition"
        >
          <Edit2 size={13} className="text-logic-text-muted" />
          <span>Renomear</span>
        </button>
      )}

      {/* 2. MUDAR COR (SUBMENU / PALETA) */}
      <div
        className="relative"
        onMouseEnter={() => setActiveSubmenu('color')}
        onMouseLeave={() => setActiveSubmenu(null)}
      >
        <button
          type="button"
          className="w-full px-3 py-2 text-left hover:bg-white/10 flex items-center justify-between text-white/90 hover:text-white transition"
        >
          <div className="flex items-center gap-2">
            <Palette size={13} className="text-logic-text-muted" />
            <span>Mudar Cor</span>
          </div>
          <ChevronRight size={13} className="text-logic-text-muted" />
        </button>

        {activeSubmenu === 'color' && (
          <div className="absolute left-full top-0 ml-1 bg-[#1a1b22] border border-white/20 rounded-xl shadow-2xl p-2.5 z-[360] w-48">
            <div className="text-[10px] font-bold uppercase tracking-wider text-logic-text-muted mb-2 px-1">
              Escolher Cor
            </div>
            <div className="grid grid-cols-4 gap-2">
              {DAW_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => {
                    setTrackColor(track.id, color);
                    setActiveSubmenu(null);
                    onClose();
                  }}
                  className="w-8 h-8 rounded-lg border border-white/20 hover:scale-110 hover:border-white transition flex items-center justify-center shadow-md"
                  style={{ backgroundColor: color }}
                  title={color}
                >
                  {track.color === color && <Check size={14} className="text-black font-bold drop-shadow" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. ENVIAR PARA OUTRA PASTA (Se não for pasta) */}
      {!track.isSubgroup && !isTc && (
        <div
          className="relative"
          onMouseEnter={() => setActiveSubmenu('folder')}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left hover:bg-white/10 flex items-center justify-between text-white/90 hover:text-white transition"
          >
            <div className="flex items-center gap-2">
              <FolderInput size={13} className="text-logic-text-muted" />
              <span>Enviar para Pasta...</span>
            </div>
            <ChevronRight size={13} className="text-logic-text-muted" />
          </button>

          {activeSubmenu === 'folder' && (
            <div className="absolute left-full top-0 ml-1 bg-[#1a1b22] border border-white/20 rounded-xl shadow-2xl p-1.5 z-[360] min-w-[200px] max-h-64 overflow-y-auto logic-scroll">
              <div className="text-[10px] font-bold uppercase tracking-wider text-logic-text-muted mb-1 px-2.5 pt-1">
                Escolha a Pasta de Destino:
              </div>



              {/* Lista de pastas existentes */}
              {availableFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    moveTrackToFolder(track.id, folder.id);
                    setActiveSubmenu(null);
                    onClose();
                  }}
                  className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between hover:bg-white/10 transition ${
                    track.parentId === folder.id ? 'text-logic-lcd-green font-bold bg-white/[0.04]' : 'text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: folder.color }} />
                    <span className="truncate">{folder.name}</span>
                  </div>
                  {track.parentId === folder.id && <Check size={12} className="text-logic-lcd-green shrink-0 ml-1" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. ROTEAR CANAL DE SAÍDA (Somente para Pastas ou Faixas na Raiz - Faixas filhas seguem a pasta) */}
      {!track.parentId ? (
        <div
          className="relative"
          onMouseEnter={() => setActiveSubmenu('output')}
          onMouseLeave={() => setActiveSubmenu(null)}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left hover:bg-white/10 flex items-center justify-between text-white/90 hover:text-white transition"
          >
            <div className="flex items-center gap-2">
              <Volume2 size={13} className="text-logic-text-muted" />
              <span>Canal de Saída...</span>
            </div>
            <ChevronRight size={13} className="text-logic-text-muted" />
          </button>

          {activeSubmenu === 'output' && (
            <div className="absolute left-full top-0 ml-1 bg-[#1a1b22] border border-white/20 rounded-xl shadow-2xl p-1.5 z-[360] min-w-[200px] max-h-64 overflow-y-auto logic-scroll">
              <div className="text-[10px] font-bold uppercase tracking-wider text-logic-text-muted mb-1 px-2.5 pt-1">
                Roteamento de Saída
              </div>

              {!isTc && (
                <div className="flex gap-1 px-1 pb-1.5 mb-1 border-b border-white/10">
                  {[false, true].map((st) => (
                    <button
                      key={st ? 'stereo' : 'mono'}
                      type="button"
                      onClick={() => setStereoView(st)}
                      className={`flex-1 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition ${
                        stereoView === st ? 'bg-logic-accent text-white' : 'bg-white/[0.04] text-logic-text-dim hover:text-white'
                      }`}
                    >
                      {st ? 'Estéreo' : 'Mono'}
                    </button>
                  ))}
                </div>
              )}

              {outputs.map((opt) => {
                const selected = isCurrentOutput(track, opt);
                return (
                  <button
                    key={`${opt.value}-${opt.stereo}`}
                    disabled={opt.disabled}
                    onClick={() => {
                      if (!opt.disabled) {
                        setOutputChannel(track.id, opt.value, opt.stereo);
                        setActiveSubmenu(null);
                        onClose();
                      }
                    }}
                    className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between transition ${
                      opt.disabled
                        ? 'opacity-30 cursor-not-allowed'
                        : selected
                          ? 'text-logic-lcd-green font-bold bg-white/[0.04]'
                          : 'hover:bg-white/10 text-white'
                    }`}
                  >
                    <span>{opt.value === 0 ? `${opt.label} (Master)` : opt.label}</span>
                    {selected && <Check size={12} className="text-logic-lcd-green shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-1.5 text-2xs text-logic-text-muted flex items-center gap-1.5 border-t border-white/5 bg-white/[0.02]">
          <Volume2 size={12} className="text-logic-text-muted shrink-0" />
          <span className="truncate">
            Saída: segue a pasta <strong className="text-white">{currentParent?.name || 'Mãe'}</strong>
          </span>
        </div>
      )}

      <div className="h-px bg-white/10 my-1" />

      {/* 5. MUDO / SOLO */}
      <div className="flex items-center px-2 py-1 gap-1">
        <button
          type="button"
          onClick={() => {
            toggleMute(track.id);
            onClose();
          }}
          className={`flex-1 py-1 px-2 rounded-lg text-2xs font-bold transition flex items-center justify-center gap-1.5 border ${
            track.mute
              ? 'bg-logic-lcd-amber/20 border-logic-lcd-amber/50 text-logic-lcd-amber'
              : 'bg-white/[0.04] border-white/10 text-logic-text-dim hover:text-white'
          }`}
        >
          <VolumeX size={12} />
          <span>{track.mute ? 'Desmutar' : 'Mudo'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            toggleSolo(track.id);
            onClose();
          }}
          className={`flex-1 py-1 px-2 rounded-lg text-2xs font-bold transition flex items-center justify-center gap-1.5 border ${
            track.solo
              ? 'bg-logic-lcd-amber/20 border-logic-lcd-amber/50 text-logic-lcd-amber'
              : 'bg-white/[0.04] border-white/10 text-logic-text-dim hover:text-white'
          }`}
        >
          <Headphones size={12} />
          <span>{track.solo ? 'Tirar Solo' : 'Solo'}</span>
        </button>
      </div>
    </div>
  );
}
