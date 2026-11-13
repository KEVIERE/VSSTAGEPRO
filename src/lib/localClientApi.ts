import type { LocalRole } from '@/lib/localNetwork';
import { PROJECT_SAVE_STATUSES, readShareResult, type ColleagueInfo, type MusicianState, type SheetBackend, type SheetInfo } from '@/lib/musicianTypes';

const TOKEN_SS = 'vs_local_token_';

/** Avisos iguais em todas as áreas do celular na Rede Local. */
export const LOCAL_NOTICE = {
  disconnected: 'O diretor desconectou este aparelho. Digite o PIN para entrar de novo.',
  notReady: 'Conectado ao Mac do diretor. Esperando ele abrir um projeto com músicas.',
};

function tokenKey(role: LocalRole, pin: string) {
  return `${TOKEN_SS}${role}_${pin}`;
}

// Prazo de cada pedido ao Mac. Os laços só pedem de novo quando o pedido anterior termina; sem
// prazo, um pedido que não volta (Wi-Fi do palco associado mas sem passar pacote, Mac que sumiu
// da rede) segurava a tela em "Sem sinal do diretor" até o navegador desistir, mesmo com a rede
// de volta. Estourou o prazo: vira `offline` e a próxima consulta sai.
const ANSWER_MS = 4000;          // consulta e comando: na rede local a resposta leva dezenas de ms
const REMOTE_COMMAND_MS = 2000;  // comando do VS Stage Remote: a fila dele desiste em 2 s
const PROMPTER_STATE_MS = 8000;  // estado do produtor e da tela: traz as letras do show e o QR
const AUTH_MS = 10_000;          // entrar e criar conta: o Mac confere a senha
const TRANSFER_MS = 60_000;      // logo, caderno com foto, lista de cadernos (vários MB)
const PROJECT_SAVE_MS = 125_000; // o Mac espera até 120 s pelo salvar do projeto (desktop/main.js)

/**
 * Pedido ao Mac do diretor. Cada motivo vira um erro próprio, para a tela não confundir:
 * - `invalid_code`: o PIN está errado (só isso mostra "PIN incorreto");
 * - `disconnected`: o diretor apertou "Desconectar" neste aparelho;
 * - `no_session`: a sessão caiu (programa reaberto); quem chama entra de novo sozinho;
 * - `not_ready`: o Mac respondeu, mas o projeto aberto não tem músicas;
 * - `offline`: o Mac não respondeu (ou não respondeu dentro de `ms`).
 * Antes todo 401/403 virava "PIN incorreto" e o projeto vazio virava "Sem conexão".
 */
