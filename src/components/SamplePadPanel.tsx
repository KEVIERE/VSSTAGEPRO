import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, Loader2, Plus, Repeat, X } from 'lucide-react';
import { LedMeter } from '@/components/MeterMask';
import MixerPanel, { Fader } from '@/components/MixerPanel';
import SegmentDisplay from '@/components/SegmentDisplay';
import { GfKnob } from '@/components/GrafitePieces';
import { EsKnob } from '@/components/EstudioPieces';
import { OfKnob } from '@/components/OficinaPieces';
import { useSkin } from '@/lib/useSkin';
import { VsKnobFace } from '@/components/AnalogPieces';
import { faderToGain } from '@/lib/faderScale';
import {
  clearPad, fadeAllPads, importPadFile, keepPadsReady, loadPads, openPadOutput, padClock, releasePad, selectBank, selectPad, setPadsChoke,
  setPadsFx, setPadsHold, setPadsMaster, setPadsOutput, stopAllPads, triggerPad, updatePad,
} from '@/lib/padPlayer';
import {
  BANK_COUNT, BANK_LABELS, DEFAULT_PAD_FX, PAD_COLORS, filterLabel, rollLabel, PAD_COUNT, PITCH_RANGE, bankCounts, clampPitch, dropTargets, formatPadTime,
  getPadsState, lastPlaying, padForKey, padOutputLabel, padOutputOptions, padSlot, pitchLabel, pitchedDuration,
  setPadsState, slotPad, subscribePads, togglePadsPanel, usablePadOutput, type PadInfo, type PadOutput,
} from '@/lib/samplePads';
import { useStore } from '@/store';

const AUDIO_TYPES = 'audio/*,.wav,.mp3,.aif,.aiff,.m4a,.flac,.ogg';

const dbOf = (volume: number) => (volume > 0 ? 20 * Math.log10(faderToGain(volume)) : -Infinity);
const dbText = (volume: number) => {
  const db = dbOf(volume);
  return Number.isFinite(db) ? `${db > 0.05 ? '+' : ''}${db.toFixed(1)}` : '-∞';
};

/**
 * Parte de baixo do Modo Show: os pads (tecla P ou o botão de pads da playlist) ficam no lugar
 * do mixer (tecla M). Apertar M com os pads abertos volta para o mixer.
 * Fica montado o tempo todo no Modo Show por causa das teclas: P abre e fecha os pads e, com
 * eles abertos, 1 a 9 tocam os pads do banco.
 */
