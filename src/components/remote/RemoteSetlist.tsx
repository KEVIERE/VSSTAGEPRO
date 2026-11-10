// Aba "Lista" do VS Stage Remote: a playlist do Modo Show, com blocos, ajustes de BPM e de tom,
// medley e a edição da lista (renomear, duplicar, mudar a ordem, blocos). Excluir fica só no Mac.
import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, Copy, CornerDownRight, FlagTriangleRight, Link, Minus, Palette, Pencil, Plus,
} from 'lucide-react';
import SegmentDisplay from '@/components/SegmentDisplay';
import { formatTime } from '@/components/ShowRundown';
import type { AdjustKind, RemoteBlock, RemoteCommand, RemotePart, RemoteSong, RemoteState } from '@/lib/remoteProtocol';

type Send = (cmd: RemoteCommand) => void;

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const blockInk = (hex: string) => (luminance(hex) > 0.18 ? '#111111' : '#ffffff');

/** Teclas - e + com o visor do ajuste no meio (igual às torres do Modo Show, maiores para o dedo). */
function Adjuster({ label, value, inherited = false, onBump }: { label: string; value: number; inherited?: boolean; onBump: (d: 1 | -1) => void }) {
  const tone = inherited ? 'text-logic-text-muted/60' : value === 0 ? 'text-logic-text-muted' : value > 0 ? 'text-logic-lcd-green' : 'text-logic-lcd-amber';
  return (
    <div className="flex items-center gap-1">
      <span className="console-legend w-8 text-right pr-0.5">{label}</span>
      <button className="console-key w-9 h-9 flex items-center justify-center !text-logic-text" onClick={() => onBump(-1)} aria-label={`Diminuir ${label}`}><Minus size={13} /></button>
      <span className={`console-display font-stage font-semibold text-[14px] leading-[34px] tabular-nums w-10 text-center ${tone}`}>
        {value > 0 ? '+' : ''}{value}
      </span>
      <button className="console-key w-9 h-9 flex items-center justify-center !text-logic-text" onClick={() => onBump(1)} aria-label={`Aumentar ${label}`}><Plus size={13} /></button>
    </div>
  );
}

function Towers({ state, song, part, send }: { state: RemoteState; song: RemoteSong; part?: RemotePart; send: Send }) {
  if (!state.towers.bpm && !state.towers.tuner) return null;
  const bump = (kind: AdjustKind) => (delta: 1 | -1) => send({ action: 'adjust', songId: song.id, kind, delta, ...(part ? { partId: part.id } : {}) });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" onClick={(e) => e.stopPropagation()}>
      {state.towers.bpm && <Adjuster label="BPM" value={part ? part.bpmShown : song.bpmShown} inherited={part?.bpmInherited} onBump={bump('bpm')} />}
      {state.towers.tuner && <Adjuster label="Tom" value={part ? part.tunerShown : Math.round(song.tuner)} inherited={part?.tunerInherited} onBump={bump('tuner')} />}
    </div>
  );
}

