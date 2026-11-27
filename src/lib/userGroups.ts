// Multigrupos criados pela pessoa (Orquestra, Metais, Backs, Coral...). Cada um é uma pasta igual
// às de fábrica: aparece na timeline com as trilhas dentro, tem canal no mixer, saída e medidor.
// Ficam só no projeto em que foram criados (salvos dentro do .vss): projeto novo ou outro projeto
// começa só com as pastas de fábrica. Enquanto o projeto está aberto, arquivo com uma palavra do
// grupo no nome vai para ele, acima da pasta de fábrica, e a IA também manda para ele.
//
// Só lógica, sem tela e sem o store: os testes rodam isto direto no Node.
// Não importa o nameRouter: é ele que consulta este arquivo (roteamento por palavra do grupo).
import type { FixedRoutingTarget, RoutingTarget, Track, UserGroup, UserGroupId } from '../types.ts';

/** As pastas de fábrica, na ordem da tela. */
export const FIXED_ROUTABLE_TRACKS: FixedRoutingTarget[] = [
  'track-guia', 'track-click', 'track-maestro', 'track-bateria', 'track-contrabaixo',
  'track-percussoes', 'track-guitarras', 'track-violoes', 'track-sanfonas',
  'track-teclados', 'track-solos', 'track-outros',
];

export const USER_GROUP_PREFIX = 'track-grupo-';

/** Cores da janela de criar multigrupo (as mesmas do menu de cor da faixa). */
export const USER_GROUP_COLORS = [
  '#30d158', '#0a84ff', '#ff9f0a', '#ff453a', '#bf5af2', '#ffd60a',
  '#64d2ff', '#ff375f', '#5e5ce6', '#32d74b', '#ac8e68', '#8e8e93',
];
const MAX_WORDS = 40;

export function isUserGroupId(id: unknown): id is UserGroupId {
  return typeof id === 'string' && id.startsWith(USER_GROUP_PREFIX) && id.length > USER_GROUP_PREFIX.length;
}

/** Sem acento, minúsculas, "_" e "-" viram espaço, espaços juntos. */
export function plainText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[_\-.]+/g, ' ').replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ').trim();
}

