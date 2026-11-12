import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, Loader2, Plus, Repeat, Square, X } from 'lucide-react';
import MiniFader from '@/components/MiniFader';
import MixerPanel from '@/components/MixerPanel';
import { useStore } from '@/store';
import { faderToGain } from '@/lib/faderScale';
import {
  clearPad, importPadFile, loadPads, openPadOutput, selectBank, setPadsMaster, stopAllPads, triggerPad, updatePad,
} from '@/lib/padPlayer';
import {
  BANK_COUNT, BANK_LABELS, PAD_COLORS, PAD_COUNT, bankCounts, dropTargets, formatPadTime, getPadsState, padForKey,
  padSlot, setPadsState, subscribePads, togglePadsPanel, type PadInfo,
} from '@/lib/samplePads';

const AUDIO_TYPES = 'audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg';

/**
 * Parte de baixo do Modo Show: os pads (tecla P ou o botão de pads da playlist) ficam no lugar
 * do mixer (tecla M). Apertar M com os pads abertos volta para o mixer.
 * Fica montado o tempo todo no Modo Show por causa das teclas: P abre e fecha os pads e, com
 * eles abertos, 1 a 9 tocam os pads do banco.
 */
export function PadsOrMixer() {
  const visible = useSyncExternalStore(subscribePads, () => getPadsState().visible);

  useEffect(() => { void loadPads(); }, []);
  // abre a saída dos pads junto com o painel: o primeiro toque já sai sem espera
  useEffect(() => { if (visible) openPadOutput(); }, [visible]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (!e.repeat) togglePadsPanel();
        return;
      }
      const cur = getPadsState();
      const pad = padForKey(e.key);
      if (!cur.visible || pad === null) return;
      e.preventDefault();
      if (!e.repeat) triggerPad(padSlot(cur.bank, pad));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // M (ou o botão do mixer) com os pads abertos: fecha os pads e mostra o mixer aberto
  useEffect(() => useStore.subscribe((s, prev) => {
    if (s.mixerVisible === prev.mixerVisible || !getPadsState().visible) return;
    setPadsState({ visible: false });
    if (!s.mixerVisible) s.toggleMixer();
  }), []);

  return visible ? <SamplePadPanel /> : <MixerPanel />;
}

/**
 * Pads do Modo Show: 9 pads (teclas 1 a 9) em 10 bancos (A a J). Clique num pad vazio (ou arraste
 * o arquivo para ele) para pôr um som; clique com o botão direito para nome, volume, loop, cor,
 * trocar ou limpar. O som sai pelo master do programa.
 */
