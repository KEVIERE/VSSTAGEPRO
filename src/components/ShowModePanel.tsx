import { useEffect, useState } from 'react';
import {
  Play, Square, Gauge, AudioWaveform, Loader2, Headphones,
  X, Radio, Repeat, Layers, ListOrdered,
} from 'lucide-react';
import { useStore } from '@/store';
import { startPlayback, stopPlayback } from '@/lib/transportControl';
import { formatTime, useShowTotals } from '@/components/ShowRundown';
import { currentAndNextSlice, sliceDuration } from '@/lib/medley';
import type { PlayFlow } from '@/types';

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
  return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function SongCard({ label, name, tone, progress, time, reverse = false, medley }: {
  label: string; name: string | null; tone: 'green' | 'amber'; progress: number; time?: string; reverse?: boolean; medley?: string;
}) {
  const c = tone === 'green'
    ? { border: 'border-logic-lcd-green/50', bg: 'bg-logic-lcd-green/[0.08]', text: 'text-logic-lcd-green', bar: 'bg-logic-lcd-green' }
    : { border: 'border-logic-lcd-amber/50', bg: 'bg-logic-lcd-amber/[0.08]', text: 'text-logic-lcd-amber', bar: 'bg-logic-lcd-amber' };
  return (
    <div className={`flex flex-col justify-between min-w-0 h-[92px] rounded-lg border px-4 py-2.5 transition-colors duration-300 ${name ? `${c.border} ${c.bg}` : 'border-logic-border-dark bg-logic-bg-deep'}`}>
      <div className="flex items-center justify-between text-2xs font-semibold uppercase tracking-[0.16em]">
        <span className={`flex items-center gap-2 min-w-0 ${name ? c.text : 'text-logic-text-muted'}`}>
          {label}
          {medley && <span className="px-1 rounded-[3px] border border-current text-[9px] leading-[12px] tracking-[0.14em] opacity-80">MEDLEY</span>}
        </span>
        {time && <span className="tabular-nums text-logic-text-dim">{time}</span>}
      </div>
      <div key={name ?? ''} className={`min-w-0 animate-[fadeIn_250ms_ease-out] ${name ? c.text : 'text-logic-text-muted'}`}>
        <div className={`text-base font-semibold leading-tight ${medley ? 'truncate' : 'line-clamp-2'}`}>{name ?? '—'}</div>
        {medley && <div className="text-xs leading-tight truncate text-logic-text-dim">{medley}</div>}
      </div>
      <div className={`flex h-1.5 rounded-full bg-black/40 overflow-hidden ${reverse ? 'justify-end' : ''}`}>
        <div className={`h-full ${c.bar} transition-[width] duration-200 ease-linear`} style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
      </div>
    </div>
  );
}

