import { useEffect, useState, useRef, useMemo, useSyncExternalStore } from 'react';
import {
  Play, Square, Gauge, AudioWaveform, Headphones,
  X, Repeat, Layers, ListOrdered, Search, Music2, Speaker,
} from 'lucide-react';
import SegmentDisplay from '@/components/SegmentDisplay';
import { clockText, useSongRemaining } from '@/lib/useSongRemaining';
import { useStore } from '@/store';
import { startPlayback, stopPlayback } from '@/lib/transportControl';
import { formatTime, useShowTotals } from '@/components/ShowRundown';
import { currentAndNextSlice, paramsAt, sliceDuration } from '@/lib/medley';
import { effectiveBpm } from '@/lib/musicianApi';
import { songKeyLabel } from '@/lib/musicKey';
import MetaReadout from '@/components/MetaReadout';
import DiskLagNotice from '@/components/DiskLagNotice';
import {
  clockLabel, durationFor, getShowClock, parseShowDuration, remainingSec, resetShowClock,
  setShowDuration, showKeyOf, startShowClock, subscribeShowClock,
} from '@/lib/showClock';
import { audioEngine } from '@/lib/audioEngine';
import { getLiveProgressPct } from '@/lib/playProgress';
import type { PlayFlow, PlaylistEntry, Song } from '@/types';

