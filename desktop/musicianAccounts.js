const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

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

function hashPassword(password) {
  return bcrypt.hashSync(String(password), 10).replace(/^\$2b\$/, '$2a$');
}

function checkPassword(password, hash) {
  if (!hash || typeof hash !== 'string') return false;
  try { return bcrypt.compareSync(String(password), hash); } catch { return false; }
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
  signup({ username, password, name, instrument }) {
    const user = usernameKey(username);
    if (!USERNAME_RE.test(user)) return { error: 'bad_username' };
    if (String(password ?? '').length < 6) return { error: 'weak_password' };
    const cleanName = String(name ?? '').trim().slice(0, 60);
    if (!cleanName) return { error: 'bad_request' };
    const book = this.ensureBook();
    if (this.findByUsername(user)) return { error: 'username_taken' };
    const at = nowIso();
    const acc = {
      id: crypto.randomUUID(),
      username: user,
      name: cleanName,
      instrument: String(instrument ?? '').trim().slice(0, 40),
      avatar: null,
      passwordHash: hashPassword(password),
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

  share(accountId, sheetId, targetIds) {
    const from = this.find(accountId);
    const sheet = from && Object.values(from.sheets || {}).find((s) => s.id === sheetId && !s.deleted);
    if (!sheet || !Array.isArray(targetIds)) return null;
    const wanted = new Set(targetIds.filter((t) => typeof t === 'string'));
    let count = 0;
    for (const acc of this.accounts) {
      if (acc.id === accountId || !wanted.has(acc.id) || acc.status !== 'approved') continue;
      acc.sheets = {
        ...(acc.sheets || {}),
        [sheet.song_id]: {
          id: acc.sheets?.[sheet.song_id]?.id ?? crypto.randomUUID(),
          song_id: sheet.song_id,
          title: sheet.title,
          content: sheet.content,
          shared_from: from.name,
          updated_at: nowIso(),
        },
      };
      this.changed(acc);
      count += 1;
    }
    return count;
  }
}

module.exports = {
  LocalAccounts, usernameKey, validUsername, hashPassword, checkPassword, mergeBooks, mergeSheets,
};
