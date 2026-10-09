import { useRef } from 'react';
import type { LyricPage, Notice, PrompterSnapshot, PrompterState } from '@/lib/prompterTypes';
import { kindInfo, lyricFontCss } from '@/lib/prompterTypes';
import type { SetlistSong } from '@/lib/musicianTypes';
import { computeLiveView, holdForward } from '@/lib/liveClock';
import { activeNotice, formatClock, nextPageTime, pageIndexFor, showTimeView } from '@/lib/prompterView';

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
          {showTop && <TopBar p={p} now={now} current={current} next={next} currentName={current && live?.sliceName ? live.sliceName : current?.name} nextName={live?.nextSliceName && current ? live.nextSliceName : next?.name} currentMedley={current && live?.sliceName ? current.name : undefined} nextMedley={current && live?.nextSliceName ? current.name : undefined} progress={lv.songProgress} remaining={current ? Math.max(0, current.duration - lv.currentTime) : 0} />}
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
      {notice && <NoticeView notice={notice} barSize={p.barSize} />}
      {lv.status === 'nosignal' && <span className="absolute top-[1.5cqh] right-[1.5cqh] w-[1.2cqh] h-[1.2cqh] rounded-full bg-[#ff9f0a]" title="Sem sinal do diretor" />}
    </>,
  );
}

function SongPanel({ label, name, color, progress, time, medley }: { label: string; name: string; color: string; progress?: number; time?: string; medley?: string }) {
  return (
    <div className="flex-1 basis-0 min-w-0 rounded-[1cqh] border px-[1.4cqw] py-[1cqh] flex flex-col justify-center" style={{ borderColor: `${color}66`, background: `${color}1f`, height: '11cqh' }}>
      <div className="flex items-baseline justify-between gap-[1cqw]">
        <p className="font-semibold tracking-[0.15em] truncate" style={{ fontSize: '1.6cqh', color }}>
          {label}
          {medley && <span className="ml-[0.8cqw] px-[0.4cqw] rounded-[0.4cqh] border border-current">MEDLEY</span>}
          {medley && <span className="ml-[0.8cqw] tracking-normal opacity-70">{medley}</span>}
        </p>
        {time && <p className="tabular-nums font-semibold" style={{ fontSize: '1.8cqh', color }}>{time}</p>}
      </div>
      <p className="font-semibold truncate" style={{ fontSize: '3.2cqh', lineHeight: 1.2, color }}>{name}</p>
      <div className="mt-[0.6cqh] h-[0.7cqh] rounded-full overflow-hidden" style={{ background: progress === undefined ? 'transparent' : `${color}33` }}>
        {progress !== undefined && <div className="h-full rounded-full" style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%`, background: color, transition: 'width 200ms linear' }} />}
      </div>
    </div>
  );
}

function TopBar({ p, now, current, currentName, nextName, currentMedley, nextMedley, progress, remaining }: {
  p: PrompterState; now: number; current: SetlistSong | null; next: SetlistSong | null; currentName?: string; nextName?: string; currentMedley?: string; nextMedley?: string; progress: number; remaining: number;
}) {
  const st = showTimeView(p, now);
  const stColor = st.phase === 'over' ? RED : st.phase === 'running' && st.seconds < 600 ? ORANGE : '#ffffff';
  const stLabel = st.phase === 'before' ? 'SHOW COMEÇA EM' : st.phase === 'running' ? 'TEMPO DE SHOW · RESTAM' : 'PASSOU DO HORÁRIO';
  return (
    <div className="flex items-center gap-[2cqw] px-[2.5cqw] border-b border-white/10" style={{ height: '15cqh' }}>
      <div className="w-[15cqw] flex-shrink-0">
        {p.toggles.clock && <p className="font-semibold tabular-nums" style={{ fontSize: '6cqh', lineHeight: 1 }}>{wallClock(now)}</p>}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-[1.5cqw]">
        {p.toggles.nowNext && (
          <>
            <SongPanel label="TOCANDO" name={currentName ?? '—'} color={GREEN} progress={current ? progress : 0} time={current ? `-${formatClock(remaining)}` : undefined} medley={currentMedley} />
            <SongPanel label="PRÓXIMA" name={nextName ?? '—'} color={ORANGE} medley={nextMedley} />
          </>
        )}
      </div>
      <div className="w-[15cqw] flex-shrink-0 text-right">
        {p.toggles.showTime && st.phase !== 'none' && (
          <>
            <p className="font-semibold tracking-[0.12em]" style={{ fontSize: '1.6cqh', color: stColor }}>{stLabel}</p>
            <p className="font-semibold tabular-nums" style={{ fontSize: '5.4cqh', lineHeight: 1.1, color: stColor }}>
              {st.phase === 'over' ? '+' : ''}{formatClock(st.seconds)}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function SidePlaylist({ snap, songs, currentId, nextId }: { snap: PrompterSnapshot; songs: SetlistSong[]; currentId: string | null; nextId: string | null }) {
  const blocks = new Map(snap.show.setlist.blocks.map((b) => [b.id, b]));
  let lastBlock: string | null | undefined;
  return (
    <div className="w-[22cqw] flex-shrink-0 border-r border-white/10 bg-white/[0.03] overflow-hidden py-[2cqh]">
      {songs.map((s, i) => {
        const block = s.blockId ? blocks.get(s.blockId) : undefined;
        const header = s.blockId !== lastBlock && block;
        lastBlock = s.blockId;
        const isCur = s.id === currentId;
        const isNext = s.id === nextId;
        return (
          <div key={s.id}>
            {header && (
              <p className="px-[1.5cqw] pt-[1.6cqh] pb-[0.6cqh] font-semibold tracking-[0.12em] uppercase truncate" style={{ fontSize: '1.7cqh', color: block.color }}>
                {block.name}
              </p>
            )}
            <div
              className="flex items-center gap-[0.8cqw] px-[1.5cqw] py-[0.7cqh]"
              style={{
                fontSize: '2.4cqh',
                background: isCur ? 'rgba(48,209,88,0.18)' : isNext ? 'rgba(255,159,10,0.14)' : undefined,
                borderLeft: `0.4cqw solid ${isCur ? GREEN : isNext ? ORANGE : 'transparent'}`,
              }}
            >
              <span className="tabular-nums text-white/40 w-[2.2cqw]">{i + 1}</span>
              <span className="truncate font-medium" style={{ color: isCur ? GREEN : isNext ? ORANGE : 'rgba(255,255,255,0.75)' }}>{s.name}</span>
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
      <span className="font-semibold tracking-[0.2em] flex-shrink-0" style={{ fontSize: `${Math.max(2, barSize * 0.13)}cqh`, color: st.color }}>{st.label}</span>
      <p className="flex-1 min-w-0 font-semibold whitespace-pre-line" style={{ fontSize: `${Math.max(3, barSize * 0.3)}cqh`, lineHeight: 1.2 }}>{notice.text}</p>
    </div>
  );
}
