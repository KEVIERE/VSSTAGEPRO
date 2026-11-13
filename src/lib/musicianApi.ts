import { supabase } from './supabaseClient';
import {
  readShareResult,
  type MusicianState, type SheetInfo, type ColleagueInfo, type DirectorMusician,
  type Setlist, type ShowLive, type Membership, type MemberStatus, type ShowInvite, type SheetBackend, type ShareResult,
} from './musicianTypes';
import type { Song, Block } from '@/types';
import { isSliceEnabled, medleySlices, sliceParams } from '@/lib/medley';

export function effectiveBpm(bpm: number, detected: boolean | undefined, bpmAdjust: number): number | null {
  if (!detected || !bpm) return null;
  return Math.round(bpm * ((120 + (bpmAdjust ?? 0)) / 120));
}

function assertOk(data: unknown, fallback: string): Record<string, unknown> {
  if (!data || typeof data !== 'object') throw new Error(fallback);
  const obj = data as Record<string, unknown>;
  if (obj.error) throw new Error(String(obj.error));
  return obj;
}

export async function createShow(name: string): Promise<{ showId: string; directorKey: string }> {
  const { data, error } = await supabase.rpc('create_show', { p_name: name });
  if (error) throw error;
  const obj = assertOk(data, 'create_show failed');
  return { showId: String(obj.show_id), directorKey: String(obj.director_key) };
}

export async function directorPublish(
  showId: string, directorKey: string, name: string,
  setlist: Setlist | null, live: ShowLive,
): Promise<void> {
  const { data, error } = await supabase.rpc('director_publish', {
    p_show: showId, p_key: directorKey, p_name: name,
    p_setlist: setlist as unknown as never,
    p_live: live as unknown as never,
  });
  if (error) throw error;
  assertOk(data, 'director_publish failed');
}

export async function directorListMusicians(
  showId: string, directorKey: string,
): Promise<DirectorMusician[]> {
  const { data, error } = await supabase.rpc('director_list_musicians', {
    p_show: showId, p_key: directorKey,
  });
  if (error) throw error;
  const obj = assertOk(data, 'director_list_musicians failed');
  return (obj.musicians as DirectorMusician[]) ?? [];
}

export async function directorAddMusician(
  showId: string, directorKey: string, name: string, instrument: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('director_add_musician', {
    p_show: showId, p_key: directorKey, p_name: name, p_instrument: instrument,
  });
  if (error) throw error;
  const obj = assertOk(data, 'director_add_musician failed');
  return String(obj.id);
}

export async function directorRegenerateCode(
  showId: string, directorKey: string, musicianId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('director_regenerate_code', {
    p_show: showId, p_key: directorKey, p_musician: musicianId,
  });
  if (error) throw error;
  assertOk(data, 'director_regenerate_code failed');
}

export async function directorRemoveMusician(
  showId: string, directorKey: string, musicianId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('director_remove_musician', {
    p_show: showId, p_key: directorKey, p_musician: musicianId,
  });
  if (error) throw error;
  assertOk(data, 'director_remove_musician failed');
}

/** "Desconectar": derruba o músico agora; ele continua na lista e entra de novo. */
export async function directorDisconnectMusician(
  showId: string, directorKey: string, musicianId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc('director_disconnect_musician', {
    p_show: showId, p_key: directorKey, p_musician: musicianId,
  });
  if (error) throw error;
  assertOk(data, 'director_disconnect_musician failed');
}

export async function directorInvite(showId: string, directorKey: string): Promise<ShowInvite> {
  const { data, error } = await supabase.rpc('director_invite', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  const obj = assertOk(data, 'director_invite failed');
  return { invite_code: String(obj.invite_code), allow_code_login: obj.allow_code_login !== false };
}

export async function directorResetInvite(showId: string, directorKey: string): Promise<void> {
  const { data, error } = await supabase.rpc('director_reset_invite', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  assertOk(data, 'director_reset_invite failed');
}

export async function directorSetCodeLogin(showId: string, directorKey: string, allow: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('director_set_code_login', {
    p_show: showId, p_key: directorKey, p_allow: allow,
  });
  if (error) throw error;
  assertOk(data, 'director_set_code_login failed');
}

export async function directorSetStatus(
  showId: string, directorKey: string, musicianId: string, status: 'approved' | 'blocked',
): Promise<void> {
  const { data, error } = await supabase.rpc('director_set_status', {
    p_show: showId, p_key: directorKey, p_musician: musicianId, p_status: status,
  });
  if (error) throw error;
  assertOk(data, 'director_set_status failed');
}

export async function memberMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase.rpc('member_memberships');
  if (error) throw error;
  const obj = assertOk(data, 'member_memberships failed');
  return Array.isArray(obj.memberships) ? (obj.memberships as Membership[]) : [];
}

export async function memberJoin(
  invite: string, name: string, instrument: string,
): Promise<{ id: string; status: MemberStatus }> {
  const { data, error } = await supabase.rpc('member_join', {
    p_invite: invite, p_name: name, p_instrument: instrument,
  });
  if (error) throw error;
  const obj = assertOk(data, 'member_join failed');
  return { id: String(obj.id), status: obj.status as MemberStatus };
}

export async function memberClaimCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('member_claim_code', { p_code: code });
  if (error) {
    if (error.message.includes('too_many_attempts')) throw new Error('too_many_attempts');
    throw error;
  }
  const obj = assertOk(data, 'member_claim_code failed');
  return String(obj.id);
}