export default function ShowModePanel({ showName }: { showName: string }) {
  const transport = useStore((s) => s.transport);
  const songs = useStore((s) => s.songs);
  const playlist = useStore((s) => s.playlist);
  const showBpmTower = useStore((s) => s.showBpmTower);
  const showTunerTower = useStore((s) => s.showTunerTower);
  const playbackError = useStore((s) => s.playbackError);
  const isLoading = useStore((s) => {
    const id = s.transport.currentSongId ?? s.selectedSongId;
    return !!id && s.loadingSongIds.includes(id);
  });
  const soloActive = useStore((s) => s.tracks.some((t) => t.solo));
  const { toggleBpmTower, toggleTunerTower, setPlayFlow, togglePlaylistMaximized, setPlaybackError } = useStore.getState();
  const { total, remaining } = useShowTotals(playlist, songs);
  const clock = useClock();

  const active = !transport.isStopped || transport.isPlaying;
  const current = active ? songs.find((s) => s.id === transport.currentSongId) : undefined;
  const next = transport.playFlow !== 'uma-uma' ? songs.find((s) => s.id === transport.nextSongId) : undefined;
  const songLeft = current ? Math.max(0, current.duration - transport.currentTime) : 0;
  const nextProgress = current && current.duration > 0 && transport.nextSongCountdown > 0
    ? 1 - transport.nextSongCountdown / current.duration : 0;
  const slices = currentAndNextSlice(current, transport.currentTime);
  const currentName = current ? slices.current?.name ?? current.name : null;
  const nextName = current && slices.next ? slices.next.name : next?.name ?? null;
  const nextTime = current && slices.next ? formatTime(sliceDuration(current, slices.next)) : next ? formatTime(next.duration) : undefined;
  const title = showName;

  const bigBtn = 'flex items-center justify-center h-12 shrink-0 rounded-lg border transition-all duration-150 active:scale-[0.96]';
  const neutral = 'bg-logic-bg-elevated border-logic-border-light text-logic-text hover:bg-logic-bg-panel-light';
  const toggle = (on: boolean) => `${bigBtn} gap-2 text-xs font-semibold uppercase tracking-[0.12em] ${on
    ? 'bg-logic-lcd-amber/15 border-logic-lcd-amber/70 text-logic-lcd-amber'
    : 'bg-logic-bg-elevated border-logic-border-light text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light'}`;

  return (
    <aside className="relative flex flex-col w-[380px] xl:w-[440px] shrink-0 h-full bg-logic-bg-panel border-l border-logic-border-dark overflow-hidden animate-[fadeIn_200ms_ease-out]">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-logic-border-dark bg-logic-bg-deep shrink-0">
        <Radio size={14} className={transport.isPlaying ? 'text-logic-lcd-green animate-pulse' : 'text-logic-text-muted'} />
        <span className="text-2xs font-semibold uppercase tracking-[0.18em] text-logic-text-dim">Modo show</span>
        <span className="ml-auto text-sm font-semibold tabular-nums text-logic-text-dim">{clock}</span>
        <button
          onClick={togglePlaylistMaximized}
          className="ml-3 flex items-center gap-1.5 h-8 px-3 rounded-md border border-logic-border-light bg-logic-bg-elevated text-xs font-semibold text-logic-text hover:bg-logic-lcd-red hover:border-logic-lcd-red hover:text-white transition-colors"
          title="Sair do modo show (Esc)"
        >
          <X size={14} /> Sair
        </button>
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
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`${bigBtn} disabled:pointer-events-none ${transport.isPlaying ? 'bg-logic-lcd-green/25 border-logic-lcd-green text-logic-lcd-green opacity-60' : 'bg-logic-lcd-green/15 border-logic-lcd-green/70 text-logic-lcd-green hover:bg-logic-lcd-green/25'}`}
            onClick={startPlayback}
            disabled={transport.isPlaying}
            title={transport.isPlaying ? 'Já está tocando. Para trocar de música, dê Stop, escolha outra e toque' : 'Tocar (Espaço)'}
            aria-label="Tocar"
          >
            {isLoading && transport.isPlaying
              ? <Loader2 size={20} className="animate-spin" aria-label="Carregando" />
              : <Play size={22} fill="currentColor" />}
          </button>
          <button className={`${bigBtn} ${neutral}`} onClick={stopPlayback} title="Parar (Esc)" aria-label="Parar">
            <Square size={20} fill="currentColor" />
          </button>
        </div>

        <div>
          <div className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-logic-text-muted">Fluxo do show</div>
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-logic-bg-deep border border-logic-border-dark">
            {FLOWS.map((f) => {
              const on = transport.playFlow === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setPlayFlow(f.id)}
                  title={f.hint}
                  aria-pressed={on}
                  className={`flex items-center justify-center gap-1.5 h-10 rounded-md text-xs font-semibold transition-all duration-150 ${on ? 'bg-logic-accent text-white shadow' : 'text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-elevated'}`}
                >
                  <f.icon size={14} /> {f.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className={toggle(showBpmTower)} onClick={toggleBpmTower} aria-pressed={showBpmTower} title="Mostrar/ocultar o ajuste de BPM em cada música">
            <Gauge size={16} /> BPM
          </button>
          <button className={toggle(showTunerTower)} onClick={toggleTunerTower} aria-pressed={showTunerTower} title="Mostrar/ocultar o ajuste de tom em cada música">
            <AudioWaveform size={16} /> Tuner
          </button>
        </div>

        <div className="flex flex-col justify-center gap-3 flex-1">
        <div className="rounded-xl border border-logic-border-dark bg-black px-6 py-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-logic-text-muted">Restante da música</div>
          <div className={`mt-2 font-mono text-6xl xl:text-7xl font-semibold leading-none tabular-nums ${current ? (songLeft <= 15 ? 'text-logic-lcd-red' : 'text-logic-lcd-green') : 'text-logic-text-muted/50'}`}>
            {current ? `-${formatTime(songLeft)}` : '--:--'}
          </div>
          <div className="mt-3 text-xl xl:text-2xl font-semibold leading-tight text-logic-text truncate" title={title}>{title}</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SongCard label="Tocando" name={currentName} medley={slices.current ? current?.name : undefined} tone="green" progress={current ? transport.songProgress : 0} time={current ? formatTime(current.duration) : undefined} />
          <SongCard label="Próxima" name={nextName} medley={slices.next ? current?.name : undefined} tone="amber" reverse progress={slices.next ? 0 : nextProgress} time={nextTime} />
        </div>
        </div>

        <div className="grid grid-cols-3 shrink-0 rounded-lg border border-logic-border-dark bg-logic-bg-deep divide-x divide-logic-border-dark">
          {[
            ['Músicas', String(playlist.length), 'text-logic-text'],
            ['Duração do show', formatTime(total), 'text-logic-text'],
            ['Falta no show', formatTime(remaining), 'text-logic-lcd-amber'],
          ].map(([label, value, tone]) => (
            <div key={label} className="flex flex-col items-center py-2">
              <span className="text-2xs uppercase tracking-[0.12em] text-logic-text-muted">{label}</span>
              <span className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</span>
            </div>
          ))}
        </div>

      </div>
    </aside>
  );
}