export function PadsOrMixer() {
  const visible = useSyncExternalStore(subscribePads, () => getPadsState().visible);

  useEffect(() => { void loadPads(); }, []);
  // no Modo Show os pads ficam sempre prontos (saída aberta e acordada, sons do banco na memória),
  // mesmo com o mixer na tela: o primeiro toque sai na hora, até depois de sair e voltar
  useEffect(() => {
    keepPadsReady(true);
    return () => keepPadsReady(false);
  }, []);
  useEffect(() => { if (visible) openPadOutput(); }, [visible]);

  useEffect(() => {
    // tecla apertada → pad que ela tocou (para soltar o mesmo pad, mesmo se o banco mudar no meio)
    const held = new Map<string, number>();
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
      if (e.repeat) return;
      const slot = padSlot(cur.bank, pad);
      held.set(e.key, slot);
      triggerPad(slot);
    };
    // soltou a tecla: no modo segurar o som para (depois de pelo menos 0,2 s)
    const onKeyUp = (e: KeyboardEvent) => {
      const slot = held.get(e.key);
      if (slot === undefined) return;
      held.delete(e.key);
      releasePad(slot);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // M (ou o botão do mixer) com os pads abertos: fecha os pads e mostra o mixer aberto
  useEffect(() => useStore.subscribe((s, prev) => {
    if (s.mixerVisible === prev.mixerVisible || !getPadsState().visible) return;
    setPadsState({ visible: false });
    if (!s.mixerVisible) s.toggleMixer();
  }), []);

  return visible ? <SamplePadPanel /> : <MixerPanel fit />;
}

/**
 * Pads do Modo Show, com cara de controlador de pads: visores do que está tocando e do pad
 * escolhido, knob de volume do pad, fader geral, pitch, efeitos, saída, bancos A a J e os 9 pads
 * acesos na cor de cada um. Apertar um pad toca e escolhe ele (o knob vai para o volume dele).
 */
function SamplePadPanel() {
  const st = useSyncExternalStore(subscribePads, getPadsState);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickFor = useRef<number | null>(null);
  const [editing, setEditing] = useState<{ slot: number; anchor: HTMLElement } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const selected = st.infos.get(st.selected);
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
  const set = (patch: Partial<Omit<PadInfo, 'slot'>>) => { if (selected) void updatePad(selected.slot, patch); };

  return (
    <div className="console-face console-screws flex flex-col shrink-0 border-t border-black overflow-hidden" style={{ height: '404px', maxHeight: '66%' }}>
      <div className="console-rail flex items-center gap-2 px-3 h-8 shrink-0">
        <LayoutGrid size={13} className="text-logic-text-dim" />
        <span className="font-stage text-[13px] font-semibold tracking-wide text-logic-text-dim">Pads</span>
        <span className="console-legend hidden md:inline">TECLAS 1 A 9 · P FECHA</span>
        {st.latencyMs !== null && (
          <span className="console-readout text-logic-lcd-green !min-w-0 px-1.5" title="Atraso da saída dos pads, do toque até a placa de áudio">
            {st.latencyMs.toLocaleString('pt-BR')} ms
          </span>
        )}
        {st.message && (
          <span className={`text-[11px] truncate min-w-0 ${st.message.ok ? 'text-logic-lcd-green' : 'text-logic-lcd-amber'}`}>{st.message.text}</span>
        )}
        <span className="flex-1" />
        <span className="console-legend shrink-0">SAÍDA</span>
        <span className="w-[112px] shrink-0 flex"><OutputButton output={st.output} /></span>
        <button className="p-1 rounded text-logic-text-muted hover:text-logic-text" onClick={togglePadsPanel} title="Fechar os pads e voltar ao mixer (P)" aria-label="Fechar os pads">
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex gap-3 p-3 overflow-x-auto logic-scroll">
        {/* Visores, pitch, efeitos e saída */}
        <div className="w-[292px] shrink-0 flex flex-col gap-2 min-h-0">
          <PlayingDisplay />
          <DetailsDisplay info={selected} number={slotPad(st.selected) + 1} bank={st.bank} output={st.output} />
          <PitchFader value={selected?.pitch ?? 0} disabled={!selected} onChange={(v) => set({ pitch: v })} />
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Efeitos do pad escolhido">
            <FxKey label="REVERB" on={!!selected?.reverb} lit="is-lit-blue" disabled={!selected} onClick={() => set({ reverb: !selected?.reverb })} title="Reverb: sala com cauda de 2 segundos" />
            <FxKey label="DELAY" on={!!selected?.delay} lit="is-lit-blue" disabled={!selected} onClick={() => set({ delay: !selected?.delay })} title="Delay: repete no tempo da música (uma semínima)" />
            <FxKey label="REVERSO" on={!!selected?.reverse} lit="is-lit-amber" disabled={!selected} onClick={() => set({ reverse: !selected?.reverse })} title="Toca o som de trás para frente (vale no próximo toque)" />
            <FxKey label="LOOP" on={!!selected?.loop} lit="is-lit-green" disabled={!selected} onClick={() => set({ loop: !selected?.loop })} title="Repete até apertar o pad de novo" />
          </div>
          <FxKnobs />
          <div className="flex items-center gap-1.5 mt-auto">
            <button
              type="button"
              className={`console-key h-7 px-2 text-[11px] flex items-center gap-1.5 shrink-0 ${st.choke ? 'is-lit-amber' : ''}`}
              onClick={() => setPadsChoke(!st.choke)}
              aria-pressed={st.choke}
              title={st.choke ? 'Um por vez ligado: tocar um pad para os outros' : 'Ligar um por vez: tocar um pad para os outros'}
            >
              <span className={`console-led ${st.choke ? 'is-on-amber' : ''}`} />
              1 POR VEZ
            </button>
            <button
              type="button"
              className={`console-key h-7 px-2 text-[11px] flex items-center gap-1.5 shrink-0 ${st.hold ? 'is-lit-amber' : ''}`}
              onClick={() => setPadsHold(!st.hold)}
              aria-pressed={st.hold}
              title={st.hold
                ? 'Segurar ligado: os pads tocam enquanto estão apertados; apertou e soltou, toca só 0,2 s'
                : 'Ligar segurar: os pads tocam enquanto estão apertados; apertou e soltou, toca só 0,2 s'}
            >
              <span className={`console-led ${st.hold ? 'is-on-amber' : ''}`} />
              SEGURAR
            </button>
            <span className="flex-1" />
            <button type="button" className="console-key h-7 px-2.5 text-[11px]" onClick={fadeAllPads} title="Abaixa os pads tocando até sumir, em 2 segundos">FADE</button>
            <button
              type="button"
              className={`console-key h-7 px-2.5 text-[11px] ${st.playing.size ? '!text-logic-lcd-red' : ''}`}
              onClick={stopAllPads}
              title="Para todos os pads na hora"
            >
              STOP
            </button>
          </div>
        </div>

        {/* Knob do pad escolhido e fader geral, como no controlador */}
        <div className="w-[96px] shrink-0 flex flex-col items-center gap-1.5">
          <PadKnob
            value={selected?.volume ?? 0}
            color={selected?.color ?? '#ffab1f'}
            disabled={!selected}
            onChange={(v) => set({ volume: v })}
            onReset={() => set({ volume: 0.8 })}
          />
          <span className="console-legend text-center leading-tight">
            VOL PAD<br /><span className="text-logic-lcd-amber tabular-nums">{selected ? `${dbText(selected.volume)} dB` : '—'}</span>
          </span>
          <div className="flex items-end gap-1.5 flex-1 min-h-0" title="Volume geral dos pads">
            <Fader value={st.master} onChange={setPadsMaster} onDoubleClick={() => setPadsMaster(0.8)} width={22} height={150} tone="cue" />
            <LedMeter id="pads" height={150} title="Nível dos pads" />
          </div>
          <span className="console-legend">GERAL</span>
        </div>

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
                className={`console-key relative w-8 h-[36px] text-[13px] ${on ? 'is-lit-amber' : ''}`}
                title={`Banco ${BANK_LABELS[b]}: ${counts[b] === 0 ? 'vazio' : counts[b] === 1 ? '1 som' : `${counts[b]} sons`}`}
              >
                {BANK_LABELS[b]}
                {counts[b] > 0 && !on && <span className="console-led is-on-green absolute top-1 right-1 !w-1 !h-1" />}
              </button>
            );
          })}
        </div>

        {/* Os 9 pads */}
        <div className="flex-1 min-w-[300px] max-w-[520px] grid grid-cols-3 grid-rows-3 gap-2.5 p-2.5 rounded-lg bg-[#121417] border border-black shadow-[inset_0_2px_6px_rgba(0,0,0,0.8)]">
          {Array.from({ length: PAD_COUNT }, (_, p) => {
            const slot = padSlot(st.bank, p);
            return (
              <Pad
                key={slot}
                number={p + 1}
                info={st.infos.get(slot)}
                playing={st.playing.has(slot)}
                selected={st.selected === slot}
                loading={st.loading.has(slot)}
                dragOver={dragOver === slot}
                onPlay={() => triggerPad(slot)}
                onRelease={() => releasePad(slot)}
                onPick={() => { selectPad(slot); pickFile(slot); }}
                onEdit={(anchor) => { selectPad(slot); setEditing({ slot, anchor }); }}
                onDragState={(on) => setDragOver(on ? slot : null)}
                onDropFiles={(files) => { setDragOver(null); void importMany(p, files); }}
              />
            );
          })}
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