export async function memberUpdateProfile(name: string, instrument: string): Promise<void> {
  const { data, error } = await supabase.rpc('member_update_profile', {
    p_name: name, p_instrument: instrument,
  });
  if (error) throw error;
  assertOk(data, 'member_update_profile failed');
}

/** Banco ainda sem `musician_live` (o upgrade do banco não rodou): usa a consulta antiga. */
let liveMissing = false;

/**
 * Prazo de cada consulta do show. O laço da Área do Músico só pede de novo quando a consulta
 * anterior termina; sem prazo, um pedido que não volta (Wi-Fi do palco associado mas sem passar
 * pacote, 4G caindo) segurava a tela em "Sem sinal do diretor" até o navegador desistir, mesmo
 * com a internet de volta. Só nestas consultas: o resto do Supabase segue sem prazo.
 */
const STATE_TIMEOUT_MS = 8000;

async function stateRpc(name: 'musician_live' | 'musician_state', args: Record<string, unknown>) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STATE_TIMEOUT_MS);
  try {
    return await supabase.rpc(name, args).abortSignal(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estado do show para o músico. `since`: hora (do servidor) em que este aparelho entrou; se o
 * diretor apertou "Desconectar" depois dela, dá erro `disconnected`. Sem `since` entra normal.
 */
export async function musicianState(code: string, since: string | null = null): Promise<MusicianState> {
  let res = liveMissing
    ? await stateRpc('musician_state', { p_code: code })
    : await stateRpc('musician_live', { p_code: code, p_since: since });
  if (!liveMissing && res.error && (res.error.code === 'PGRST202' || /musician_live/.test(res.error.message))) {
    liveMissing = true;
    res = await stateRpc('musician_state', { p_code: code });
  }
  const { data, error } = res;
  if (error) {
    if (error.message.includes('too_many_attempts')) throw new Error('too_many_attempts');
    throw error;
  }
  const obj = assertOk(data, 'invalid_code');
  return obj as unknown as MusicianState;
}

export async function musicianSheets(code: string): Promise<SheetInfo[]> {
  const { data, error } = await supabase.rpc('musician_sheets', { p_code: code });
  if (error) throw error;
  const obj = assertOk(data, 'invalid_code');
  return (obj.sheets as SheetInfo[]) ?? [];
}

/** Banco ainda sem `musician_sheets_stamp` (o upgrade do banco não rodou): não confere mais. */
let stampMissing = false;

/** Marca da lista de cadernos (quantos e o mais recente), no mesmo formato de `musicianSheetsStamp`. */
export function sheetsListStamp(list: SheetInfo[]): string {
  // a lista vem do servidor do mais recente para o mais antigo
  return `${list.length}|${list[0]?.updated_at ?? ''}`;
}

/**
 * Consulta leve (poucos bytes) que diz se a lista de cadernos mudou: caderno enviado por colega,
 * feito no outro aparelho ou apagado. A lista inteira (com as fotos) só é baixada quando muda.
 * null: o banco ainda não tem a consulta; segue como antes, sem conferir.
 */
export async function musicianSheetsStamp(code: string): Promise<string | null> {
  if (stampMissing) return null;
  const { data, error } = await supabase.rpc('musician_sheets_stamp', { p_code: code });
  if (error) {
    if (error.code === 'PGRST202' || /musician_sheets_stamp/.test(error.message)) {
      stampMissing = true;
      return null;
    }
    throw error;
  }
  const obj = assertOk(data, 'invalid_code');
  return `${Number(obj.n) || 0}|${typeof obj.at === 'string' ? obj.at : ''}`;
}

export async function musicianSaveSheet(
  code: string, sheetId: string | null, songId: string, title: string, content: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('musician_save_sheet', {
    p_code: code, p_sheet: sheetId, p_song_id: songId, p_title: title, p_content: content,
  });
  if (error) throw error;
  const obj = assertOk(data, 'save_sheet failed');
  return String(obj.id);
}

export async function musicianSongLyrics(code: string, songId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('musician_song_lyrics', { p_code: code, p_song_id: songId });
  if (error) throw error;
  const obj = assertOk(data, 'song_lyrics failed');
  return Array.isArray(obj.texts) ? obj.texts.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
}

export async function musicianDeleteSheet(code: string, sheetId: string): Promise<void> {
  const { data, error } = await supabase.rpc('musician_delete_sheet', {
    p_code: code, p_sheet: sheetId,
  });
  if (error) throw error;
  assertOk(data, 'delete_sheet failed');
}

export async function musicianColleagues(code: string): Promise<ColleagueInfo[]> {
  const { data, error } = await supabase.rpc('musician_colleagues', { p_code: code });
  if (error) throw error;
  const obj = assertOk(data, 'invalid_code');
  return (obj.colleagues as ColleagueInfo[]) ?? [];
}

/**
 * Envia o caderno para colegas. `skipped`: quem já tinha caderno desta música (feito por ele ou
 * cópia em que mexeu) e ficou com o dele. Banco sem a migração nova: vem só `count`.
 */
export async function musicianShareSheet(
  code: string, sheetId: string, targets: string[],
): Promise<ShareResult> {
  const { data, error } = await supabase.rpc('musician_share_sheet', {
    p_code: code, p_sheet: sheetId, p_targets: targets,
  });
  if (error) throw error;
  return readShareResult(assertOk(data, 'share_sheet failed'));
}

export async function musicianAvatar(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('musician_avatar', { p_code: code });
  if (error) throw error;
  const obj = assertOk(data, 'musician_avatar failed');
  return typeof obj.avatar === 'string' ? obj.avatar : null;
}

export async function musicianSetAvatar(code: string, avatar: string | null): Promise<void> {
  const { data, error } = await supabase.rpc('musician_set_avatar', { p_code: code, p_avatar: avatar });
  if (error) throw error;
  assertOk(data, 'musician_set_avatar failed');
}

/** Fotos dos músicos do show (id → foto). Lida quando a janela abre, não a cada consulta da lista. */
export async function directorMusicianAvatars(showId: string, directorKey: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('director_musician_avatars', { p_show: showId, p_key: directorKey });
  if (error) throw error;
  const obj = assertOk(data, 'director_musician_avatars failed');
  return (obj.avatars as Record<string, string>) ?? {};
}

export function onlineSheetBackend(code: string): SheetBackend {
  return {
    key: `online:${code}`,
    storedIn: 'na sua conta',
    save: (sheetId, songId, title, content) => musicianSaveSheet(code, sheetId, songId, title, content),
    remove: (sheetId) => musicianDeleteSheet(code, sheetId),
    songLyrics: (songId) => musicianSongLyrics(code, songId),
    colleagues: () => musicianColleagues(code),
    share: (sheetId, targets) => musicianShareSheet(code, sheetId, targets),
    avatar: () => musicianAvatar(code),
    setAvatar: (avatar) => musicianSetAvatar(code, avatar),
  };
}

export function buildSetlist(
  songs: Song[], blocks: Block[], playlistOrder: string[], songKeys?: Record<string, { key: string }>,
): Setlist {
  return {
    songs: songs.map((s) => ({
      id: s.id, name: s.name, duration: s.duration,
      bpm: effectiveBpm(s.bpm, s.bpmDetected, s.bpmAdjust), blockId: s.blockId,
      baseBpm: s.bpmDetected && s.bpm ? Math.round(s.bpm) : null,
      bpmAdjust: s.bpmAdjust || 0, tuner: s.tuner || 0,
      musicKey: s.musicKey || songKeys?.[s.id]?.key || undefined,
      // bpmAdjust de cada parte: a sincronia automática da letra segue o andamento de cada uma
      parts: medleySlices(s).map((p) => ({
        id: p.id, name: p.name, start: p.start, end: p.end, bpmAdjust: sliceParams(s, p).bpmAdjust,
        ...(isSliceEnabled(p) ? {} : { enabled: false }),
      })),
    })).map((x) => (x.parts.length ? x : { ...x, parts: undefined })),
    blocks: blocks.map((b) => ({ id: b.id, name: b.name, color: b.color })),
    order: playlistOrder,
  };
}

export function buildLive(
  isPlaying: boolean, isPaused: boolean, currentTime: number,
  songProgress: number, nextSongCountdown: number,
  currentSongId: string | null, nextSongId: string | null,
  bpm: number | null, playFlow: string, onAir: boolean,
  sliceName: string | null = null, nextSliceName: string | null = null,
  sliceId: string | null = null, nextSliceId: string | null = null,
  tuner: number | null = null,
): ShowLive {
  return {
    isPlaying, isPaused, currentTime, songProgress, nextSongCountdown,
    currentSongId, nextSongId, bpm, playFlow, onAir, sliceName, nextSliceName, sliceId, nextSliceId, tuner,
    publishedAt: Date.now(),
  };
}