function SamplePadPanel() {
  const st = useSyncExternalStore(subscribePads, getPadsState);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<number | null>(null);
  const [editing, setEditing] = useState<{ slot: number; anchor: HTMLElement } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const counts = bankCounts(st.infos);
  const pickFile = (slot: number) => {
    pickFor.current = slot;
    fileRef.current?.click();
  };
  const importMany = async (startPad: number, files: File[]) => {
    const used = new Set(st.infos.keys());
    const targets = dropTargets(st.bank, startPad, files.length, used);
    let ok = 0;
    for (let i = 0; i < targets.length; i++) if (await importPadFile(targets[i], files[i])) ok++;
    const left = files.length - targets.length;
    if (ok > 0) {
      setPadsState({
        message: {
          ok: true,
          text: `${ok === 1 ? '1 som pronto' : `${ok} sons prontos`} no banco ${BANK_LABELS[st.bank]}.`
            + (left > 0 ? ` ${left === 1 ? '1 arquivo ficou' : `${left} arquivos ficaram`} de fora: não há pad vazio depois.` : ''),
        },
      });
    }
  };

  return (
    <div className="console-face flex flex-col shrink-0 border-t border-black overflow-hidden" style={{ height: '268px', maxHeight: '55%' }}>
      <div className="console-rail flex items-center gap-2 px-3 h-8 shrink-0">
        <LayoutGrid size={13} className="text-logic-text-dim" />
        <span className="font-stage text-[13px] font-semibold tracking-wide text-logic-text-dim">Pads</span>
        <span className="console-readout text-logic-lcd-amber !min-w-0 px-1.5" title="Banco aberto">BANCO {BANK_LABELS[st.bank]}</span>
        <span className="console-legend hidden md:inline">TECLAS 1 A 9</span>
        {st.latencyMs !== null && (
          <span className="console-readout text-logic-lcd-green !min-w-0 px-1.5" title="Atraso da saída dos pads, do toque até a placa de áudio">
            {st.latencyMs.toLocaleString('pt-BR')} ms
          </span>
        )}
        <span className="flex-1" />
        <span className="console-legend">VOLUME</span>
        <MiniFader value={st.master} onChange={setPadsMaster} onReset={() => setPadsMaster(0.8)} width={84} height={14} tone="cue" />
        <button
          type="button"
          className={`console-key h-6 px-2 text-[11px] flex items-center gap-1 ${st.playing.size ? '!text-logic-lcd-red' : ''}`}
          onClick={stopAllPads}
          title="Parar todos os pads"
        >
          <Square size={10} fill="currentColor" /> Parar tudo
        </button>
        <button className="p-1 rounded text-logic-text-muted hover:text-logic-text" onClick={togglePadsPanel} title="Fechar os pads e voltar ao mixer (P)" aria-label="Fechar os pads">
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex gap-3 p-3">
        {/* Bancos: cada um guarda 9 sons */}
        <div className="grid grid-cols-2 gap-1 content-start shrink-0" role="radiogroup" aria-label="Bancos dos pads">
          {Array.from({ length: BANK_COUNT }, (_, b) => {
            const on = b === st.bank;
            return (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void selectBank(b)}
                className={`console-key relative w-8 h-[34px] text-[13px] ${on ? 'is-lit-amber' : ''}`}
                title={`Banco ${BANK_LABELS[b]}: ${counts[b] === 0 ? 'vazio' : counts[b] === 1 ? '1 som' : `${counts[b]} sons`}`}
              >
                {BANK_LABELS[b]}
                {counts[b] > 0 && !on && <span className="console-led is-on-green absolute top-1 right-1 !w-1 !h-1" />}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0 grid grid-cols-3 grid-rows-3 gap-2 max-w-[720px]">
          {Array.from({ length: PAD_COUNT }, (_, p) => {
            const slot = padSlot(st.bank, p);
            return (
              <Pad
                key={slot}
                number={p + 1}
                info={st.infos.get(slot)}
                playing={st.playing.has(slot)}
                loading={st.loading.has(slot)}
                dragOver={dragOver === slot}
                onPlay={() => triggerPad(slot)}
                onPick={() => pickFile(slot)}
                onEdit={(anchor) => setEditing({ slot, anchor })}
                onDragState={(on) => setDragOver(on ? slot : null)}
                onDropFiles={(files) => { setDragOver(null); void importMany(p, files); }}
              />
            );
          })}
        </div>

        <div className="hidden lg:flex flex-col justify-end gap-2 w-[200px] shrink-0 text-[11px] leading-snug text-logic-text-muted">
          {st.message ? (
            <p className={`px-2 py-1.5 rounded border ${st.message.ok
              ? 'bg-logic-lcd-green/10 border-logic-lcd-green/35 text-logic-lcd-green'
              : 'bg-logic-lcd-amber/15 border-logic-lcd-amber/40 text-logic-lcd-amber'}`}
            >
              {st.message.text}
            </p>
          ) : (
            <p>
              Clique num pad vazio ou arraste WAV ou MP3 para ele. Botão direito no pad: nome, volume, loop, cor, trocar ou limpar.
            </p>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={AUDIO_TYPES}
        multiple
        aria-label="Arquivos de som para os pads"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          const slot = pickFor.current;
          if (slot === null || !files.length) return;
          void importMany(slot % PAD_COUNT, files);
        }}
      />

      {editing && st.infos.get(editing.slot) && (
        <PadEditor
          info={st.infos.get(editing.slot)!}
          anchor={editing.anchor}
          onClose={() => setEditing(null)}
          onReplace={() => { pickFile(editing.slot); setEditing(null); }}
          onClear={() => { void clearPad(editing.slot); setEditing(null); }}
        />
      )}
    </div>
  );
}

function Pad({ number, info, playing, loading, dragOver, onPlay, onPick, onEdit, onDragState, onDropFiles }: {
  number: number;
  info?: PadInfo;
  playing: boolean;
  loading: boolean;
  dragOver: boolean;
  onPlay: () => void;
  onPick: () => void;
  onEdit: (anchor: HTMLElement) => void;
  onDragState: (on: boolean) => void;
  onDropFiles: (files: File[]) => void;
}) {
  const color = info?.color ?? PAD_COLORS[number - 1];
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      onDragState(true);
    },
    onDragLeave: () => onDragState(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDropFiles([...e.dataTransfer.files]);
    },
  };
  const key = (
    <kbd className="inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-[3px] bg-black/45 border border-white/15 text-[10px] font-mono text-logic-text-dim">{number}</kbd>
  );

  if (!info || loading) {
    return (
      <button
        type="button"
        onClick={onPick}
        disabled={loading}
        className={`console-pad relative min-h-0 flex items-center gap-2 px-2.5 text-left border-dashed ${dragOver ? '!border-[#ffab1f]' : '!border-white/15'}`}
        title={`Pad ${number}: clique ou arraste um WAV ou MP3`}
        {...drop}
      >
        {key}
        {loading ? <Loader2 size={13} className="animate-spin text-logic-lcd-amber" /> : <Plus size={13} className="text-logic-text-muted" />}
        <span className="text-[11px] text-logic-text-muted truncate">{loading ? 'Carregando...' : 'Pôr som'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); onPlay(); } }}
      onKeyDown={(e) => { if (e.key === 'Enter') onPlay(); }}
      onContextMenu={(e) => { e.preventDefault(); onEdit(e.currentTarget); }}
      className={`console-pad relative min-h-0 flex items-stretch overflow-hidden text-left ${playing ? 'is-active' : ''} ${dragOver ? '!border-[#ffab1f]' : ''}`}
      style={{ ['--pad-color' as string]: color }}
      title={`${info.name} (tecla ${number}). Botão direito: ajustar`}
      aria-pressed={playing}
      {...drop}
    >
      <span className="w-1.5 shrink-0" style={{ backgroundColor: color, boxShadow: playing ? `0 0 10px ${color}` : undefined }} />
      <span className="flex-1 min-w-0 flex flex-col justify-center gap-1 px-2">
        <span className="flex items-center gap-1.5 min-w-0">
          {key}
          <span className={`font-stage font-bold text-[13px] leading-none truncate ${playing ? 'text-white' : 'text-logic-text'}`}>{info.name}</span>
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-logic-text-muted tabular-nums">
          <span className={`console-led ${playing ? 'is-on-green animate-pulse' : ''}`} />
          {formatPadTime(info.duration)}
          {info.loop && <Repeat size={10} className="text-logic-lcd-green" aria-label="Loop" />}
        </span>
      </span>
    </button>
  );
}

