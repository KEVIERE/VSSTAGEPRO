const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const QRCode = require('qrcode');
const { resolveStatic } = require('./staticFiles');
const { LocalSheets } = require('./localSheets');

const DEFAULT_PORT = 8080;
const HOST_NAME = 'vsstage.local';
const ONLINE_WINDOW_MS = 10_000;
const MAX_BODY = 4 * 1024 * 1024;
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 5 * 60_000;
const SCREEN_CODE = 'TELA';
const ROLES = new Set(['musician', 'producer', 'screen']);
// Caminho da área (músico, produtor, tela) no link. Vai no endereço, não depois de '#',
// porque os aplicativos de mensagem cortam o que vem depois do '#' e a pessoa não chegava
// na área certa — só o QR code, que guarda o endereço inteiro, funcionava.
const PATH = { musician: 'musico', producer: 'produtor', screen: 'tela' };

function newPin(other) {
  let pin;
  do { pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); } while (pin === other);
  return pin;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out.sort((a, b) => Number(a.startsWith('169.254.')) - Number(b.startsWith('169.254.')));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class LocalServer {
  constructor({ webRoot, storePath, version }) {
    this.webRoot = webRoot;
    this.version = String(version || '');
    this.storePath = storePath;
    this.server = null;
    this.port = DEFAULT_PORT;
    this.error = null;
    this.mdns = null;
    this.mdnsAddress = null;
    this.sessions = new Map();
    this.failures = new Map();
    this.banned = new Set();
    this.published = null;
    this.publishedAt = new Date().toISOString();
    this.producerLyrics = {};
    this.lyricsUpdatedAt = {};
    this.clearOverridesOnPublish = false;
    this.lyricsSave = { requestedAt: null, savedAt: null };
    this.pendingSaveRequest = null;
    this.qrCache = new Map();
    this.sheets = new LocalSheets(path.join(path.dirname(storePath), 'rede-local-cadernos.json'));
    const saved = this.load();
    this.pins = saved.pins;
    this.prompter = saved.prompter;
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      const ok = (p) => typeof p === 'string' && /^\d{6}$/.test(p);
      if (ok(data?.pins?.musician) && ok(data?.pins?.producer) && data.pins.musician !== data.pins.producer) {
        return { pins: data.pins, prompter: data.prompter && typeof data.prompter === 'object' ? data.prompter : null };
      }
    } catch { /* primeira vez: cria PINs novos */ }
    const musician = newPin();
    const pins = { musician, producer: newPin(musician) };
    this.persist({ pins, prompter: null });
    return { pins, prompter: null };
  }

  persist(data = { pins: this.pins, prompter: this.prompter }) {
    try { fs.writeFileSync(this.storePath, JSON.stringify(data), { mode: 0o600 }); } catch { /* sem disco: segue em memória */ }
  }

  get running() { return !!this.server?.listening; }

  start() {
    if (this.server) return Promise.resolve();
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => this.handle(req, res).catch(() => this.json(res, 500, { error: 'server_error' })));
      let port = DEFAULT_PORT;
      server.on('error', (e) => {
        if (e.code === 'EADDRINUSE' && port < DEFAULT_PORT + 20) { port += 1; server.listen(port, '0.0.0.0'); return; }
        this.error = 'Não consegui ligar a rede local neste Mac.';
        this.server = null;
        resolve();
      });
      server.on('listening', () => {
        this.server = server;
        this.port = port;
        this.error = null;
        this.refreshMdns();
        resolve();
      });
      server.listen(port, '0.0.0.0');
    });
  }

  stop() {
    this.sheets.flush();
    this.stopMdns();
    this.sessions.clear();
    if (!this.server) return Promise.resolve();
    const s = this.server;
    this.server = null;
    return new Promise((resolve) => { s.close(() => resolve()); s.closeAllConnections?.(); });
  }

  // Registra vsstage.local com o próprio Bonjour do macOS, apontando para o IP atual.
  refreshMdns() {
    if (!this.running || process.platform !== 'darwin') return;
    const ip = lanAddresses()[0] || null;
    if (ip === this.mdnsAddress && this.mdns) return;
    this.stopMdns();
    if (!ip) return;
    this.mdnsAddress = ip;
    try {
      this.mdns = spawn('/usr/bin/dns-sd', ['-P', 'VS Stage', '_http._tcp', 'local', String(this.port), HOST_NAME, ip], { stdio: 'ignore' });
      this.mdns.on('exit', () => { this.mdns = null; });
    } catch {
      this.mdns = null;
    }
  }

  stopMdns() {
    if (this.mdns) { this.mdns.kill(); this.mdns = null; }
    this.mdnsAddress = null;
  }

  get mdnsActive() { return !!this.mdns && !this.mdns.killed; }

  async info() {
    this.refreshMdns();
    const addresses = lanAddresses();
    const base = this.running && addresses[0] ? `http://${addresses[0]}:${this.port}` : null;
    const urls = {};
    const qr = {};
    for (const role of ROLES) {
      urls[role] = base ? `${base}/${PATH[role]}` : null;
      qr[role] = urls[role] ? await this.qr(urls[role]) : null;
    }
    const now = Date.now();
    const clients = [...this.sessions.values()]
      .filter((s) => now - s.lastSeen < ONLINE_WINDOW_MS)
      .map(({ id, role, name, address, lastSeen }) => ({ id, role, name, address, lastSeen }));
    return {
      running: this.running,
      port: this.port,
      hostName: this.running && this.mdnsActive ? HOST_NAME : null,
      addresses,
      pins: { ...this.pins },
      qr,
      urls,
      clients,
      lyrics: this.mergedLyrics(),
      lyricsSaveRequestedAt: this.pendingSaveRequest,
      error: this.error,
    };
  }

  async qr(text) {
    if (!this.qrCache.has(text)) {
      this.qrCache.set(text, await QRCode.toDataURL(text, { margin: 1, width: 256, errorCorrectionLevel: 'M' }));
    }
    return this.qrCache.get(text);
  }

  publish(payload) {
    if (!payload || typeof payload !== 'object') return;
    this.published = {
      name: String(payload.name ?? ''),
      setlist: payload.setlist && Array.isArray(payload.setlist.songs) ? payload.setlist : null,
      live: payload.live && typeof payload.live === 'object' ? payload.live : null,
      lyrics: payload.lyrics && typeof payload.lyrics === 'object' ? payload.lyrics : {},
    };
    this.publishedAt = new Date().toISOString();
    if (this.clearOverridesOnPublish) {
      this.producerLyrics = {};
      this.clearOverridesOnPublish = false;
    }
  }

  regeneratePin(role) {
    if (role !== 'musician' && role !== 'producer') return;
    const other = role === 'musician' ? this.pins.producer : this.pins.musician;
    this.pins = { ...this.pins, [role]: newPin(other) };
    for (const [token, s] of this.sessions) if (s.role === role) this.sessions.delete(token);
    this.banned.clear();
    this.persist();
  }

  // Desconecta e bloqueia o aparelho até gerar um PIN novo ou religar a rede local.
  kick(clientId) {
    for (const [token, s] of this.sessions) {
      if (s.id === clientId) { this.sessions.delete(token); this.banned.add(`${s.role}|${s.address}`); }
    }
  }

  ackLyricsSave() {
    this.pendingSaveRequest = null;
    this.lyricsSave = { ...this.lyricsSave, savedAt: new Date().toISOString() };
    this.clearOverridesOnPublish = true;
  }

  mergedLyrics() {
    return { ...(this.published?.lyrics || {}), ...this.producerLyrics };
  }

  // ---------- HTTP ----------

  json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); }
      });
      req.on('error', reject);
    });
  }

  address(req) {
    return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  }

  tooManyFailures(addr) {
    const f = this.failures.get(addr);
    if (!f || Date.now() - f.since > FAIL_WINDOW_MS) return false;
    return f.count >= FAIL_LIMIT;
  }

  noteFailure(addr) {
    const f = this.failures.get(addr);
    if (!f || Date.now() - f.since > FAIL_WINDOW_MS) this.failures.set(addr, { count: 1, since: Date.now() });
    else f.count += 1;
  }

  session(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const s = m ? this.sessions.get(m[1]) : null;
    if (!s) return null;
    s.lastSeen = Date.now();
    s.address = this.address(req);
    return s;
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://local');
    if (url.pathname.startsWith('/api/local/')) return this.api(req, res, url.pathname.slice('/api/local/'.length));
    if (req.method !== 'GET' && req.method !== 'HEAD') return this.json(res, 405, { error: 'method' });
    return this.serveStatic(req, res, url.pathname);
  }

  serveStatic(req, res, pathname) {
    const { file, type, isIndex } = resolveStatic(this.webRoot, pathname);
    if (isIndex) {
      let html;
      try { html = fs.readFileSync(file, 'utf8'); } catch { return this.json(res, 503, { error: 'web_missing' }); }
      const host = this.mdnsActive ? `;window.__VS_HOST__=${JSON.stringify(`${HOST_NAME}:${this.port}`)}` : '';
      const ver = this.version ? `;window.__VS_VERSION__=${JSON.stringify(this.version)}` : '';
      html = html.replace('</head>', `<script>window.__VS_LOCAL__=1${host}${ver}</script></head>`);
      // Pré-visualização de links (iMessage, WhatsApp) só aceita endereço completo da imagem.
      const reqHost = /^[A-Za-z0-9.:-]{1,100}$/.test(req.headers.host || '') ? req.headers.host : `${lanAddresses()[0] || '127.0.0.1'}:${this.port}`;
      html = html.split('content="/og-image.jpg"').join(`content="http://${reqHost}/og-image.jpg"`);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.end()).pipe(res);
  }

  async api(req, res, route) {
    if (route === 'ping') return this.json(res, 200, { ok: true });

    if (route === 'login' && req.method === 'POST') {
      const addr = this.address(req);
      if (this.tooManyFailures(addr)) return this.json(res, 429, { error: 'too_many_attempts' });
      const body = await this.readBody(req).catch(() => null);
      const role = body?.role;
      if (!ROLES.has(role)) return this.json(res, 400, { error: 'bad_request' });
      if (this.banned.has(`${role}|${addr}`)) return this.json(res, 403, { error: 'invalid_code' });
      const pin = String(body.pin ?? '');
      const valid = role === 'screen' ? pin.toUpperCase() === SCREEN_CODE : safeEqual(pin, this.pins[role]);
      if (!valid) { this.noteFailure(addr); return this.json(res, 401, { error: 'invalid_code' }); }
      this.failures.delete(addr);
      const token = crypto.randomBytes(24).toString('base64url');
      const name = String(body.name ?? '').trim().slice(0, 60) || (role === 'screen' ? 'Tela do palco' : 'Sem nome');
      const sheetKey = role === 'musician' ? this.sheets.touch(name) : null;
      this.sessions.set(token, { id: crypto.randomUUID(), role, name, sheetKey, address: addr, lastSeen: Date.now() });
      return this.json(res, 200, { token });
    }

    const s = this.session(req);
    if (!s) return this.json(res, 401, { error: 'invalid_code' });

    if (route === 'state' && req.method === 'GET') {
      if (!this.published?.setlist) return this.json(res, 503, { error: 'not_ready' });
      const now = new Date().toISOString();
      const show = { name: this.published.name, setlist: this.published.setlist, live: this.published.live, live_at: this.publishedAt };
      if (s.role === 'musician') {
        return this.json(res, 200, { musician: { id: s.id, name: s.name, instrument: '' }, show, server_now: now });
      }
      const lyrics = Object.entries(this.mergedLyrics()).map(([song_id, pages]) => ({
        song_id, pages, updated_at: this.lyricsUpdatedAt[song_id] || this.publishedAt,
      }));
      return this.json(res, 200, {
        show,
        prompter: this.prompter,
        lyrics,
        lyrics_save: { requested_at: this.lyricsSave.requestedAt, saved_at: this.lyricsSave.savedAt },
        server_now: now,
      });
    }

    if (s.role === 'musician' && s.sheetKey) return this.musicianApi(req, res, route, s);

    if (req.method !== 'POST') return this.json(res, 404, { error: 'not_found' });
    if (s.role !== 'producer') return this.json(res, 403, { error: 'forbidden' });
    const body = await this.readBody(req).catch(() => null);
    if (!body || typeof body !== 'object') return this.json(res, 400, { error: 'bad_request' });

    if (route === 'prompter') {
      if (!body.prompter || typeof body.prompter !== 'object' || Array.isArray(body.prompter)) return this.json(res, 400, { error: 'bad_request' });
      this.prompter = body.prompter;
      this.persist();
      return this.json(res, 200, { ok: true });
    }

    if (route === 'lyrics') {
      const songId = typeof body.songId === 'string' ? body.songId : '';
      const known = this.published?.setlist?.songs?.some((x) => x && x.id === songId);
      if (!known || !Array.isArray(body.pages)) return this.json(res, 400, { error: 'bad_request' });
      this.producerLyrics[songId] = body.pages;
      this.lyricsUpdatedAt[songId] = new Date().toISOString();
      this.clearOverridesOnPublish = false;
      return this.json(res, 200, { ok: true });
    }

    if (route === 'lyrics-save') {
      const at = new Date().toISOString();
      this.lyricsSave = { ...this.lyricsSave, requestedAt: at };
      this.pendingSaveRequest = at;
      return this.json(res, 200, { ok: true });
    }

    return this.json(res, 404, { error: 'not_found' });
  }

  async musicianApi(req, res, route, s) {
    const key = s.sheetKey;
    if (req.method === 'GET') {
      if (route === 'sheets') return this.json(res, 200, { sheets: this.sheets.list(key) });
      if (route === 'colleagues') return this.json(res, 200, { colleagues: this.sheets.colleagues(key) });
      if (route.startsWith('song-lyrics/')) {
        const pages = this.mergedLyrics()[decodeURIComponent(route.slice('song-lyrics/'.length))];
        const texts = Array.isArray(pages) ? pages.map((p) => (p && typeof p.text === 'string' ? p.text : '')).filter((t) => t.trim()) : [];
        return this.json(res, 200, { texts });
      }
      return this.json(res, 404, { error: 'not_found' });
    }
    if (req.method !== 'POST') return this.json(res, 404, { error: 'not_found' });
    const body = await this.readBody(req).catch(() => null);
    if (!body || typeof body !== 'object') return this.json(res, 400, { error: 'bad_request' });

    if (route === 'sheet-save') {
      const id = this.sheets.save(key, body);
      return id ? this.json(res, 200, { id }) : this.json(res, 400, { error: 'bad_request' });
    }
    if (route === 'sheet-delete') {
      this.sheets.remove(key, String(body.sheetId ?? ''));
      return this.json(res, 200, { ok: true });
    }
    if (route === 'sheet-share') {
      const count = this.sheets.share(key, String(body.sheetId ?? ''), body.targets);
      return count === null ? this.json(res, 400, { error: 'bad_request' }) : this.json(res, 200, { count });
    }
    return this.json(res, 404, { error: 'not_found' });
  }
}

module.exports = { LocalServer, lanAddresses, HOST_NAME };