function BlockHeader({ block, state, send }: { block: RemoteBlock; state: RemoteState; send: Send }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(block.name);
  const ink = blockInk(block.color);
  return (
    <div className="mt-2">
      <button
        className="cue-block relative w-full flex items-center justify-center gap-1.5 px-4 h-11 border-b border-black"
        style={{ backgroundColor: block.color }}
        onClick={() => { setName(block.name); setOpen((o) => !o); }}
        aria-expanded={open}
      >
        <FlagTriangleRight size={11} style={{ color: ink }} />
        <span className="font-stage font-bold truncate text-[15px] uppercase tracking-[0.12em]" style={{ color: ink }}>{block.name}</span>
        <span className="absolute right-4 font-stage font-semibold text-[13px] tabular-nums opacity-75" style={{ color: ink }}>{formatTime(block.duration)}</span>
      </button>
      {open && (
        <div className="console-well m-2 p-3 space-y-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { send({ action: 'renameBlock', blockId: block.id, name }); setOpen(false); } }}
              aria-label="Nome do bloco"
              className="access-field is-plain flex-1 min-w-0 !h-10"
            />
            <button
              className="console-key is-lit-amber h-10 px-3 text-[13px] flex items-center gap-1"
              disabled={!name.trim()}
              onClick={() => { send({ action: 'renameBlock', blockId: block.id, name }); setOpen(false); }}
            ><Pencil size={13} /> Renomear</button>
          </div>
          <div>
            <div className="console-legend mb-1.5 flex items-center gap-1.5"><Palette size={11} /> Cor do bloco</div>
            <div className="flex flex-wrap gap-2">
              {state.blockColors.map((c) => (
                <button
                  key={c}
                  className={`w-9 h-9 rounded border ${block.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-black border-transparent' : 'border-logic-border-light'}`}
                  style={{ backgroundColor: c }}
                  onClick={() => send({ action: 'blockColor', blockId: block.id, color: c })}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MedleyParts({ song, number, state, send }: { song: RemoteSong; number: number; state: RemoteState; send: Send }) {
  const enabledCount = song.parts.filter((p) => p.enabled).length;
  return (
    <div className="pb-2 space-y-1" onClick={(e) => e.stopPropagation()}>
      {song.parts.map((p, i) => {
        const locked = p.enabled && enabledCount <= 1;
        return (
          <div key={p.id} className="px-3 py-1.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                className={`w-9 h-9 shrink-0 rounded flex items-center justify-center border ${p.enabled ? 'bg-logic-lcd-green/20 border-logic-lcd-green/70 text-logic-lcd-green' : 'border-logic-border-light text-transparent'} ${locked ? 'opacity-60' : ''}`}
                onClick={() => { if (!locked) send({ action: 'sliceToggle', songId: song.id, partId: p.id }); }}
                aria-pressed={p.enabled}
                aria-label={p.enabled ? `Não tocar ${p.name}` : `Tocar ${p.name}`}
              >
                <Check size={15} strokeWidth={3} />
              </button>
              <button
                className={`flex-1 min-w-0 flex items-center gap-2 min-h-[40px] text-left ${p.enabled ? '' : 'opacity-40'}`}
                onClick={() => send({ action: 'slice', songId: song.id, partId: p.id })}
              >
                <CornerDownRight size={13} className="text-logic-text-muted shrink-0" />
                <span className="text-xs font-mono text-logic-text-muted shrink-0">{number}.{i + 1}</span>
                <span className={`text-sm font-medium truncate text-logic-text ${p.enabled ? '' : 'line-through'}`}>{p.name}</span>
                {!p.enabled && <span className="text-2xs uppercase tracking-[0.14em] text-logic-text-muted shrink-0">Pulada</span>}
                <span className="ml-auto text-xs font-stage text-logic-text-dim shrink-0">{formatTime(p.duration)}</span>
              </button>
            </div>
            <div className="pl-11"><Towers state={state} song={song} part={p} send={send} /></div>
          </div>
        );
      })}
    </div>
  );
}

function SongRow({ song, index, state, send, open, selected, onTap, isLast }: {
  song: RemoteSong; index: number; state: RemoteState; send: Send; open: boolean;
  /** selecionada no Mac (ou acabou de ser tocada aqui e o Mac ainda não respondeu) */
  selected: boolean;
  /** toque na música: seleciona no Mac e abre/fecha as opções */
  onTap: () => void;
  isLast: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(song.name);
  const isCurrent = state.playing && song.id === state.currentId;
  const isNext = song.id === state.nextId;
  const isSelected = selected;
  const currentIndex = state.playing ? state.songs.findIndex((s) => s.id === state.currentId) : -1;
  const played = currentIndex >= 0 && index < currentIndex;
  const tone = isCurrent ? 'text-logic-lcd-green' : isNext ? 'text-logic-lcd-amber' : 'text-logic-text-muted';
  const umaUma = state.flow === 'uma-uma';
  return (
    <div className={`cue-row border-b border-black/60 ${isCurrent ? 'is-current' : isNext ? 'is-next' : isSelected ? 'is-selected' : ''} ${played && !open ? 'opacity-50' : ''}`}>
      <button className="relative w-full flex items-center gap-3 pl-7 pr-3 min-h-[60px] text-left" onClick={onTap} aria-expanded={open} aria-current={isSelected ? 'true' : undefined}>
        <span className={`console-led is-lg absolute left-[9px] top-1/2 -translate-y-1/2 ${isCurrent ? 'is-on-green' : isNext ? 'is-on-amber' : ''}`} />
        <SegmentDisplay text={String(index + 1).padStart(2, '0')} label={`Música ${index + 1}`} ghost={isCurrent || isNext} className={`h-[17px] shrink-0 ${tone}`} />
        <span className="flex-1 min-w-0">
          <span className={`block text-[16px] font-semibold truncate ${isCurrent ? 'text-logic-lcd-green console-glow' : isNext ? 'text-logic-lcd-amber console-glow' : isSelected ? 'text-white' : 'text-logic-text'}`}>
            {song.name}
            {song.missing && <AlertTriangle size={13} className="inline ml-1.5 -mt-0.5 text-logic-lcd-red" aria-label="Arquivo de áudio não encontrado no Mac" />}
          </span>
          <span className="flex items-center gap-2.5 mt-0.5 font-stage text-[13px] tabular-nums text-logic-text-dim">
            {isCurrent && <span className="console-display px-1.5 text-[11px] font-semibold text-logic-lcd-green">No ar</span>}
            {isNext && <span className="console-display px-1.5 text-[11px] font-semibold text-logic-lcd-amber">Próxima</span>}
            <span>{song.bpm} BPM</span>
            <span className={song.tuner !== 0 ? 'text-logic-lcd-amber' : ''}>{song.tone}</span>
            <span className="text-logic-text">{formatTime(song.duration)}</span>
            <span className="text-logic-text-muted">{formatTime(song.start)}</span>
          </span>
        </span>
      </button>

      {(state.towers.bpm || state.towers.tuner) && (
        <div className="pl-7 pr-3 pb-2.5"><Towers state={state} song={song} send={send} /></div>
      )}

      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          {renaming ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) { send({ action: 'rename', songId: song.id, name }); setRenaming(false); }
                  if (e.key === 'Escape') setRenaming(false);
                }}
                aria-label="Nome da música"
                className="access-field is-plain flex-1 min-w-0 !h-10"
              />
              <button className="console-key h-10 px-3 text-[13px]" onClick={() => setRenaming(false)}>Cancelar</button>
              <button
                className="console-key is-lit-amber h-10 px-3 text-[13px]"
                disabled={!name.trim()}
                onClick={() => { send({ action: 'rename', songId: song.id, name }); setRenaming(false); }}
              >OK</button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              <button
                className={`console-key h-11 text-[12px] flex items-center justify-center gap-1 ${isNext ? 'is-lit-amber' : ''}`}
                disabled={umaUma}
                onClick={() => send({ action: 'setNext', songId: isNext ? null : song.id })}
                title={umaUma ? 'Fluxo Uma a Uma: sem próxima engatilhada' : undefined}
              ><Link size={13} /> {isNext ? 'Tirar próx.' : 'Próxima'}</button>
              <button className="console-key h-11 text-[12px] flex items-center justify-center gap-1" onClick={() => { setName(song.name); setRenaming(true); }}><Pencil size={13} /> Renomear</button>
              <button className="console-key h-11 text-[12px] flex items-center justify-center gap-1" onClick={() => send({ action: 'duplicate', songId: song.id })}><Copy size={13} /> Duplicar</button>
              <button className="console-key h-11 text-[12px] flex items-center justify-center gap-1" disabled={index === 0} onClick={() => send({ action: 'move', songId: song.id, dir: -1 })}><ArrowUp size={13} /> Subir</button>
              <button className="console-key h-11 text-[12px] flex items-center justify-center gap-1" disabled={isLast} onClick={() => send({ action: 'move', songId: song.id, dir: 1 })}><ArrowDown size={13} /> Descer</button>
              <button className="console-key h-11 text-[12px] flex items-center justify-center gap-1" onClick={() => send({ action: 'createBlock', songId: song.id })}><FlagTriangleRight size={13} /> Criar bloco</button>
            </div>
          )}
          {song.parts.length > 0 && <MedleyParts song={song} number={index + 1} state={state} send={send} />}
        </div>
      )}
    </div>
  );
}

/** Quanto tempo a música tocada fica marcada aqui esperando o Mac confirmar a seleção. */
const PICK_HOLD_MS = 2000;

export default function RemoteSetlist({ state, send }: { state: RemoteState; send: Send }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // a música tocada fica marcada na hora; o Mac confirma em seguida (selectedId do estado)
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!picked) return;
    if (state.selectedId === picked) { setPicked(null); return; }
    const t = window.setTimeout(() => setPicked(null), PICK_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [picked, state.selectedId]);
  const selectedId = picked ?? state.selectedId;
  const tap = (songId: string) => {
    // tocar na música seleciona no Mac, como o clique na playlist do programa
    if (songId !== state.selectedId) {
      send({ action: 'select', songId });
      setPicked(songId);
    }
    setOpenId((id) => (id === songId ? null : songId));
  };
  if (state.songs.length === 0) {
    return <div className="p-8 text-center text-sm text-logic-text-muted">Nenhuma música na playlist do Mac.</div>;
  }
  let lastBlock: string | null = null;
  return (
    <div className="pb-4">
      {state.songs.map((song, index) => {
        const block = song.blockId ? state.blocks.find((b) => b.id === song.blockId) : undefined;
        const showBlock = !!block && block.id !== lastBlock;
        lastBlock = song.blockId;
        return (
          <div key={song.id}>
            {showBlock && block && <BlockHeader block={block} state={state} send={send} />}
            <SongRow
              song={song}
              index={index}
              state={state}
              send={send}
              open={openId === song.id}
              selected={song.id === selectedId}
              onTap={() => tap(song.id)}
              isLast={index === state.songs.length - 1}
            />
          </div>
        );
      })}
      <p className="px-4 pt-4 text-center text-xs text-logic-text-muted">Toque numa música para selecionar no Mac e ver as opções. Excluir música só no Mac.</p>
    </div>
  );
}
