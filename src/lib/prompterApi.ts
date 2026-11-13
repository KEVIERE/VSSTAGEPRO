import { supabase } from '@/lib/supabaseClient';
import type { LyricPage, LyricStyle, PrompterSnapshot, PrompterState, ScreenToggles } from '@/lib/prompterTypes';
import { lyricStyleOf, normalizePages, normalizePrompter, sameLyricStyle } from '@/lib/prompterTypes';
import { isLocalClient } from '@/lib/localNetwork';
import { localProducerPost, localPrompterState } from '@/lib/localClientApi';
import { publicLink } from '@/lib/publicUrl';

function assertOk(data: unknown, fallback: string): Record<string, unknown> {
  if (!data || typeof data !== 'object') throw new Error(fallback);
  const obj = data as Record<string, unknown>;
  if (obj.error) throw new Error(String(obj.error));
  return obj;
}

function rpcError(error: { message: string }): Error {
  return new Error(error.message.includes('too_many_attempts') ? 'too_many_attempts' : error.message);
}

/**
 * `lyrics: null` junto com `lyrics_rev` vem de um servidor que recebeu a versão das letras e viu
 * que nada mudou: quer dizer "use a letra que você já tem" (o usePrompterFeed trata). Sem
 * `lyrics_rev` (servidor antigo), `null` continua valendo lista vazia, como sempre: senão a TV de
 * um show sem letra nunca saía da tela de carregando. Quem chama sem a versão sempre recebe a lista.
 */
function toSnapshot(obj: Record<string, unknown>): PrompterSnapshot {
  const show = obj.show as PrompterSnapshot['show'] | undefined;
  if (!show || typeof show !== 'object') throw new Error('invalid_response');
  const rev = typeof obj.lyrics_rev === 'string' ? obj.lyrics_rev : null;
  const sameLyrics = obj.lyrics === null && rev !== null;
  const lyrics = Array.isArray(obj.lyrics) ? obj.lyrics : [];
  const setlist = show.setlist && Array.isArray(show.setlist.songs) ? show.setlist : null;
  const save = (obj.lyrics_save && typeof obj.lyrics_save === 'object' ? obj.lyrics_save : {}) as Record<string, unknown>;
  const logo = (obj.logo && typeof obj.logo === 'object' ? obj.logo : {}) as Record<string, unknown>;
  return {
    show: {
      name: String(show.name ?? ''),
      setlist: setlist
        ? { songs: setlist.songs, blocks: Array.isArray(setlist.blocks) ? setlist.blocks : [], order: Array.isArray(setlist.order) ? setlist.order : [] }
        : { songs: [], blocks: [], order: [] },
      live: show.live && typeof show.live === 'object' ? show.live : null,
      live_at: String(show.live_at ?? ''),
    },
    prompter: normalizePrompter(obj.prompter),
    lyrics: (sameLyrics ? null : lyrics.map((l: Record<string, unknown>) => ({
      song_id: String(l.song_id ?? ''),
      pages: normalizePages(l.pages),
      updated_at: String(l.updated_at ?? ''),
    }))) as PrompterSnapshot['lyrics'],
    ...(rev !== null ? { lyricsRev: rev } : {}),
    lyricsSave: {
      requestedAt: typeof save.requested_at === 'string' ? save.requested_at : null,
      savedAt: typeof save.saved_at === 'string' ? save.saved_at : null,
    },
    server_now: String(obj.server_now ?? ''),
    joinQr: typeof obj.join_qr === 'string' && obj.join_qr.startsWith('data:image/') ? obj.join_qr : null,
    // Só a Rede Local devolve a logo junto do estado: na nuvem ela vem por `prompter-audio`.
    logo: typeof logo.url === 'string' && logo.url
      ? { url: logo.url, updatedAt: typeof logo.updatedAt === 'string' ? logo.updatedAt : null }
      : null,
  };
}

