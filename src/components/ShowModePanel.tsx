import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Play, Square, Gauge, AudioWaveform, Loader2, Headphones,
  X, Radio, Repeat, Layers, ListOrdered, Search, Music2,
} from 'lucide-react';
import { useStore } from '@/store';
import { startPlayback, stopPlayback } from '@/lib/transportControl';
import { formatTime, useShowTotals } from '@/components/ShowRundown';
import { currentAndNextSlice, sliceDuration } from '@/lib/medley';
import { audioEngine } from '@/lib/audioEngine';
import type { PlayFlow, Song } from '@/types';

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

function ShowTotalsSummary({ playlist, songs }: { playlist: Array<any>; songs: Song[] }) {
  const { total, remaining } = useShowTotals(playlist, songs);
  return (
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
  );
}

// Relógio grande "Restante da música": atualiza direto do relógio de hardware a 60fps via rAF,
// sem disparar re-render do React nem depender dos ticks do Zustand.
function RemainingDisplay({ title }: { title: string }) {
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = textRef.current;
      if (el) {
        const st = useStore.getState();
        const curId = st.transport.currentSongId ?? st.selectedSongId ?? st.playlist[0]?.songId;
        const curSong = st.songs.find((s) => s.id === curId);
        const duration = curSong?.duration ?? 0;

        if (duration <= 0) {
          el.textContent = '--:--';
          el.className = 'mt-2 font-mono text-6xl xl:text-7xl font-semibold leading-none tabular-nums text-logic-text-muted/50';
        } else {
          const live = st.transport.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking();
          const t = live ? audioEngine.getCurrentTime() : st.transport.currentTime;
          const left = Math.max(0, duration - t);
          el.textContent = `-${formatTime(left)}`;
          el.className = `mt-2 font-mono text-6xl xl:text-7xl font-semibold leading-none tabular-nums ${left <= 15 ? 'text-logic-lcd-red' : 'text-logic-lcd-green'}`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="rounded-xl border border-logic-border-dark bg-black px-6 py-6 text-center">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-logic-text-muted">Restante da música</div>
      <div ref={textRef} className="mt-2 font-mono text-6xl xl:text-7xl font-semibold leading-none tabular-nums text-logic-text-muted/50">
        --:--
      </div>
      <div className="mt-3 text-xl xl:text-2xl font-semibold leading-tight text-logic-text truncate" title={title}>{title}</div>
    </div>
  );
}

// Barra contínua de alta taxa: escreve style.width direto no DOM em cada quadro (60fps),
// eliminando completamente o atraso, pulo ou efeito elástico de CSS transitions.
function LiveProgressBar({
  tone,
  reverse = false,
  mode,
}: {
  tone: 'green' | 'amber';
  reverse?: boolean;
  mode: 'current' | 'next';
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const colorCls = tone === 'green' ? 'bg-logic-lcd-green' : 'bg-logic-lcd-amber';

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = barRef.current;
      if (el) {
        const st = useStore.getState();
        const curId = st.transport.currentSongId ?? st.selectedSongId ?? st.playlist[0]?.songId;
        const curSong = st.songs.find((s) => s.id === curId);
        const duration = curSong?.duration ?? 0;

        if (duration <= 0) {
          el.style.width = '0%';
          raf = requestAnimationFrame(tick);
          return;
        }

        const live = st.transport.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking();
        const t = live ? audioEngine.getCurrentTime() : st.transport.currentTime;
        const slices = curSong ? currentAndNextSlice(curSong, t) : { current: null, next: null };

        if (mode === 'current') {
          // Barra de progresso (Tocando): corre da esquerda para a direita
          let pct = 0;
          if (slices.current) {
            const sDur = Math.max(0.01, sliceDuration(curSong!, slices.current));
            pct = Math.min(100, Math.max(0, ((t - slices.current.start) / sDur) * 100));
          } else {
            pct = Math.min(100, Math.max(0, (t / duration) * 100));
          }
          el.style.width = `${pct}%`;
        } else {
          // Barra de regresso (Próxima): enche da direita para a esquerda (reverse = true com justify-end)
          let pct = 0;
          if (slices.next && slices.current) {
            const sDur = Math.max(0.01, sliceDuration(curSong!, slices.current));
            const left = Math.max(0, slices.current.end - t);
            pct = Math.min(100, Math.max(0, (1 - left / sDur) * 100));
          } else {
            const left = Math.max(0, duration - t);
            pct = Math.min(100, Math.max(0, (1 - left / duration) * 100));
          }
          el.style.width = `${pct}%`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <div className={`flex h-1.5 rounded-full bg-black/40 overflow-hidden ${reverse ? 'justify-end' : ''}`}>
      <div ref={barRef} className={`h-full ${colorCls} will-change-[width]`} style={{ width: '0%' }} />
    </div>
  );
}

function SongCard({
  label, name, tone, time, reverse = false, medley, mode,
}: {
  label: string;
  name: string | null;
  tone: 'green' | 'amber';
  time?: string;
  reverse?: boolean;
  medley?: string;
  mode: 'current' | 'next';
}) {
  const c = tone === 'green'
    ? { border: 'border-logic-lcd-green/50', bg: 'bg-logic-lcd-green/[0.08]', text: 'text-logic-lcd-green' }
    : { border: 'border-logic-lcd-amber/50', bg: 'bg-logic-lcd-amber/[0.08]', text: 'text-logic-lcd-amber' };
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
      <LiveProgressBar tone={tone} reverse={reverse} mode={mode} />
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
  const isLoading = useStore((s) => {
    const id = s.transport.currentSongId ?? s.selectedSongId;
    return !!id && s.loadingSongIds.includes(id);
  });
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

  // Busca instantânea: acha rápido qualquer música do show sem precisar sair do Modo Show
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return (playlist ?? [])
      .map((entry, index) => ({ entry, song: songs.find((s) => s.id === entry.songId), index }))
      .filter(({ entry, song }) => entry?.name?.toLowerCase().includes(q) || song?.name?.toLowerCase().includes(q));
  }, [playlist, songs, searchQuery]);

  const bigBtn = 'flex items-center justify-center h-12 shrink-0 rounded-lg border transition-all duration-150 active:scale-[0.96]';
  const neutral = 'bg-logic-bg-elevated border-logic-border-light text-logic-text hover:bg-logic-bg-panel-light';
  const toggle = (on: boolean) => `${bigBtn} gap-2 text-xs font-semibold uppercase tracking-[0.12em] ${on
    ? 'bg-logic-lcd-amber/15 border-logic-lcd-amber/70 text-logic-lcd-amber'
    : 'bg-logic-bg-elevated border-logic-border-light text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light'}`;

  return (
    <aside className="relative flex flex-col w-[380px] xl:w-[440px] shrink-0 h-full bg-logic-bg-panel border-l border-logic-border-dark overflow-hidden animate-[fadeIn_200ms_ease-out]">
      <div className="flex items-center gap-2 px-5 h-12 border-b border-logic-border-dark bg-logic-bg-deep shrink-0">
        <Radio size={14} className={isPlaying ? 'text-logic-lcd-green animate-pulse' : 'text-logic-text-muted'} />
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

      <div className="relative mx-4 mt-3 shrink-0">
        <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-logic-bg-deep border border-logic-border-dark focus-within:border-logic-accent transition-colors">
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
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`${bigBtn} disabled:pointer-events-none ${isPlaying ? 'bg-logic-lcd-green/25 border-logic-lcd-green text-logic-lcd-green opacity-60' : 'bg-logic-lcd-green/15 border-logic-lcd-green/70 text-logic-lcd-green hover:bg-logic-lcd-green/25'}`}
            onClick={startPlayback}
            disabled={isPlaying}
            title={isPlaying ? 'Já está tocando. Para trocar de música, dê Stop, escolha outra e toque' : 'Tocar (Espaço)'}
            aria-label="Tocar"
          >
            {isLoading && isPlaying
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
              const on = playFlow === f.id;
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
          <RemainingDisplay title={title} />

          <div className="grid grid-cols-2 gap-3">
            <SongCard
              label="Tocando"
              name={currentName}
              medley={slices.current ? current?.name : undefined}
              tone="green"
              time={current ? formatTime(current.duration) : undefined}
              mode="current"
            />
            <SongCard
              label="Próxima"
              name={nextName}
              medley={slices.next ? current?.name : undefined}
              tone="amber"
              reverse
              time={nextTime}
              mode="next"
            />
          </div>
        </div>

        <ShowTotalsSummary playlist={playlist} songs={songs} />

      </div>
    </aside>
  );
}
