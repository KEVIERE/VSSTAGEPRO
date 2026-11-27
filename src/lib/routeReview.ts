// Conferência das faixas na importação e o aprendizado das escolhas da pessoa.
//
// Cada áudio importado ganha um grau de certeza: alto quando o nome diz o instrumento
// (nameRouter), quando a pessoa já ensinou aquele nome antes ou quando a IA ficou bem segura;
// baixo quando nada disso aconteceu. Só os de certeza baixa aparecem na janela "Conferir faixas".
// O que a pessoa confirma ali fica guardado neste computador (a palavra que identifica o
// arquivo, ex.: "HELLAN" = teclado) e vale nas próximas importações, acima da IA e abaixo de
// um nome de instrumento explícito.
//
// Só lógica, sem tela e sem o store: os testes rodam isto direto no Node.
import type { FixedRoutingTarget, RoutingTarget } from '@/types';
import { activeUserGroup, activeUserGroups, isUserGroupId } from './userGroups.ts';

export interface RouteGuess {
  target: RoutingTarget;
  childName: string;
  confidence: number;
}

export type RoutingCertainty = 'high' | 'low';

/** As faixas do programa, na ordem da tela. */
export const REVIEW_TARGETS: readonly RoutingTarget[] = [
  'track-guia', 'track-click', 'track-maestro', 'track-bateria', 'track-percussoes', 'track-contrabaixo',
  'track-guitarras', 'track-violoes', 'track-sanfonas', 'track-teclados', 'track-solos', 'track-outros',
];

/** As faixas da janela: as de fábrica e, antes de Outros, os multigrupos criados pela pessoa. */
export function reviewTargets(): RoutingTarget[] {
  const groups = activeUserGroups().map((g) => g.id);
  if (groups.length === 0) return [...REVIEW_TARGETS];
  const out: RoutingTarget[] = [];
  for (const id of REVIEW_TARGETS) {
    if (id === 'track-outros') out.push(...groups);
    out.push(id);
  }
  return out;
}

/** Faixa que a janela aceita: de fábrica ou multigrupo da pessoa. */
export function isReviewTarget(t: unknown): t is RoutingTarget {
  return typeof t === 'string' && ((REVIEW_TARGETS as readonly string[]).includes(t) || isUserGroupId(t));
}

/** Instrumento padrão da faixa; num multigrupo da pessoa, o nome do grupo. */
export function defaultChildFor(target: RoutingTarget): string {
  if (isUserGroupId(target)) return activeUserGroup(target)?.name ?? 'Extra';
  return DEFAULT_CHILD[target] ?? 'Extra';
}

/** Nome do instrumento quando a pessoa escolhe a faixa e a IA não deu um nome para ela. */
export const DEFAULT_CHILD: Record<FixedRoutingTarget, string> = {
  'track-guia': 'Guia',
  'track-click': 'Click',
  'track-maestro': 'Maestro',
  'track-bateria': 'Bateria',
  'track-percussoes': 'Percussão',
  'track-contrabaixo': 'Contrabaixo',
  'track-guitarras': 'Guitarra',
  'track-violoes': 'Violão',
  'track-sanfonas': 'Sanfona',
  'track-teclados': 'Teclado',
  'track-solos': 'Solo',
  'track-outros': 'Extra',
};

/** Guia, Click e Maestro não têm solo: o botão "É solo" fica apagado nelas. */
export function canBeSolo(target: RoutingTarget): boolean {
  return target !== 'track-guia' && target !== 'track-click' && target !== 'track-maestro' && target !== 'track-solos';
}

// ---------------------------------------------------------------- certeza

/**
 * A IA está segura? Num stem o "Music" leva quase toda a nota, então o instrumento certo fica
 * entre 5% e 60%. Conta a nota e a distância para o 2º palpite: 40% com o 2º bem abaixo, ou
 * 15% com o 2º muito abaixo. Sem palpite nenhum, certeza baixa.
 */