/** Lista de palavras limpa: sem repetição, sem vazio, no máximo 40. */
export function normalizeWords(words: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (typeof w !== 'string') continue;
    const p = plainText(w);
    if (p.length < 2 || out.includes(p)) continue;
    out.push(p);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

/** "trompete, trombone; sax" ou uma por linha. */
export function parseWords(text: string): string[] {
  return normalizeWords(text.split(/[,;\n]+/));
}

// Palavras sugeridas pelo nome do grupo. A chave é comparada com o nome sem acento.
const SUGGESTIONS: Array<{ match: RegExp; words: string[] }> = [
  { match: /\b(metais|metal|metaleira|brass|sopros?|horns?|naipe)\b/, words: ['metais', 'metaleira', 'brass', 'horn', 'horns', 'trompete', 'trumpet', 'trombone', 'trompa', 'tuba', 'fliscorne', 'sax', 'saxofone', 'sopro', 'sopros', 'naipe'] },
  { match: /\b(orquestra|orchestra|orq|cordas|strings?)\b/, words: ['orquestra', 'orchestra', 'orq', 'cordas', 'strings', 'string', 'violino', 'violin', 'cello', 'violoncelo', 'contrabaixo arco'] },
  { match: /\b(backs?|bv|backing|coral|coro|choir|vocais|apoio)\b/, words: ['back', 'backs', 'bv', 'backvocal', 'back vocal', 'vocal', 'vocais', 'coro', 'coral', 'choir', 'apoio'] },
  { match: /\b(madeiras|woodwinds?|flautas?)\b/, words: ['madeiras', 'woodwind', 'flauta', 'flute', 'clarinete', 'clarinet', 'oboe', 'fagote', 'pife'] },
  { match: /\b(pads?|ambiencias?|ambient)\b/, words: ['pad', 'pads', 'ambiencia', 'ambient'] },
  { match: /\b(efeitos?|fx|sfx)\b/, words: ['fx', 'sfx', 'efeito', 'efeitos', 'riser'] },
  { match: /\b(loops?|sequencias?|seq)\b/, words: ['loop', 'loops', 'seq', 'sequencia'] },
];

/** Palavras sugeridas ao criar: as do naipe conhecido, senão o próprio nome (e o singular). */
export function suggestWords(name: string): string[] {
  const p = plainText(name);
  if (!p) return [];
  for (const s of SUGGESTIONS) if (s.match.test(p)) return normalizeWords([p, ...s.words]);
  // singular só do plural simples: 'metais', 'vozes' e 'coros' não viram 'metai', 'voze', 'coro'
  const singular = p.endsWith('s') && !p.endsWith('es') && !p.endsWith('is') && p.length > 3 ? p.slice(0, -1) : '';
  return normalizeWords([p, singular]);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palavra inteira do grupo dentro do texto (já sem acento). */
function hasWord(text: string, word: string): number {
  const m = new RegExp(`(^|[^a-z0-9])${escapeRe(word).replace(/ /g, '\\s*')}(?=$|[^a-z0-9])`).exec(text);
  return m ? m.index + m[1].length : -1;
}

function baseName(fileName: string): string {
  return plainText(fileName.normalize('NFC').replace(/\.[a-z0-9]{2,4}$/i, ''));
}

export interface UserGroupWordHit {
  group: UserGroup;
  /** a palavra do grupo que apareceu no nome (sem acento, minúsculas) */
  word: string;
}

/** O grupo da pessoa que tem uma palavra no nome do arquivo (a palavra mais cedo no nome vence; empate, a mais longa). */
export function matchUserGroupWord(fileName: string, groups: readonly UserGroup[]): UserGroupWordHit | null {
  if (!groups.length || !fileName) return null;
  const text = baseName(fileName);
  let best: { g: UserGroup; w: string; at: number } | null = null;
  for (const g of groups) {
    for (const w of g.words) {
      const at = hasWord(text, w);
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && w.length > best.w.length)) best = { g, w, at };
    }
  }
  return best ? { group: best.g, word: best.w } : null;
}

export function matchUserGroup(fileName: string, groups: readonly UserGroup[]): UserGroup | null {
  return matchUserGroupWord(fileName, groups)?.group ?? null;
}

