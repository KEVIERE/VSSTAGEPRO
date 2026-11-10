const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const QRCode = require('qrcode');
const { resolveStatic } = require('./staticFiles');
const { LocalAccounts } = require('./musicianAccounts');

const DEFAULT_PORT = 8080;
const HOST_NAME = 'vsstage.local';
const ONLINE_WINDOW_MS = 10_000;
const MAX_BODY = 4 * 1024 * 1024;
const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 5 * 60_000;
const SCREEN_CODE = 'TELA';
const ROLES = new Set(['musician', 'producer', 'screen', 'remote']);
// Caminho da área (músico, produtor, tela, controle remoto celular) no link.
const PATH = { musician: 'musico', producer: 'produtor', screen: 'tela', remote: 'show' };
// Logo da banda na Rede Local: o celular do produtor manda a imagem para cá, sem passar pela
// nuvem (lá a função exige a chave do diretor e devolvia 403 para quem entra pela rede).
const LOGO_MAX = 5 * 1024 * 1024;
const LOGO_TYPES = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/jpeg': 'jpg' };
const LOGO_FILE = 'logo-local';
// Resposta do "Salvar" do músico: gravado; gravado quando a música parar; projeto ainda sem
// arquivo (o diretor salva a primeira vez); falhou; programa sem a função.
const PROJECT_SAVE_STATUS = new Set(['saved', 'later', 'no_file', 'error', 'unavailable']);

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
  constructor({ webRoot, storePath, version, onTransportCommand, onAccountsChange, onProjectSave }) {
    this.webRoot = webRoot;
    this.version = String(version || '');
    this.storePath = storePath;
    this.onTransportCommand = onTransportCommand;
    // Botão "Salvar" do músico: o programa grava o projeto e responde como ficou.
    this.onProjectSave = onProjectSave;
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
    this.remoteMeters = null;
    this.qrCache = new Map();
    // Contas dos músicos (usuário e senha) e os cadernos delas. Moram no projeto do show; aqui
    // fica a cópia em uso e uma de segurança por projeto. Os cadernos antigos (por nome) vão
    // para a conta de quem criar uma com o mesmo nome.
    this.accounts = new LocalAccounts({
      dir: path.join(path.dirname(storePath), 'rede-local-contas'),
      legacyFile: path.join(path.dirname(storePath), 'rede-local-cadernos.json'),
      onChange: (change) => {
        this.dropLockedSessions();
        if (onAccountsChange) onAccountsChange(change);
      },
    });
    const saved = this.load();
    this.pins = saved.pins;
    this.prompter = saved.prompter;
    // Aparelhos que o diretor desconectou continuam desconectados depois de fechar o programa.
    // Antes isso vivia só na memória e `start()` limpava a lista: os três aparelhos voltavam a
    // aparecer conectados toda vez que o programa abria.
    for (const k of saved.banned || []) this.banned.add(k);
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      const ok = (p) => typeof p === 'string' && /^\d{6}$/.test(p);
      if (ok(data?.pins?.musician) && ok(data?.pins?.producer) && data.pins.musician !== data.pins.producer) {
        const pins = {
          ...data.pins,
          remote: ok(data?.pins?.remote) ? data.pins.remote : data.pins.producer,
        };
        const banned = Array.isArray(data.banned) ? data.banned.filter((k) => typeof k === 'string') : [];
        return {
          pins,
          prompter: data.prompter && typeof data.prompter === 'object' ? data.prompter : null,
          banned,
        };
      }
    } catch { /* primeira vez: cria PINs novos */ }
    const musician = newPin();
    const producer = newPin(musician);
    const remote = newPin(producer);
    const pins = { musician, producer, remote };
    this.persist({ pins, prompter: null });
    return { pins, prompter: null };
  }

  persist(data) {
    const body = data || { pins: this.pins, prompter: this.prompter, banned: [...this.banned] };
    try { fs.writeFileSync(this.storePath, JSON.stringify(body), { mode: 0o600 }); } catch { /* sem disco: segue em memória */ }
  }

  // ---------- logo da banda (Rede Local) ----------

  get logoDir() { return path.join(path.dirname(this.storePath), 'rede-local-logo'); }

  logoFile() {
    for (const ext of Object.values(LOGO_TYPES)) {
      const file = path.join(this.logoDir, `${LOGO_FILE}.${ext}`);
      try {
        if (fs.existsSync(file)) return file;
      } catch { /* sem disco */ }
    }
    return null;
  }

  /** `{ url, updatedAt }` no mesmo formato que a nuvem devolve, mas servido por aqui. */
  logoInfo() {
    const file = this.logoFile();
    if (!file) return { url: null, updatedAt: null };
    let mtime = null;
    try { mtime = fs.statSync(file).mtime.toISOString(); } catch { /* sem disco */ }
    const ext = path.extname(file).slice(1);
    const type = Object.keys(LOGO_TYPES).find((k) => LOGO_TYPES[k] === ext) || 'image/png';
    return { url: `/${PATH.producer}/logo/atual?v=${mtime ? Date.parse(mtime) : 0}`, updatedAt: mtime, type };
  }

  saveLogo(buffer, contentType) {
    const ext = LOGO_TYPES[contentType];
    if (!ext || !buffer || buffer.length === 0 || buffer.length > LOGO_MAX) return false;
    try {
      fs.mkdirSync(this.logoDir, { recursive: true });
      this.removeLogo();
      fs.writeFileSync(path.join(this.logoDir, `${LOGO_FILE}.${ext}`), buffer, { mode: 0o644 });
      return true;
    } catch { return false; }
  }

  removeLogo() {
    try {
      for (const f of fs.readdirSync(this.logoDir)) {
        if (f.startsWith(`${LOGO_FILE}.`)) fs.unlinkSync(path.join(this.logoDir, f));
      }
    } catch { /* pasta nem existe ainda */ }
  }

  get running() { return !!this.server?.listening; }

  start() {
    if (this.server) return Promise.resolve();
    // Só a contagem de erros de PIN é zerada aqui. A lista de aparelhos desconectados pelo
    // diretor é mantida: quem ele tirou não pode voltar a conectar por reabrir o programa.
    this.failures.clear();
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

  /** O programa manda as contas do projeto aberto (ou null sem projeto). */
  setMusicianBook(book) {
    this.accounts.setBook(book);
    this.dropLockedSessions();
  }

  /**
   * Conta bloqueada, apagada ou sem aprovação perde a sessão na hora. "Desconectar" do diretor
   * (`disconnectedAt`) derruba quem entrou antes dele; a conta continua na lista.
   */
  dropLockedSessions() {
    for (const [token, s] of this.sessions) {
      if (s.role !== 'musician') continue;
      const acc = this.accounts.find(s.accountId);
      const cut = acc?.disconnectedAt ? Date.parse(acc.disconnectedAt) : NaN;
      if (!acc || acc.status !== 'approved' || (Number.isFinite(cut) && (s.since || 0) <= cut)) this.sessions.delete(token);
    }
  }

  stop() {
    this.accounts.flush();
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
      // O QR dos músicos só abre a página: o PIN é digitado na primeira vez (o QR pode
      // aparecer na tela do palco). Os outros papéis levam o PIN depois do # para entrar direto.
      const pin = role === 'musician' ? null : this.pins[role];
      qr[role] = urls[role] ? await this.qr(pin ? `${urls[role]}#pin=${pin}` : urls[role]) : null;
    }
    const now = Date.now();
    const clients = [...this.sessions.values()]
      .filter((s) => now - s.lastSeen < ONLINE_WINDOW_MS)
      .map(({ id, role, name, address, lastSeen, accountId }) => ({ id, role, name, address, lastSeen, accountId: accountId || null }));
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
      // Estado completo do Modo Show para o VS Stage Remote (celular)
      remote: payload.remote && typeof payload.remote === 'object' ? payload.remote : null,
    };
    this.publishedAt = new Date().toISOString();
    if (this.clearOverridesOnPublish) {
      this.producerLyrics = {};
      this.clearOverridesOnPublish = false;
    }
  }

  /** Medidores dos faders para o VS Stage Remote (o programa manda umas 12 vezes por segundo). */
  publishMeters(meters) {
    const ok = meters && typeof meters === 'object' && Array.isArray(meters.ids) && Array.isArray(meters.levels)
      && meters.ids.length === meters.levels.length && meters.ids.length <= 64;
    this.remoteMeters = ok ? meters : null;
  }

  regeneratePin(role) {
    if (role !== 'musician' && role !== 'producer') return;
    const other = role === 'musician' ? this.pins.producer : this.pins.musician;
    this.pins = { ...this.pins, [role]: newPin(other) };
    for (const [token, s] of this.sessions) if (s.role === role) this.sessions.delete(token);
    // PIN novo é o socorro de quem ficou trancado: sai o bloqueio daquele papel e a contagem
    // de erros. Os aparelhos desconectados dos OUTROS papéis continuam fora.
    for (const k of [...this.banned]) if (k.startsWith(`${role}|`)) this.banned.delete(k);
    this.failures.clear();
    this.persist();
  }

  /**
   * Desconecta e bloqueia o aparelho até gerar um PIN novo.
   *
   * O bloqueio vai para o disco: antes morria com o programa, e os aparelhos desconectados
   * voltavam a aparecer conectados na próxima abertura. `start()` também precisa respeitar a
   * lista — ele a limpa ao religar a rede local para destravar PIN, mas não ao abrir o programa.
   */
  kick(clientId) {
    let changed = false;
    for (const [token, s] of this.sessions) {
      if (s.id === clientId) {
        this.sessions.delete(token);
        this.banned.add(`${s.role}|${s.address}`);
        changed = true;
      }
    }
    if (changed) this.persist();
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

  /** O pedido veio do próprio Mac (o programa aberto), não de um aparelho na rede. */
  isLoopback(addr) {
    return addr === '127.0.0.1' || addr === '::1' || addr === '';
  }

  /**
   * Bloqueio por tentativas erradas.
   *
   * Histórico: a primeira versão congelava o horário do primeiro erro e o endereço ficava preso
   * para sempre. A segunda tentou janela deslizante, mas o cliente consulta o estado a cada
   * 250 ms; cada consulta recusada contava como erro nova e renovava a janela, então o PIN certo
   * continuava bloqueado mesmo depois de minutos sem ninguém digitar nada (medido em 06/11/2026:
   * 6 minutos parado e ainda 429).
   *
   * Regra atual: só conta tentativa de LOGIN. Tentativa recusada durante o bloqueio não conta,
   * porque não é senha errada — é espera. A janela expira sem depender da sorte do intervalo.
   */
  tooManyFailures(addr) {
    const f = this.failures.get(addr);
    if (!f) return false;
    if (Date.now() - f.last >= FAIL_WINDOW_MS) { this.failures.delete(addr); return false; }
    return f.count >= FAIL_LIMIT;
  }

  noteFailure(addr) {
    const f = this.failures.get(addr);
    const now = Date.now();
    if (!f || now - f.last >= FAIL_WINDOW_MS) this.failures.set(addr, { count: 1, last: now });
    else { f.count += 1; f.last = now; }
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
    // A logo trocada pelo produtor na rede local. Fica fora de /api para o <img> apontar direto.
    if (url.pathname === `/${PATH.producer}/logo/atual`) return this.serveLogo(req, res);
    return this.serveStatic(req, res, url.pathname);
  }

  serveLogo(req, res) {
    const file = this.logoFile();
    if (!file) return this.json(res, 404, { error: 'no_logo' });
    const ext = path.extname(file).slice(1);
    const type = Object.keys(LOGO_TYPES).find((k) => LOGO_TYPES[k] === ext) || 'image/png';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).on('error', () => res.end()).pipe(res);
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
      // O bloqueio só vale para aparelho na rede (celular, tablet, TV). Quem está operando no
      // próprio Mac do diretor nunca fica trancado: é ele que está no palco com a TV à vista.
      // Antes o limite valia para o IP do link (`192.168.x.x:8080/produtor`), e o produtor
      // recebia "muitas tentativas erradas" com o PIN certo, sem ter como sair.
      // O limite NÃO barra o login, em nenhum aparelho.
      //
      // Numa mesa de som não existe "espere 5 minutos": se o PIN certo for digitado, tem que
      // entrar. Medido em 06/11/2026: o produtor ficou 6 minutos sem digitar nada e o link
      // `192.168.x.x:8080/produtor` ainda respondia `too_many_attempts`, porque a página consulta
      // o estado a cada 250 ms e cada consulta recusada renovava a janela.
      //
      // O contador continua existindo só para registro (console), sem trancar ninguém.
      const throttled = this.tooManyFailures(addr);
      if (throttled) console.warn(`[rede local] ${addr} acumulou ${this.failures.get(addr)?.count} erros de PIN; login segue liberado.`);
      const body = await this.readBody(req).catch(() => null);
      const role = body?.role;
      if (!ROLES.has(role)) return this.json(res, 400, { error: 'bad_request' });
      if (this.banned.has(`${role}|${addr}`)) return this.json(res, 403, { error: 'invalid_code' });
      if (role === 'musician') return this.musicianLogin(res, body, addr);
      const pin = String(body.pin ?? '');
      const valid = role === 'screen' ? pin.toUpperCase() === SCREEN_CODE : safeEqual(pin, this.pins[role]);
      if (!valid) { this.noteFailure(addr); return this.json(res, 401, { error: 'invalid_code' }); }
      this.failures.delete(addr);
      const token = crypto.randomBytes(24).toString('base64url');
      const name = String(body.name ?? '').trim().slice(0, 60) || (role === 'screen' ? 'Tela do palco' : 'Sem nome');
      this.sessions.set(token, { id: crypto.randomUUID(), role, name, address: addr, lastSeen: Date.now(), since: Date.now() });
      return this.json(res, 200, { token });
    }

    const s = this.session(req);
    if (!s) return this.json(res, 401, { error: 'invalid_code' });

    // VS Stage Remote: o Modo Show inteiro, só para quem entrou com o PIN do Remote
    if (route === 'remote-state' && req.method === 'GET') {
      if (s.role !== 'remote') return this.json(res, 403, { error: 'forbidden' });
      if (!this.published?.remote) return this.json(res, 503, { error: 'not_ready' });
      return this.json(res, 200, { remote: this.published.remote, server_now: Date.now() });
    }

    // Medidores dos faders (a aba Mixer do Remote busca várias vezes por segundo)
    if (route === 'remote-meters' && req.method === 'GET') {
      if (s.role !== 'remote') return this.json(res, 403, { error: 'forbidden' });
      return this.json(res, 200, { meters: this.remoteMeters || null });
    }

    if (route === 'state' && req.method === 'GET') {
      if (!this.published?.setlist) return this.json(res, 503, { error: 'not_ready' });
      const now = new Date().toISOString();
      const show = { name: this.published.name, setlist: this.published.setlist, live: this.published.live, live_at: this.publishedAt };
      if (s.role === 'musician') {
        const acc = this.accounts.find(s.accountId);
        return this.json(res, 200, {
          musician: { id: acc?.id ?? s.id, name: acc?.name ?? s.name, instrument: acc?.instrument ?? '', username: acc?.username ?? '' },
          show, server_now: now,
        });
      }
      const lyrics = Object.entries(this.mergedLyrics()).map(([song_id, pages]) => ({
        song_id, pages, updated_at: this.lyricsUpdatedAt[song_id] || this.publishedAt,
      }));
      // QR de entrada dos músicos (sem o PIN) só quando o diretor liga a opção na tela do palco
      let joinQr = null;
      if (this.prompter?.toggles?.joinQr && this.pins?.musician) {
        const base = lanAddresses()[0];
        if (base) joinQr = await this.qr(`http://${base}:${this.port}/${PATH.musician}`);
      }
      return this.json(res, 200, {
        show,
        prompter: this.prompter,
        join_qr: joinQr,
        logo: this.logoInfo(),
        lyrics,
        lyrics_save: { requested_at: this.lyricsSave.requestedAt, saved_at: this.lyricsSave.savedAt },
        server_now: now,
      });
    }

    if (s.role === 'musician' && s.accountId) return this.musicianApi(req, res, route, s);

    // Comandos do VS Stage Remote. Só o papel `remote` manda: a tela do palco entra com um
    // código fixo e não pode tocar nem parar o show.
    if (route === 'transport' && req.method === 'POST') {
      if (s.role !== 'remote') return this.json(res, 403, { error: 'forbidden' });
      const body = await this.readBody(req).catch(() => null);
      if (!body || typeof body.action !== 'string') return this.json(res, 400, { error: 'bad_request' });
      if (this.onTransportCommand) {
        this.onTransportCommand(body);
      }
      return this.json(res, 200, { ok: true });
    }

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

    // Logo da banda trocada pelo produtor na rede local. A chave de autorização do arquivo é o
    // próprio PIN do produtor, conferido na sessão de quem está mandando.
    if (route === 'logo') {
      const type = String(body.type || body.contentType || '');
      const data = typeof body.data === 'string' ? body.data : '';
      if (!LOGO_TYPES[type] || !data) return this.json(res, 400, { error: 'bad_request' });
      const buffer = Buffer.from(data, 'base64');
      if (!this.saveLogo(buffer, type)) return this.json(res, 400, { error: 'bad_request' });
      return this.json(res, 200, { ok: true, logo: this.logoInfo() });
    }

    if (route === 'logo-remove') {
      this.removeLogo();
      return this.json(res, 200, { ok: true, logo: this.logoInfo() });
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

  /**
   * Entrada do músico: `mode`
   * - `signup`: PIN dos músicos + nome, instrumento, usuário e senha. A conta nasce pendente.
   * - `login`: usuário e senha. Senha zerada pelo diretor: PIN + `newPassword`.
   * - `resume`: o aparelho lembrado (`remember`), sem digitar nada.
   * Pendente responde `{ pending: true, remember }`: o celular espera o diretor aprovar.
   */
  musicianLogin(res, body, addr) {
    const mode = String(body.mode ?? 'login');
    const pinOk = safeEqual(String(body.pin ?? ''), this.pins.musician);
    let result;
    if (mode === 'signup') {
      if (!pinOk) { this.noteFailure(addr); return this.json(res, 401, { error: 'invalid_code' }); }
      result = this.accounts.signup({ username: body.username, password: body.password, name: body.name, instrument: body.instrument });
      if (result.account && !result.error) result = { account: result.account, error: 'pending' };
    } else if (mode === 'resume') {
      result = this.accounts.resume(body.remember);
    } else {
      if (body.newPassword && !pinOk) { this.noteFailure(addr); return this.json(res, 401, { error: 'invalid_code' }); }
      result = this.accounts.login({ username: body.username, password: body.password, newPassword: body.newPassword, pinOk });
    }
    if (!result.account) {
      if (result.error === 'wrong_login') this.noteFailure(addr);
      const status = { wrong_login: 401, disconnected: 401, blocked: 403, username_taken: 409, needs_password: 409 }[result.error] || 400;
      return this.json(res, status, { error: result.error || 'bad_request' });
    }
    this.failures.delete(addr);
    const acc = result.account;
    const remember = mode === 'resume' ? String(body.remember) : this.accounts.remember(acc);
    if (result.error === 'pending') return this.json(res, 202, { pending: true, remember, name: acc.name });
    const token = crypto.randomBytes(24).toString('base64url');
    this.sessions.set(token, { id: crypto.randomUUID(), role: 'musician', name: acc.name, accountId: acc.id, address: addr, lastSeen: Date.now(), since: Date.now() });
    return this.json(res, 200, { token, remember, name: acc.name });
  }

  async musicianApi(req, res, route, s) {
    const key = s.accountId;
    if (req.method === 'GET') {
      if (route === 'sheets') return this.json(res, 200, { sheets: this.accounts.list(key) });
      if (route === 'colleagues') return this.json(res, 200, { colleagues: this.accounts.colleagues(key) });
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

    if (route === 'logout') {
      this.accounts.forget(this.accounts.find(key), String(body.remember ?? ''));
      for (const [token, x] of this.sessions) if (x === s) this.sessions.delete(token);
      return this.json(res, 200, { ok: true });
    }
    if (route === 'sheet-save') {
      const id = this.accounts.save(key, body);
      return id ? this.json(res, 200, { id }) : this.json(res, 400, { error: 'bad_request' });
    }
    if (route === 'sheet-delete') {
      this.accounts.remove(key, String(body.sheetId ?? ''));
      return this.json(res, 200, { ok: true });
    }
    if (route === 'sheet-share') {
      const count = this.accounts.share(key, String(body.sheetId ?? ''), body.targets);
      return count === null ? this.json(res, 400, { error: 'bad_request' }) : this.json(res, 200, { count });
    }
    // Botão "Salvar" da Área do Músico: o caderno já chegou (sheet-save); aqui a cópia de
    // segurança vai para o disco na hora e o programa grava o arquivo do projeto.
    if (route === 'project-save') {
      this.accounts.flush();
      let status = 'unavailable';
      if (this.onProjectSave) {
        try { status = await this.onProjectSave(); } catch { status = 'error'; }
      }
      return this.json(res, 200, { status: PROJECT_SAVE_STATUS.has(status) ? status : 'error' });
    }
    return this.json(res, 404, { error: 'not_found' });
  }
}

module.exports = { LocalServer, lanAddresses, HOST_NAME };