/** Ajustes do pad (botão direito): nome, volume, loop, cor, trocar o som ou limpar. */
function PadEditor({ info, anchor, onClose, onReplace, onClear }: {
  info: PadInfo;
  anchor: HTMLElement;
  onClose: () => void;
  onReplace: () => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(info.name);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const db = info.volume > 0 ? 20 * Math.log10(faderToGain(info.volume)) : -Infinity;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 220;
    const left = Math.min(window.innerWidth - 268, Math.max(8, r.left));
    setPos(r.top - 6 - h > 8 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const saveName = () => {
    const clean = name.trim().slice(0, 28);
    if (clean && clean !== info.name) void updatePad(info.slot, { name: clean });
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Ajustes do pad ${info.name}`}
      className="fixed z-[999] w-[260px] console-face rounded-lg border border-black shadow-[0_12px_40px_rgba(0,0,0,0.85)] p-2.5 flex flex-col gap-2.5 text-[11px] animate-[fadeIn_100ms_ease-out]"
      style={pos}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => { if (e.key === 'Enter') { saveName(); (e.target as HTMLInputElement).blur(); } }}
        className="console-well w-full px-2 py-1.5 text-[12px] text-logic-text outline-none focus:ring-1 focus:ring-[#ffab1f]/60"
        aria-label="Nome do pad"
        maxLength={28}
      />
      <div className="flex items-center gap-2">
        <span className="console-legend w-14">VOLUME</span>
        <MiniFader
          value={info.volume}
          onChange={(v) => void updatePad(info.slot, { volume: v })}
          onReset={() => void updatePad(info.slot, { volume: 0.8 })}
          width={120}
          height={14}
          tone="cue"
        />
        <span className="console-readout text-logic-lcd-amber">{Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(1)}` : '-∞'}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="console-legend w-14">TOCAR</span>
        <button
          type="button"
          className={`console-key h-6 px-2 flex items-center gap-1 ${!info.loop ? 'is-lit-amber' : ''}`}
          onClick={() => void updatePad(info.slot, { loop: false })}
          title="Toca até o fim; apertar de novo recomeça"
        >
          Uma vez
        </button>
        <button
          type="button"
          className={`console-key h-6 px-2 flex items-center gap-1 ${info.loop ? 'is-lit-green' : ''}`}
          onClick={() => void updatePad(info.slot, { loop: true })}
          title="Repete até apertar o pad de novo"
        >
          <Repeat size={11} /> Loop
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="console-legend w-14">COR</span>
        <div className="flex flex-wrap gap-1">
          {PAD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`w-4 h-4 rounded-[3px] border ${info.color === c ? 'border-white' : 'border-black/60'}`}
              style={{ backgroundColor: c }}
              onClick={() => void updatePad(info.slot, { color: c })}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 pt-2 border-t border-black/60">
        <button type="button" className="console-key h-7 px-2.5 flex-1" onClick={onReplace}>Trocar som...</button>
        <button type="button" className="console-key h-7 px-2.5 hover:!text-logic-lcd-red" onClick={onClear}>Limpar</button>
      </div>
    </div>,
    document.body,
  );
}
