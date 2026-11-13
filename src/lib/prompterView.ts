import type { LyricPage, Notice, NoticeLayout, NoticeLevel, PrompterState } from '@/lib/prompterTypes';

const SCHEDULED_DEFAULT_SEC = 15;

/**
 * Página que está no ar no tempo `t`: a de maior tempo marcado que já passou. As páginas podem
 * estar fora da ordem do tempo (página movida, tempo marcado de novo); pegar só a última da lista
 * mostrava uma página velha ([70, 62, 80] em 71 s mostrava a de 62). Empate fica com a de baixo.
 */
export function autoPageIndex(pages: LyricPage[], t: number): number {
  let idx = -1;
  let best = -Infinity;
  pages.forEach((p, i) => {
    if (p.time !== null && p.time <= t + 0.05 && p.time >= best) { best = p.time; idx = i; }
  });
  return idx;
}

export function pageIndexFor(pages: LyricPage[], t: number, songId: string | null, p: PrompterState): number {
  const base = autoPageIndex(pages, t + (p.lyricLead ?? 0));
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
  /** `idle`: a chave está ligada mas ninguém definiu o início ainda. */
  phase: 'none' | 'idle' | 'before' | 'running' | 'over';
  seconds: number;
}

export function showTimeView(p: PrompterState, nowMs: number): ShowTimeView {
  // Sem horário definido o visor aparece zerado, para o produtor ver que a chave está ligada e
  // que falta preencher o início. Antes ele sumia da tela e parecia que o botão não funcionava.
  if (!p.showStartAt) return { phase: 'idle', seconds: p.showDurationMin * 60 };
  const start = Date.parse(p.showStartAt);
  if (!Number.isFinite(start)) return { phase: 'idle', seconds: p.showDurationMin * 60 };
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

/**
 * Id curto para avisos e páginas.
 *
 * `crypto.randomUUID` só existe em contexto seguro (HTTPS ou localhost). A Rede Local serve as
 * páginas em `http://192.168.x.x:8080`, onde ele NÃO existe: o clique em "Mandar" estourava
 * `crypto.randomUUID is not a function` antes de montar o aviso, e nada chegava à TV. Era o
 * "aviso não funciona" no link que o programa entrega para o celular e para o produtor.
 */
export function newId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (c && typeof c.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // Último recurso (navegador muito antigo): id por tempo + sorte, suficiente para uso local.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_NOTICE_TEXT = 200;
const MAX_HISTORY = 20;

/**
 * Coloca um aviso na tela e guarda no histórico. Devolve null se o texto estiver vazio.
 *
 * `at` é o instante do envio. Quem manda deve passar a hora do servidor
 * (`Date.now() + feed.sync.clockOffsetMs`): a TV compara o tempo do aviso com a hora do servidor,
 * e não com o relógio do próprio aparelho, que pode estar adiantado ou atrasado.
 */
export function withNotice(
  s: PrompterState, text: string, opts: { level: NoticeLevel; layout: NoticeLayout; durationSec: number },
  at: number = Date.now(),
): PrompterState | null {
  const t = text.trim().slice(0, MAX_NOTICE_TEXT);
  if (!t) return null;
  const id = newId();
  return {
    ...s,
    notice: { id, text: t, level: opts.level, layout: opts.layout, sentAt: at, durationSec: opts.durationSec },
    history: [{ id, text: t, at }, ...s.history.filter((h) => h.text !== t)].slice(0, MAX_HISTORY),
  };
}