export function aiCertainty(first: RouteGuess | null | undefined, second?: RouteGuess | null): RoutingCertainty {
  if (!first) return 'low';
  const c = first.confidence;
  const s = second && second.target !== first.target ? second.confidence : 0;
  if (c >= 0.4 && s <= c * 0.6) return 'high';
  if (c >= 0.15 && s <= c * 0.35) return 'high';
  return 'low';
}

export interface CertaintyInput {
  /** O nome do arquivo (ou da faixa do REAPER) disse o instrumento. */
  byName: boolean;
  /** A pessoa já ensinou esse nome numa conferência anterior. */
  learned: boolean;
  ai?: RouteGuess | null;
  second?: RouteGuess | null;
  /**
   * O motor de escuta trocou a resposta da votação de hoje: a faixa fica a dele, mas a certeza é
   * baixa (o áudio aparece em "Conferir faixas"). Os trechos do treino e os do programa não são
   * os mesmos, e contagem de maestro sem nome já foi parar em Violões com nota alta.
   */
  aiSwitched?: boolean;
}

export function routeCertainty(i: CertaintyInput): RoutingCertainty {
  if (i.byName || i.learned) return 'high';
  if (i.aiSwitched) return 'low';
  return aiCertainty(i.ai, i.second);
}

// ---------------------------------------------------------------- votação da IA

export type VotedGuess = RouteGuess & { second?: RouteGuess | null };

/**
 * Junta os palpites dos trechos ouvidos (um por trecho, null quando a IA não reconheceu).
 * A decisão (`route`) é exatamente a de antes: vence o instrumento que aparecer mais, desempate
 * pela confiança, e com mais de um trecho precisa de 2 votos. `guesses` traz o 1º e o 2º
 * palpites em faixas diferentes, com a confiança de cada um, mesmo quando não houve decisão.
 */
export function tallyVotes<R extends VotedGuess>(results: Array<R | null>, picks: number, hints: Array<RouteGuess | null> = []): { route: R | null; guesses: RouteGuess[] } {
  const votes = new Map<RoutingTarget, { n: number; conf: number; best: R }>();
  for (const r of results) {
    if (!r) continue;
    const v = votes.get(r.target) ?? { n: 0, conf: 0, best: r };
    v.n++; v.conf += r.confidence;
    if (r.confidence > v.best.confidence) v.best = r;
    votes.set(r.target, v);
  }
  let winner: { n: number; conf: number; best: R } | null = null;
  for (const v of votes.values()) if (!winner || v.n > winner.n || (v.n === winner.n && v.conf > winner.conf)) winner = v;
  const route = winner && winner.n >= 2 ? winner.best : winner && picks < 2 ? winner.best : null;

  const ranked = [...votes.values()].sort((a, b) => b.n - a.n || b.conf - a.conf);
  const guesses: RouteGuess[] = ranked.slice(0, 2).map((v) => plain(v.best));
  if (guesses.length === 1) {
    // um instrumento só nos votos: o 2º palpite vem do que a IA ouviu logo abaixo dele
    let second: RouteGuess | null = null;
    for (const r of results) {
      const s = r?.second;
      if (s && s.target !== guesses[0].target && (!second || s.confidence > second.confidence)) second = s;
    }
    if (second) guesses.push(plain(second));
  }
  if (guesses.length === 0) {
    // a IA não chegou a decidir em trecho nenhum: mostra o que ela mais ouviu, só como pista
    const seen = new Set<RoutingTarget>();
    for (const h of [...hints].filter((x): x is RouteGuess => !!x).sort((a, b) => b.confidence - a.confidence)) {
      if (seen.size >= 2 || seen.has(h.target)) continue;
      seen.add(h.target);
      guesses.push(plain(h));
    }
  }
  return { route, guesses };
}

const plain = (g: RouteGuess): RouteGuess => ({ target: g.target, childName: g.childName, confidence: g.confidence });

// ---------------------------------------------------------------- trecho para ouvir