/** Palavra do grupo como nome de trilha ("trompete" -> "Trompete", "back vocal" -> "Back Vocal"). */
export function wordDisplayName(word: string): string {
  return word.split(' ').filter(Boolean).map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

// ---------------------------------------------------------------- grupos do projeto aberto
// O store avisa aqui quando os grupos do projeto mudam (abrir, criar, editar, apagar, Desfazer).
// Fica só na memória: nada vai para o disco fora do projeto.
let active: readonly UserGroup[] = [];

export function setActiveUserGroups(groups: readonly UserGroup[] | undefined | null): void {
  active = Array.isArray(groups) ? groups.filter((g) => isUserGroupId(g?.id)) : [];
}

/** Os multigrupos do projeto aberto (vazio fora do programa, nos testes, e em projeto sem grupo). */
export function activeUserGroups(): readonly UserGroup[] {
  return active;
}

export function activeUserGroup(id: string): UserGroup | null {
  return active.find((g) => g.id === id) ?? null;
}

// O que a IA devolve (nome do instrumento) e as palavras que contam como dele.
const AI_ALIASES: Record<string, string[]> = {
  backvocal: ['back', 'backs', 'backvocal', 'back vocal', 'backing', 'bv', 'coro', 'coral', 'choir', 'vocal', 'vocais'],
  metais: ['metais', 'metal', 'brass', 'horn', 'sopro', 'sopros', 'naipe'],
  sopro: ['sopro', 'sopros', 'madeiras', 'woodwind'],
  cordas: ['cordas', 'strings', 'string', 'orquestra', 'orchestra'],
  orquestra: ['orquestra', 'orchestra', 'orq', 'cordas', 'strings'],
  violino: ['violino', 'violin', 'cordas', 'strings'],
  violoncelo: ['violoncelo', 'cello', 'cordas', 'strings'],
  trompete: ['trompete', 'trumpet', 'metais', 'brass'],
  trombone: ['trombone', 'metais', 'brass'],
  trompa: ['trompa', 'horn', 'metais', 'brass'],
  saxofone: ['saxofone', 'sax', 'metais', 'sopro'],
  flauta: ['flauta', 'flute', 'sopro', 'madeiras'],
  clarinete: ['clarinete', 'clarinet', 'sopro', 'madeiras'],
};

/** O grupo da pessoa que é do instrumento que a IA ouviu (Trompete -> Metais, Backvocal -> Backs). */
export function userGroupForAi(childName: string, groups: readonly UserGroup[]): UserGroup | null {
  if (!groups.length || !childName) return null;
  const key = plainText(childName);
  const said = new Set([key, ...(AI_ALIASES[key] ?? [])]);
  for (const g of groups) if (g.words.some((w) => said.has(w))) return g;
  return null;
}

/** Palpite da IA levado para o grupo da pessoa quando o instrumento é dele. */
export function aiToUserGroup<R extends { target: RoutingTarget; childName: string }>(route: R, groups: readonly UserGroup[]): R {
  if (route.target === 'track-click' || route.target === 'track-maestro' || isUserGroupId(route.target)) return route;
  // voz principal (Guia) não vai para o grupo; coro (Backvocal) sim
  if (route.target === 'track-guia') return route;
  const g = userGroupForAi(route.childName, groups);
  return g ? { ...route, target: g.id } : route;
}

/** O mesmo, com os grupos do projeto aberto (usado pela IA na importação e no Reclassificar). */
export function routeToUserGroup<R extends { target: RoutingTarget; childName: string }>(route: R): R;
export function routeToUserGroup<R extends { target: RoutingTarget; childName: string }>(route: R | null): R | null;
export function routeToUserGroup<R extends { target: RoutingTarget; childName: string }>(route: R | null): R | null {
  return route ? aiToUserGroup(route, active) : null;
}

/** Canais de topo na ordem padrão: os de fábrica, com os grupos da pessoa logo antes de Outros. */
export function defaultTrackIds(tracks: readonly Pick<Track, 'id' | 'parentId'>[]): RoutingTarget[] {
  const mine = tracks.filter((t) => isUserGroupId(t.id) && !t.parentId).map((t) => t.id as UserGroupId);
  if (mine.length === 0) return FIXED_ROUTABLE_TRACKS;
  const at = FIXED_ROUTABLE_TRACKS.indexOf('track-outros');
  return [...FIXED_ROUTABLE_TRACKS.slice(0, at), ...mine, ...FIXED_ROUTABLE_TRACKS.slice(at)];
}

/**
 * Canais de topo na ordem da tela (timeline, mixer, Modo Show, Rede Local). Sem ordem arrumada
 * pela pessoa (`topOrder`), a padrão. Com ordem, ela vale; o que ficou sem posição (multigrupo
 * criado depois) entra logo antes de Outros, e uma pasta de fábrica sem posição volta para perto
 * da vizinha de sempre.
 */
export function routableTrackIds(tracks: readonly Pick<Track, 'id' | 'parentId' | 'topOrder'>[]): RoutingTarget[] {
  const base = defaultTrackIds(tracks);
  const rank = new Map<string, number>();
  for (const t of tracks) {
    if (!t.parentId && typeof t.topOrder === 'number' && Number.isFinite(t.topOrder)) rank.set(t.id, t.topOrder);
  }
  if (!base.some((id) => rank.has(id))) return base;
  const out = base.filter((id) => rank.has(id)).sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number) || base.indexOf(a) - base.indexOf(b));
  for (const [i, id] of base.entries()) {
    if (rank.has(id)) continue;
    if (isUserGroupId(id)) {
      const outros = out.indexOf('track-outros');
      out.splice(outros < 0 ? out.length : outros, 0, id);
      continue;
    }
    let at = 0;
    for (let k = i - 1; k >= 0; k--) {
      const p = out.indexOf(base[k]);
      if (p >= 0) { at = p + 1; break; }
    }
    out.splice(at, 0, id);
  }
  return out;
}

