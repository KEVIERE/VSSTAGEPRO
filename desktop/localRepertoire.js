// Repertório do produtor na Rede Local: o áudio de cada música (e a letra lida pelo Mac) fica
// numa pasta do próprio Mac do diretor, sem passar pela nuvem.
//
// Mesmas regras do modo online:
// - só existe depois que o diretor aperta "Enviar repertório";
// - o produtor salvou as letras: 10 minutos depois a pasta é apagada;
// - para o produtor ouvir de novo, o diretor envia de novo.
//
// Os arquivos são servidos por um endereço com chave aleatória (trocada a cada envio novo):
// o <audio> do navegador não manda cabeçalho de login, então a chave vai no próprio endereço.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const GRACE_MS = 10 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const KINDS = { audio: '.mp3', words: '.words.json' };
const MAX_BYTES = { audio: 40 * 1024 * 1024, words: 4 * 1024 * 1024 };

class LocalRepertoire {
  constructor({ dir, graceMs = GRACE_MS, now = () => Date.now() }) {
    this.dir = dir;
    this.graceMs = graceMs;
    this.now = now;
    this.releasedAt = null;
    this.requestedAt = null;
    this.key = crypto.randomBytes(16).toString('hex');
  }

  /** Apaga tudo. Usado ao abrir o programa: um envio só vale enquanto o programa está aberto. */
  wipe() {
    let removed = 0;
    try {
      for (const f of fs.readdirSync(this.dir)) {
        try { fs.unlinkSync(path.join(this.dir, f)); removed++; } catch { /* já saiu */ }
      }
    } catch { /* pasta ainda não existe */ }
    return removed;
  }

  files() {
    const audio = new Map();
    const words = new Map();
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return { audio, words }; }
    for (const name of names) {
      const isWords = name.endsWith(KINDS.words);
      const isAudio = !isWords && name.endsWith(KINDS.audio);
      if (!isWords && !isAudio) continue;
      const songId = name.slice(0, -(isWords ? KINDS.words : KINDS.audio).length);
      if (!ID_RE.test(songId)) continue;
      let mtime = null;
      try { mtime = fs.statSync(path.join(this.dir, name)).mtime.toISOString(); } catch { continue; }
      (isWords ? words : audio).set(songId, mtime);
    }
    return { audio, words };
  }

  /** Situação para o programa do diretor (mesmo formato da nuvem). */
  status() {
    this.sweep();
    const { audio, words } = this.files();
    const iso = (t) => (t === null ? null : new Date(t).toISOString());
    return {
      files: [...audio.entries()].map(([songId, updatedAt]) => ({ songId, updatedAt })),
      words: [...words.entries()].map(([songId, updatedAt]) => ({ songId, updatedAt })),
      released_at: iso(this.releasedAt),
      requested_at: iso(this.requestedAt),
    };
  }

  /** O diretor apertou "Enviar repertório": começa um envio novo. */
  start() {
    this.releasedAt = null;
    this.requestedAt = null;
    // Endereços novos: um link antigo guardado no navegador não abre o envio novo.
    this.key = crypto.randomBytes(16).toString('hex');
  }

  put(songId, kind, data) {
    if (!ID_RE.test(String(songId)) || !KINDS[kind]) throw new Error('bad_request');
    const buf = Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    if (buf.length === 0 || buf.length > MAX_BYTES[kind]) throw new Error('bad_request');
    fs.mkdirSync(this.dir, { recursive: true });
    const final = path.join(this.dir, `${songId}${KINDS[kind]}`);
    const tmp = `${final}.part`;
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, final);
  }

  /** O produtor pediu o repertório: vira um aviso no programa do diretor (quem envia é ele). */
  request() {
    this.requestedAt = this.now();
    // Igual à nuvem: se o áudio ainda não saiu, ele fica até o produtor salvar de novo.
    this.releasedAt = null;
  }

  /** O programa do diretor pega o pedido (uma vez só). */
  takeRequest() {
    const at = this.requestedAt;
    this.requestedAt = null;
    return at === null ? null : new Date(at).toISOString();
  }

  /** O produtor salvou as letras: o relógio dos 10 minutos começa. */
  release() {
    const { audio, words } = this.files();
    if (audio.size === 0 && words.size === 0) return;
    this.releasedAt = this.now();
  }

  /** Passados os 10 minutos do "Salvar", apaga a pasta. Devolve quantos arquivos saíram. */
  sweep() {
    if (this.releasedAt === null || this.requestedAt !== null) return 0;
    if (this.now() - this.releasedAt < this.graceMs) return 0;
    return this.wipe();
  }

  /** Lista para a página do produtor, com os endereços dos arquivos. */
  list(prefix) {
    this.sweep();
    const { audio, words } = this.files();
    return [...audio.entries()].map(([songId, updatedAt]) => ({
      songId,
      updatedAt,
      url: `${prefix}/${songId}${KINDS.audio}?k=${this.key}&v=${Date.parse(updatedAt) || 0}`,
      wordsUrl: words.has(songId) ? `${prefix}/${songId}${KINDS.words}?k=${this.key}&v=${Date.parse(words.get(songId)) || 0}` : null,
    }));
  }

  /** Caminho do arquivo pedido pelo navegador, ou null se o nome ou a chave não conferem. */
  filePath(name, key) {
    if (typeof key !== 'string' || key.length !== this.key.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(key), Buffer.from(this.key))) return null;
    const m = /^([A-Za-z0-9_-]{1,80})(\.mp3|\.words\.json)$/.exec(String(name));
    if (!m) return null;
    this.sweep();
    const file = path.join(this.dir, `${m[1]}${m[2]}`);
    return fs.existsSync(file) ? file : null;
  }
}

module.exports = { LocalRepertoire, GRACE_MS };
