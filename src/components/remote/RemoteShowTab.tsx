// Aba "Show" do VS Stage Remote: o painel do Modo Show do programa, em pé para o celular.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioWaveform, Gauge, Headphones, Layers, ListOrdered, Music2, Play, Repeat, Search, SkipForward, Speaker, X } from 'lucide-react';
import SegmentDisplay from '@/components/SegmentDisplay';
import MetaReadout from '@/components/MetaReadout';
import { formatTime } from '@/components/ShowRundown';
import { clockText } from '@/lib/useSongRemaining';
import { clockLabel, parseShowDuration, remainingSec } from '@/lib/showClock';
import { regionAt } from '@/lib/regions';
import { liveProgressPct, liveRemaining, livePos, type RemoteCard, type RemoteCommand, type RemoteState } from '@/lib/remoteProtocol';
import type { PlayFlow } from '@/types';

type Send = (cmd: RemoteCommand) => void;

const FLOWS: { id: PlayFlow; label: string; icon: typeof Repeat }[] = [
  { id: 'continuo', label: 'Contínuo', icon: Repeat },
  { id: 'bloco', label: 'Por Bloco', icon: Layers },
  { id: 'uma-uma', label: 'Uma a Uma', icon: ListOrdered },
];

/** Redesenha a cada `ms` (o tempo anda no celular entre uma mensagem e outra). */
function useTick(ms: number, active = true) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

/** Barra de LEDs que enche no ritmo da música (escreve direto no DOM a cada quadro). */
function LiveBar({ state, macNow, tone, reverse = false }: { state: RemoteState; macNow: () => number; tone: 'green' | 'amber'; reverse?: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (barRef.current) barRef.current.style.width = `${liveProgressPct(stateRef.current, macNow())}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [macNow]);
  return (
    <div className={`relative flex h-2 rounded-[1px] bg-white/[0.06] overflow-hidden ${reverse ? 'justify-end' : ''}`}>
      <div ref={barRef} className={`h-full ${tone === 'green' ? 'bg-logic-lcd-green' : 'bg-logic-lcd-amber'}`} style={{ width: '0%', boxShadow: '0 0 6px currentColor' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 5px, #0c0e0d 5px 7px)' }} />
    </div>
  );
}

function SongCard({ label, card, tone, state, macNow, reverse = false }: {
  label: string; card: RemoteCard | null; tone: 'green' | 'amber'; state: RemoteState; macNow: () => number; reverse?: boolean;
}) {
  const text = tone === 'green' ? 'text-logic-lcd-green' : 'text-logic-lcd-amber';
  return (
    <div className={`console-display flex flex-col gap-1.5 min-w-0 px-3.5 py-2.5 ${card ? '' : 'opacity-70'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`console-legend flex items-center gap-2 min-w-0 ${card ? `${text} opacity-80` : ''}`}>
          {label}
          {card?.medley && <span className="px-1 rounded-[2px] border border-current text-[9px] leading-[12px] tracking-[0.14em]">MEDLEY</span>}
        </span>
        {card && <SegmentDisplay text={formatTime(card.duration)} className="h-3 text-logic-lcd-text/70" ghost={false} />}
      </div>
      <div key={card?.name ?? ''} className={`console-glow min-w-0 animate-[fadeIn_250ms_ease-out] ${card ? text : 'text-logic-text-muted'}`}>
        <div className={`text-[19px] font-semibold leading-tight ${card?.medley ? 'truncate' : 'line-clamp-2'}`}>{card?.name ?? '—'}</div>
        {card?.medley && <div className="text-xs leading-tight truncate text-logic-text-dim">{card.medley}</div>}
      </div>
      <div className="flex items-center gap-3 min-h-[15px]">
        <MetaReadout label="Tom" value={card?.key ?? ''} tone="text-logic-lcd-amber" />
        <MetaReadout label="BPM" value={card?.bpm ?? ''} />
      </div>
      <div className={text}>
        <LiveBar state={state} macNow={macNow} tone={tone} reverse={reverse} />
      </div>
    </div>
  );
}

