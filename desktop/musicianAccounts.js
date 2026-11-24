const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// O bcryptjs só carrega quando uma senha é conferida aqui mesmo (cerca de 5 ms a menos na abertura).
let bcryptLib = null;
const bcrypt = () => bcryptLib || (bcryptLib = require('bcryptjs'));

// Contas dos músicos da Rede Local. Moram no projeto do show (o programa manda e recebe o
// "livro" de contas); aqui ficam enquanto a rede local roda, com uma cópia de segurança no
// disco por projeto, para nada se perder se o programa fechar antes de salvar.
//
// Senha: bcrypt no formato $2a$, o mesmo que o pgcrypto do Supabase confere (crypt/gen_salt
// 'bf'), para a mesma senha valer no Show Online.

const MAX_CONTENT = 1_500_000;
const MAX_TITLE = 200;
const SAVE_DELAY_MS = 400;
const MAX_REMEMBER = 10;
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
// Foto de perfil: o celular manda um JPEG pequeno (src/lib/avatarImage.ts, até 15 000 caracteres).
// O limite deixa folga e segura o tamanho do projeto, que leva a foto de cada músico.
const MAX_AVATAR = 64_000;
const AVATAR_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Foto aceita: data URL de imagem em base64, dentro do limite. */
function validAvatar(value) {
  return typeof value === 'string' && value.length <= MAX_AVATAR && AVATAR_RE.test(value);
}

/** Nome da rede local antiga (cadernos separados por nome): sem maiúscula, acento ou espaço sobrando. */
function musicianKey(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** "João.Baixo " -> "joao.baixo": sem acento, minúsculo, espaços viram ponto. */
function usernameKey(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/\s+/g, '.');
}

function validUsername(value) {
  return USERNAME_RE.test(usernameKey(value));
}

const BCRYPT_ROUNDS = 10;
const toPgcrypto = (hash) => hash.replace(/^\$2b\$/, '$2a$');

function hashPassword(password) {
  return toPgcrypto(bcrypt().hashSync(String(password), BCRYPT_ROUNDS));
}

function checkPassword(password, hash) {
  if (!hash || typeof hash !== 'string') return false;
  try { return bcrypt().compareSync(String(password), hash); } catch { return false; }
}