const FLOWS: { id: PlayFlow; label: string; hint: string; icon: typeof Repeat }[] = [
  { id: 'continuo', label: 'Contínuo', hint: 'Toca a lista inteira, uma atrás da outra', icon: Repeat },
  { id: 'bloco', label: 'Por Bloco', hint: 'Para no fim de cada bloco', icon: Layers },
  { id: 'uma-uma', label: 'Uma a Uma', hint: 'Para no fim de cada música', icon: ListOrdered },
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// Nome curto da placa em uso: sem o "Default - " e sem o código USB do fim (ex.: "(1235:821d)").
export function interfaceName(label: string): string {
  const name = label.replace(/^Default\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return !name || name === 'default' ? 'Saída padrão' : name;
}

// Acesso discreto ao Dispositivo de Áudio sem sair do Modo Show.
function AudioDeviceButton() {
  const iface = useStore((s) => s.audioInterface);
  const connected = useStore((s) => s.audioInterfaceConnected);
  const outputs = useStore((s) => s.outputChannelCount);
  const name = connected ? interfaceName(iface ?? '') : 'Saída padrão';
  return (
    <button
      onClick={() => useStore.getState().setAudioDeviceDialogOpen(true)}
      className="console-key ml-auto flex items-center gap-1.5 min-w-0 max-w-[150px] h-7 px-2 text-[11px] font-semibold"
      title={`Dispositivo de Áudio: ${name} · ${outputs} saídas`}
    >
      <Speaker size={12} className="shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}

// Relógio que anda só enquanto `active` (o cronômetro do show redesenha 4× por segundo).
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

// Campo da duração do show (dois cliques no "Falta no show"). Enter ou sair do campo guarda;
// Esc cancela; vazio volta para a duração do próprio show.
function ShowDurationInput({ initial, onDone }: { initial: number; onDone: (sec: number | null | undefined) => void }) {
  const [text, setText] = useState(() => (initial > 0 ? clockLabel(initial) : ''));
  const [bad, setBad] = useState(false);
  // Esc seguido do "blur" do campo não pode guardar o que foi cancelado
  const finished = useRef(false);
  const finish = (v: number | null | undefined) => {
    if (finished.current) return;
    finished.current = true;
    onDone(v);
  };
  const read = (): number | null | undefined => {
    if (text.trim() === '') return null;
    const sec = parseShowDuration(text);
    return sec === null ? undefined : sec;
  };
  return (
    <input
      autoFocus
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => { setText(e.target.value); setBad(false); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(undefined); }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = read();
        if (v === undefined) setBad(true);
        else finish(v);
      }}
      onBlur={() => finish(read())}
      placeholder="h:mm"
      aria-label="Duração do show"
      title="Ex.: 2 (duas horas), 2:30, 90min. Vazio volta para a duração do show."
      className={`w-[104px] h-6 px-1 rounded bg-black/60 border text-center font-stage text-[15px] tabular-nums text-logic-lcd-amber outline-none ${
        bad ? 'border-logic-lcd-red' : 'border-logic-lcd-amber/60'
      }`}
    />
  );
}

// Totais do show em três displays de 7 segmentos, com o nome impresso embaixo.
// "Falta no show" é um cronômetro de parede (showClock): começa com a duração do show selecionado,
// conta a partir do Iniciar sem depender da música, e dois cliques trocam a duração.
function ShowTotalsSummary({ playlist, songs }: { playlist: PlaylistEntry[]; songs: Song[] }) {
  const { total } = useShowTotals(playlist, songs);
  const showKey = showKeyOf(useStore((s) => s.activeShowId));
  const clock = useSyncExternalStore(subscribeShowClock, getShowClock);
  const duration = durationFor(clock, showKey, total);
  const running = !!clock.run;
  const now = useNow(running);
  const left = clock.run ? remainingSec(clock.run, now) : duration;
  const over = running && left < 0;
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (!confirmReset) return;
    const id = window.setTimeout(() => setConfirmReset(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmReset]);

  const leftText = clockLabel(left);
  const onKey = () => {
    if (!running) { startShowClock(duration); return; }
    // zerar no meio do show pede um segundo clique (evita apagar a contagem sem querer)
    if (confirmReset) { resetShowClock(); setConfirmReset(false); } else setConfirmReset(true);
  };

  return (
    <div className="shrink-0">
      <div className="console-display grid grid-cols-3 divide-x divide-black/80">
        {[
          ['Músicas', String(playlist.length)],
          ['Duração do show', formatTime(total)],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-center py-2.5">
            <SegmentDisplay text={value} label={`${label}: ${value}`} className="h-6 text-logic-lcd-text" />
          </div>
        ))}
        <div
          className="flex justify-center py-2.5 cursor-pointer select-none"
          onDoubleClick={() => setEditing(true)}
          title={over ? 'O show passou do tempo. Dois cliques para mudar a duração.' : 'Dois cliques para mudar a duração do show'}
        >
          {editing ? (
            <ShowDurationInput
              initial={duration}
              onDone={(sec) => {
                setEditing(false);
                if (sec !== undefined) setShowDuration(showKey, sec, total);
              }}
            />
          ) : (
            <SegmentDisplay
              text={leftText}
              label={over ? `Passou ${leftText.slice(1)} do tempo do show` : `Falta no show: ${leftText}`}
              className={`h-6 ${over ? 'text-logic-lcd-red animate-pulse' : 'text-logic-lcd-amber'} ${running ? '' : 'opacity-80'}`}
            />
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 mt-1.5 items-start">
        <span className="console-legend text-center">Músicas</span>
        <span className="console-legend text-center">Duração do show</span>
        <div className="flex flex-col items-center gap-1">
          <span className="console-legend text-center">Falta no show</span>
          <button
            className={`console-key flex items-center gap-1 h-5 px-2 text-[10px] font-semibold leading-none ${confirmReset ? 'is-lit-amber' : ''}`}
            onClick={onKey}
            disabled={!running && !(duration > 0)}
            aria-pressed={running}
            title={running
              ? (confirmReset ? 'Clique de novo para zerar o cronômetro do show' : 'Zerar o cronômetro do show (pede confirmação)')
              : 'Iniciar a contagem do show. Trocar de música não mexe nela.'}
          >
            {running ? (
              <>
                <span className="console-led is-on-green" />
                {confirmReset ? 'CONFIRMA?' : 'ZERAR'}
              </>
            ) : (
              <>
                <Play size={9} fill="currentColor" />
                INICIAR
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Display grande "Restante da música", em 7 segmentos: verde, e vermelho nos últimos 15 s.
// O tempo vem do relógio do áudio; o React só redesenha uma vez por segundo.
function RemainingDisplay({ title }: { title: string }) {
  const left = useSongRemaining();
  const text = left === null ? '-:--' : `-${clockText(left)}`;
  const tone = left === null ? 'text-logic-text-muted' : left <= 15 ? 'text-logic-lcd-red' : 'text-logic-lcd-green';

  return (
    <div className="console-bezel">
      <div className="console-display px-5 pt-3 pb-4 text-center">
        <div className="console-legend">Restante da música</div>
        <div className="mt-3 flex justify-center">
          <SegmentDisplay
            text={text}
            label={left === null ? 'Sem música' : `Faltam ${clockText(left)}`}
            className={`h-[72px] xl:h-[84px] ${tone}`}
          />
        </div>
        <div className="console-glow mt-3 text-xl xl:text-2xl font-semibold leading-tight text-logic-lcd-text truncate" title={title}>{title}</div>
      </div>
    </div>
  );
}

// Barra contínua de alta taxa: escreve style.width direto no DOM em cada quadro (60fps),
// eliminando completamente o atraso, pulo ou efeito elástico de CSS transitions.
// Funciona como ampulheta com 100% de concordância entre Tocando e Próxima (inclusive em medleys).
function LiveProgressBar({
  tone,
  reverse = false,
}: {
  tone: 'green' | 'amber';
  reverse?: boolean;
  mode?: 'current' | 'next';
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const colorCls = tone === 'green' ? 'bg-logic-lcd-green' : 'bg-logic-lcd-amber';

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (barRef.current) {
        const pct = getLiveProgressPct();
        barRef.current.style.width = `${pct}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // barra de LEDs: a cor enche e as linhas escuras por cima recortam em segmentos
  return (
    <div className={`relative flex h-2 rounded-[1px] bg-white/[0.06] overflow-hidden ${reverse ? 'justify-end' : ''}`}>
      <div ref={barRef} className={`h-full ${colorCls} will-change-[width]`} style={{ width: '0%', boxShadow: '0 0 6px currentColor' }} />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 5px, #0c0e0d 5px 7px)' }} />
    </div>
  );
}

/**
 * Tom e BPM valendo numa música. `at`: 'live' = no ponto em que ela está tocando (num medley,
 * o da parte no ar); número = num ponto fixo (início da próxima música ou parte). Relê a cada
 * 0,4 s e quando a música muda (ajuste de BPM/tom, partes novas na timeline).
 */
function useSongMeta(song: Song | undefined, at: 'live' | number): { key: string; bpm: string } {
  const detected = useStore((s) => (song ? s.songKeys?.[song.id]?.key : undefined));
  const [params, setParams] = useState<{ bpmAdjust: number; tuner: number } | null>(null);
  useEffect(() => {
    if (!song) { setParams(null); return; }
    const read = () => {
      let t = typeof at === 'number' ? at : 0;
      if (at === 'live') {
        const st = useStore.getState();
        t = st.transport.isPlaying && audioEngine.isRunning() ? audioEngine.getCurrentTime() : st.transport.currentTime;
      }
      const p = paramsAt(song, t);
      setParams((prev) => (prev && prev.bpmAdjust === p.bpmAdjust && prev.tuner === p.tuner ? prev : { bpmAdjust: p.bpmAdjust, tuner: p.tuner }));
    };
    read();
    if (at !== 'live') return;
    const id = window.setInterval(read, 400);
    return () => window.clearInterval(id);
  }, [song, at]);
  if (!song) return { key: '', bpm: '' };
  const p = params ?? { bpmAdjust: song.bpmAdjust ?? 0, tuner: song.tuner ?? 0 };
  const bpm = effectiveBpm(song.bpm, song.bpmDetected, p.bpmAdjust);
  return { key: songKeyLabel({ musicKey: song.musicKey || detected, tuner: p.tuner }), bpm: bpm ? String(bpm) : '' };
}

function SongCard({
  label, name, tone, time, reverse = false, medley, mode, meta,
}: {
  label: string;
  name: string | null;
  tone: 'green' | 'amber';
  time?: string;
  reverse?: boolean;
  medley?: string;
  mode: 'current' | 'next';
  /** tom e BPM que valem nessa música (ou parte) */
  meta: { key: string; bpm: string };
}) {
  const text = tone === 'green' ? 'text-logic-lcd-green' : 'text-logic-lcd-amber';
  // Visor de vidro: o nome da música aceso na cor do estado (verde tocando, âmbar próxima)
  return (
    <div className={`console-display flex flex-col justify-between gap-1 min-w-0 h-[118px] px-3.5 py-2.5 ${name ? '' : 'opacity-70'}`}>
      <div className="flex items-center justify-between">
        <span className={`console-legend flex items-center gap-2 min-w-0 ${name ? `${text} opacity-80` : ''}`}>
          {label}
          {medley && <span className="px-1 rounded-[2px] border border-current text-[9px] leading-[12px] tracking-[0.14em]">MEDLEY</span>}
        </span>
        {time && <SegmentDisplay text={time} className="h-3 text-logic-lcd-text/70" ghost={false} />}
      </div>
      <div key={name ?? ''} className={`console-glow min-w-0 animate-[fadeIn_250ms_ease-out] ${name ? text : 'text-logic-text-muted'}`}>
        <div className={`text-[17px] font-semibold leading-tight ${medley ? 'truncate' : 'line-clamp-2'}`}>{name ?? '—'}</div>
        {medley && <div className="text-xs leading-tight truncate text-logic-text-dim">{medley}</div>}
      </div>
      <div className="flex items-center gap-3 min-h-[15px]">
        <MetaReadout label="Tom" value={name ? meta.key : ''} tone="text-logic-lcd-amber" />
        <MetaReadout label="BPM" value={name ? meta.bpm : ''} />
      </div>
      <div className={text}>
        <LiveProgressBar tone={tone} reverse={reverse} mode={mode} />
      </div>
    </div>
  );
}

export default function ShowModePanel({ showName }: { showName: string }) {
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const isStopped = useStore((s) => s.transport.isStopped);
  const currentSongId = useStore((s) => s.transport.currentSongId);
  const nextSongId = useStore((s) => s.transport.nextSongId);
  const playFlow = useStore((s) => s.transport.playFlow);
  const songs = useStore((s) => s.songs);
  const playlist = useStore((s) => s.playlist);
  const showBpmTower = useStore((s) => s.showBpmTower);
  const showTunerTower = useStore((s) => s.showTunerTower);
  const playbackError = useStore((s) => s.playbackError);
  const soloActive = useStore((s) => s.tracks.some((t) => t.solo));
  const { toggleBpmTower, toggleTunerTower, setPlayFlow, togglePlaylistMaximized, setPlaybackError, selectSong, setNextSong } = useStore.getState();
  const clock = useClock();
  const [searchQuery, setSearchQuery] = useState('');

  const active = !isStopped || isPlaying;
  const current = active ? songs.find((s) => s.id === currentSongId) : undefined;
  const next = playFlow !== 'uma-uma' ? songs.find((s) => s.id === nextSongId) : undefined;
  const slices = currentAndNextSlice(current, isPlaying && audioEngine.isRunning() ? audioEngine.getCurrentTime() : 0);
  const currentName = current ? slices.current?.name ?? current.name ?? null : null;
  const nextName = current && slices.next ? slices.next.name : next?.name ?? null;
  const nextTime = current && slices.next
    ? formatTime(sliceDuration(current, slices.next))
    : next
      ? formatTime(next.duration ?? 0)
      : undefined;
  const title = showName;
  const currentMeta = useSongMeta(current, 'live');
  // próxima: o tom/BPM com que ela começa (num medley, o da próxima parte)
  const nextMeta = useSongMeta(current && slices.next ? current : next, current && slices.next ? slices.next.start : 0);

  // Busca instantânea: acha rápido qualquer música do show sem precisar sair do Modo Show
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return (playlist ?? [])
      .map((entry, index) => ({ entry, song: songs.find((s) => s.id === entry.songId), index }))
      .filter(({ entry, song }) => entry?.name?.toLowerCase().includes(q) || song?.name?.toLowerCase().includes(q));
  }, [playlist, songs, searchQuery]);

  // teclas de mesa: as grandes para o transporte, as de liga/desliga com LED
  const bigKey = 'console-key is-big flex items-center justify-center gap-2 shrink-0 text-[15px]';
  const ledKey = (on: boolean) => `${bigKey} h-11 text-[13px] ${on ? '!text-logic-text' : ''}`;

  return (
    <aside className="console-face console-screws relative flex flex-col w-[380px] xl:w-[440px] shrink-0 h-full border-l-2 border-black overflow-hidden animate-[fadeIn_200ms_ease-out]">
      <DiskLagNotice className="absolute right-3 top-[54px] z-30" />
      <div className="console-rail flex items-center gap-2 px-4 h-12 shrink-0">
        <span className={`console-lamp shrink-0 ${isPlaying ? 'is-on' : ''}`} title={isPlaying ? 'No ar: o show está tocando' : 'Parado'} />
        <span className="font-stage text-[15px] font-semibold tracking-wide text-logic-text shrink-0">Modo show</span>
        <AudioDeviceButton />
        <span className="console-display ml-2 flex items-center h-7 px-2 shrink-0" title="Hora certa">
          <SegmentDisplay text={clock} label={`Hora: ${clock}`} className="h-4 text-logic-lcd-amber" />
        </span>
        <button
          onClick={togglePlaylistMaximized}
          className="console-key ml-2 flex items-center gap-1.5 h-8 px-3 text-[13px] shrink-0 hover:!bg-logic-lcd-red hover:!text-black"
          title="Sair do modo show (Esc ou ⌘M)"
        >
          <X size={14} /> Sair
        </button>
      </div>

      <div className="relative mx-4 mt-3 shrink-0">
        <div className="console-well flex items-center gap-2 px-3 h-9 !rounded-[4px] ring-1 ring-transparent focus-within:ring-logic-accent transition-shadow">
          <Search size={14} className="text-logic-text-muted shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar música do show..."
            className="flex-1 min-w-0 bg-transparent text-xs text-logic-text placeholder:text-logic-text-muted outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-logic-text-muted hover:text-white p-0.5 rounded flex-shrink-0" aria-label="Limpar busca">
              <X size={12} />
            </button>
          )}
        </div>
        {searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-1 z-40 max-h-64 overflow-y-auto logic-scroll rounded-lg border border-logic-border-light bg-logic-bg-panel shadow-logic-raised">
            {searchResults.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-logic-text-muted">
                <Music2 size={14} className="opacity-40" /> Nenhuma música encontrada
              </div>
            ) : (
              searchResults.map(({ entry, song, index }) => (
                <button
                  key={entry.songId}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-logic-bg-panel-light transition-colors border-b border-logic-border-dark/60 last:border-b-0"
                  onClick={() => {
                    selectSong(entry.songId);
                    if (playFlow !== 'uma-uma' && !isPlaying) setNextSong(entry.songId);
                    setSearchQuery('');
                  }}
                  title={isPlaying ? 'Selecionar esta música (defina como Próxima na playlist para entrar na sequência)' : 'Selecionar esta música'}
                >
                  <span className="text-2xs font-mono text-logic-text-muted w-5 flex-shrink-0">{index + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-logic-text">{entry.name}</span>
                  {song && <span className="text-2xs font-mono text-logic-text-muted flex-shrink-0">{formatTime(song.duration ?? 0)}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {playbackError && (
        <div role="alert" className="flex items-center gap-3 mx-4 mt-3 px-3 py-2 rounded-md border border-logic-lcd-red/60 bg-logic-lcd-red/10 text-xs text-logic-text">
          <span className="flex-1">{playbackError}</span>
          <button onClick={() => setPlaybackError(null)} className="font-semibold text-logic-text-dim hover:text-logic-text">OK</button>
        </div>
      )}

      <div className="flex flex-col flex-1 min-h-0 gap-3 p-4 overflow-y-auto logic-scroll">
        {soloActive && (
          <div role="status" className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-logic-lcd-amber/60 bg-logic-lcd-amber/10 text-xs font-semibold text-logic-lcd-amber">
            <Headphones size={14} /> Solo ativo: só as faixas em solo estão tocando
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Tocar: acende verde enquanto o show toca */}
          <button
            className={`${bigKey} h-14 ${isPlaying ? 'is-lit-green' : '!text-logic-lcd-green'}`}
            onClick={startPlayback}
            disabled={isPlaying}
            title={isPlaying ? 'Já está tocando. Para trocar de música, dê Stop, escolha outra e toque' : 'Tocar (Espaço)'}
            aria-label="Tocar"
          >
            <Play size={22} fill="currentColor" /> Tocar
          </button>
          <button className={`${bigKey} h-14 !text-logic-text`} onClick={stopPlayback} title="Parar (Esc)" aria-label="Parar">
            <Square size={18} fill="currentColor" /> Parar
          </button>
        </div>

        <div>
          <div className="console-legend mb-1.5">Fluxo do show</div>
          {/* teclas de escolha única: a do fluxo em uso fica acesa */}
          <div className="grid grid-cols-3 gap-1.5">
            {FLOWS.map((f) => {
              const on = playFlow === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setPlayFlow(f.id)}
                  title={f.hint}
                  aria-pressed={on}
                  className={`console-key flex items-center justify-center gap-1.5 h-10 text-[13px] ${on ? 'is-lit-blue' : ''}`}
                >
                  <f.icon size={14} /> {f.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <button className={ledKey(showBpmTower)} onClick={toggleBpmTower} aria-pressed={showBpmTower} title="Mostrar/ocultar o ajuste de BPM em cada música">
            <span className={`console-led ${showBpmTower ? 'is-on-amber' : ''}`} />
            <Gauge size={16} /> BPM
          </button>
          <button className={ledKey(showTunerTower)} onClick={toggleTunerTower} aria-pressed={showTunerTower} title="Mostrar/ocultar o ajuste de tom em cada música">
            <span className={`console-led ${showTunerTower ? 'is-on-amber' : ''}`} />
            <AudioWaveform size={16} /> Tuner
          </button>
        </div>

        <div className="flex flex-col justify-center gap-3 flex-1">
          <RemainingDisplay title={title} />

          <div className="grid grid-cols-2 gap-3">
            <SongCard
              label="Tocando"
              name={currentName}
              medley={slices.current ? current?.name : undefined}
              tone="green"
              time={current ? formatTime(current.duration) : undefined}
              mode="current"
              meta={currentMeta}
            />
            <SongCard
              label="Próxima"
              name={nextName}
              medley={slices.next ? current?.name : undefined}
              tone="amber"
              reverse
              time={nextTime}
              mode="next"
              meta={nextMeta}
            />
          </div>
        </div>

        <ShowTotalsSummary playlist={playlist} songs={songs} />

      </div>
    </aside>
  );
}
