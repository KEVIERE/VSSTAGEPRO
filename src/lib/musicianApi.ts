import { supabase } from './supabaseClient';
import type {
  MusicianState, SheetInfo, ColleagueInfo, DirectorMusician,
  Setlist, ShowLive, Membership, MemberStatus, ShowInvite, SheetBackend,
} from './musicianTypes';
import type { Song, Block } from '@/types';

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

export async function musicianState(code: string): Promise<MusicianState> {
  const { data, error } = await supabase.rpc('musician_state', { p_code: code });
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

export async function musicianShareSheet(
  code: string, sheetId: string, targets: string[],
): Promise<number> {
  const { data, error } = await supabase.rpc('musician_share_sheet', {
    p_code: code, p_sheet: sheetId, p_targets: targets,
  });
  if (error) throw error;
  const obj = assertOk(data, 'share_sheet failed');
  return Number(obj.count) || 0;
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
  };
}

export function buildSetlist(
  songs: Song[], blocks: Block[], playlistOrder: string[],
): Setlist {
  return {
    songs: songs.map((s) => ({
      id: s.id, name: s.name, duration: s.duration,
      bpm: effectiveBpm(s.bpm, s.bpmDetected, s.bpmAdjust), blockId: s.blockId,
      baseBpm: s.bpmDetected && s.bpm ? Math.round(s.bpm) : null,
      bpmAdjust: s.bpmAdjust || 0, tuner: s.tuner || 0,
    })),
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
): ShowLive {
  return {
    isPlaying, isPaused, currentTime, songProgress, nextSongCountdown,
    currentSongId, nextSongId, bpm, playFlow, onAir, sliceName, nextSliceName,
    publishedAt: Date.now(),
  };
}