export interface SampleSource {
  length: number;
  sampleRate: number;
  channels: number;
  sample: (channel: number, index: number) => number;
}

/**
 * Onde começa o trecho de `seconds` em que o áudio soa mais forte (em segundos). Stem de VS
 * costuma começar mudo (o piano só entra no refrão): o botão de ouvir toca a parte que tem som.
 */
export function loudestWindow(src: SampleSource, seconds = 8): number {
  const sr = src.sampleRate;
  if (!(sr > 0) || src.length <= 0 || src.channels < 1) return 0;
  const hop = Math.max(1, Math.round(sr / 4)); // blocos de 0,25 s
  const blocks = Math.ceil(src.length / hop);
  const win = Math.max(1, Math.round((seconds * sr) / hop));
  if (blocks <= win) return 0;
  const energy = new Float64Array(blocks);
  const stride = 16;
  for (let b = 0; b < blocks; b++) {
    const from = b * hop;
    const to = Math.min(src.length, from + hop);
    let e = 0;
    for (let c = 0; c < src.channels; c++) for (let i = from; i < to; i += stride) { const v = src.sample(c, i); e += v * v; }
    energy[b] = e;
  }
  let sum = 0;
  for (let b = 0; b < win; b++) sum += energy[b];
  let best = sum;
  let bestAt = 0;
  for (let b = win; b < blocks; b++) {
    sum += energy[b] - energy[b - win];
    if (sum > best * 1.0001) { best = sum; bestAt = b - win + 1; }
  }
  return (bestAt * hop) / sr;
}

// ---------------------------------------------------------------- aprendizado

export interface LearnedRoute {
  /** As palavras que identificam o arquivo, em maiúsculas e sem acento ("GTR LEAD"). */
  key: string;
  target: RoutingTarget;
  /** Instrumento dentro da faixa ("Teclado", "Guitarra"); com solo, o instrumento do solo. */
  childName: string;
  solo: boolean;
  at: number;
}

export interface LearnedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export const LEARNED_STORAGE_KEY = 'vsstage.learnedRoutes.v1';
const MAX_LEARNED = 400;

/** Palavras que não dizem o que é o áudio: ficam de fora do que é guardado. */
const NOISE_WORDS = new Set([
  'VS', 'STEM', 'STEMS', 'TRACK', 'TRACKS', 'FAIXA', 'AUDIO', 'AUDIOS', 'MIX', 'MIXED', 'MASTER', 'FINAL', 'NOVO', 'NOVA', 'NEW',
  'MONO', 'STEREO', 'ESTEREO', 'WAV', 'MP3', 'AIF', 'AIFF', 'FLAC', 'M4A', 'TAKE', 'BOUNCE', 'PRINT', 'EXPORT', 'BPM',
  'SOLO', 'SL', 'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'THE', 'AND', 'OF', 'COPY', 'COPIA', 'CÓPIA', 'VERSAO', 'VERSION', 'VER',
]);