/** Visor do que está tocando: o último pad que começou, o tempo que falta e a barra. */
function PlayingDisplay() {
  const st = useSyncExternalStore(subscribePads, getPadsState);
  const slot = lastPlaying(st.playing);
  const info = slot !== null ? st.infos.get(slot) : undefined;
  const [, tick] = useState(0);
  useEffect(() => {
    if (slot === null) return;
    const id = window.setInterval(() => tick((n) => n + 1), 100);
    return () => window.clearInterval(id);
  }, [slot]);
  const total = info ? pitchedDuration(info) : 0;
  const elapsed = slot !== null ? Math.max(0, padClock() - (st.playing.get(slot) ?? 0)) : 0;
  const left = info?.loop ? (total > 0 ? total - (elapsed % total) : 0) : Math.max(0, total - elapsed);
  const pct = total > 0 ? Math.min(100, ((info?.loop ? elapsed % total : elapsed) / total) * 100) : 0;
  const others = st.playing.size - (slot !== null ? 1 : 0);
  return (
    <div className="console-bezel shrink-0">
      <div className="console-display px-2.5 py-1.5 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`console-led shrink-0 ${info ? 'is-on-green' : ''}`} />
          <span className="text-[10px] tracking-[0.12em] text-logic-lcd-text/60 shrink-0">TOCANDO</span>
          <span className="text-[12px] font-semibold truncate text-logic-lcd-text">{info ? info.name : 'nada tocando'}</span>
          {others > 0 && <span className="ml-auto text-[10px] text-logic-lcd-amber shrink-0">+{others}</span>}
        </div>
        <div className="flex items-center gap-2">
          <SegmentDisplay
            text={info ? (info.loop ? `L${formatPadTime(left)}` : `-${formatPadTime(left)}`) : '-0:00'}
            label={info ? `Faltam ${formatPadTime(left)}` : 'Nada tocando'}
            className={`h-6 ${info ? 'text-logic-lcd-amber' : 'text-logic-lcd-amber/30'}`}
          />
          <div className="flex-1 h-1.5 rounded-sm bg-black/60 overflow-hidden">
            <div className="h-full bg-logic-lcd-green transition-[width] duration-100" style={{ width: `${pct}%`, backgroundColor: info?.color }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Visor do pad escolhido: nome, tamanho, volume, pitch, efeitos e saída. */
function DetailsDisplay({ info, number, bank, output }: { info?: PadInfo; number: number; bank: number; output: PadOutput }) {
  const count = useStore((s) => s.outputChannelCount);
  const fx = info ? [info.reverb && 'REV', info.delay && 'DLY', info.reverse && 'REVERSO', info.loop && 'LOOP'].filter(Boolean).join(' · ') : '';
  return (
    <div className="console-display shrink-0 px-2.5 py-1.5 text-[11px] leading-tight flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-logic-lcd-amber font-semibold shrink-0">PAD {BANK_LABELS[bank]}{number}</span>
        <span className="truncate text-logic-lcd-text">{info ? info.name : 'vazio: clique no pad para pôr um som'}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 tabular-nums text-logic-lcd-text/80">
        <span>TAM {info ? formatPadTime(pitchedDuration(info)) : '—'}</span>
        <span>VOL {info ? dbText(info.volume) : '—'}</span>
        <span>PITCH {info ? pitchLabel(info.pitch) : '—'}</span>
      </div>
      <div className="flex items-center gap-2 text-logic-lcd-text/80 min-w-0">
        <span className="truncate">FX {fx || 'nenhum'}</span>
        <span className="ml-auto shrink-0">OUT {padOutputLabel(usablePadOutput(output, count))}</span>
      </div>
    </div>
  );
}

function FxKey({ label, on, lit, disabled, onClick, title }: {
  label: string; on: boolean; lit: string; disabled: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      type="button"
      className={`console-key h-8 text-[10.5px] flex flex-col items-center justify-center gap-0.5 ${on ? lit : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={title}
    >
      <span className={`console-led ${on ? 'is-on-green' : ''}`} />
      {label}
    </button>
  );
}

/** Pitch do pad escolhido: -12 a +12 semitons, com o zero no meio. Duplo clique volta ao zero. */
function PitchFader({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (value + PITCH_RANGE) / (PITCH_RANGE * 2);
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !ref.current) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const width = ref.current.getBoundingClientRect().width;
    let last = e.clientX;
    let acc = value;
    const move = (ev: PointerEvent) => {
      acc += ((ev.clientX - last) / width) * PITCH_RANGE * 2 * (ev.shiftKey ? 0.25 : 1);
      last = ev.clientX;
      acc = Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, acc));
      const next = clampPitch(acc);
      if (next !== value) onChange(next);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div className={`flex items-center gap-2 shrink-0 ${disabled ? 'opacity-50' : ''}`}>
      <span className="console-legend w-10 shrink-0">PITCH</span>
      <div
        ref={ref}
        className="relative flex-1 h-6 cursor-ew-resize select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={down}
        onDoubleClick={() => { if (!disabled) onChange(0); }}
        title="Pitch do pad escolhido: arraste para os lados (Shift: fino). Duplo clique: zero."
        role="slider"
        aria-label="Pitch do pad"
        aria-valuemin={-PITCH_RANGE}
        aria-valuemax={PITCH_RANGE}
        aria-valuenow={value}
      >
        {[-12, -7, 0, 7, 12].map((m) => (
          <span key={m} className={`absolute top-0 w-px ${m === 0 ? 'h-full bg-logic-lcd-amber/70' : 'h-1.5 bg-white/25'}`} style={{ left: `${((m + PITCH_RANGE) / (PITCH_RANGE * 2)) * 100}%` }} />
        ))}
        <div className="console-slot is-horizontal absolute left-0 right-0 top-1/2 -translate-y-1/2" />
        <div className="console-cap console-cap--cue is-horizontal absolute top-0 bottom-0 w-3" style={{ left: `calc(${pct * 100}% - 6px)` }} />
      </div>
      <span className="console-readout text-logic-lcd-amber w-9 shrink-0">{pitchLabel(value)}</span>
    </div>
  );
}

/** Knob do volume do pad escolhido, com anel de LED. Arraste para cima ou para baixo; duplo clique: 0 dB. */
function PadKnob({ value, color, disabled, onChange, onReset }: {
  value: number; color: string; disabled: boolean; onChange: (v: number) => void; onReset: () => void;
}) {
  const pct = Math.max(0, Math.min(1, value / 1.5));
  const skin = useSkin();
  const grafite = skin === 'grafite';
  const estudio = skin === 'estudio';
  const oficina = skin === 'oficina';
  const SEG = 21;
  const angle = -135 + pct * 270;
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = e.clientY;
    let acc = value;
    const move = (ev: PointerEvent) => {
      acc += ((last - ev.clientY) / 160) * 1.5 * (ev.shiftKey ? 0.1 : 1);
      last = ev.clientY;
      acc = Math.max(0, Math.min(1.5, acc));
      onChange(Math.round(acc * 1000) / 1000);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div
      className={`relative w-[78px] h-[78px] shrink-0 select-none ${disabled ? 'opacity-40' : 'cursor-ns-resize'}`}
      style={{ touchAction: 'none' }}
      onPointerDown={down}
      onDoubleClick={() => { if (!disabled) onReset(); }}
      onWheel={(e) => { if (!disabled) onChange(Math.max(0, Math.min(1.5, Math.round((value - Math.sign(e.deltaY) * 0.02) * 1000) / 1000))); }}
      role="slider"
      aria-label="Volume do pad escolhido"
      aria-valuemin={0}
      aria-valuemax={1.5}
      aria-valuenow={value}
      title="Volume do pad escolhido: arraste para cima ou para baixo (Shift: fino). Duplo clique: 0 dB."
    >
      {!grafite && !estudio && (
      <svg viewBox="0 0 78 78" className="absolute inset-0">
        {Array.from({ length: SEG }, (_, i) => {
          const a = ((-135 + (i / (SEG - 1)) * 270) * Math.PI) / 180;
          const on = i / (SEG - 1) <= pct + 1e-6 && pct > 0;
          return (
            <line
              key={i}
              x1={39 + Math.sin(a) * 31} y1={39 - Math.cos(a) * 31}
              x2={39 + Math.sin(a) * 36} y2={39 - Math.cos(a) * 36}
              stroke={on ? color : '#3a3f46'}
              strokeWidth={2.6}
              strokeLinecap="round"
              style={on ? { filter: `drop-shadow(0 0 2px ${color})` } : undefined}
            />
          );
        })}
      </svg>
      )}
      {oficina ? (
        // Oficina: o knob cinza-claro de risco escuro, o mesmo do pan dos canais (o anel fica)
        <div className="absolute" style={{ inset: 15 }}>
          <OfKnob value={pct * 2 - 1} className="w-full h-full" />
        </div>
      ) : estudio ? (
        // Estúdio: o knob cinza com o arco azul, o mesmo do pan dos canais
        <div className="absolute" style={{ inset: 8 }}>
          <EsKnob value={pct * 2 - 1} bipolar={false} className="w-full h-full" />
        </div>
      ) : grafite ? (
        // Grafite: o mesmo encoder com anel de LED dos canais do mixer (anel na cor do pad)
        <div className="absolute" style={{ inset: 6 }}>
          <GfKnob value={pct * 2 - 1} bipolar={false} color={color} className="w-full h-full" />
        </div>
      ) : (
      <div
        className="absolute rounded-full border border-black"
        style={{
          inset: 13,
          background: 'radial-gradient(circle at 38% 32%, #6b7079 0%, #3a3e45 45%, #1c1e22 100%)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.18)',
        }}
      >
        <div
          className="absolute rounded-full"
          style={{ inset: 7, background: 'repeating-conic-gradient(from 0deg, #2b2e33 0deg 6deg, #34373d 6deg 12deg)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.7)' }}
        />
        <div className="absolute left-1/2 top-1/2 w-[2px] h-[20px] -ml-px origin-bottom" style={{ transform: `translateY(-100%) rotate(${angle}deg)` }}>
          <div className="w-full h-[9px] rounded-full bg-[#f2eee4]" />
        </div>
      </div>
      )}
    </div>
  );
}

/** Saída dos pads, no estilo da saída dos canais do mixer. */
function OutputButton({ output }: { output: PadOutput }) {
  const count = useStore((s) => s.outputChannelCount);
  const [open, setOpen] = useState(false);
  const [stereo, setStereo] = useState(output.stereo);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const current = usablePadOutput(output, count);
  const missing = current.channel !== output.channel;

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 168)), bottom: window.innerHeight - r.top + 4 });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => { setStereo(output.stereo); setOpen(!open); }}
        className={`flex-1 min-w-0 h-7 px-2 text-[11px] font-mono bg-logic-lcd-bg border rounded-sm truncate text-left hover:border-logic-accent transition-colors ${
          missing ? 'text-logic-lcd-amber border-logic-lcd-amber/60' : 'text-logic-lcd-text border-logic-border-dark'}`}
        title={missing
          ? `A placa atual não tem a ${padOutputLabel(output)}: os pads saem no Master até você escolher outra.`
          : 'Saída dos pads na placa de áudio (Master segue o fader master do programa)'}
      >
        {padOutputLabel(current)}{missing ? ' ?' : ''}
      </button>
      {open && pos && createPortal(
        <div
          ref={list}
          className="fixed z-[999] w-40 max-h-[50vh] overflow-y-auto logic-scroll bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded text-[11px] animate-[fadeIn_120ms_ease-out]"
          style={{ left: pos.left, bottom: pos.bottom }}
        >
          <div className="sticky top-0 flex gap-0.5 p-1 bg-logic-bg-panel border-b border-logic-border-dark">
            {[false, true].map((sv) => (
              <button
                key={String(sv)}
                type="button"
                className={`flex-1 rounded-sm py-0.5 text-[10px] font-bold uppercase tracking-wide ${stereo === sv ? 'bg-logic-accent text-white' : 'text-logic-text-dim hover:text-logic-text'}`}
                onClick={() => setStereo(sv)}
              >
                {sv ? 'Estéreo' : 'Mono'}
              </button>
            ))}
          </div>
          {count <= 2 && (
            <p className="px-2 py-1.5 text-logic-text-muted leading-snug border-b border-logic-border-dark">
              Esta saída tem só 2 canais. Escolha uma interface com mais saídas em Dispositivo de Áudio.
            </p>
          )}
          {padOutputOptions(count, stereo).map((opt) => {
            const on = opt.channel === current.channel && (opt.channel === 0 || opt.stereo === current.stereo);
            return (
              <button
                key={`${opt.channel}-${opt.stereo}`}
                type="button"
                className={`w-full text-left px-2 py-1 hover:bg-logic-accent hover:text-white ${on ? 'text-logic-accent' : ''}`}
                onClick={() => { setPadsOutput(opt); setOpen(false); }}
              >
                {padOutputLabel(opt)}{opt.channel === 0 ? ' (1/2)' : ''}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

function Pad({ number, info, playing, selected, loading, dragOver, onPlay, onRelease, onPick, onEdit, onDragState, onDropFiles }: {
  number: number;
  info?: PadInfo;
  playing: boolean;
  selected: boolean;
  loading: boolean;
  dragOver: boolean;
  onPlay: () => void;
  /** Soltou o pad (modo segurar). */
  onRelease: () => void;
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

  if (!info || loading) {
    return (
      <button
        type="button"
        onClick={onPick}
        disabled={loading}
        className={`relative min-h-0 rounded-[7px] flex flex-col items-center justify-center gap-1 border-2 border-dashed transition-colors ${
          dragOver ? 'border-[#ffab1f] bg-[#ffab1f]/10' : selected ? 'border-white/40 bg-[#1d2024]' : 'border-white/12 bg-[#1a1d21] hover:border-white/25'}`}
        title={`Pad ${number}: clique ou arraste um WAV ou MP3`}
        {...drop}
      >
        <span className="absolute top-1.5 left-2 text-[11px] font-mono text-logic-text-muted">{number}</span>
        {loading ? <Loader2 size={16} className="animate-spin text-logic-lcd-amber" /> : <Plus size={16} className="text-logic-text-muted" />}
        <span className="text-[10.5px] text-logic-text-muted">{loading ? 'Carregando...' : 'Pôr som'}</span>
      </button>
    );
  }

  // pad aceso na cor dele: fraco parado, forte tocando
  const bg = playing
    ? `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${color} 55%, white) 0%, ${color} 42%, color-mix(in srgb, ${color} 70%, black) 100%)`
    : `radial-gradient(circle at 50% 45%, color-mix(in srgb, ${color} 62%, #15171a) 0%, color-mix(in srgb, ${color} 40%, #15171a) 55%, color-mix(in srgb, ${color} 22%, #0e0f11) 100%)`;
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        // soltar fora do pad também conta como soltar (modo segurar)
        e.currentTarget.setPointerCapture(e.pointerId);
        onPlay();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onKeyDown={(e) => { if (e.key === 'Enter') onPlay(); }}
      onContextMenu={(e) => { e.preventDefault(); onEdit(e.currentTarget); }}
      className="relative min-h-0 rounded-[7px] overflow-hidden text-left transition-[box-shadow,filter] duration-75 active:brightness-110"
      style={{
        background: bg,
        border: `1px solid ${playing ? color : 'rgba(0,0,0,0.85)'}`,
        boxShadow: [
          playing ? `0 0 22px ${color}aa` : '0 2px 4px rgba(0,0,0,0.6)',
          'inset 0 1px 0 rgba(255,255,255,0.22)',
          selected ? 'inset 0 0 0 2px rgba(255,255,255,0.85)' : '',
        ].filter(Boolean).join(', '),
      }}
      title={`${info.name} (tecla ${number}). Botão direito: nome, cor, trocar ou limpar`}
      aria-pressed={playing}
      {...drop}
    >
      {/* brilho de cima, como a capa de um pad */}
      <span className="absolute inset-x-0 top-0 h-1/2 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0))' }} />
      <span className={`absolute top-1.5 left-2 right-2 flex items-center gap-1.5 text-[11.5px] font-semibold leading-tight ${playing ? 'text-black/80' : 'text-white/90'}`}>
        <span className="font-mono opacity-80">{number}</span>
        <span className="truncate">{info.name}</span>
      </span>
      <span className={`absolute bottom-1.5 left-2 right-2 flex items-center gap-1 text-[10px] tabular-nums ${playing ? 'text-black/70' : 'text-white/65'}`}>
        {formatPadTime(pitchedDuration(info))}
        {info.loop && <Repeat size={10} aria-label="Loop" />}
        <span className="ml-auto flex gap-1">
          {info.reverb && <span>REV</span>}
          {info.delay && <span>DLY</span>}
          {info.reverse && <span>REV←</span>}
          {info.pitch !== 0 && <span>{pitchLabel(info.pitch)}</span>}
        </span>
      </span>
    </button>
  );
}

/** Botão direito no pad: nome, cor, trocar o som ou limpar. */
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

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 150;
    const left = Math.min(window.innerWidth - 248, Math.max(8, r.left));
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
      className="fixed z-[999] w-[240px] console-face rounded-lg border border-black shadow-[0_12px_40px_rgba(0,0,0,0.85)] p-2.5 flex flex-col gap-2.5 text-[11px] animate-[fadeIn_100ms_ease-out]"
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
        <span className="console-legend w-10">COR</span>
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

/**
 * Knobs de efeito (valem para todos os pads): quanto de reverb e de delay, a velocidade do loop
 * (roll de DJ, no tempo da música) e o filtro de DJ. Duplo clique volta ao padrão.
 */
function FxKnobs() {
  const fx = useSyncExternalStore(subscribePads, () => getPadsState().fx);
  return (
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Knobs de efeito dos pads">
      <FxKnob
        label="REVERB"
        value={fx.reverb}
        text={`${Math.round(fx.reverb * 100)}`}
        onChange={(v) => setPadsFx({ reverb: v })}
        onReset={() => setPadsFx({ reverb: DEFAULT_PAD_FX.reverb })}
        title="Quanto de reverb nos pads com REVERB ligado. Duplo clique: 50."
      />
      <FxKnob
        label="DELAY"
        value={fx.delay}
        text={`${Math.round(fx.delay * 100)}`}
        onChange={(v) => setPadsFx({ delay: v })}
        onReset={() => setPadsFx({ delay: DEFAULT_PAD_FX.delay })}
        title="Quanto de delay (e quantas repetições) nos pads com DELAY ligado. Duplo clique: 50."
      />
      <FxKnob
        label="ROLL"
        value={fx.roll}
        text={rollLabel(fx.roll)}
        onChange={(v) => setPadsFx({ roll: v })}
        onReset={() => setPadsFx({ roll: 0 })}
        title="Velocidade do loop: repete um pedaço do som no tempo da música, de 1 tempo até 1/64 (bem rápido, efeito de DJ). Todo para a esquerda desliga. Duplo clique: desliga."
      />
      <FxKnob
        label="FILTRO"
        value={fx.filter}
        bipolar
        text={filterLabel(fx.filter)}
        onChange={(v) => setPadsFx({ filter: v })}
        onReset={() => setPadsFx({ filter: 0 })}
        title="Filtro de DJ: para a esquerda abafa (só graves), para a direita afina (só agudos). No meio, sem filtro. Duplo clique: meio."
      />
    </div>
  );
}

function FxKnob({ label, value, bipolar, text, onChange, onReset, title }: {
  label: string;
  /** 0 a 1, ou -1 a 1 no bipolar. */
  value: number;
  bipolar?: boolean;
  text: string;
  onChange: (v: number) => void;
  onReset: () => void;
  title: string;
}) {
  const lo = bipolar ? -1 : 0;
  const clamp = (v: number) => Math.max(lo, Math.min(1, Math.round(v * 1000) / 1000));
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = e.clientY;
    let acc = value;
    const move = (ev: PointerEvent) => {
      acc = clamp(acc + ((last - ev.clientY) / 140) * (1 - lo) * (ev.shiftKey ? 0.1 : 1));
      last = ev.clientY;
      onChange(acc);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-0" title={title}>
      <div
        className="relative w-[38px] h-[38px] shrink-0 select-none cursor-ns-resize"
        style={{ touchAction: 'none' }}
        onPointerDown={down}
        onDoubleClick={onReset}
        onWheel={(e) => onChange(clamp(value - Math.sign(e.deltaY) * 0.02 * (1 - lo)))}
        role="slider"
        aria-label={label}
        aria-valuemin={lo}
        aria-valuemax={1}
        aria-valuenow={value}
        aria-valuetext={text}
      >
        <VsKnobFace value={bipolar ? (value + 1) / 2 : value} bipolar={bipolar} unity={2} />
      </div>
      <span className="console-legend leading-none">{label}</span>
      <span className="console-readout !min-w-0 w-full text-center text-logic-lcd-green text-[10px] leading-none py-[2px]">{text}</span>
    </div>
  );
}

