import { useRef } from 'react';
import type { LyricPage, Notice, PrompterSnapshot, PrompterState } from '@/lib/prompterTypes';
import { kindInfo, lyricFontCss } from '@/lib/prompterTypes';
import type { SetlistSong, ShowLive } from '@/lib/musicianTypes';
import { computeLiveView, holdForward } from '@/lib/liveClock';
import { activeNotice, formatClock, nextPageTime, pageIndexFor, showTimeView } from '@/lib/prompterView';
import { songKeyLabel } from '@/lib/musicKey';
import SegmentDisplay from '@/components/SegmentDisplay';

// The TV must keep scrolling lyrics through short internet drops, so tolerate a long gap before freezing.
const STAGE_STALE_MS = 30000;
const COUNT_IN_S = 3;
const GREEN = '#30d158';
const ORANGE = '#ff9f0a';
const RED = '#ff453a';

const NOTICE_STYLE: Record<Notice['level'], { color: string; label: string }> = {
  info: { color: '#64d2ff', label: 'AVISO' },
  warn: { color: ORANGE, label: 'ATENÇÃO' },
  urgent: { color: RED, label: 'URGENTE' },
};

function wallClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function orderedSongs(snap: PrompterSnapshot): SetlistSong[] {
  const map = new Map(snap.show.setlist.songs.map((s) => [s.id, s]));
  const list = snap.show.setlist.order.map((id) => map.get(id)).filter((s): s is SetlistSong => !!s);
  return list.length ? list : snap.show.setlist.songs;
}

export default function StageScreen({ snap, sync, now, logoUrl = null }: {
  snap: PrompterSnapshot;
  sync: { lagMs: number; receivedAt: number };
  now: number;
  logoUrl?: string | null;
}) {
  const mem = useRef<{ songId: string | null; t: number }>({ songId: null, t: 0 });
  const p = snap.prompter;
  const live = snap.show.live;
  const songs = orderedSongs(snap);
  const current = live?.currentSongId ? songs.find((s) => s.id === live.currentSongId) ?? null : null;
  const next = live?.nextSongId ? songs.find((s) => s.id === live.nextSongId) ?? null : null;
  const lv = holdForward(
    computeLiveView(live, current?.duration, sync.lagMs, sync.receivedAt, now, STAGE_STALE_MS),
    current?.id ?? null, mem.current, current?.duration,
  );
  const pages = current ? snap.lyrics.find((l) => l.song_id === current.id)?.pages ?? [] : [];
  const notice = p.toggles.notices ? activeNotice(p, now, current?.id ?? null, lv.currentTime, lv.isPlaying) : null;

  const frame = (children: React.ReactNode) => (
    <div className="w-full h-full bg-black text-white overflow-hidden select-none" style={{ containerType: 'size' }}>
      <div className="relative w-full h-full" style={{ transform: p.mirror ? 'scaleX(-1)' : undefined }}>{children}</div>
    </div>
  );

  if (p.blackout) return frame(null);

  const showTop = p.toggles.clock || p.toggles.showTime || p.toggles.nowNext;
  const dimForNotice = notice?.layout === 'center';
  const showLyrics = p.toggles.lyrics && pages.length > 0 && !!current;

  return frame(
    <>
      <div className={`absolute inset-0 flex transition-opacity duration-300 ${dimForNotice ? 'opacity-25' : 'opacity-100'}`}>
        {p.toggles.playlist && <SidePlaylist snap={snap} songs={songs} currentId={current?.id ?? null} nextId={next?.id ?? null} />}
        <div className="flex-1 min-w-0 flex flex-col">
          {showTop && <TopBar p={p} now={now} live={live} playing={lv.isPlaying} current={current} next={next} currentName={current && live?.sliceName ? live.sliceName : current?.name} nextName={live?.nextSliceName && current ? live.nextSliceName : next?.name} currentMedley={current && live?.sliceName ? current.name : undefined} nextMedley={current && live?.nextSliceName ? current.name : undefined} progress={lv.songProgress} remaining={current ? Math.max(0, current.duration - lv.currentTime) : 0} />}
          <div className="flex-1 min-h-0 relative">
            {showLyrics && current
              ? <LyricsView pages={pages} t={lv.currentTime} playing={lv.isPlaying} songId={current.id} p={p} />
              : p.toggles.logo && logoUrl && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <img key={logoUrl} src={logoUrl} alt="Logo da banda" className="object-contain animate-[prompterFade_600ms_ease-out]" style={{ maxWidth: '60cqw', maxHeight: '60cqh' }} draggable={false} />
                </div>
              )}
          </div>
          {notice?.layout === 'bar' && <div style={{ height: `${p.barSize}cqh` }} />}
        </div>
      </div>
      {p.toggles.logoCorner && logoUrl && (showLyrics || !p.toggles.logo) && (
        <img src={logoUrl} alt="" className="absolute object-contain opacity-90 pointer-events-none" style={{ left: '2cqw', bottom: notice?.layout === 'bar' ? `${p.barSize + 2}cqh` : '2.5cqh', maxWidth: '14cqw', maxHeight: '11cqh' }} draggable={false} />
      )}
      {p.toggles.joinQr && snap.joinQr && (
        <div className="absolute flex flex-col items-center gap-[0.6cqh] rounded-[1cqh] bg-white p-[0.9cqh] shadow-2xl" style={{ right: '2cqw', bottom: notice?.layout === 'bar' ? `${p.barSize + 2}cqh` : '2.5cqh' }}>
          <img src={snap.joinQr} alt="QR code para os músicos entrarem" className="[image-rendering:pixelated]" style={{ width: '16cqh', height: '16cqh' }} draggable={false} />
          <span className="font-semibold text-black" style={{ fontSize: '1.4cqh' }}>Músicos: escaneie</span>
        </div>
      )}
      {notice && <NoticeView notice={notice} barSize={p.barSize} />}
      {lv.status === 'nosignal' && <span className="absolute top-[1.5cqh] right-[1.5cqh] w-[1.2cqh] h-[1.2cqh] rounded-full bg-[#ff9f0a]" title="Sem sinal do diretor" />}
    </>,
  );
}