async function call(path: string, init: RequestInit = {}, token?: string, ms = ANSWER_MS): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  let res: Response;
  let data: unknown = null;
  try {
    res = await fetch(`/api/local/${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    data = await res.json().catch(() => null);
  } catch {
    throw new Error('offline');
  } finally {
    clearTimeout(timer);
  }
  // Corpo cortado pelo prazo não pode virar "PIN incorreto" (401 sem código) e apagar o PIN.
  if (ctrl.signal.aborted) throw new Error('offline');
  const code = data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
    ? (data as { error: string }).error
    : null;
  if (res.status === 401 || res.status === 403) throw new Error(code || 'invalid_code');
  if (res.status === 429) throw new Error('too_many_attempts');
  if (res.status === 503 && code === 'not_ready') throw new Error('not_ready');
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
      const msg = (e as Error).message;
      if (msg === 'no_session' || msg === 'disconnected') sessionStorage.removeItem(tokenKey(role, pin));
      // Desconectado pelo diretor não entra de novo sozinho: a tela pede o PIN.
      if (msg !== 'no_session') throw e;
    }
  }
  return run(await login(role, pin, name));
}

export function localForget(role: LocalRole, pin: string) {
  sessionStorage.removeItem(tokenKey(role, pin));
}

export function localPrompterState(role: 'producer' | 'screen', pin: string) {
  return withSession(role, pin, role === 'screen' ? 'Tela do palco' : 'Produtor', (t) => call('state', {}, t, PROMPTER_STATE_MS));
}

export function localProducerPost(pin: string, path: 'prompter' | 'lyrics' | 'lyrics-save' | 'logo' | 'logo-remove' | 'references' | 'repertoire-request', body: unknown) {
  // a logo vai em base64 (até 4 MB): prazo de envio grande
  return withSession('producer', pin, 'Produtor', (t) => call(path, { method: 'POST', body: JSON.stringify(body) }, t, path === 'logo' ? TRANSFER_MS : ANSWER_MS));
}

/**
 * VS Stage Remote: o Modo Show inteiro do Mac. `serverNow`: a hora do Mac na resposta, só quando
 * ele manda. Antes, sem ela, ia a hora do celular, e o relógio do Remote achava que os dois
 * relógios eram iguais; sem a hora, quem chama acerta o relógio pelo próprio estado.
 */
export async function localRemoteState(pin: string): Promise<{ remote: unknown; serverNow?: number }> {
  const data = await withSession('remote', pin, 'VS Stage Remote', (t) => call('remote-state', {}, t));
  return { remote: data.remote, serverNow: typeof data.server_now === 'number' && Number.isFinite(data.server_now) ? data.server_now : undefined };
}

/** VS Stage Remote: medidores dos faders (nível de cada canal agora). */
export async function localRemoteMeters(pin: string): Promise<unknown> {
  const data = await withSession('remote', pin, 'VS Stage Remote', (t) => call('remote-meters', {}, t));
  return data.meters;
}

/**
 * VS Stage Remote: manda um comando para o programa do Mac. Prazo do mesmo tamanho da espera da
 * fila do Remote (2 s): com o prazo geral de 4 s, o pedido desistido pela fila continuava no ar e
 * podia chegar ao Mac depois do comando seguinte, fora de ordem.
 */
export function localRemoteCommand(pin: string, cmd: unknown) {
  return withSession('remote', pin, 'VS Stage Remote', (t) => call('transport', { method: 'POST', body: JSON.stringify(cmd) }, t, REMOTE_COMMAND_MS));
}

// ---------- Músico com conta (usuário e senha) ----------

const REMEMBER_LS = 'vs_local_musician_remember';
let musicianToken: string | null = null;

export type MusicianAuthError =
  | 'invalid_code' | 'wrong_login' | 'blocked' | 'username_taken' | 'needs_password'
  | 'bad_username' | 'weak_password' | 'pending' | 'logged_out' | 'disconnected' | 'offline'
  | 'not_ready';

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
  // Voltar pelo aparelho lembrado é consulta (sai sozinho); entrar e criar conta são toque do
  // músico e o Mac confere a senha: prazo maior, para uma resposta só atrasada não ser cortada e
  // virar "Esse usuário já existe" na segunda tentativa.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), body.mode === 'resume' ? ANSWER_MS : AUTH_MS);
  let res: Response;
  let data: Record<string, unknown> | null = null;
  try {
    res = await fetch('/api/local/login', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'musician', ...body }),
    });
    data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    throw new Error('offline');
  } finally {
    clearTimeout(timer);
  }
  // corpo cortado pelo prazo não pode virar "Usuário ou senha incorretos" e esquecer o aparelho
  if (ctrl.signal.aborted) throw new Error('offline');
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
    // Mac fora do ar, ou programa reaberto ainda abrindo o projeto (sem o livro de contas):
    // guarda o aparelho e quem chama tenta de novo. Antes `not_ready` também apagava o aparelho.
    if (msg === 'offline' || msg === 'not_ready') throw new Error(msg);
    if (msg === 'wrong_login' || msg === 'blocked' || msg === 'disconnected') forgetMusician();
    throw new Error(msg === 'blocked' || msg === 'disconnected' ? msg : 'logged_out');
  }
}

/** Chamada com a sessão do músico; se ela caiu (programa reaberto), volta pelo aparelho lembrado. */
async function withMusician(path: string, init: RequestInit = {}, ms?: number): Promise<Record<string, unknown>> {
  if (!musicianToken) {
    const r = await localMusicianResume();
    if (r.pending) throw new Error('pending');
  }
  try {
    return await call(path, init, musicianToken!, ms);
  } catch (e) {
    const msg = (e as Error).message;
    // Desconectado pelo diretor: esquece o aparelho e pede usuário e senha de novo.
    if (msg === 'disconnected') forgetMusician();
    if (msg !== 'no_session') throw e;
    musicianToken = null;
    const r = await localMusicianResume();
    if (r.pending) throw new Error('pending');
    return call(path, init, musicianToken!, ms);
  }
}

export async function localAccountState(): Promise<MusicianState> {
  const data = await withMusician('state');
  const show = data.show as MusicianState['show'] | undefined;
  if (!show || typeof show !== 'object' || !show.setlist || !Array.isArray(show.setlist.songs)) throw new Error('offline');
  return data as unknown as MusicianState;
}

export async function localAccountSheets(): Promise<SheetInfo[]> {
  // a lista traz o conteúdo inteiro de cada caderno, com fotos: prazo de envio grande
  const data = await withMusician('sheets', {}, TRANSFER_MS);
  return Array.isArray(data.sheets) ? (data.sheets as SheetInfo[]) : [];
}

export async function localMusicianLogout() {
  const remember = musicianRemembered();
  try { if (musicianToken) await call('logout', { method: 'POST', body: JSON.stringify({ remember }) }, musicianToken); } catch { /* sai mesmo assim */ }
  forgetMusician();
}

export function localAccountBackend(username: string): SheetBackend {
  const post = (path: string, body: unknown, ms?: number) => withMusician(path, { method: 'POST', body: JSON.stringify(body) }, ms);
  return {
    key: `local:${username}`,
    storedIn: 'na sua conta do show',
    async save(sheetId, songId, title, content) {
      const data = await post('sheet-save', { sheetId, songId, title, content }, TRANSFER_MS);
      if (typeof data.id !== 'string') throw new Error('offline');
      return data.id;
    },
    async saveProject() {
      // o Mac grava o projeto antes de responder (pode esperar a música parar)
      const data = await post('project-save', {}, PROJECT_SAVE_MS);
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
      // `skipped`: colegas que já tinham caderno desta música e ficaram com o deles
      return readShareResult(await post('sheet-share', { sheetId, targets }));
    },
  };
}
