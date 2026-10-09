import type { Setlist, ShowLive } from '@/lib/musicianTypes';

export type PageKind = 'verso' | 'refrao' | 'ponte' | 'fala' | 'solo' | 'intro';

export interface LyricPage {
  id: string;
  time: number | null;
  text: string;
  kind: PageKind;
}

export interface SongLyrics {
  song_id: string;
  pages: LyricPage[];
  updated_at: string;
}

export type NoticeLevel = 'info' | 'warn' | 'urgent';
export type NoticeLayout = 'bar' | 'center';

export interface Notice {
  id: string;
  text: string;
  level: NoticeLevel;
  layout: NoticeLayout;
  sentAt: number;
  durationSec: number;
}

export interface ScheduledNotice {
  id: string;
  songId: string;
  text: string;
  level: NoticeLevel;
  layout: NoticeLayout;
  durationSec: number;
}

export interface ScreenToggles {
  lyrics: boolean;
  clock: boolean;
  showTime: boolean;
  nowNext: boolean;
  playlist: boolean;
  notices: boolean;
  logo: boolean;
}

export type LyricAlign = 'left' | 'center' | 'right';

export const LYRIC_COLORS = ['#ffffff', '#ffd60a', '#30d158', '#64d2ff', '#ff9f0a', '#ff6482', '#bf9b6f', '#a1a1a6'];

export type LyricFontGroup = 'Sem serifa' | 'Condensada' | 'Com serifa' | 'Arredondada' | 'Marcante';

export const LYRIC_FONTS: { id: string; label: string; group: LyricFontGroup; css: string }[] = [
  { id: 'inter', label: 'Moderna', group: 'Sem serifa', css: "'Inter', system-ui, sans-serif" },
  { id: 'montserrat', label: 'Geométrica', group: 'Sem serifa', css: "'Montserrat', 'Inter', sans-serif" },
  { id: 'poppins', label: 'Limpa', group: 'Sem serifa', css: "'Poppins', 'Inter', sans-serif" },
  { id: 'opensans', label: 'Neutra', group: 'Sem serifa', css: "'Open Sans', 'Inter', sans-serif" },
  { id: 'barlow', label: 'Condensada', group: 'Condensada', css: "'Barlow Semi Condensed', 'Inter', sans-serif" },
  { id: 'oswald', label: 'Alta', group: 'Condensada', css: "'Oswald', 'Inter', sans-serif" },
  { id: 'robotocondensed', label: 'Estreita', group: 'Condensada', css: "'Roboto Condensed', 'Inter', sans-serif" },
  { id: 'bebas', label: 'Cartaz', group: 'Condensada', css: "'Bebas Neue', 'Oswald', sans-serif" },
  { id: 'merriweather', label: 'Clássica', group: 'Com serifa', css: "'Merriweather', Georgia, serif" },
  { id: 'playfair', label: 'Elegante', group: 'Com serifa', css: "'Playfair Display', Georgia, serif" },
  { id: 'lora', label: 'Livro', group: 'Com serifa', css: "'Lora', Georgia, serif" },
  { id: 'nunito', label: 'Suave', group: 'Arredondada', css: "'Nunito', 'Inter', sans-serif" },
  { id: 'quicksand', label: 'Leve', group: 'Arredondada', css: "'Quicksand', 'Inter', sans-serif" },
  { id: 'anton', label: 'Impacto', group: 'Marcante', css: "'Anton', 'Oswald', sans-serif" },
  { id: 'archivoblack', label: 'Pesada', group: 'Marcante', css: "'Archivo Black', 'Inter', sans-serif" },
  { id: 'permanentmarker', label: 'Pincel', group: 'Marcante', css: "'Permanent Marker', cursive" },
];

export function lyricFontCss(id: string): string {
  return (LYRIC_FONTS.find((f) => f.id === id) ?? LYRIC_FONTS[0]).css;
}