// ---------- senha fora do processo principal ----------
//
// Cada senha leva cerca de 50 a 70 ms de bcrypt. Calculada aqui, a janela do diretor parava esse
// tempo a cada músico que se cadastrava ou entrava pela primeira vez (é o mesmo processo que
// desenha a janela). Num worker o cálculo é o mesmo, com o mesmo bcryptjs: o código dele vai
// junto, lido daqui (dentro do app.asar o worker não acharia o pacote sozinho). Sem worker, ou se
// ele falhar, a conta é feita aqui como antes. O worker fecha sozinho depois de um tempo parado.
const WORKER_IDLE_MS = 30_000;
const WORKER_JOB_MS = 15_000;
const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const mod = { exports: {} };
new Function('module', 'exports', 'require', workerData.src)(mod, mod.exports, require);
const bcrypt = mod.exports.default || mod.exports;
parentPort.on('message', ({ id, op, password, hash, rounds }) => {
  try {
    if (op === 'hash') { parentPort.postMessage({ id, value: bcrypt.hashSync(String(password), rounds) }); return; }
    let ok = false;
    try { ok = bcrypt.compareSync(String(password), hash); } catch { ok = false; }
    parentPort.postMessage({ id, value: ok });
  } catch (e) {
    parentPort.postMessage({ id, error: String((e && e.message) || e) });
  }
});
`;

let passwordWorker = null; // { w, jobs: Map<id, { resolve, reject, timer }>, idle }
let nextJob = 1;
let workerBroken = false;

function stopPasswordWorker(pw, err) {
  if (passwordWorker === pw) passwordWorker = null;
  clearTimeout(pw.idle);
  for (const job of pw.jobs.values()) { clearTimeout(job.timer); job.reject(err || new Error('worker_closed')); }
  pw.jobs.clear();
  pw.w.terminate().catch(() => {});
}

function startPasswordWorker() {
  const { Worker } = require('node:worker_threads');
  const src = fs.readFileSync(require.resolve('bcryptjs'), 'utf8');
  const w = new Worker(workerSource, { eval: true, workerData: { src } });
  w.unref();
  const pw = { w, jobs: new Map(), idle: null };
  w.on('message', (msg) => {
    const job = pw.jobs.get(msg?.id);
    if (!job) return;
    pw.jobs.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.error) job.reject(new Error(msg.error));
    else job.resolve(msg.value);
    if (pw.jobs.size === 0) {
      // parado não segura o processo aberto (testes, sair do programa)
      pw.w.unref();
      clearTimeout(pw.idle);
      pw.idle = setTimeout(() => stopPasswordWorker(pw), WORKER_IDLE_MS);
      pw.idle.unref?.();
    }
  });
  w.on('error', (err) => { workerBroken = true; stopPasswordWorker(pw, err); });
  w.on('exit', () => stopPasswordWorker(pw, new Error('worker_exit')));
  return pw;
}

/** Roda a conta no worker. Rejeita se não houver worker ou se ele não responder. */
function inWorker(job) {
  return new Promise((resolve, reject) => {
    if (workerBroken) { reject(new Error('worker_unavailable')); return; }
    let pw;
    try {
      pw = passwordWorker || (passwordWorker = startPasswordWorker());
    } catch (err) {
      workerBroken = true;
      reject(err);
      return;
    }
    clearTimeout(pw.idle);
    const id = nextJob++;
    // worker que não responde sai: esta conta e as da fila são feitas aqui mesmo
    const timer = setTimeout(() => stopPasswordWorker(pw, new Error('worker_timeout')), WORKER_JOB_MS);
    timer.unref?.();
    pw.jobs.set(id, { resolve, reject, timer });
    pw.w.ref();
    pw.w.postMessage({ id, ...job });
  });
}

/** O mesmo hashPassword, sem parar o processo principal. */
async function hashPasswordAsync(password) {
  try {
    const hash = await inWorker({ op: 'hash', password: String(password), rounds: BCRYPT_ROUNDS });
    if (typeof hash === 'string' && hash.startsWith('$2')) return toPgcrypto(hash);
  } catch { /* conta aqui mesmo */ }
  return hashPassword(password);
}

/** O mesmo checkPassword, sem parar o processo principal. */
async function checkPasswordAsync(password, hash) {
  if (!hash || typeof hash !== 'string') return false;
  try {
    const ok = await inWorker({ op: 'check', password: String(password), hash });
    if (typeof ok === 'boolean') return ok;
  } catch { /* confere aqui mesmo */ }
  return checkPassword(password, hash);
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function nowIso() { return new Date().toISOString(); }

function newer(a, b) {
  return String(a ?? '') > String(b ?? '');
}

/** Junta dois cadernos da mesma conta: em cada música fica o mais recente. */
function mergeSheets(a = {}, b = {}) {
  const out = { ...a };
  for (const [songId, sheet] of Object.entries(b)) {
    if (!out[songId] || newer(sheet?.updated_at, out[songId]?.updated_at)) out[songId] = sheet;
  }
  return out;
}

/**
 * Junta dois livros de contas. Conta por conta: os dados (nome, senha, situação) do lado com
 * `updatedAt` mais novo; os cadernos música por música. Conta apagada pelo diretor fica em
 * `removed` e não volta.
 */
function mergeBooks(a, b) {
  if (!a) return b;
  if (!b) return a;
  const removed = [...new Set([...(a.removed || []), ...(b.removed || [])])];
  const gone = new Set(removed);
  const byId = new Map();
  for (const acc of [...(a.accounts || []), ...(b.accounts || [])]) {
    if (!acc || gone.has(acc.id)) continue;
    const cur = byId.get(acc.id);
    if (!cur) { byId.set(acc.id, acc); continue; }
    const base = newer(acc.updatedAt, cur.updatedAt) ? acc : cur;
    // Aparelhos lembrados: somam só quando a conta não mudou dos dois lados. Se o diretor
    // zerou a senha ou bloqueou (conta mais nova), vale a lista dele, senão os aparelhos voltavam.
    const sameVersion = String(acc.updatedAt ?? '') === String(cur.updatedAt ?? '');
    byId.set(acc.id, {
      ...base,
      remember: sameVersion
        ? [...new Set([...(cur.remember || []), ...(acc.remember || [])])].slice(-MAX_REMEMBER)
        : (base.remember || []),
      sheets: mergeSheets(cur.sheets, acc.sheets),
    });
  }
  return { id: a.id || b.id, accounts: [...byId.values()], removed };
}

/** Mesmo conteúdo? (para não avisar o programa à toa) */
function sameAccount(x, y) {
  return JSON.stringify(x) === JSON.stringify(y);
}

class LocalAccounts {
  /**
   * @param {object} opts
   * @param {string} opts.dir         pasta das cópias de segurança (uma por projeto)
   * @param {string} [opts.legacyFile] cadernos antigos da rede local, separados por nome
   * @param {(change: {book?: object, account?: object, removedId?: string}) => void} [opts.onChange]
   */
  constructor({ dir, legacyFile, onChange }) {
    this.dir = dir;
    this.legacyFile = legacyFile || null;
    this.onChange = onChange || (() => {});
    this.book = null;
    this.timer = null;
    this.legacy = this.loadLegacy();
  }

  // ---------- disco ----------

  backupFile(id) { return path.join(this.dir, `${id}.json`); }

  readBackup(id) {
    try {
      const d = JSON.parse(fs.readFileSync(this.backupFile(id), 'utf8'));
      return d && Array.isArray(d.accounts) ? d : null;
    } catch { return null; }
  }

  persist() {
    if (this.timer || !this.book) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, SAVE_DELAY_MS);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.book) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = this.backupFile(this.book.id);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.book), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    } catch { /* sem disco: segue em memória (e no projeto) */ }
  }

  loadLegacy() {
    if (!this.legacyFile) return { musicians: {} };
    try {
      const d = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8'));
      if (d && typeof d.musicians === 'object' && d.musicians) return d;
    } catch { /* não tem */ }
    return { musicians: {} };
  }

  saveLegacy() {
    if (!this.legacyFile) return;
    try { fs.writeFileSync(this.legacyFile, JSON.stringify(this.legacy), { mode: 0o600 }); } catch { /* sem disco */ }
  }

  // ---------- livro (vem do projeto) ----------

  /**
   * O programa manda o livro do projeto aberto. Junta com a cópia de segurança desse projeto
   * (o que entrou pela rede e ainda não foi salvo no projeto) e devolve ao programa o que mudou.
   */
  setBook(incoming) {
    const book = incoming && typeof incoming.id === 'string' && Array.isArray(incoming.accounts)
      ? { id: incoming.id, accounts: incoming.accounts, removed: incoming.removed || [] }
      : null;
    if (!book) { this.flush(); this.book = null; return; }
    const sameProject = this.book?.id === book.id;
    const before = sameProject ? this.book : this.readBackup(book.id);
    if (!sameProject) this.flush();
    const merged = mergeBooks(book, before);
    this.book = merged;
    this.persist();
    // o programa só fica sabendo do que ele ainda não tinha
    for (const acc of merged.accounts) {
      const theirs = book.accounts.find((a) => a.id === acc.id);
      if (!theirs || !sameAccount(theirs, acc)) this.onChange({ account: acc });
    }
  }

  ensureBook() {
    if (!this.book) {
      this.book = { id: crypto.randomUUID(), accounts: [], removed: [] };
      this.onChange({ book: { id: this.book.id } });
    }
    return this.book;
  }

  get accounts() { return this.book?.accounts || []; }

  find(id) { return this.accounts.find((a) => a.id === id) || null; }

  findByUsername(username) {
    const key = usernameKey(username);
    return this.accounts.find((a) => a.username === key) || null;
  }

  changed(acc) {
    this.persist();
    this.onChange({ account: acc });
  }

  // ---------- entrar ----------

  /**
   * Conta nova (pendente até o diretor aprovar). Quem tinha caderno na rede local antiga, com
   * o mesmo nome, leva ele junto.
   * @returns {{ account?: object, error?: string }}
   */
  signup(args) {
    const check = this.signupCheck(args);
    if (check.error) return check;
    return this.signupCommit(check, args, hashPassword(args.password));
  }

  /**
   * O mesmo signup, com o bcrypt fora do processo principal (rede local). O usuário é conferido
   * de novo depois da conta da senha: outro celular pode ter pegado o mesmo nesse meio tempo.
   */
  async signupAsync(args) {
    const check = this.signupCheck(args);
    if (check.error) return check;
    const passwordHash = await hashPasswordAsync(args.password);
    const again = this.signupCheck(args);
    if (again.error) return again;
    return this.signupCommit(again, args, passwordHash);
  }

  signupCheck({ username, password, name }) {
    const user = usernameKey(username);
    if (!USERNAME_RE.test(user)) return { error: 'bad_username' };
    if (String(password ?? '').length < 6) return { error: 'weak_password' };
    const cleanName = String(name ?? '').trim().slice(0, 60);
    if (!cleanName) return { error: 'bad_request' };
    this.ensureBook();
    if (this.findByUsername(user)) return { error: 'username_taken' };
    return { user, cleanName };
  }

  signupCommit({ user, cleanName }, { instrument }, passwordHash) {
    const book = this.ensureBook();
    const at = nowIso();
    const acc = {
      id: crypto.randomUUID(),
      username: user,
      name: cleanName,
      instrument: String(instrument ?? '').trim().slice(0, 40),
      avatar: null,
      passwordHash,
      status: 'pending',
      remember: [],
      createdAt: at,
      updatedAt: at,
      sheets: {},
    };
    const old = this.legacy.musicians[musicianKey(cleanName)];
    if (old && old.sheets && typeof old.sheets === 'object') {
      acc.sheets = { ...old.sheets };
      delete this.legacy.musicians[musicianKey(cleanName)];
      this.saveLegacy();
    }
    book.accounts.push(acc);
    this.changed(acc);
    return { account: acc };
  }

  /**
   * Usuário e senha. Conta com a senha zerada pelo diretor: o músico manda o PIN dos músicos
   * (conferido pelo servidor) e uma senha nova em `newPassword`.
   * @returns {{ account?: object, error?: string }}
   */
  login({ username, password, newPassword, pinOk }) {
    const acc = this.findByUsername(username);
    if (!acc) return { error: 'wrong_login' };
    if (acc.status === 'blocked') return { error: 'blocked' };
    if (!acc.passwordHash) {
      if (!pinOk) return { error: 'needs_password' };
      if (String(newPassword ?? '').length < 6) return { error: 'weak_password' };
      acc.passwordHash = hashPassword(newPassword);
      acc.updatedAt = nowIso();
      this.changed(acc);
    } else if (!checkPassword(password, acc.passwordHash)) {
      return { error: 'wrong_login' };
    }
    if (acc.status !== 'approved') return { account: acc, error: 'pending' };
    return { account: acc };
  }

  /**
   * O mesmo login, com o bcrypt fora do processo principal (rede local). A ordem é a de sempre:
   * primeiro a senha é conferida (ou a nova é calculada) no worker, só depois a conta muda. Se a
   * conta mudou enquanto o worker calculava (diretor zerou a senha, livro novo do projeto), confere
   * de novo com a conta de agora.
   */
  async loginAsync(args) {
    const { username, password, newPassword, pinOk } = args;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const acc = this.findByUsername(username);
      if (!acc) return { error: 'wrong_login' };
      if (acc.status === 'blocked') return { error: 'blocked' };
      const before = acc.passwordHash;
      let newHash = null;
      if (!before) {
        if (!pinOk) return { error: 'needs_password' };
        if (String(newPassword ?? '').length < 6) return { error: 'weak_password' };
        newHash = await hashPasswordAsync(newPassword);
      } else if (!(await checkPasswordAsync(password, before))) {
        if (this.findByUsername(username) === acc && acc.passwordHash === before) return { error: 'wrong_login' };
        continue;
      }
      // a conta mudou durante a conta da senha: de novo, com a conta de agora
      if (this.findByUsername(username) !== acc || acc.passwordHash !== before) continue;
      if (acc.status === 'blocked') return { error: 'blocked' };
      if (newHash) {
        acc.passwordHash = newHash;
        acc.updatedAt = nowIso();
        this.changed(acc);
      }
      if (acc.status !== 'approved') return { account: acc, error: 'pending' };
      return { account: acc };
    }
    // a conta não parou de mudar: confere do jeito de antes, de uma vez
    return this.login(args);
  }

  /** Lembrar este aparelho: devolve o código (só o hash fica na conta). */
  remember(acc) {
    const token = crypto.randomBytes(24).toString('base64url');
    acc.remember = [...(acc.remember || []), sha256(token)].slice(-MAX_REMEMBER);
    this.changed(acc);
    return token;
  }

  /** Volta pelo aparelho lembrado. */
  resume(token) {
    if (typeof token !== 'string' || !token) return { error: 'wrong_login' };
    const h = sha256(token);
    const acc = this.accounts.find((a) => (a.remember || []).includes(h));
    // aparelho que o diretor desconectou: o celular avisa por que saiu e pede usuário e senha
    if (!acc) return { error: this.accounts.some((a) => (a.dropped || []).includes(h)) ? 'disconnected' : 'wrong_login' };
    if (acc.status === 'blocked') return { error: 'blocked' };
    if (acc.status !== 'approved') return { account: acc, error: 'pending' };
    return { account: acc };
  }

  forget(acc, token) {
    const h = sha256(token);
    if (!acc || !(acc.remember || []).includes(h)) return;
    acc.remember = acc.remember.filter((x) => x !== h);
    this.changed(acc);
  }

  // ---------- foto de perfil ----------

  /** Foto da conta (null sem foto; conta antiga sem o campo também é sem foto). undefined: conta não existe. */
  avatar(accountId) {
    const acc = this.find(accountId);
    if (!acc) return undefined;
    return validAvatar(acc.avatar) ? acc.avatar : null;
  }

  /**
   * Troca ou remove (null) a foto. Vai para a cópia de segurança (gravada de uma vez, ver flush)
   * e para o programa, que guarda no projeto e mostra ao diretor.
   * @returns {{ ok?: true, error?: 'not_found' | 'too_large' | 'bad_image' }}
   */
  setAvatar(accountId, avatar) {
    const acc = this.find(accountId);
    if (!acc) return { error: 'not_found' };
    if (avatar !== null) {
      if (typeof avatar !== 'string') return { error: 'bad_image' };
      if (avatar.length > MAX_AVATAR) return { error: 'too_large' };
      if (!validAvatar(avatar)) return { error: 'bad_image' };
    }
    if ((acc.avatar ?? null) === avatar) return { ok: true };
    acc.avatar = avatar;
    // hora nova: na junção com a cópia do projeto vale a foto mais recente
    acc.updatedAt = nowIso();
    this.changed(acc);
    return { ok: true };
  }

  // ---------- cadernos ----------

  list(accountId) {
    const acc = this.find(accountId);
    return acc ? Object.values(acc.sheets || {}).filter((s) => !s.deleted) : [];
  }

  save(accountId, { sheetId, songId, title, content }) {
    const acc = this.find(accountId);
    if (!acc || typeof songId !== 'string' || !songId || songId.length > 100) return null;
    if (typeof content !== 'string' || content.length > MAX_CONTENT) return null;
    const existing = acc.sheets?.[songId];
    const sheet = {
      id: existing?.id ?? (typeof sheetId === 'string' && sheetId ? sheetId.slice(0, 64) : crypto.randomUUID()),
      song_id: songId,
      title: String(title ?? '').slice(0, MAX_TITLE),
      content,
      shared_from: existing?.shared_from ?? null,
      updated_at: nowIso(),
    };
    acc.sheets = { ...(acc.sheets || {}), [songId]: sheet };
    this.changed(acc);
    return sheet.id;
  }

  remove(accountId, sheetId) {
    const acc = this.find(accountId);
    if (!acc) return false;
    const entry = Object.entries(acc.sheets || {}).find(([, s]) => s.id === sheetId && !s.deleted);
    if (!entry) return false;
    // fica marcado como apagado (com a hora), para a cópia do projeto não trazer ele de volta
    acc.sheets = { ...acc.sheets, [entry[0]]: { id: entry[1].id, song_id: entry[0], deleted: true, updated_at: nowIso() } };
    this.changed(acc);
    return true;
  }

  colleagues(accountId) {
    return this.accounts
      .filter((a) => a.id !== accountId && a.status === 'approved')
      .map((a) => ({ id: a.id, name: a.name, instrument: a.instrument || '' }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }

  /**
   * Envia o caderno para colegas aprovados. Só grava por cima do que não é trabalho do colega:
   * nada, caderno apagado ou cópia recebida em que ele não mexeu. Antes trocava o caderno inteiro
   * e as cifras, desenhos e fotos que o colega fez naquela música sumiam sem aviso.
   * @returns {{ count: number, skipped: string[] } | null} `skipped`: quem ficou com o caderno dele
   */
  shareSheet(accountId, sheetId, targetIds) {
    const from = this.find(accountId);
    const sheet = from && Object.values(from.sheets || {}).find((s) => s.id === sheetId && !s.deleted);
    if (!sheet || !Array.isArray(targetIds)) return null;
    const wanted = new Set(targetIds.filter((t) => typeof t === 'string'));
    let count = 0;
    const skipped = [];
    for (const acc of this.accounts) {
      if (acc.id === accountId || !wanted.has(acc.id) || acc.status !== 'approved') continue;
      const cur = acc.sheets?.[sheet.song_id];
      // Cópia recebida e nunca editada: `received_at` igual a `updated_at`. O save() monta o
      // caderno sem `received_at`, então qualquer edição do colega na cópia protege o caderno dele.
      // Cópias de antes desta regra (sem `received_at`) também ficam protegidas.
      const free = !cur || cur.deleted || (!!cur.shared_from && !!cur.received_at && cur.received_at === cur.updated_at);
      if (!free) { skipped.push(acc.id); continue; }
      const at = nowIso();
      acc.sheets = {
        ...(acc.sheets || {}),
        [sheet.song_id]: {
          id: cur?.id ?? crypto.randomUUID(),
          song_id: sheet.song_id,
          title: sheet.title,
          content: sheet.content,
          shared_from: from.name,
          received_at: at,
          updated_at: at,
        },
      };
      this.changed(acc);
      count += 1;
    }
    return { count, skipped };
  }

  /** Mesmo envio de shareSheet, devolvendo só quantos receberam (null para pedido inválido). */
  share(accountId, sheetId, targetIds) {
    const r = this.shareSheet(accountId, sheetId, targetIds);
    return r ? r.count : null;
  }
}

module.exports = {
  LocalAccounts, usernameKey, validUsername, hashPassword, checkPassword, mergeBooks, mergeSheets,
  hashPasswordAsync, checkPasswordAsync,
  validAvatar, MAX_AVATAR,
};
