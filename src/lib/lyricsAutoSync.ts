import type { LyricPage, PageKind } from '@/lib/prompterTypes';

/**
 * Letra automática do teleprompter: transforma o que a IA ouviu (palavras com o tempo de cada
 * uma) em páginas, e cuida das marcações que o produtor apaga, cria e arrasta na onda.
 *
 * Tudo aqui é puro (sem React, sem rede) para poder ser testado em tests/lyricsAutoSync.test.mjs.
 * O resultado é o mesmo formato de página que o teleprompter já usa: { id, time, text, kind }.
 */

/** Uma palavra cantada: texto, início e fim em segundos. */
export interface TimedWord { w: string; s: number; e: number }

/** Trecho no formato que o WhisperX devolve (com `align_output`). Campos podem faltar. */
export interface RawSegment {
  start?: number | null;
  end?: number | null;
  text?: string | null;
  words?: { word?: string | null; start?: number | null; end?: number | null }[] | null;
}

export interface PageLayout {
  /** Caracteres por linha antes de quebrar. A TV do palco mostra letra grande. */
  maxLineChars: number;
  /** Linhas por página. */
  maxLines: number;
  /** Silêncio (s) que vira quebra de linha. */
  lineGap: number;
  /** Silêncio (s) que fecha a página quando ela já tem duas linhas. */
  pageGap: number;
  /** Silêncio (s) que sempre fecha a página (solo, instrumental). */
  hardGap: number;
}

export const DEFAULT_LAYOUT: PageLayout = { maxLineChars: 32, maxLines: 4, lineGap: 0.45, pageGap: 1.4, hardGap: 3 };

const MAX_PAGES = 400;
const MAX_PAGE_TEXT = 600;
/** Distância mínima entre duas marcações vizinhas. */
export const MIN_MARKER_GAP = 0.2;

/**
 * Frases que o Whisper inventa em trecho sem voz (vêm dos vídeos com legenda usados no treino).
 * Um trecho que contém uma delas é descartado inteiro.
 */
const HALLUCINATIONS = [
  'amara.org', 'comunidade amara', 'obrigado por assistir', 'obrigada por assistir', 'inscreva-se', 'se inscreva',
  'inscrevam-se', 'legendas pela', 'legendado por', 'legendas por', 'legenda por', 'ative o sininho',
  'deixe seu like', 'até o próximo vídeo', 'ate o proximo video', 'tradução e legendas', 'transcrição e legendas',
];

const round1 = (t: number) => Math.round(t * 10) / 10;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function defaultId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function isHallucination(text: string): boolean {
  const t = text.toLowerCase();
  return HALLUCINATIONS.some((h) => t.includes(h));
}

/**
 * Palavras com tempo, em ordem, a partir dos trechos do WhisperX.
 *
 * O alinhador às vezes não dá tempo a uma palavra (número, sigla) ou a um trecho inteiro.
 * Nesses casos o tempo é repartido entre os vizinhos, para nenhuma palavra sumir da letra.
 */
export function normalizeWords(segments: RawSegment[]): TimedWord[] {
  const out: TimedWord[] = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (!seg || typeof seg !== 'object') continue;
    const segText = typeof seg.text === 'string' ? seg.text : '';
    const rawWords = Array.isArray(seg.words) ? seg.words : [];
    const wordsText = rawWords.map((w) => (typeof w?.word === 'string' ? w.word : '')).join(' ');
    if (isHallucination(segText) || isHallucination(wordsText)) continue;

    const segStart = finite(seg.start) ? seg.start : null;
    const segEnd = finite(seg.end) ? seg.end : null;

    let items: { w: string; s: number | null; e: number | null }[] = rawWords
      .map((w) => ({
        w: typeof w?.word === 'string' ? w.word.trim() : '',
        s: finite(w?.start) ? w.start : null,
        e: finite(w?.end) ? w.end : null,
      }))
      .filter((w) => w.w.length > 0);
    // Trecho sem alinhamento por palavra: reparte o texto no tempo do trecho.
    if (items.length === 0) {
      items = segText.split(/\s+/).map((w) => w.trim()).filter(Boolean).map((w) => ({ w, s: null, e: null }));
    }
    if (items.length === 0) continue;

    const lo = segStart ?? items.find((w) => w.s !== null)?.s ?? (out.length ? out[out.length - 1].e : 0);
    const hi = segEnd ?? [...items].reverse().find((w) => w.e !== null)?.e ?? lo + items.length * 0.4;

    // Preenche os buracos: cada sequência sem tempo divide o espaço entre o vizinho de antes e o de depois.
    let i = 0;
    while (i < items.length) {
      if (items[i].s !== null) { i++; continue; }
      let j = i;
      while (j < items.length && items[j].s === null) j++;
      const from = i > 0 ? (items[i - 1].e ?? items[i - 1].s ?? lo) : lo;
      const to = j < items.length ? (items[j].s as number) : hi;
      const span = Math.max(0, to - from);
      const n = j - i;
      for (let k = 0; k < n; k++) {
        items[i + k].s = from + (span * k) / n;
        items[i + k].e = from + (span * (k + 1)) / n;
      }
      i = j;
    }

    for (const it of items) {
      const prevS = out.length ? out[out.length - 1].s : 0;
      const s = Math.max(0, it.s as number, prevS);
      const e = Math.max(s, it.e ?? s);
      out.push({ w: it.w, s, e });
    }
  }
  return out;
}