/** Separa o nome em palavras: sem extensão, sem acento, maiúsculas, letras e números à parte. */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFC')
    .replace(/\.(wav|wave|mp3|aif|aiff|flac|m4a|ogg|caf)$/i, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .toUpperCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const isNumber = (t: string) => /^\d+$/.test(t);
const keyWord = (t: string) => !isNumber(t) && t.length >= 2 && !NOISE_WORDS.has(t);

/**
 * A parte útil do nome do arquivo: tira o nome da música, "VS", números soltos, letras soltas
 * (L, R) e palavras como "stem" e "mix". "HELLAN - Fiquei Sabendo VS 03.wav" vira "HELLAN".
 * Fica no máximo 3 palavras; sem nada útil, null (não aprende).
 */
export function learnedKey(fileName: string, songName?: string, skip?: Iterable<string>): string | null {
  const song = new Set(songName ? nameTokens(songName) : []);
  for (const w of skip ?? []) song.add(w);
  const words = nameTokens(fileName).filter((t) => keyWord(t) && !song.has(t));
  if (words.length === 0) return null;
  return words.slice(0, 3).join(' ');
}

const contains = (hay: string[], needle: string[]) => {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
};

/**
 * Palavras que se repetem nos stems de cada música (a marca do vendedor, "CLUBE DO VS - GTR",
 * "... - BAIXO"): não dizem o instrumento e saem da parte útil do nome. Conta a palavra que está
 * em todos os áudios (música com 3 ou mais) ou em mais da metade (música com 4 ou mais).
 */
export function sharedSongWords(siblings: ReadonlyArray<{ songId: string; songName?: string; fileName: string; clipId: string }>): Map<string, Set<string>> {
  const bySong = new Map<string, Map<string, Set<string>>>();
  for (const sib of siblings) {
    const words = bySong.get(sib.songId) ?? new Map<string, Set<string>>();
    bySong.set(sib.songId, words);
    for (const t of nameTokens(sib.fileName)) {
      if (!keyWord(t)) continue;
      const ids = words.get(t) ?? new Set<string>();
      ids.add(sib.clipId);
      words.set(t, ids);
    }
  }
  const out = new Map<string, Set<string>>();
  for (const [songId, words] of bySong) {
    const n = new Set(siblings.filter((x) => x.songId === songId).map((x) => x.clipId)).size;
    const shared = new Set<string>();
    if (n >= 3) for (const [t, ids] of words) if (ids.size === n || (n >= 4 && ids.size * 2 > n)) shared.add(t);
    out.set(songId, shared);
  }
  return out;
}

/** O que foi aprendido que bate com algum destes nomes: vence o de mais palavras, depois o mais novo. */
export function matchLearned(entries: readonly LearnedRoute[], names: readonly string[]): LearnedRoute | null {
  const lists = names.filter(Boolean).map(nameTokens);
  let best: LearnedRoute | null = null;
  let bestLen = 0;
  for (const e of entries) {
    const needle = e.key.split(' ').filter(Boolean);
    if (!lists.some((l) => contains(l, needle))) continue;
    if (!best || needle.length > bestLen || (needle.length === bestLen && e.at > best.at)) { best = e; bestLen = needle.length; }
  }
  return best;
}

function defaultStorage(): LearnedStorage | null {
  try {
    const ls = (globalThis as { localStorage?: LearnedStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
export function subscribeLearned(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
const notify = () => listeners.forEach((f) => { try { f(); } catch { /* tela fechada */ } });

// O aprendido fica neste computador e vale para todo projeto: só guarda pasta de fábrica. Multigrupo
// é do projeto (as palavras dele já mandam o áudio para lá), então escolha para ele não é aprendida.
const isTarget = (t: unknown): t is RoutingTarget => typeof t === 'string' && (REVIEW_TARGETS as readonly string[]).includes(t);

export function loadLearned(storage: LearnedStorage | null = defaultStorage()): LearnedRoute[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LEARNED_STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as { entries?: unknown };
    if (!Array.isArray(data?.entries)) return [];
    return data.entries.filter((e): e is LearnedRoute => !!e && typeof e === 'object'
      && typeof (e as LearnedRoute).key === 'string' && (e as LearnedRoute).key.length > 0
      && isTarget((e as LearnedRoute).target) && typeof (e as LearnedRoute).childName === 'string')
      .map((e) => ({ key: e.key, target: e.target, childName: e.childName, solo: !!e.solo, at: Number(e.at) || 0 }));
  } catch {
    return [];
  }
}

function saveLearned(list: LearnedRoute[], storage: LearnedStorage | null): boolean {
  if (!storage) return false;
  try {
    const kept = [...list].sort((a, b) => b.at - a.at).slice(0, MAX_LEARNED);
    storage.setItem(LEARNED_STORAGE_KEY, JSON.stringify({ entries: kept }));
    notify();
    return true;
  } catch {
    return false;
  }
}

export interface LearnChoice {
  target: RoutingTarget;
  childName: string;
  solo: boolean;
  /** Palavras comuns aos stems da música (sharedSongWords): não entram na palavra aprendida. */
  skipWords?: readonly string[];
}

/** Guarda a escolha confirmada (a mesma palavra aprendida de novo troca a anterior). */
export function learnRoute(fileName: string, songName: string | undefined, choice: LearnChoice, storage: LearnedStorage | null = defaultStorage(), now = Date.now()): LearnedRoute | null {
  const key = learnedKey(fileName, songName, choice.skipWords);
  if (!key || !isTarget(choice.target)) return null;
  const solo = choice.solo && canBeSolo(choice.target);
  const entry: LearnedRoute = { key, target: choice.target, childName: (choice.childName || defaultChildFor(choice.target)).trim(), solo, at: now };
  const list = loadLearned(storage).filter((e) => e.key !== key);
  list.push(entry);
  return saveLearned(list, storage) ? entry : null;
}

export function forgetLearned(key: string, storage: LearnedStorage | null = defaultStorage()): void {
  saveLearned(loadLearned(storage).filter((e) => e.key !== key), storage);
}

export function clearLearned(storage: LearnedStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (storage.removeItem) storage.removeItem(LEARNED_STORAGE_KEY);
    else storage.setItem(LEARNED_STORAGE_KEY, JSON.stringify({ entries: [] }));
    notify();
  } catch { /* sem como guardar: nada a apagar */ }
}

export interface LearnedDestination {
  target: RoutingTarget;
  instrumentName: string;
  key: string;
}

/** Para onde vai um áudio pelo que foi aprendido (com solo, para Solos com "Guitarra Solo"). */
export function learnedDestination(e: LearnedRoute): LearnedDestination {
  if (e.solo && canBeSolo(e.target)) return { target: 'track-solos', instrumentName: `${e.childName} Solo`, key: e.key };
  return { target: e.target, instrumentName: e.childName, key: e.key };
}

export function routeByLearned(names: readonly string[], entries: readonly LearnedRoute[] = loadLearned()): LearnedDestination | null {
  // nome aprendido para um multigrupo que a pessoa apagou: não vale mais
  const e = matchLearned(entries.filter((x) => !isUserGroupId(x.target)), names);
  return e ? learnedDestination(e) : null;
}

/**
 * Ordem de quem decide a faixa na importação:
 * 1. nome de instrumento explícito (palavra inteira, peso 10 ou mais no nameRouter);
 * 2. o que a pessoa ensinou;
 * 3. nome com abreviação fraca ("gtr", "v1");
 * 4. a IA (feita fora daqui).
 * Devolve quem decidiu, ou null para a IA ouvir.
 */
export type BeforeAiDecision<N> = { kind: 'name'; route: N } | { kind: 'learned'; route: LearnedDestination } | null;

export function decideBeforeAi<N extends { confidence: number }>(byName: N | null, learned: LearnedDestination | null): BeforeAiDecision<N> {
  if (byName && byName.confidence >= 1) return { kind: 'name', route: byName };
  if (learned) return { kind: 'learned', route: learned };
  if (byName) return { kind: 'name', route: byName };
  return null;
}

// ---------------------------------------------------------------- janela "Conferir faixas"

export interface ReviewItem {
  clipId: string;
  songId: string;
  songName: string;
  fileName: string;
  clipName: string;
  /** Faixa onde o áudio está agora (a pasta, para quem está numa trilha dentro dela). */
  current: RoutingTarget;
  /** Instrumento de agora ("Teclado"), sem o número da trilha. */
  currentChild: string;
  certainty: RoutingCertainty;
  /** 1º e 2º palpites da IA, com a confiança de cada um (pode vir vazio). */
  guesses: RouteGuess[];
  /** Onde começa o trecho de 8 s mais forte, em segundos do arquivo. */
  previewAt?: number;
}

export interface ReviewChoice {
  clipId: string;
  target: RoutingTarget;
  solo: boolean;
  /** Nome novo do clipe; vazio ou igual ao de agora, fica como está. */
  rename?: string;
}

/** Só os de certeza baixa: os que o nome ou a IA já decidiram bem não aparecem. */
export function itemsToReview(items: readonly ReviewItem[]): ReviewItem[] {
  return items.filter((i) => i.certainty === 'low');
}

/** Instrumento para a faixa escolhida: o do palpite da IA para aquela faixa, senão o de agora ou o padrão. */
export function instrumentFor(item: ReviewItem, target: RoutingTarget): string {
  if (target === item.current && item.currentChild) return item.currentChild;
  const g = item.guesses.find((x) => x.target === target);
  return g?.childName ?? defaultChildFor(target);
}

/** Escolha inicial de cada linha: fica o palpite da IA (onde o áudio já está). */
export function initialChoice(item: ReviewItem): ReviewChoice {
  return { clipId: item.clipId, target: item.current, solo: false, rename: '' };
}

/** Faixa e instrumento finais de uma escolha (com solo: Solos, "Guitarra Solo"). */
export function finalDestination(item: ReviewItem, choice: ReviewChoice): { target: RoutingTarget; childName: string; baseChild: string; solo: boolean } {
  const baseChild = instrumentFor(item, choice.target);
  if (choice.solo && canBeSolo(choice.target)) return { target: 'track-solos', childName: `${baseChild} Solo`, baseChild, solo: true };
  return { target: choice.target, childName: baseChild, baseChild, solo: false };
}

export interface ReviewApi {
  /** Começa e termina um passo só no Desfazer. */
  beginUndoStep(): void;
  endUndoStep(): void;
  routeClip(clipId: string, target: RoutingTarget, childName: string): void;
  renameClip(clipId: string, name: string): void;
  learn(fileName: string, songName: string, choice: LearnChoice): void;
  /** A pessoa decidiu a faixa deste áudio: a reorganização das faixas não mexe mais nele. */
  lockClip?(clipId: string): void;
}

/** Um áudio da música (para saber se a palavra aprendida aparece em mais de um). */
export interface ReviewSibling {
  songId: string;
  songName: string;
  fileName: string;
  clipId: string;
}

export interface ApplyReviewOptions {
  /** Áudios que a pessoa ouviu na janela: ouvir e deixar onde está também é conferir. */
  heard?: ReadonlySet<string>;
  /** Todos os áudios das músicas conferidas (os que não aparecem na janela também). */
  siblings?: readonly ReviewSibling[];
}

const destKey = (d: { target: RoutingTarget; baseChild: string; solo: boolean }) => `${d.target}|${d.baseChild.toLowerCase()}|${d.solo ? 1 : 0}`;

/**
 * Palavras que não podem ser aprendidas neste Confirmar: as que aparecem em mais de um áudio da
 * mesma música sem que todos eles tenham sido conferidos para o mesmo destino ("HELLAN - ... 01",
 * "02", "03" com instrumentos diferentes; a marca do vendedor em todos os stems), e as que o mesmo
 * Confirmar mandou para destinos diferentes.
 */
export function ambiguousLearnKeys(
  learnable: ReadonlyArray<{ clipId: string; songId: string; songName: string; fileName: string; dest: string }>,
  siblings: readonly ReviewSibling[],
): Set<string> {
  const bad = new Set<string>();
  const shared = sharedSongWords(siblings);
  const keyOf = (x: { songId: string; songName: string; fileName: string }) => learnedKey(x.fileName, x.songName, shared.get(x.songId));
  const destOf = new Map(learnable.map((l) => [l.clipId, l.dest]));
  const destsByKey = new Map<string, Set<string>>();
  for (const l of learnable) {
    const key = keyOf(l);
    if (!key) continue;
    const set = destsByKey.get(key) ?? new Set<string>();
    set.add(l.dest);
    destsByKey.set(key, set);
  }
  for (const [key, set] of destsByKey) if (set.size > 1) bad.add(key);
  // por música: a palavra em mais de um áudio só vale se todos foram conferidos para o mesmo lugar
  const groups = new Map<string, ReviewSibling[]>();
  for (const sib of siblings) {
    const key = keyOf(sib);
    if (!key || !destsByKey.has(key)) continue;
    const g = groups.get(`${sib.songId}|${key}`) ?? [];
    if (!g.some((x) => x.clipId === sib.clipId)) g.push(sib);
    groups.set(`${sib.songId}|${key}`, g);
  }
  for (const [gk, g] of groups) {
    if (g.length < 2) continue;
    const key = gk.slice(gk.indexOf('|') + 1);
    const dests = new Set(g.map((x) => destOf.get(x.clipId) ?? '?'));
    if (dests.size > 1 || dests.has('?')) bad.add(key);
  }
  return bad;
}

/**
 * "Confirmar": aplica tudo num passo só de Desfazer. Áudio que continua onde estava não muda de
 * faixa. Só é aprendida a linha que a pessoa mudou de faixa ou ouviu; o palpite que ninguém mexeu
 * não vira regra, e ficar em Outros sem mudar nada também não (Outros é "não sei"). Palavra que
 * aparece em mais de um áudio da música com destinos diferentes não é aprendida (ambiguousLearnKeys).
 * Devolve quantos áudios mudaram.
 */
export function applyReview(api: ReviewApi, items: readonly ReviewItem[], choices: readonly ReviewChoice[], opts: ApplyReviewOptions = {}): number {
  const byId = new Map(items.map((i) => [i.clipId, i]));
  const heard = opts.heard ?? new Set<string>();
  const plan = choices.flatMap((choice) => {
    const item = byId.get(choice.clipId);
    if (!item) return [];
    const dest = finalDestination(item, choice);
    const moved = dest.target !== item.current || dest.childName !== item.currentChild;
    const touched = moved || heard.has(item.clipId);
    const learn = moved || (touched && dest.target !== 'track-outros');
    return [{ choice, item, dest, moved, touched, learn }];
  });
  const siblings = opts.siblings ?? items.map((i) => ({ songId: i.songId, songName: i.songName, fileName: i.fileName, clipId: i.clipId }));
  const blocked = ambiguousLearnKeys(
    plan.filter((p) => p.learn).map((p) => ({ clipId: p.item.clipId, songId: p.item.songId, songName: p.item.songName, fileName: p.item.fileName, dest: destKey(p.dest) })),
    siblings,
  );
  const shared = sharedSongWords(siblings);
  let changed = 0;
  api.beginUndoStep();
  try {
    for (const { choice, item, dest, moved, touched, learn } of plan) {
      if (moved) api.routeClip(item.clipId, dest.target, dest.childName);
      const name = (choice.rename ?? '').trim();
      const renamed = !!name && name !== item.clipName;
      if (renamed) api.renameClip(item.clipId, name);
      if (moved || renamed) changed++;
      if (touched) api.lockClip?.(item.clipId);
      const skip = [...(shared.get(item.songId) ?? [])];
      const key = learnedKey(item.fileName, item.songName, skip);
      if (learn && key && !blocked.has(key)) api.learn(item.fileName, item.songName, { target: choice.target, childName: dest.baseChild, solo: dest.solo, ...(skip.length ? { skipWords: skip } : {}) });
    }
  } finally {
    api.endUndoStep();
  }
  return changed;
}

/**
 * A reorganização das faixas (reconcileTracks, a cada importação) reclassifica pelo nome do
 * arquivo. Áudio cuja faixa a pessoa decidiu (Confirmar da conferência, ou um nome aprendido na
 * importação) fica onde está, se ainda estiver numa trilha válida.
 */
export function keepsPersonRoute(clip: { routingLocked?: boolean }): boolean {
  return clip.routingLocked === true;
}

/** "62%" para mostrar a confiança. */
export function percent(confidence: number): string {
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}