export async function directorPrompterCodes(
  showId: string, directorKey: string,
): Promise<{ producerCode: string; screenCode: string }> {
  const { data, error } = await supabase.rpc('director_prompter_codes', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  const obj = assertOk(data, 'director_prompter_codes failed');
  return { producerCode: String(obj.producer_code), screenCode: String(obj.screen_code) };
}

export async function directorResetPrompterCodes(showId: string, directorKey: string): Promise<void> {
  const { data, error } = await supabase.rpc('director_reset_prompter_codes', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  assertOk(data, 'director_reset_prompter_codes failed');
}

/**
 * Parâmetros do estado online. `p_lyrics_rev` só vai quando o servidor já mandou uma versão das
 * letras: banco sem a migração nunca manda `lyrics_rev`, então nunca recebe o parâmetro (que ele
 * recusaria por não conhecer).
 */
function stateArgs(code: string, lyricsRev?: string | null): Record<string, string> {
  return typeof lyricsRev === 'string' && lyricsRev ? { p_code: code, p_lyrics_rev: lyricsRev } : { p_code: code };
}

export async function producerState(code: string, lyricsRev?: string | null): Promise<PrompterSnapshot> {
  if (isLocalClient()) return toSnapshot(await localPrompterState('producer', code));
  const { data, error } = await supabase.rpc('producer_state', stateArgs(code, lyricsRev));
  if (error) throw rpcError(error);
  return toSnapshot(assertOk(data, 'producer_state failed'));
}

export async function screenState(code: string, lyricsRev?: string | null): Promise<PrompterSnapshot> {
  if (isLocalClient()) return toSnapshot(await localPrompterState('screen', code));
  const { data, error } = await supabase.rpc('screen_state', stateArgs(code, lyricsRev));
  if (error) throw rpcError(error);
  return toSnapshot(assertOk(data, 'screen_state failed'));
}

export async function producerSaveLyrics(code: string, songId: string, pages: LyricPage[]): Promise<void> {
  if (isLocalClient()) { await localProducerPost(code, 'lyrics', { songId, pages }); return; }
  const { data, error } = await supabase.rpc('producer_save_lyrics', { p_code: code, p_song_id: songId, p_pages: pages });
  if (error) throw rpcError(error);
  assertOk(data, 'save_lyrics failed');
}

export async function producerRequestLyricsSave(code: string): Promise<void> {
  if (isLocalClient()) { await localProducerPost(code, 'lyrics-save', {}); return; }
  const { data, error } = await supabase.rpc('producer_request_lyrics_save', { p_code: code });
  if (error) throw rpcError(error);
  assertOk(data, 'request_lyrics_save failed');
}

export interface DirectorLyrics {
  lyrics: { song_id: string; pages: LyricPage[] }[];
  requestedAt: string | null;
  savedAt: string | null;
}

export async function directorLyricsGet(showId: string, directorKey: string): Promise<DirectorLyrics> {
  const { data, error } = await supabase.rpc('director_lyrics_get', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  const obj = assertOk(data, 'director_lyrics_get failed');
  const list = Array.isArray(obj.lyrics) ? obj.lyrics : [];
  return {
    lyrics: list.map((l: Record<string, unknown>) => ({ song_id: String(l.song_id ?? ''), pages: normalizePages(l.pages) })),
    requestedAt: typeof obj.requested_at === 'string' ? obj.requested_at : null,
    savedAt: typeof obj.saved_at === 'string' ? obj.saved_at : null,
  };
}

export async function directorLyricsAck(showId: string, directorKey: string): Promise<void> {
  const { data, error } = await supabase.rpc('director_lyrics_ack', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  assertOk(data, 'director_lyrics_ack failed');
}

export async function directorLyricsRestore(
  showId: string, directorKey: string, lyrics: Record<string, LyricPage[]>,
): Promise<number> {
  const items = Object.entries(lyrics).filter(([, pages]) => pages.length > 0).map(([song_id, pages]) => ({ song_id, pages }));
  if (items.length === 0) return 0;
  const { data, error } = await supabase.rpc('director_lyrics_restore', { p_show: showId, p_key: directorKey, p_lyrics: items });
  if (error) throw error;
  return Number(assertOk(data, 'director_lyrics_restore failed').added ?? 0);
}

/** Estilo geral da letra que o produtor deixou no show (lido com o código do produtor). */
export async function directorLyricStyleGet(showId: string, directorKey: string): Promise<LyricStyle | null> {
  const { producerCode } = await directorPrompterCodes(showId, directorKey);
  const snap = await producerState(producerCode);
  return lyricStyleOf(snap.prompter);
}

/**
 * Projeto aberto: o show volta a ter o estilo de letra gravado no projeto (o resto da tela fica).
 * Manda só as chaves do estilo: entre ler e gravar, o produtor pode ter mudado a tela, e gravar
 * a cópia inteira desfazia isso.
 */
export async function directorLyricStyleRestore(showId: string, directorKey: string, style: LyricStyle): Promise<boolean> {
  const { producerCode } = await directorPrompterCodes(showId, directorKey);
  const snap = await producerState(producerCode);
  if (sameLyricStyle(lyricStyleOf(snap.prompter), style)) return false;
  await producerPatchPrompter(producerCode, { ...style }, { ...snap.prompter, ...style });
  return true;
}

export async function producerSetPrompter(code: string, state: PrompterState, signal?: AbortSignal): Promise<void> {
  if (isLocalClient()) { await localProducerPost(code, 'prompter', { prompter: state }); return; }
  let q = supabase.rpc('producer_set_prompter', { p_code: code, p_prompter: state });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error) throw rpcError(error);
  assertOk(data, 'set_prompter failed');
}

/** Só o que mudou na tela, chave por chave (as chaves da tela, `toggles`, uma por uma). */
export type PrompterPatch = Partial<Omit<PrompterState, 'toggles'>> & { toggles?: Partial<ScreenToggles> };

/** O banco ainda não tem `producer_patch_prompter` (a migração não rodou): manda o estado inteiro. */
let patchMissing = false;

/**
 * Grava só as chaves que este aparelho mudou: o servidor mescla com o que está lá. Antes cada
 * envio gravava a cópia inteira, e dois aparelhos do produtor (ou o diretor abrindo o projeto)
 * desfaziam o que o outro tinha acabado de mandar. `full` é a cópia inteira, usada quando o
 * servidor ainda não sabe mesclar (banco sem a migração; Rede Local, que recebe a cópia inteira).
 */
export async function producerPatchPrompter(
  code: string, patch: PrompterPatch, full: PrompterState, signal?: AbortSignal,
): Promise<void> {
  if (isLocalClient() || patchMissing) return producerSetPrompter(code, full, signal);
  let q = supabase.rpc('producer_patch_prompter', { p_code: code, p_patch: patch });
  if (signal) q = q.abortSignal(signal);
  const { data, error } = await q;
  if (error && (error.code === 'PGRST202' || /producer_patch_prompter/.test(error.message))) {
    patchMissing = true;
    return producerSetPrompter(code, full, signal);
  }
  if (error) throw rpcError(error);
  assertOk(data, 'patch_prompter failed');
}

// Os links nunca levam o código: quem abre precisa digitá-lo ou colá-lo.
export function producerLink(): string {
  return publicLink('produtor');
}

export function screenLink(): string {
  return publicLink('tela');
}

export function cleanAccessCode(raw: string): string {
  const fromLink = raw.match(/#(?:produtor|tela)=([A-Za-z0-9-]+)/);
  return (fromLink ? fromLink[1] : raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