// ---------------------------------------------------------------------------------------------
// Barra de cima e playlist com o visual do programa (mesa analógica): displays de vidro com LED,
// números de 7 segmentos, Tom e BPM, e a playlist com as faixas coloridas dos blocos. Tudo em
// cqh/cqw para crescer junto com a TV.
// ---------------------------------------------------------------------------------------------

const LCD_TEXT = '#d8d3c6';
const LEGEND = '#8f8b81';
const STEEL = 'linear-gradient(180deg, #24282d, #1b1e22)';
const BARLOW = "'Barlow Semi Condensed', 'Inter', system-ui, sans-serif";

function Legend({ children, color = LEGEND }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="flex items-center gap-[0.5cqw] font-semibold truncate" style={{ fontFamily: BARLOW, fontSize: '1.55cqh', lineHeight: 1, letterSpacing: '0.06em', color }}>
      {children}
    </span>
  );
}

function Led({ color }: { color: string | null }) {
  return (
    <span
      className="flex-shrink-0 rounded-full"
      style={{ width: '0.95cqh', height: '0.95cqh', background: color ?? '#2a1a1a', boxShadow: color ? `0 0 0.7cqh 0.15cqh ${color}bb` : 'inset 0 1px 1px rgba(0,0,0,0.8)' }}
    />
  );
}

function Readout({ label, value, color }: { label: string; value: string; color: string }) {
  if (!value) return null;
  return (
    <span className="flex items-baseline gap-[0.35cqw]">
      <span className="font-semibold" style={{ fontFamily: BARLOW, fontSize: '1.4cqh', letterSpacing: '0.06em', color: LEGEND }}>{label}</span>
      <span className="console-glow font-semibold tabular-nums" style={{ fontFamily: BARLOW, fontSize: '2.5cqh', lineHeight: 1, color }}>{value}</span>
    </span>
  );
}

