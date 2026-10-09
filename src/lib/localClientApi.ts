import type { LocalRole } from '@/lib/localNetwork';
import type { ColleagueInfo, MusicianState, SheetBackend, SheetInfo } from '@/lib/musicianTypes';

const TOKEN_SS = 'vs_local_token_';

function tokenKey(role: LocalRole, pin: string) {
  return `${TOKEN_SS}${role}_${pin}`;
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`/api/local/${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new Error('offline');
  }
  if (res.status === 401 || res.status === 403) throw new Error('invalid_code');
  if (res.status === 429) throw new Error('too_many_attempts');
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data !== 'object') throw new Error('offline');
  return data as Record<string, unknown>;
}

async function login(role: LocalRole, pin: string, name: string): Promise<string> {
  const data = await call('login', { method: 'POST', body: JSON.stringify({ role, pin, name }) });
  if (typeof data.token !== 'string') throw new Error('invalid_code');
  sessionStorage.setItem(tokenKey(role, pin), data.token);
  return data.token;
}

/** Faz login com o PIN só na primeira vez; depois reaproveita a sessão e entra de novo se ela cair. */
async function withSession<T>(role: LocalRole, pin: string, name: string, run: (token: string) => Promise<T>): Promise<T> {
  const saved = sessionStorage.getItem(tokenKey(role, pin));
  if (saved) {
    try { return await run(saved); } catch (e) {
      if ((e as Error).message !== 'invalid_code') throw e;
      sessionStorage.removeItem(tokenKey(role, pin));
    }
  }
  return run(await login(role, pin, name));
}

export function localForget(role: LocalRole, pin: string) {
  sessionStorage.removeItem(tokenKey(role, pin));
}

export function localPrompterState(role: 'producer' | 'screen', pin: string) {
  return withSession(role, pin, role === 'screen' ? 'Tela do palco' : 'Produtor', (t) => call('state', {}, t));
}

export function localProducerPost(pin: string, path: 'prompter' | 'lyrics' | 'lyrics-save', body: unknown) {
  return withSession('producer', pin, 'Produtor', (t) => call(path, { method: 'POST', body: JSON.stringify(body) }, t));
}

export async function localMusicianState(pin: string, name: string): Promise<MusicianState> {
  const data = await withSession('musician', pin, name, (t) => call('state', {}, t));
  const show = data.show as MusicianState['show'] | undefined;
  if (!show || typeof show !== 'object' || !show.setlist || !Array.isArray(show.setlist.songs)) throw new Error('offline');
  return data as unknown as MusicianState;
}

export async function localMusicianSheets(pin: string, name: string): Promise<SheetInfo[]> {
  const data = await withSession('musician', pin, name, (t) => call('sheets', {}, t));
  return Array.isArray(data.sheets) ? (data.sheets as SheetInfo[]) : [];
}

export function localSheetBackend(pin: string, name: string): SheetBackend {
  const get = (path: string) => withSession('musician', pin, name, (t) => call(path, {}, t));
  const post = (path: string, body: unknown) =>
    withSession('musician', pin, name, (t) => call(path, { method: 'POST', body: JSON.stringify(body) }, t));
  return {
    key: `local:${name.trim().toLowerCase()}`,
    storedIn: 'no Mac do diretor',
    async save(sheetId, songId, title, content) {
      const data = await post('sheet-save', { sheetId, songId, title, content });
      if (typeof data.id !== 'string') throw new Error('offline');
      return data.id;
    },
    async remove(sheetId) { await post('sheet-delete', { sheetId }); },
    async songLyrics(songId) {
      const data = await get(`song-lyrics/${encodeURIComponent(songId)}`);
      return Array.isArray(data.texts) ? data.texts.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
    },
    async colleagues() {
      const data = await get('colleagues');
      return Array.isArray(data.colleagues) ? (data.colleagues as ColleagueInfo[]) : [];
    },
    async share(sheetId, targets) {
      const data = await post('sheet-share', { sheetId, targets });
      return Number(data.count) || 0;
    },
  };
}