export interface PrompterState {
  toggles: ScreenToggles;
  blackout: boolean;
  fontScale: number;
  lyricColor: string;
  lyricFont: string;
  lyricAlign: LyricAlign;
  mirror: boolean;
  barSize: number;
  showStartAt: string | null;
  showDurationMin: number;
  nudge: { songId: string | null; delta: number };
  notice: Notice | null;
  presets: string[];
  history: { id: string; text: string; at: number }[];
  scheduled: ScheduledNotice[];
}

export interface PrompterSnapshot {
  show: { name: string; setlist: Setlist; live: ShowLive | null; live_at: string };
  prompter: PrompterState;
  lyrics: SongLyrics[];
  lyricsSave: { requestedAt: string | null; savedAt: string | null };
  server_now: string;
}

export const PAGE_KINDS: { id: PageKind; label: string; color: string }[] = [
  { id: 'verso', label: 'Verso', color: '#64d2ff' },
  { id: 'refrao', label: 'Refrão', color: '#30d158' },
  { id: 'ponte', label: 'Ponte', color: '#ffd60a' },
  { id: 'fala', label: 'Fala', color: '#ff9f0a' },
  { id: 'solo', label: 'Solo', color: '#ff6482' },
  { id: 'intro', label: 'Intro', color: '#98989d' },
];

export function kindInfo(kind: PageKind) {
  return PAGE_KINDS.find((k) => k.id === kind) ?? PAGE_KINDS[0];
}

export const DEFAULT_PROMPTER: PrompterState = {
  toggles: { lyrics: true, clock: true, showTime: true, nowNext: true, playlist: true, notices: true, logo: true },
  blackout: false,
  fontScale: 1,
  lyricColor: '#ffffff',
  lyricFont: 'inter',
  lyricAlign: 'center',
  mirror: false,
  barSize: 20,
  showStartAt: null,
  showDurationMin: 120,
  nudge: { songId: null, delta: 0 },
  notice: null,
  presets: ['Mandar um alô para a cidade', 'Agradecer a produção', 'O prefeito chegou', 'Chamar o público para cantar junto', 'Últimas 2 músicas'],
  history: [],
  scheduled: [],
};

const KIND_IDS = new Set(PAGE_KINDS.map((k) => k.id));

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export function normalizePrompter(raw: unknown): PrompterState {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<PrompterState>;
  return {
    toggles: { ...DEFAULT_PROMPTER.toggles, ...(p.toggles ?? {}) },
    blackout: p.blackout === true,
    fontScale: num(p.fontScale, 1, 0.6, 1.6),
    lyricColor: typeof p.lyricColor === 'string' && LYRIC_COLORS.includes(p.lyricColor) ? p.lyricColor : '#ffffff',
    lyricFont: typeof p.lyricFont === 'string' && LYRIC_FONTS.some((f) => f.id === p.lyricFont) ? p.lyricFont : 'inter',
    lyricAlign: p.lyricAlign === 'left' || p.lyricAlign === 'right' ? p.lyricAlign : 'center',
    mirror: p.mirror === true,
    barSize: num(p.barSize, 20, 12, 50),
    showStartAt: typeof p.showStartAt === 'string' ? p.showStartAt : null,
    showDurationMin: num(p.showDurationMin, 120, 1, 600),
    nudge: p.nudge && typeof p.nudge === 'object' ? { songId: p.nudge.songId ?? null, delta: num(p.nudge.delta, 0, -400, 400) } : DEFAULT_PROMPTER.nudge,
    notice: p.notice && typeof p.notice === 'object' && typeof p.notice.text === 'string' ? p.notice : null,
    presets: Array.isArray(p.presets) ? p.presets.filter((x) => typeof x === 'string') : DEFAULT_PROMPTER.presets,
    history: Array.isArray(p.history) ? p.history : [],
    scheduled: Array.isArray(p.scheduled) ? p.scheduled : [],
  };
}

export function normalizePages(raw: unknown): LyricPage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object').map((x: Record<string, unknown>, i) => ({
    id: typeof x.id === 'string' ? x.id : `p${i}`,
    time: typeof x.time === 'number' && Number.isFinite(x.time) ? x.time : null,
    text: typeof x.text === 'string' ? x.text : '',
    kind: KIND_IDS.has(x.kind as PageKind) ? (x.kind as PageKind) : 'verso',
  }));
}