/**
 * Faixas com a ordem de topo nova depois de arrastar `id` para a posição `slot` da lista `shown`
 * (as faixas de topo como estão na tela). Todas as de topo da tela ganham a posição, para a ordem
 * ficar salva no projeto. Devolve a mesma lista quando nada muda.
 */
export function withTopOrder<T extends Pick<Track, 'id' | 'parentId' | 'topOrder'>>(tracks: T[], shown: readonly string[], next: readonly string[]): T[] {
  if (shown.length === next.length && shown.every((id, i) => id === next[i])) return tracks;
  const pos = new Map(next.map((id, i) => [id, i]));
  return tracks.map((t) => (!t.parentId && pos.has(t.id) && t.topOrder !== pos.get(t.id) ? { ...t, topOrder: pos.get(t.id) } : t));
}

/** Id novo, a partir do nome ("Metais" -> track-grupo-metais-x1y2). */
export function newUserGroupId(name: string, taken: readonly string[] = [], rand = Math.random): UserGroupId {
  const slug = plainText(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'grupo';
  for (;;) {
    const id = `${USER_GROUP_PREFIX}${slug}-${Math.floor(rand() * 36 ** 4).toString(36)}` as UserGroupId;
    if (!taken.includes(id)) return id;
  }
}

/** A faixa mãe do grupo: uma pasta igual às de fábrica. */
export function makeUserGroupTrack(g: UserGroup): Track {
  return {
    id: g.id, name: g.name, type: 'subgroup', color: g.color, volume: 0.8, pan: 0, mute: false, solo: false,
    antiClip: false, isSubgroup: true, parentId: null, children: [], height: 40, visible: true,
    outputChannel: 0, meterLevel: 0, clipIndicator: false, clipPeak: 0,
  };
}

/**
 * Grupos do projeto aberto. Projeto antigo não tem: fica vazio. Grupo sem a faixa mãe ganha a
 * faixa; faixa de grupo sem cadastro (arquivo mexido à mão) ganha o cadastro pelo nome dela.
 */
export function normalizeUserGroups(raw: unknown, tracks: readonly Track[]): { groups: UserGroup[]; tracks: Track[] } {
  const groups: UserGroup[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const g = r as Partial<UserGroup>;
      if (!isUserGroupId(g.id) || groups.some((x) => x.id === g.id)) continue;
      const name = typeof g.name === 'string' && g.name.trim() ? g.name.trim() : 'Multigrupo';
      groups.push({
        id: g.id, name,
        color: typeof g.color === 'string' && g.color ? g.color : '#8e8e93',
        words: Array.isArray(g.words) ? normalizeWords(g.words) : suggestWords(name),
      });
    }
  }
  for (const t of tracks) {
    if (isUserGroupId(t.id) && !t.parentId && !groups.some((g) => g.id === t.id)) {
      groups.push({ id: t.id, name: t.name, color: t.color, words: suggestWords(t.name) });
    }
  }
  const missing = groups.filter((g) => !tracks.some((t) => t.id === g.id));
  const nextTracks = missing.length ? [...tracks, ...missing.map(makeUserGroupTrack)] : [...tracks];
  // a faixa mãe é sempre pasta (arquivo antigo ou mexido)
  return {
    groups,
    tracks: nextTracks.map((t) => (isUserGroupId(t.id) && !t.parentId && !t.isSubgroup ? { ...t, isSubgroup: true, type: 'subgroup' as const } : t)),
  };
}
