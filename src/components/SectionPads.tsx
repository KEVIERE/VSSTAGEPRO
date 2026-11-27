import { useEffect, useMemo, useRef } from 'react';
import { Repeat, Keyboard, SkipForward } from 'lucide-react';
import { useStore } from '@/store';
import type { Song, SongRegion } from '@/types';
import { nextRepeat, regionAt, repeatLabel, sortedRegions } from '@/lib/regions';
import { audioEngine } from '@/lib/audioEngine';
import { useLiveFill } from '@/lib/frameClock';
import { registerCommand } from '@/lib/shortcuts/runtime';

export function SectionPads({ song }: { song: Song }) {
  const regions = useMemo(() => sortedRegions(song.regions), [song.regions]);
  // Só o id da parte no ar e o da seguinte: antes os pads assinavam o cursor e redesenhavam todos
  // 10 vezes por segundo. A linha que anda dentro do pad vai pelo relógio de quadro (PadProgress).
  const activeId = useStore((s) => regionAt(regions, s.transport.currentTime)?.id ?? null);
  const nextRegionId = useStore((s) => followingRegion(regions, s.transport.currentTime)?.id ?? null);
  const queuedId = useStore((s) => (s.queuedRegion?.songId === song.id ? s.queuedRegion.regionId : null));
  const sectionKeys = useStore((s) => s.sectionKeys);
  const toggleSectionKeys = useStore((s) => s.toggleSectionKeys);

  // L (loop da parte) e N (pular parte), ou as teclas que o usuário escolheu: valem só com o
  // botão de atalhos das partes ligado. As teclas 1 a 9 são dos pads do Modo Show; P abre os pads.
  useEffect(() => {
    if (!sectionKeys) return;
    const songOf = () => useStore.getState().songs.find((x) => x.id === song.id);
    const offLoop = registerCommand('show.regionLoop', (e) => {
      if (e.repeat) return false;
      const st = useStore.getState();
      const sg = songOf();
      if (!sg) return false;
      const cur = regionAt(sortedRegions(sg.regions), st.transport.currentTime);
      if (!cur) return false;
      st.updateSongRegion(sg.id, cur.id, { loop: !cur.loop });
    });
    const offSkip = registerCommand('show.regionSkip', (e) => {
      if (e.repeat) return false;
      const sg = songOf();
      if (!sg) return false;
      skipSection(sg);
    });
    return () => { offLoop(); offSkip(); };
  }, [sectionKeys, song.id]);

  if (regions.length === 0) return null;
  const nextRegion = nextRegionId ? regions.find((r) => r.id === nextRegionId) ?? null : null;
  const skipping = !!nextRegion && queuedId === nextRegion.id;

  return (
    <div
      className="flex flex-wrap items-stretch gap-2 px-6 pb-3 pt-1"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {regions.map((r) => (
        <SectionPad
          key={r.id}
          song={song}
          region={r}
          isActive={activeId === r.id}
          isQueued={queuedId === r.id}
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
}

/** Posição da música agora: o relógio do áudio tocando (como as barras), senão o cursor do store. */
function padTimeNow(): number {
  const st = useStore.getState();
  const live = st.transport.isPlaying && audioEngine.isRunning() && !audioEngine.isUserSeeking();
  return live ? audioEngine.getCurrentTime() : st.transport.currentTime;
}

// Linha que anda dentro do pad da parte no ar, a cada quadro do relógio único. Uma camada do
// tamanho do pad é empurrada por transform (sem refazer o layout) e a linha fica na borda direita
// dela, no mesmo ponto em que o "left" de antes a punha. Sem transição: segue o relógio do áudio.
function PadProgress({ region }: { region: SongRegion }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLiveFill(ref, () => ((padTimeNow() - region.start) / Math.max(0.001, region.end - region.start)) * 100);
  return (
    <span ref={ref} className="pointer-events-none absolute inset-0 will-change-transform" style={{ transform: 'translateX(-100%)' }}>
      <span
        className="absolute top-0 bottom-0 right-0 w-0.5 -mr-px"
        style={{ backgroundColor: region.color, boxShadow: `0 0 6px ${region.color}` }}
      />
    </span>
  );
}

function SectionPad({ song, region, isActive, isQueued }: SectionPadProps) {
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
      {isActive && <PadProgress region={region} />}
    </div>
  );
}
