import type { LyricPage, Notice, NoticeLayout, NoticeLevel, PrompterState } from '@/lib/prompterTypes';

const SCHEDULED_DEFAULT_SEC = 15;

export function autoPageIndex(pages: LyricPage[], t: number): number {
  let idx = -1;
  pages.forEach((p, i) => {
    if (p.time !== null && p.time <= t + 0.05) idx = i;
  });
  return idx;
}

export function pageIndexFor(pages: LyricPage[], t: number, songId: string | null, p: PrompterState): number {
  const base = autoPageIndex(pages, t);
  if (!songId || p.nudge.songId !== songId || p.nudge.delta === 0) return base;
  return Math.max(-1, Math.min(pages.length - 1, base + p.nudge.delta));
}

export function nextPageTime(pages: LyricPage[], index: number): number | null {
  for (let i = index + 1; i < pages.length; i++) {
    const tm = pages[i].time;
    if (tm !== null) return tm;
  }
  return null;
}

export function activeNotice(
  p: PrompterState, nowMs: number, songId: string | null, songTime: number, playing: boolean,
): Notice | null {
  if (p.notice && (p.notice.durationSec <= 0 || nowMs - p.notice.sentAt < p.notice.durationSec * 1000)) return p.notice;
  if (!songId || !playing) return null;
  const s = p.scheduled.find((x) => x.songId === songId && songTime < (x.durationSec > 0 ? x.durationSec : SCHEDULED_DEFAULT_SEC));
  return s ? { id: s.id, text: s.text, level: s.level, layout: s.layout, sentAt: nowMs, durationSec: 0 } : null;
}

export interface ShowTimeView {
  phase: 'none' | 'before' | 'running' | 'over';
  seconds: number;
}

export function showTimeView(p: PrompterState, nowMs: number): ShowTimeView {
  if (!p.showStartAt) return { phase: 'none', seconds: 0 };
  const start = Date.parse(p.showStartAt);
  if (!Number.isFinite(start)) return { phase: 'none', seconds: 0 };
  if (nowMs < start) return { phase: 'before', seconds: (start - nowMs) / 1000 };
  const end = start + p.showDurationMin * 60000;
  if (nowMs <= end) return { phase: 'running', seconds: (end - nowMs) / 1000 };
  return { phase: 'over', seconds: (nowMs - end) / 1000 };
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

const MAX_NOTICE_TEXT = 200;
const MAX_HISTORY = 20;

/** Coloca um aviso na tela e guarda no histórico. Devolve null se o texto estiver vazio. */
export function withNotice(
  s: PrompterState, text: string, opts: { level: NoticeLevel; layout: NoticeLayout; durationSec: number },
): PrompterState | null {
  const t = text.trim().slice(0, MAX_NOTICE_TEXT);
  if (!t) return null;
  const id = newId();
  const at = Date.now();
  return {
    ...s,
    notice: { id, text: t, level: opts.level, layout: opts.layout, sentAt: at, durationSec: opts.durationSec },
    history: [{ id, text: t, at }, ...s.history.filter((h) => h.text !== t)].slice(0, MAX_HISTORY),
  };
}