function RemainingDisplay({ state, macNow }: { state: RemoteState; macNow: () => number }) {
  useTick(250, state.playing);
  const left = liveRemaining(state, macNow());
  const shown = left === null ? null : Math.round(left);
  const text = shown === null ? '-:--' : `-${clockText(shown)}`;
  const tone = shown === null ? 'text-logic-text-muted' : shown <= 15 ? 'text-logic-lcd-red' : 'text-logic-lcd-green';
  return (
    <div className="console-bezel">
      <div className="console-display px-4 pt-3 pb-4 text-center">
        <div className="console-legend">Restante da música</div>
        <div className="mt-3 flex justify-center">
          <SegmentDisplay text={text} label={shown === null ? 'Sem música' : `Faltam ${clockText(shown)}`} className={`h-[68px] ${tone}`} />
        </div>
        <div className="console-glow mt-3 text-xl font-semibold leading-tight text-logic-lcd-text truncate">{state.showName}</div>
      </div>
    </div>
  );
}

/** Partes da música no ar: ir para a parte, loop, repetições e pular (como os pads do Modo Show). */
function SectionPads({ state, macNow, send }: { state: RemoteState; macNow: () => number; send: Send }) {
  useTick(500, state.playing);
  const song = state.songs.find((s) => s.id === state.currentId);
  if (!state.active || !song || song.regions.length === 0) return null;
  const pos = livePos(state, macNow());
  const active = regionAt(song.regions.map((r) => ({ ...r, repeat: r.repeat ?? undefined })), pos);
  const idx = active ? song.regions.findIndex((r) => r.id === active.id) : -1;
  const following = active ? song.regions[idx + 1] ?? null : song.regions.find((r) => r.start > pos) ?? null;
  const queuedId = state.queued?.songId === song.id ? state.queued.regionId : null;
  const skipping = !!following && queuedId === following.id;
  return (
    <div>
      <div className="console-legend mb-1.5">Partes da música</div>
      <div className="grid grid-cols-2 gap-2">
        {song.regions.map((r) => {
          const isActive = active?.id === r.id;
          const isQueued = queuedId === r.id;
          return (
            <div
              key={r.id}
              className={`console-pad relative flex items-stretch h-14 overflow-hidden ${isActive ? 'is-active' : ''} ${isQueued ? 'is-queued' : ''}`}
              style={{ ['--pad-color' as string]: r.color }}
            >
              <span className="w-1.5 shrink-0" style={{ backgroundColor: r.color, boxShadow: isActive ? `0 0 8px ${r.color}` : undefined }} />
              <button
                className="flex-1 min-w-0 flex flex-col justify-center items-start pl-2.5 pr-1 text-left"
                onClick={() => send({ action: 'section', songId: song.id, regionId: r.id })}
              >
                <span className="text-sm font-semibold truncate max-w-full text-logic-text">{r.name}</span>
                <span className="text-2xs font-medium uppercase tracking-[0.12em] h-3.5">
                  {isQueued && <span className="text-logic-lcd-amber animate-[sectionQueued_900ms_ease-in-out_infinite]">Próxima</span>}
                  {isActive && !isQueued && <span className="text-logic-lcd-green">No ar</span>}
                </span>
              </button>
              <div className="flex flex-col items-center justify-center gap-0.5 pr-1.5">
                <button
                  className={`console-key w-9 h-7 flex items-center justify-center ${r.loop ? 'is-lit-green' : ''}`}
                  onClick={() => send({ action: 'regionLoop', songId: song.id, regionId: r.id })}
                  aria-pressed={r.loop}
                  aria-label={r.loop ? 'Desligar loop' : 'Ligar loop'}
                >
                  <Repeat size={14} strokeWidth={2.5} />
                </button>
                {r.loop && (
                  <button
                    className="w-9 h-4 rounded text-2xs font-semibold leading-none text-logic-lcd-green"
                    onClick={() => send({ action: 'regionRepeat', songId: song.id, regionId: r.id })}
                  >
                    {r.repeat ? `${r.repeat}x` : '∞'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <button
          className={`console-pad flex flex-col items-center justify-center gap-0.5 h-14 px-3 ${!following ? 'opacity-50' : skipping ? 'is-queued text-logic-lcd-amber' : 'text-logic-text'}`}
          onClick={() => send({ action: 'skipSection', songId: song.id })}
          disabled={!following}
          aria-pressed={skipping}
        >
          <span className="flex items-center gap-1.5 text-sm font-semibold"><SkipForward size={14} /> Pular</span>
          <span className="text-2xs font-medium uppercase tracking-[0.12em] h-3.5 truncate max-w-full text-logic-text-muted">
            {following ? (skipping ? 'Na sequência' : following.name) : ''}
          </span>
        </button>
      </div>
    </div>
  );
}

function DurationInput({ initial, onDone }: { initial: number; onDone: (sec: number | null | undefined) => void }) {
  const [text, setText] = useState(() => (initial > 0 ? clockLabel(initial) : ''));
  const [bad, setBad] = useState(false);
  const read = (): number | null | undefined => {
    if (text.trim() === '') return null;
    const sec = parseShowDuration(text);
    return sec === null ? undefined : sec;
  };
  const save = () => {
    const v = read();
    if (v === undefined) setBad(true);
    else onDone(v);
  };
  return (
    <div className="flex flex-col items-center gap-1.5">
      <input
        autoFocus
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setText(e.target.value); setBad(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onDone(undefined); }}
        placeholder="h:mm"
        aria-label="Duração do show"
        className={`w-[110px] h-9 px-1 rounded bg-black/60 border text-center font-stage text-[17px] tabular-nums text-logic-lcd-amber outline-none ${bad ? 'border-logic-lcd-red' : 'border-logic-lcd-amber/60'}`}
      />
      <div className="flex gap-1.5">
        <button className="console-key h-8 px-3 text-[12px]" onClick={() => onDone(undefined)}>Cancelar</button>
        <button className="console-key is-lit-amber h-8 px-3 text-[12px]" onClick={save}>OK</button>
      </div>
    </div>
  );
}

/** Totais do show, com o cronômetro "Falta no show" do Mac. */
function ShowTotals({ state, macNow, send }: { state: RemoteState; macNow: () => number; send: Send }) {
  const run = state.clock.run;
  useTick(250, !!run);
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const id = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmReset]);
  const left = run ? remainingSec(run, macNow()) : state.clock.duration;
  const over = !!run && left < 0;
  const leftText = clockLabel(left);
  const onKey = () => {
    if (!run) { send({ action: 'clockStart' }); return; }
    if (confirmReset) { send({ action: 'clockReset' }); setConfirmReset(false); } else setConfirmReset(true);
  };
  return (
    <div>
      <div className="console-display grid grid-cols-3 divide-x divide-black/80">
        <div className="flex justify-center py-2.5"><SegmentDisplay text={String(state.songs.length)} className="h-5 text-logic-lcd-text" /></div>
        <div className="flex justify-center py-2.5"><SegmentDisplay text={formatTime(state.total)} className="h-5 text-logic-lcd-text" /></div>
        <button
          className="flex justify-center py-2.5"
          onClick={() => setEditing(true)}
          aria-label="Mudar a duração do show"
        >
          <SegmentDisplay
            text={leftText}
            label={over ? `Passou ${leftText.slice(1)} do tempo do show` : `Falta no show: ${leftText}`}
            className={`h-5 ${over ? 'text-logic-lcd-red animate-pulse' : 'text-logic-lcd-amber'} ${run ? '' : 'opacity-80'}`}
          />
        </button>
      </div>
      <div className="grid grid-cols-3 mt-1.5 items-start">
        <span className="console-legend text-center">Músicas</span>
        <span className="console-legend text-center">Duração do show</span>
        <div className="flex flex-col items-center gap-1.5">
          <span className="console-legend text-center">Falta no show</span>
          <button
            className={`console-key flex items-center gap-1 h-8 px-3 text-[11px] font-semibold leading-none ${confirmReset ? 'is-lit-amber' : ''}`}
            onClick={onKey}
            disabled={!run && !(state.clock.duration > 0)}
            aria-pressed={!!run}
          >
            {run ? (<><span className="console-led is-on-green" />{confirmReset ? 'CONFIRMA?' : 'ZERAR'}</>) : (<><Play size={10} fill="currentColor" />INICIAR</>)}
          </button>
        </div>
      </div>
      {editing && (
        <div className="console-well mt-3 p-3 flex flex-col items-center gap-1">
          <span className="console-legend">Duração do show (ex.: 2, 2:30, 90min). Vazio volta para a do show.</span>
          <DurationInput
            initial={state.clock.duration}
            onDone={(sec) => {
              setEditing(false);
              if (sec !== undefined) send({ action: 'clockDuration', sec });
            }}
          />
        </div>
      )}
    </div>
  );
}

function ShowSearch({ state, send }: { state: RemoteState; send: Send }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return state.songs.map((s, index) => ({ s, index })).filter(({ s }) => s.name.toLowerCase().includes(t));
  }, [q, state.songs]);
  return (
    <div className="relative">
      <div className="console-well flex items-center gap-2 px-3 h-11 !rounded-[4px] ring-1 ring-transparent focus-within:ring-logic-accent">
        <Search size={15} className="text-logic-text-muted shrink-0" />
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Pesquisar música do show..."
          className="flex-1 min-w-0 bg-transparent text-[15px] text-logic-text placeholder:text-logic-text-muted outline-none"
        />
        {q && (
          <button onClick={() => setQ('')} className="text-logic-text-muted p-1" aria-label="Limpar busca"><X size={14} /></button>
        )}
      </div>
      {q.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 max-h-72 overflow-y-auto logic-scroll rounded-lg border border-logic-border-light bg-logic-bg-panel shadow-logic-raised">
          {results.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-logic-text-muted"><Music2 size={14} className="opacity-40" /> Nenhuma música encontrada</div>
          ) : results.map(({ s, index }) => (
            <button
              key={s.id}
              className="w-full flex items-center gap-2 px-3 min-h-[44px] text-left border-b border-logic-border-dark/60 last:border-b-0 active:bg-logic-bg-panel-light"
              onClick={() => { send({ action: 'pick', songId: s.id }); setQ(''); }}
            >
              <span className="text-xs font-mono text-logic-text-muted w-6 shrink-0">{index + 1}</span>
              <span className="flex-1 min-w-0 truncate text-[15px] text-logic-text">{s.name}</span>
              <span className="text-xs font-mono text-logic-text-muted shrink-0">{formatTime(s.duration)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RemoteShowTab({ state, macNow, send }: { state: RemoteState; macNow: () => number; send: Send }) {
  const ledKey = (on: boolean) => `console-key is-big flex items-center justify-center gap-2 h-12 text-[14px] ${on ? '!text-logic-text' : ''}`;
  return (
    <div className="flex flex-col gap-3.5 p-4">
      <ShowSearch state={state} send={send} />

      {state.error && (
        <div role="alert" className="flex items-center gap-3 px-3 py-2 rounded-md border border-logic-lcd-red/60 bg-logic-lcd-red/10 text-sm text-logic-text">
          <span className="flex-1">{state.error}</span>
          <button onClick={() => send({ action: 'dismissError' })} className="console-key h-9 px-3 text-[13px]">OK</button>
        </div>
      )}
      {state.soloActive && (
        <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-md border border-logic-lcd-amber/60 bg-logic-lcd-amber/10 text-sm font-semibold text-logic-lcd-amber">
          <Headphones size={15} /> Solo ativo: só as faixas em solo estão tocando
        </div>
      )}
      {state.diskLag.length > 0 && (
        <div role="status" className="console-display flex items-center gap-2 px-3 py-2">
          <span className="console-led is-on-amber animate-pulse shrink-0" />
          <span className="console-legend !text-logic-lcd-amber uppercase shrink-0">Disco atrasado</span>
          <span className="min-w-0 truncate text-xs text-logic-text-dim">{state.diskLag.join(', ')}</span>
        </div>
      )}

      <RemainingDisplay state={state} macNow={macNow} />
      <SongCard label="Tocando" card={state.current} tone="green" state={state} macNow={macNow} />
      <SongCard label="Próxima" card={state.next} tone="amber" state={state} macNow={macNow} reverse />

      <SectionPads state={state} macNow={macNow} send={send} />

      <div>
        <div className="console-legend mb-1.5">Fluxo do show</div>
        <div className="grid grid-cols-3 gap-1.5">
          {FLOWS.map((f) => {
            const on = state.flow === f.id;
            return (
              <button
                key={f.id}
                onClick={() => send({ action: 'flow', flow: f.id })}
                aria-pressed={on}
                className={`console-key flex items-center justify-center gap-1.5 h-12 text-[13px] ${on ? 'is-lit-blue' : ''}`}
              >
                <f.icon size={14} /> {f.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button className={ledKey(state.towers.bpm)} onClick={() => send({ action: 'towerBpm' })} aria-pressed={state.towers.bpm}>
          <span className={`console-led ${state.towers.bpm ? 'is-on-amber' : ''}`} /><Gauge size={16} /> BPM
        </button>
        <button className={ledKey(state.towers.tuner)} onClick={() => send({ action: 'towerTuner' })} aria-pressed={state.towers.tuner}>
          <span className={`console-led ${state.towers.tuner ? 'is-on-amber' : ''}`} /><AudioWaveform size={16} /> Tuner
        </button>
      </div>

      <ShowTotals state={state} macNow={macNow} send={send} />

      <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-logic-text-muted">
        <Speaker size={12} /> {state.audio} · {state.outputs} saídas
      </div>
    </div>
  );
}
