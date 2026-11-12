import { useEffect } from 'react';
import { Repeat, Keyboard, SkipForward } from 'lucide-react';
import { useStore } from '@/store';
import type { Song, SongRegion } from '@/types';
import { nextRepeat, regionAt, repeatLabel, sortedRegions } from '@/lib/regions';

export function SectionPads({ song }: { song: Song }) {
  const regions = sortedRegions(song.regions);
  const currentTime = useStore((s) => s.transport.currentTime);
  const queuedId = useStore((s) => (s.queuedRegion?.songId === song.id ? s.queuedRegion.regionId : null));
  const sectionKeys = useStore((s) => s.sectionKeys);
  const toggleSectionKeys = useStore((s) => s.toggleSectionKeys);
  const active = regionAt(regions, currentTime);

  useEffect(() => {
    if (!sectionKeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const st = useStore.getState();
      const sg = st.songs.find((x) => x.id === song.id);
      if (!sg) return;
      const list = sortedRegions(sg.regions);
      // as teclas 1 a 9 são dos pads do Modo Show; P abre os pads
      if (e.key === 'l' || e.key === 'L') {
        const cur = regionAt(list, st.transport.currentTime);
        if (!cur) return;
        e.preventDefault();
        st.updateSongRegion(sg.id, cur.id, { loop: !cur.loop });
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        skipSection(sg);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sectionKeys, song.id]);

  if (regions.length === 0) return null;
  const nextRegion = followingRegion(regions, currentTime);
  const skipping = !!nextRegion && queuedId === nextRegion.id;

  return (
    <div
      className="flex flex-wrap items-stretch gap-2 px-6 pb-3 pt-1"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {regions.map((r, i) => (
        <SectionPad
          key={r.id}
          song={song}
          region={r}
          isActive={active?.id === r.id}
          isQueued={queuedId === r.id}
          progress={active?.id === r.id ? (currentTime - r.start) / Math.max(0.001, r.end - r.start) : 0}
        />
      ))}
      <button
        className={`console-pad flex flex-col items-center justify-center gap-0.5 min-w-[88px] h-12 px-3 ${
          !nextRegion
            ? 'text-logic-text-muted/40 cursor-not-allowed opacity-60'
            : skipping
              ? 'is-queued text-logic-lcd-amber'
              : 'text-logic-text hover:text-logic-lcd-amber'
        }`}
        onClick={() => skipSection(song)}
        disabled={!nextRegion}
        aria-pressed={skipping}
        title={!nextRegion
          ? 'Não há outra parte depois desta'
          : skipping ? `Vai para "${nextRegion.name}" ao fim desta passada · clique para cancelar` : `Termina esta passada e vai para "${nextRegion.name}"`}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {sectionKeys && <kbd className="inline-flex items-center justify-center w-4 h-4 rounded-[3px] bg-black/40 border border-white/15 text-2xs font-mono text-logic-text-dim">N</kbd>}
          <SkipForward size={14} />
          Pular
        </span>
        <span className={`text-2xs font-medium uppercase tracking-[0.12em] h-3.5 ${skipping ? 'animate-[sectionQueued_900ms_ease-in-out_infinite]' : 'text-logic-text-muted'}`}>
          {nextRegion ? (skipping ? 'Na sequência' : nextRegion.name) : ''}
        </span>
      </button>
      <button
        className={`console-key self-center ml-auto flex items-center gap-1.5 h-8 px-2.5 text-[12px] ${sectionKeys ? 'is-lit-blue' : ''}`}
        onClick={toggleSectionKeys}
        aria-pressed={sectionKeys}
        title={sectionKeys ? 'Atalhos ligados: L liga/desliga o loop da parte atual, N pula para a próxima' : 'Ligar atalhos de teclado para as partes'}
      >
        <Keyboard size={13} />
        L · N
      </button>
    </div>
  );
}

export function followingRegion(regions: SongRegion[], time: number): SongRegion | null {
  const current = regionAt(regions, time);
  if (current) {
    const idx = regions.findIndex((r) => r.id === current.id);
    return regions[idx + 1] ?? null;
  }
  return regions.find((r) => r.start > time) ?? null;
}

/** Termina a passada atual (mesmo em loop) e segue para a parte seguinte. */
export function skipSection(song: Song) {
  const st = useStore.getState();
  const next = followingRegion(sortedRegions(song.regions), st.transport.currentTime);
  if (!next) return;
  const queued = st.queuedRegion?.songId === song.id && st.queuedRegion.regionId === next.id;
  st.setQueuedRegion(queued ? null : { songId: song.id, regionId: next.id });
}

export function pickSection(song: Song, region: SongRegion) {
  const st = useStore.getState();
  const current = regionAt(song.regions, st.transport.currentTime);
  if (current?.id === region.id && st.transport.isPlaying) {
    st.updateSongRegion(song.id, region.id, { loop: !region.loop });
    return;
  }
  const queued = st.queuedRegion?.songId === song.id && st.queuedRegion.regionId === region.id;
  st.setQueuedRegion(queued ? null : { songId: song.id, regionId: region.id });
}

interface SectionPadProps {
  song: Song;
  region: SongRegion;
  isActive: boolean;
  isQueued: boolean;
  progress: number;
}

function SectionPad({ song, region, isActive, isQueued, progress }: SectionPadProps) {
  const updateSongRegion = useStore((s) => s.updateSongRegion);
  // pad de mesa: a parte tocando acende na cor dela; a engatilhada fica com borda âmbar
  return (
    <div
      className={`console-pad relative flex items-stretch min-w-[140px] h-12 overflow-hidden ${isActive ? 'is-active' : ''} ${isQueued ? 'is-queued' : ''}`}
      style={{ ['--pad-color' as string]: region.color }}
    >
      <span className="w-1.5 flex-shrink-0" style={{ backgroundColor: region.color, boxShadow: isActive ? `0 0 8px ${region.color}` : undefined }} />
      <button
        className="flex-1 min-w-0 flex flex-col justify-center items-start pl-2.5 pr-2 text-left"
        onClick={() => pickSection(song, region)}
        title={isActive
          ? 'Tocando agora · clique para ligar/desligar o loop'
          : isQueued ? 'Próxima parte · clique para cancelar' : 'Pular para esta parte ao fim da parte atual'}
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold truncate max-w-full text-logic-text">
          <span className="truncate">{region.name}</span>
        </span>
        <span className="text-2xs font-medium uppercase tracking-[0.12em] h-3.5">
          {isQueued && <span className="text-logic-lcd-amber animate-[sectionQueued_900ms_ease-in-out_infinite]">Próxima</span>}
        </span>
      </button>
      <div className="flex flex-col items-center justify-center gap-0.5 pr-1.5">
        <button
          className={`console-key w-7 h-6 flex items-center justify-center ${region.loop ? 'is-lit-green' : ''}`}
          onClick={() => updateSongRegion(song.id, region.id, { loop: !region.loop })}
          aria-pressed={region.loop}
          title={region.loop ? 'Loop ligado (clique para desligar)' : 'Ligar loop'}
        >
          <Repeat size={13} strokeWidth={2.5} />
        </button>
        {region.loop && (
          <button
            className="w-7 h-4 rounded text-2xs font-semibold leading-none text-logic-lcd-green hover:bg-white/10 transition-colors"
            onClick={() => updateSongRegion(song.id, region.id, { repeat: nextRepeat(region.repeat) })}
            title={region.repeat ? `Toca ${region.repeat} vezes e segue (clique para mudar)` : 'Repete até desligar (clique para mudar)'}
          >
            {repeatLabel(region.repeat)}
          </button>
        )}
      </div>
      {isActive && (
        <span
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 -ml-px transition-[left] duration-200 ease-linear"
          style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%`, backgroundColor: region.color, boxShadow: `0 0 6px ${region.color}` }}
        />
      )}
    </div>
  );
}
