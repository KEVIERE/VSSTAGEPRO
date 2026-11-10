import type { LocalRole } from '@/lib/localNetwork';
import { PROJECT_SAVE_STATUSES, type ColleagueInfo, type MusicianState, type SheetBackend, type SheetInfo } from '@/lib/musicianTypes';

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

export function localProducerPost(pin: string, path: 'prompter' | 'lyrics' | 'lyrics-save' | 'logo' | 'logo-remove', body: unknown) {
  return withSession('producer', pin, 'Produtor', (t) => call(path, { method: 'POST', body: JSON.stringify(body) }, t));
}

/** VS Stage Remote: o Modo Show inteiro do Mac. */
export async function localRemoteState(pin: string): Promise<{ remote: unknown; serverNow: number }> {
  const data = await withSession('remote', pin, 'VS Stage Remote', (t) => call('remote-state', {}, t));
  return { remote: data.remote, serverNow: typeof data.server_now === 'number' ? data.server_now : Date.now() };
}

/** VS Stage Remote: medidores dos faders (nível de cada canal agora). */
export async function localRemoteMeters(pin: string): Promise<unknown> {
  const data = await withSession('remote', pin, 'VS Stage Remote', (t) => call('remote-meters', {}, t));
  return data.meters;
}

/** VS Stage Remote: manda um comando para o programa do Mac. */
export function localRemoteCommand(pin: string, cmd: unknown) {
  return withSession('remote', pin, 'VS Stage Remote', (t) => call('transport', { method: 'POST', body: JSON.stringify(cmd) }, t));
}

// ---------- Músico com conta (usuário e senha) ----------

const REMEMBER_LS = 'vs_local_musician_remember';
let musicianToken: string | null = null;

export type MusicianAuthError =
  | 'invalid_code' | 'wrong_login' | 'blocked' | 'username_taken' | 'needs_password'
  | 'bad_username' | 'weak_password' | 'pending' | 'logged_out' | 'disconnected' | 'offline';

export type MusicianAuth = { pending: false; name: string } | { pending: true; name: string };

export function musicianRemembered(): string | null {
  try { return localStorage.getItem(REMEMBER_LS); } catch { return null; }
}

function keepRemember(remember: unknown) {
  if (typeof remember !== 'string' || !remember) return;
  try { localStorage.setItem(REMEMBER_LS, remember); } catch { /* aparelho sem armazenamento */ }
}

export function forgetMusician() {
  musicianToken = null;
  try { localStorage.removeItem(REMEMBER_LS); } catch { /* sem armazenamento */ }
}

async function musicianAuth(body: Record<string, unknown>): Promise<MusicianAuth> {
  let res: Response;
  try {
    res = await fetch('/api/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'musician', ...body }),
    });
  } catch {
    throw new Error('offline');
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.status === 200 && typeof data?.token === 'string') {
    musicianToken = data.token;
    keepRemember(data.remember);
    return { pending: false, name: String(data.name ?? '') };
  }
  if (res.status === 202 && data?.pending) {
    musicianToken = null;
    keepRemember(data.remember);
    return { pending: true, name: String(data.name ?? '') };
  }
  const code = typeof data?.error === 'string' ? data.error : (res.status >= 500 ? 'offline' : 'wrong_login');
  throw new Error(code);
}

export function localMusicianSignup(p: { pin: string; name: string; instrument: string; username: string; password: string }) {
  return musicianAuth({ mode: 'signup', ...p });
}

export function localMusicianLogin(p: { username: string; password?: string; pin?: string; newPassword?: string }) {
  return musicianAuth({ mode: 'login', ...p });
}

/** Volta pelo aparelho lembrado, sem digitar nada. */
export async function localMusicianResume(): Promise<MusicianAuth> {
  const remember = musicianRemembered();
  if (!remember) throw new Error('logged_out');
  try {
    return await musicianAuth({ mode: 'resume', remember });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== 'offline') forgetMusician();
    throw new Error(msg === 'offline' || msg === 'blocked' || msg === 'disconnected' ? msg : 'logged_out');
  }
}

/** Chamada com a sessão do músico; se ela caiu (programa reaberto), volta pelo aparelho lembrado. */
async function withMusician(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  if (!musicianToken) {
    const r = await localMusicianResume();
    if (r.pending) throw new Error('pending');
  }
  try {
    return await call(path, init, musicianToken!);
  } catch (e) {
    if ((e as Error).message !== 'invalid_code') throw e;
    musicianToken = null;
    const r = await localMusicianResume();
    if (r.pending) throw new Error('pending');
    return call(path, init, musicianToken!);
  }
}

export async function localAccountState(): Promise<MusicianState> {
  const data = await withMusician('state');
  const show = data.show as MusicianState['show'] | undefined;
  if (!show || typeof show !== 'object' || !show.setlist || !Array.isArray(show.setlist.songs)) throw new Error('offline');
  return data as unknown as MusicianState;
}

export async function localAccountSheets(): Promise<SheetInfo[]> {
  const data = await withMusician('sheets');
  return Array.isArray(data.sheets) ? (data.sheets as SheetInfo[]) : [];
}

export async function localMusicianLogout() {
  const remember = musicianRemembered();
  try { if (musicianToken) await call('logout', { method: 'POST', body: JSON.stringify({ remember }) }, musicianToken); } catch { /* sai mesmo assim */ }
  forgetMusician();
}

export function localAccountBackend(username: string): SheetBackend {
  const post = (path: string, body: unknown) => withMusician(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    key: `local:${username}`,
    storedIn: 'na sua conta do show',
    async save(sheetId, songId, title, content) {
      const data = await post('sheet-save', { sheetId, songId, title, content });
      if (typeof data.id !== 'string') throw new Error('offline');
      return data.id;
    },
    async saveProject() {
      const data = await post('project-save', {});
      const status = PROJECT_SAVE_STATUSES.find((s) => s === data.status);
      return status ?? 'error';
    },
    async remove(sheetId) { await post('sheet-delete', { sheetId }); },
    async songLyrics(songId) {
      const data = await withMusician(`song-lyrics/${encodeURIComponent(songId)}`);
      return Array.isArray(data.texts) ? data.texts.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
    },
    async colleagues() {
      const data = await withMusician('colleagues');
      return Array.isArray(data.colleagues) ? (data.colleagues as ColleagueInfo[]) : [];
    },
    async share(sheetId, targets) {
      const data = await post('sheet-share', { sheetId, targets });
      return Number(data.count) || 0;
    },
  };
}