function lineText(words: string[]): string {
  const raw = words.join(' ').replace(/\s+/g, ' ').trim().replace(/[,.;:]+$/, '');
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

function normalizeForCompare(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Parecença entre dois trechos (0 a 1), pelas palavras em comum. */
export function similarity(a: string, b: string): number {
  const sa = new Set(normalizeForCompare(a));
  const sb = new Set(normalizeForCompare(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  sa.forEach((w) => { if (sb.has(w)) common++; });
  return common / (sa.size + sb.size - common);
}

/** Trecho que se repete na música vira Refrão; o resto fica Verso. */
export function markChorus(pages: LyricPage[]): LyricPage[] {
  return pages.map((p, i) => {
    const enough = normalizeForCompare(p.text).length >= 3;
    const repeats = enough && pages.some((q, j) => j !== i && normalizeForCompare(q.text).length >= 3 && similarity(p.text, q.text) >= 0.6);
    const kind: PageKind = repeats ? 'refrao' : 'verso';
    return p.kind === kind ? p : { ...p, kind };
  });
}

/**
 * Monta as páginas da letra a partir das palavras.
 *
 * Quebra a linha num respiro curto, no fim de frase ou quando a linha fica comprida; fecha a
 * página num respiro longo ou quando ela enche. Cada página começa no tempo da primeira palavra.
 */
export function buildPages(words: TimedWord[], layout: Partial<PageLayout> = {}, makeId: () => string = defaultId): LyricPage[] {
  const o = { ...DEFAULT_LAYOUT, ...layout };
  const groups: { start: number; lines: string[][] }[] = [];
  let page: { start: number; lines: string[][] } | null = null;
  let line: string[] = [];
  let lineLen = 0;
  let prev: TimedWord | null = null;

  const closeLine = () => {
    if (page && line.length) page.lines.push(line);
    line = [];
    lineLen = 0;
  };
  const closePage = () => {
    closeLine();
    if (page && page.lines.length) groups.push(page);
    page = null;
  };

  for (const word of words) {
    const w = word.w.trim();
    if (!w) continue;
    if (page && prev) {
      const gap = word.s - prev.e;
      const linesNow = page.lines.length + (line.length ? 1 : 0);
      const tooLong = lineLen + 1 + w.length > o.maxLineChars;
      const sentenceEnd = /[.!?;]$/.test(prev.w);
      const wantsLine = line.length > 0 && (tooLong || gap >= o.pageGap || (line.length >= 2 && (gap >= o.lineGap || sentenceEnd)));
      const wantsPage = gap >= o.hardGap || (gap >= o.pageGap && linesNow >= 2) || (wantsLine && linesNow >= o.maxLines);
      if (wantsPage) closePage();
      else if (wantsLine) closeLine();
    }
    if (!page) page = { start: word.s, lines: [] };
    line.push(w);
    lineLen += (line.length > 1 ? 1 : 0) + w.length;
    prev = word;
  }
  closePage();

  const pages: LyricPage[] = [];
  let lastTime = -Infinity;
  for (const g of groups.slice(0, MAX_PAGES)) {
    const text = g.lines.map(lineText).filter(Boolean).join('\n').slice(0, MAX_PAGE_TEXT);
    if (!text) continue;
    const time = Math.max(round1(g.start), lastTime === -Infinity ? 0 : round1(lastTime + 0.1));
    lastTime = time;
    pages.push({ id: makeId(), time, text, kind: 'verso' });
  }
  return markChorus(pages);
}

function neighborTimes(pages: LyricPage[], idx: number): { prev: number | null; next: number | null } {
  let prev: number | null = null;
  let next: number | null = null;
  for (let i = idx - 1; i >= 0; i--) { const t = pages[i].time; if (t !== null) { prev = t; break; } }
  for (let i = idx + 1; i < pages.length; i++) { const t = pages[i].time; if (t !== null) { next = t; break; } }
  return { prev, next };
}

/**
 * Arrasta uma marcação. Ela não passa por cima das vizinhas: fica entre a de antes e a de
 * depois, com um respiro de MIN_MARKER_GAP. Devolve o mesmo array se nada mudou.
 */
export function moveMarker(pages: LyricPage[], id: string, time: number, duration = 0): LyricPage[] {
  const idx = pages.findIndex((p) => p.id === id);
  if (idx < 0 || !finite(time)) return pages;
  const t = clampMarker(pages, id, time, duration);
  if (t === null || pages[idx].time === t) return pages;
  return pages.map((p, i) => (i === idx ? { ...p, time: t } : p));
}

/** Onde a marcação `id` pode ficar se for solta em `time` (null se não há espaço). */
export function clampMarker(pages: LyricPage[], id: string, time: number, duration = 0): number | null {
  const idx = pages.findIndex((p) => p.id === id);
  if (idx < 0 || !finite(time)) return null;
  const { prev, next } = neighborTimes(pages, idx);
  const min = prev !== null ? Math.ceil((prev + MIN_MARKER_GAP) * 10 - 1e-6) / 10 : 0;
  let max = next !== null ? Math.floor((next - MIN_MARKER_GAP) * 10 + 1e-6) / 10 : Infinity;
  if (duration > 0) max = Math.min(max, Math.floor(duration * 10) / 10);
  if (min > max) return null;
  return Math.min(max, Math.max(min, round1(time)));
}

function joinText(a: string, b: string): string {
  return [a.trim(), b.trim()].filter(Boolean).join('\n').slice(0, MAX_PAGE_TEXT);
}

/**
 * Apaga uma marcação: o trecho dela passa a fazer parte do trecho de antes. A primeira
 * marcação não tem trecho antes; apagar ela junta o trecho seguinte ao primeiro, que continua
 * começando no mesmo tempo. Com uma página só não há o que juntar.
 */
export function removeMarker(pages: LyricPage[], id: string): LyricPage[] {
  const idx = pages.findIndex((p) => p.id === id);
  if (idx < 0 || pages.length < 2) return pages;
  const keep = idx === 0 ? 0 : idx - 1;
  const drop = idx === 0 ? 1 : idx;
  const merged = { ...pages[keep], text: joinText(pages[keep].text, pages[drop].text) };
  return pages.filter((_, i) => i !== drop).map((p, i) => (i === keep ? merged : p));
}

function capitalize(text: string): string {
  const i = text.search(/\S/);
  return i < 0 ? text : text.slice(0, i) + text.charAt(i).toUpperCase() + text.slice(i + 1);
}

/** Divide o texto depois da k-ésima palavra, mantendo as quebras de linha. */
export function splitTextAt(text: string, k: number): [string, string] {
  const head: string[] = [];
  const tail: string[] = [];
  let n = 0;
  for (const rawLine of text.split('\n')) {
    const toks = rawLine.trim().split(/\s+/).filter(Boolean);
    const h: string[] = [];
    const t: string[] = [];
    for (const tok of toks) { (n < k ? h : t).push(tok); n++; }
    if (h.length) head.push(h.join(' '));
    if (t.length) tail.push(t.join(' '));
  }
  return [head.join('\n'), capitalize(tail.join('\n'))];
}

function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Cria uma marcação no tempo `time`, como cortar uma legenda no CapCut.
 *
 * Se cair dentro de um trecho com texto, o trecho é dividido ali: o que é cantado antes fica,
 * o que vem depois vai para a página nova. Com as palavras da IA o corte cai na palavra certa;
 * se o produtor já mexeu no texto (ou não há palavras), o corte é proporcional ao tempo.
 * Antes da primeira marcação, ou sem texto para dividir, a página nova vem vazia.
 */
export function addMarker(
  pages: LyricPage[], time: number, words: TimedWord[] = [], duration = 0, makeId: () => string = defaultId,
): LyricPage[] {
  if (!finite(time) || pages.length >= MAX_PAGES) return pages;
  const t = round1(Math.max(0, duration > 0 ? Math.min(duration, time) : time));
  if (pages.some((p) => p.time !== null && Math.abs(p.time - t) < MIN_MARKER_GAP - 1e-6)) return pages;

  let idx = -1;
  pages.forEach((p, i) => { if (p.time !== null && p.time <= t) idx = i; });

  const blank = (kind: PageKind = 'verso'): LyricPage => ({ id: makeId(), time: t, text: '', kind });

  if (idx < 0) {
    const first = pages.findIndex((p) => p.time !== null);
    const at = first < 0 ? pages.length : first;
    return [...pages.slice(0, at), blank(), ...pages.slice(at)];
  }

  const page = pages[idx];
  const start = page.time as number;
  const { next } = neighborTimes(pages, idx);
  const end = next ?? (duration > 0 ? duration : null);
  const total = countTokens(page.text);

  let k = total;
  const inRange = words.filter((w) => w.s >= start - 0.05 && (next === null || w.s < next));
  if (inRange.length > 0 && inRange.length === total) {
    k = inRange.filter((w) => w.s < t).length;
  } else if (end !== null && end > start) {
    k = Math.round((total * (t - start)) / (end - start));
  }
  k = Math.max(0, Math.min(total, k));

  let added: LyricPage;
  let updated = page;
  if (k > 0 && k < total) {
    const [head, tail] = splitTextAt(page.text, k);
    updated = { ...page, text: head };
    added = { id: makeId(), time: t, text: tail, kind: page.kind };
  } else {
    added = blank(page.kind);
  }
  const out = pages.map((p, i) => (i === idx ? updated : p));
  out.splice(idx + 1, 0, added);
  return out;
}