function Display({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`console-display flex flex-col justify-between min-w-0 ${className}`} style={{ padding: '1cqh 1cqw', borderRadius: '0.5cqh', ...style }}>
      {children}
    </div>
  );
}

function meta(song: SetlistSong | null, live: ShowLive | null, playing: boolean) {
  if (!song) return { key: '', bpm: '' };
  const tuner = playing && typeof live?.tuner === 'number' ? live.tuner : song.tuner;
  const bpm = playing && live?.bpm ? live.bpm : song.bpm;
  return { key: songKeyLabel({ musicKey: song.musicKey, tuner }), bpm: bpm ? String(bpm) : '' };
}

function SongDisplay({ label, name, color, song, live, playing, progress, time, medley, fillFromRight = false }: {
  label: string; name: string; color: string; song: SetlistSong | null; live: ShowLive | null; playing: boolean;
  progress: number; time?: string; medley?: string; fillFromRight?: boolean;
}) {
  const on = !!song;
  const m = meta(song, live, playing);
  return (
    <Display className="flex-1 basis-0">
      <div className="flex items-center justify-between gap-[1cqw]">
        <Legend color={on ? color : LEGEND}>
          <Led color={on ? color : null} />
          {label}
          {medley && <span className="px-[0.3cqw] rounded-[0.3cqh] border border-current" style={{ fontSize: '1.2cqh', letterSpacing: '0.14em' }}>MEDLEY</span>}
        </Legend>
        <span className="flex items-center gap-[1cqw] flex-shrink-0">
          <Readout label="Tom" value={m.key} color="#ffab1f" />
          <Readout label="BPM" value={m.bpm} color={LCD_TEXT} />
        </span>
      </div>
      <div className="flex items-center gap-[0.6cqw] min-w-0">
        <div className="flex-1 min-w-0">
          <p className="console-glow font-semibold truncate" style={{ fontFamily: BARLOW, fontSize: '3.9cqh', lineHeight: 1.1, color: on ? color : '#6f6c66' }}>{name}</p>
          {medley && <p className="truncate" style={{ fontSize: '1.4cqh', color: LEGEND }}>{medley}</p>}
        </div>
        {/* Cronômetro discreto de propósito: o nome da música é o que o músico precisa ler de longe.
            Fica em 1.5cqh, menor que o Tom/BPM, para nunca empurrar o nome para as reticências. */}
        {time && (
          <span className="flex flex-shrink-0 items-center" style={{ height: '1.5cqh', maxWidth: '9cqw', color, opacity: 0.7 }}>
            <SegmentDisplay text={time} className="h-full" label={`Faltam ${time.replace('-', '')}`} />
          </span>
        )}
      </div>
      <div className={`led-bar flex ${fillFromRight ? 'justify-end' : ''}`} style={{ height: '0.8cqh', color, borderRadius: '0.15cqh' }}>
        <div className="led-bar-fill" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%`, transition: 'width 200ms linear' }} />
      </div>
    </Display>
  );
}

function TopBar({ p, now, live, playing, current, next, currentName, nextName, currentMedley, nextMedley, progress, remaining }: {
  p: PrompterState; now: number; live: ShowLive | null; playing: boolean; current: SetlistSong | null; next: SetlistSong | null;
  currentName?: string; nextName?: string; currentMedley?: string; nextMedley?: string; progress: number; remaining: number;
}) {
  const st = showTimeView(p, now);
  const stColor = st.phase === 'idle' ? LEGEND
    : st.phase === 'over' ? RED
    : st.phase === 'running' && st.seconds < 600 ? ORANGE : LCD_TEXT;
  const stLabel = st.phase === 'idle' ? 'Tempo de show'
    : st.phase === 'before' ? 'Show começa em'
    : st.phase === 'running' ? 'Tempo de show · restam'
    : 'Passou do horário';
  return (
    <div className="flex items-stretch gap-[1.2cqw] px-[1.6cqw] py-[1.4cqh]" style={{ height: '17cqh', background: STEEL, borderBottom: '0.3cqh solid #0b0d0f' }}>
      {p.toggles.clock && (
        <Display className="flex-shrink-0" style={{ width: '15cqw' }}>
          <Legend>Relógio</Legend>
          <div className="flex justify-center" style={{ height: '7.2cqh', color: LCD_TEXT }}>
            <SegmentDisplay text={wallClock(now)} className="h-full" label={`Agora são ${wallClock(now)}`} />
          </div>
        </Display>
      )}
      {p.toggles.nowNext && (
        <div className="flex-1 min-w-0 flex gap-[1.2cqw]">
          <SongDisplay
            label="Tocando" name={currentName ?? '---'} color={GREEN} song={current} live={live} playing={playing}
            progress={current ? progress : 0} time={current ? `-${formatClock(remaining)}` : undefined} medley={currentMedley}
          />
          <SongDisplay
            label="Próxima" name={nextName ?? '---'} color={ORANGE} song={next} live={null} playing={false}
            progress={current && next ? progress : 0} medley={nextMedley} fillFromRight
          />
        </div>
      )}
      {p.toggles.showTime && (
        <Display className="flex-shrink-0" style={{ width: '17cqw' }}>
          <Legend color={st.phase === 'running' ? LEGEND : stColor}>{stLabel}</Legend>
          <div className="flex justify-center" style={{ height: '7.2cqh', color: stColor }}>
            <SegmentDisplay text={formatClock(st.seconds)} className="h-full" label={`${stLabel} ${formatClock(st.seconds)}`} />
          </div>
        </Display>
      )}
    </div>
  );
}

function SidePlaylist({ snap, songs, currentId, nextId }: { snap: PrompterSnapshot; songs: SetlistSong[]; currentId: string | null; nextId: string | null }) {
  const blocks = new Map(snap.show.setlist.blocks.map((b) => [b.id, b]));
  const blockTotal = (id: string) => songs.filter((s) => s.blockId === id).reduce((sum, s) => sum + (s.duration || 0), 0);
  let lastBlock: string | null | undefined;
  return (
    <div className="w-[23cqw] flex-shrink-0 overflow-hidden" style={{ background: STEEL, borderRight: '0.3cqh solid #0b0d0f' }}>
      <div className="flex items-center justify-between px-[1.2cqw]" style={{ height: '5cqh', borderBottom: '0.2cqh solid #0b0d0f' }}>
        <Legend color={LCD_TEXT}>Playlist do show</Legend>
        <Legend>{songs.length} músicas</Legend>
      </div>
      {songs.map((s, i) => {
        const block = s.blockId ? blocks.get(s.blockId) : undefined;
        const header = s.blockId !== lastBlock && block;
        lastBlock = s.blockId;
        const isCur = s.id === currentId;
        const isNext = s.id === nextId;
        const tone = isCur ? GREEN : isNext ? ORANGE : null;
        return (
          <div key={s.id}>
            {header && (
              <div className="cue-block relative flex items-center justify-center px-[1.2cqw]" style={{ height: '4.4cqh', background: block.color }}>
                <span className="font-bold uppercase truncate text-white" style={{ fontFamily: BARLOW, fontSize: '1.9cqh', letterSpacing: '0.16em' }}>{block.name}</span>
                <span className="absolute right-[1.2cqw] tabular-nums text-white/85 font-semibold" style={{ fontFamily: BARLOW, fontSize: '1.6cqh' }}>{formatClock(blockTotal(block.id))}</span>
              </div>
            )}
            <div
              className={`cue-row flex items-center gap-[0.9cqw] px-[1.2cqw] ${isCur ? 'is-current' : isNext ? 'is-next' : ''}`}
              style={{ height: '5.6cqh', borderBottom: '1px solid rgba(0,0,0,0.45)' }}
            >
              <Led color={tone} />
              <span className="flex flex-shrink-0" style={{ height: '2.5cqh', color: tone ?? '#6f6c66' }}>
                <SegmentDisplay text={String(i + 1).padStart(2, '0')} className="h-full" label={`Música ${i + 1}`} />
              </span>
              <span className={`flex-1 min-w-0 truncate font-semibold ${tone ? 'console-glow' : ''}`} style={{ fontFamily: BARLOW, fontSize: '2.6cqh', color: tone ?? LCD_TEXT }}>{s.name}</span>
              <span className="flex-shrink-0 tabular-nums" style={{ fontFamily: BARLOW, fontSize: '1.7cqh', color: tone ?? LEGEND }}>{formatClock(s.duration || 0)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function fitSize(text: string, scale: number): number {
  const lines = text.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const byLines = 52 / Math.max(2, lines.length);
  const byWidth = 150 / longest;
  return Math.max(3.2, Math.min(11, byLines, byWidth)) * scale;
}

function LyricsView({ pages, t, playing, songId, p }: { pages: LyricPage[]; t: number; playing: boolean; songId: string; p: PrompterState }) {
  const mem = useRef<{ pageId: string | null; nextId: string | null; prev: LyricPage | null }>({ pageId: null, nextId: null, prev: null });
  const idx = pageIndexFor(pages, t, songId, p);
  const firstTime = pages.find((x) => x.time !== null)?.time ?? null;

  if (idx < 0) {
    const until = firstTime !== null ? firstTime - t : null;
    const counting = playing && until !== null && until <= COUNT_IN_S && until > 0;
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center px-[6cqw]">
        {counting ? (
          <p key={Math.ceil(until)} className="font-semibold tabular-nums animate-[prompterIn_300ms_ease-out]" style={{ fontSize: '30cqh', color: GREEN, lineHeight: 1 }}>
            {Math.ceil(until)}
          </p>
        ) : (
          <>
            <p className="text-white/40 font-semibold tracking-[0.3em]" style={{ fontSize: '2.6cqh' }}>{until !== null && until > 0 ? 'LETRA EM' : 'AGUARDANDO'}</p>
            {until !== null && until > 0 && <p className="tabular-nums font-semibold text-white/70 mt-[1cqh]" style={{ fontSize: '8cqh' }}>{formatClock(until)}</p>}
          </>
        )}
        {pages[0] && !counting && <p className="mt-[4cqh] text-center whitespace-pre-line opacity-40" style={{ fontSize: `${fitSize(pages[0].text, p.fontScale) * 0.45}cqh`, lineHeight: 1.3, color: p.lyricColor, fontFamily: lyricFontCss(p.lyricFont) }}>{pages[0].text}</p>}
      </div>
    );
  }

  const page = pages[idx];
  const next = pages[idx + 1];
  const nextT = nextPageTime(pages, idx);
  const span = nextT !== null && page.time !== null ? nextT - page.time : 0;
  const progress = span > 0 && page.time !== null ? Math.min(1, Math.max(0, (t - page.time) / span)) : 0;
  const kind = kindInfo(page.kind);
  const justify = p.lyricAlign === 'left' ? 'justify-start' : p.lyricAlign === 'right' ? 'justify-end' : 'justify-center';
  const fontFamily = lyricFontCss(p.lyricFont);
  const origin = p.lyricAlign === 'left' ? 'left center' : p.lyricAlign === 'right' ? 'right center' : 'center';

  const flow = mem.current;
  if (flow.pageId !== page.id) {
    flow.prev = flow.pageId && flow.nextId === page.id ? pages.find((x) => x.id === flow.pageId) ?? null : null;
    flow.pageId = page.id;
  }
  flow.nextId = next?.id ?? null;
  const rose = !!flow.prev;
  const leaving = flow.prev;

  return (
    <div className="absolute inset-0 flex flex-col px-[5cqw] pt-[3cqh] pb-[2cqh]">
      <div className="flex items-center gap-[1.2cqw]">
        <span className="px-[1cqw] py-[0.4cqh] rounded font-semibold tracking-[0.15em]" style={{ fontSize: '1.9cqh', color: '#000', background: kind.color }}>
          {kind.label.toUpperCase()}
        </span>
        <span className="text-white/35 tabular-nums" style={{ fontSize: '1.9cqh' }}>{idx + 1}/{pages.length}</span>
      </div>
      <div className={`relative flex-1 min-h-0 flex items-center ${justify}`}>
        {leaving && (
          <div aria-hidden className={`absolute inset-0 flex items-center ${justify} pointer-events-none`}>
            <p
              key={`out-${leaving.id}`}
              className="font-semibold whitespace-pre-line animate-[prompterLeave_420ms_ease-in_forwards]"
              style={{ fontSize: `${fitSize(leaving.text, p.fontScale)}cqh`, lineHeight: 1.2, color: p.lyricColor, fontFamily, textAlign: p.lyricAlign, transformOrigin: origin }}
              onAnimationEnd={() => { if (mem.current.prev === leaving) mem.current.prev = null; }}
            >
              {leaving.text}
            </p>
          </div>
        )}
        <p
          key={page.id}
          className={`font-semibold whitespace-pre-line transition-colors duration-300 ${rose ? 'animate-[prompterRise_520ms_cubic-bezier(0.22,1,0.36,1)]' : 'animate-[prompterUp_260ms_ease-out]'}`}
          style={{ fontSize: `${fitSize(page.text, p.fontScale)}cqh`, lineHeight: 1.2, color: p.lyricColor, fontFamily, textAlign: p.lyricAlign, transformOrigin: origin }}
        >
          {page.text}
        </p>
      </div>
      {span > 0 && (
        <div className="h-[0.6cqh] rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: kind.color, transition: 'width 120ms linear' }} />
        </div>
      )}
      {next && (
        <p
          key={`next-${next.id}`}
          className="mt-[1.6cqh] whitespace-pre-line line-clamp-3 animate-[prompterNextIn_420ms_ease-out]"
          style={{ fontSize: `${Math.min(4.2, fitSize(next.text, p.fontScale) * 0.42)}cqh`, lineHeight: 1.25, color: p.lyricColor, opacity: 0.32, fontFamily, textAlign: p.lyricAlign }}
        >
          {next.text}
        </p>
      )}
    </div>
  );
}

function NoticeView({ notice, barSize }: { notice: Notice; barSize: number }) {
  const st = NOTICE_STYLE[notice.level];
  const pulse = notice.level === 'urgent' ? 'animate-[noticePulse_1.2s_ease-in-out_infinite]' : '';
  if (notice.layout === 'center') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/85 animate-[prompterFade_250ms_ease-out]">
        <div className={`max-w-[80cqw] px-[5cqw] py-[5cqh] rounded-[2cqh] border-[0.5cqh] bg-black text-center ${pulse}`} style={{ borderColor: st.color }}>
          <p className="font-semibold tracking-[0.25em]" style={{ fontSize: '3cqh', color: st.color }}>{st.label}</p>
          <p className="mt-[2cqh] font-semibold whitespace-pre-line" style={{ fontSize: '8cqh', lineHeight: 1.2 }}>{notice.text}</p>
        </div>
      </div>
    );
  }
  return (
    <div
      key={notice.id}
      className={`absolute inset-x-0 bottom-0 bg-black flex items-center gap-[3cqw] px-[4cqw] animate-[prompterIn_250ms_ease-out] ${pulse}`}
      style={{ height: `${barSize}cqh`, borderTop: `0.8cqh solid ${st.color}` }}
    >
      <span className="flex items-center gap-[0.8cqw] font-bold tracking-[0.2em] flex-shrink-0" style={{ fontFamily: BARLOW, fontSize: `${Math.max(2, barSize * 0.13)}cqh`, color: st.color }}>
        <span className="rounded-full" style={{ width: '1.1cqh', height: '1.1cqh', background: st.color, boxShadow: `0 0 0.8cqh ${st.color}` }} />
        {st.label}
      </span>
      <p className="flex-1 min-w-0 font-semibold whitespace-pre-line" style={{ fontFamily: BARLOW, fontSize: `${Math.max(3, barSize * 0.32)}cqh`, lineHeight: 1.15 }}>{notice.text}</p>
    </div>
  );
}
