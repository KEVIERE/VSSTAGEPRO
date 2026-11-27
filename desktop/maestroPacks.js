// Pacotes de falas prontas do Maestro (Maestro 2 e Maestro 3), baixados uma vez só.
//
// - maestro-packs.json (vai dentro do app) trava versão, tamanho e SHA-256 do manifesto de cada
//   voz. Enquanto ele estiver vazio, o programa não faz nenhum acesso à rede por aqui.
// - No servidor: <base>/<voz>/<versão>/manifest.json e os MP3 ao lado dele, no mesmo desenho de
//   public/maestro-falas: <id>.mp3 (Normal), calma/<id>.mp3 e forte/<id>.mp3.
// - No computador: <userData>/maestro-falas/<voz>/<versão>/. O arquivo atual.json só aponta para
//   a versão depois que ela chegou inteira e conferida: a voz nunca aparece pela metade.
// - Continua de onde parou (".part"), pausa com música tocando e tenta de novo se a rede cair.
// - Nada de áudio fica na memória: cada fala é lida do disco só quando pedida.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');

const VOICES = ['will', 'carla'];
const MODES = ['normal', 'calma', 'forte'];
const BASE_URL = 'https://download.vsstagepro.com.br/maestro-falas';
const USER_AGENT = 'VS-Stage-Maestro-Falas';

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 12_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PACK_BYTES = 6 * 1024 * 1024 * 1024;
/** Falas baixadas ao mesmo tempo. */
const PARALLEL_FILES = 6;
/** Folga de disco além do que falta baixar. */
const DISK_MARGIN = 200 * 1024 * 1024;
/** Espera entre tentativas depois de falha: 30 s, 2 min, 10 min (e fica nos 10 min). */
const RETRY_MS = [30_000, 120_000, 600_000];

const VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PATH_RE = /^(?:(calma|forte)\/)?([a-z0-9]+(?:-[a-z0-9]+)*)\.mp3$/;
// nomes que o Windows reserva, mesmo com extensão
const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

class PausedError extends Error {}
class NotPublishedError extends Error {}

const validId = (id) => typeof id === 'string' && id.length <= 120 && ID_RE.test(id) && !RESERVED_RE.test(id);
const validVersion = (v) => typeof v === 'string' && VERSION_RE.test(v) && !v.includes('..');

/** Caminho do manifesto para { mode, id }. Qualquer coisa fora do desenho esperado vira null. */
function parsePackPath(value) {
  if (typeof value !== 'string' || value.length > 140) return null;
  const match = PATH_RE.exec(value);
  if (!match || !validId(match[2])) return null;
  return { mode: match[1] || 'normal', id: match[2] };
}

const packPath = (mode, id) => (mode === 'normal' ? `${id}.mp3` : `${mode}/${id}.mp3`);

/** Confere o manifesto inteiro: uma entrada ruim recusa o pacote todo. */
function parseManifest(raw, voice, version) {
  let data;
  try { data = JSON.parse(raw.toString('utf8')); } catch { throw new Error('Manifesto ilegível.'); }
  if (!data || data.schema !== 1 || data.voice !== voice || data.version !== version || !Array.isArray(data.files)) {
    throw new Error('Manifesto não corresponde à voz publicada.');
  }
  if (data.files.length === 0 || data.files.length > MAX_FILES) throw new Error('Manifesto com número de arquivos inválido.');
  const seen = new Set();
  let total = 0;
  const files = data.files.map((entry) => {
    const parsed = parsePackPath(entry?.path);
    if (!parsed) throw new Error('Manifesto com caminho inválido.');
    if (seen.has(entry.path)) throw new Error('Manifesto com arquivo repetido.');
    seen.add(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > MAX_FILE_BYTES) throw new Error('Manifesto com tamanho inválido.');
    if (typeof entry.sha256 !== 'string' || !SHA_RE.test(entry.sha256)) throw new Error('Manifesto com SHA-256 inválido.');
    total += entry.size;
    return { path: entry.path, size: entry.size, sha256: entry.sha256, mode: parsed.mode, id: parsed.id };
  });
  if (total > MAX_PACK_BYTES) throw new Error('Pacote maior que o permitido.');
  return { voice, version, files, total };
}

/** Só aceita a trava de uma voz conhecida e bem formada. */
function readPins(source) {
  const pins = new Map();
  const voices = source && typeof source === 'object' ? source.voices : null;
  if (!voices || typeof voices !== 'object') return pins;
  for (const voice of VOICES) {
    const pin = Object.prototype.hasOwnProperty.call(voices, voice) ? voices[voice] : null;
    if (pin && validVersion(pin.version) && typeof pin.sha256 === 'string' && SHA_RE.test(pin.sha256)
      && Number.isSafeInteger(pin.size) && pin.size > 0 && pin.size <= MAX_MANIFEST_BYTES) {
      pins.set(voice, { version: pin.version, sha256: pin.sha256, size: pin.size });
    }
  }
  return pins;
}

function bundledPins() {
  try { return require('./maestro-packs.json'); } catch { return null; }
}

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

async function syncFile(file) {
  const handle = await fsp.open(file, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temp, data);
  await syncFile(temp);
  await fsp.rename(temp, file);
}

const statOf = async (file) => {
  try {
    const info = await fsp.lstat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
};

const hashMatches = async (file, expected) => {
  try { return await sha256File(file) === expected; } catch { return false; }
};

const sizeOf = async (file) => {
  try {
    const info = await fsp.lstat(file);
    return info.isFile() ? info.size : -1;
  } catch {
    return -1;
  }
};

/**
 * @param {object} [opts]
 * @param {string} [opts.home]    pasta-base (padrão: <userData>/maestro-falas)
 * @param {string} [opts.baseUrl] endereço dos pacotes (nos testes, servidor local)
 * @param {object} [opts.pins]    conteúdo de maestro-packs.json
 * @param {number[]} [opts.retryMs]
 * @param {(dir:string)=>Promise<{bavail:number,bsize:number}>} [opts.statfs]
 */
function createMaestroPacks(opts = {}) {
  const baseUrl = (opts.baseUrl || BASE_URL).replace(/\/$/, '');
  const pins = readPins(opts.pins === undefined ? bundledPins() : opts.pins);
  const retryMs = opts.retryMs || RETRY_MS;
  const statfs = opts.statfs || ((dir) => fsp.statfs(dir));

  const phases = new Map(VOICES.map((v) => [v, { phase: 'indisponivel', received: 0, total: 0 }]));
  const lastSent = new Map();
  /** Versão ativa de cada voz (só a string: nenhum catálogo fica na memória). */
  const activeVersions = new Map();
  let listener = null;
  let paused = false;
  let stopped = false;
  let wanted = false;
  let running = null;
  let retryTimer = null;
  let attempt = 0;
  let currentRequest = null;
  let agent = null;
  /** Sobe a cada pausa: distingue "pausou e já voltou" de uma falha de rede. */
  let pauseGeneration = 0;
  /** voz@versão já conferidas nesta sessão: não varre o disco de novo a cada parada de música. */
  const verified = new Set();
  /** voz@versão cuja limpeza de versões antigas já rodou nesta sessão. */
  const pruned = new Set();
  /** Vozes que precisam de nova conferência (arquivo sumiu ou manifesto estragou). */
  const recheck = new Set();
  /** Falas da versão ativa que sumiram do disco: só os faltantes, normalmente nada. */
  const missing = new Map();
  /** Pedidos de fala que o pacote não tem, para não reler o manifesto a cada pedido. */
  const outsidePack = new Set();

  const checkpoint = () => {
    if (paused || stopped) throw new PausedError();
  };

  function home() {
    if (opts.home) return opts.home;
    try {
      const { app } = require('electron');
      if (app?.getPath) return path.join(app.getPath('userData'), 'maestro-falas');
    } catch { /* fora do Electron */ }
    return path.join(os.homedir(), '.vs-maestro-falas');
  }

  const voiceDir = (voice) => path.join(home(), voice);
  const versionDir = (voice, version) => path.join(voiceDir(voice), version);
  const pointerFile = (voice) => path.join(voiceDir(voice), 'atual.json');
  const stampFile = (voice, version) => path.join(versionDir(voice, version), 'conferido.json');

  /** Momento da última conferência completa desta versão (null se nunca houve). */
  async function readStamp(voice, version) {
    try {
      const at = JSON.parse(await fsp.readFile(stampFile(voice, version), 'utf8'))?.at;
      return Number.isFinite(at) ? at : null;
    } catch {
      return null;
    }
  }

  async function activeVersion(voice) {
    if (activeVersions.has(voice)) return activeVersions.get(voice);
    let version = null;
    try {
      const data = JSON.parse(await fsp.readFile(pointerFile(voice), 'utf8'));
      if (validVersion(data?.version)) version = data.version;
    } catch (err) {
      // erro passageiro de leitura não pode valer como "não instalada" até reiniciar
      if (err?.code && err.code !== 'ENOENT') return null;
    }
    activeVersions.set(voice, version);
    return version;
  }

  async function readInstalledManifest(voice, version) {
    try {
      const raw = await fsp.readFile(path.join(versionDir(voice, version), 'manifest.json'));
      return parseManifest(raw, voice, version);
    } catch {
      return null;
    }
  }

  function publicState(voice) {
    if (activeVersions.get(voice)) return { state: 'pronto', progress: 1 };
    const p = phases.get(voice);
    const progress = p.total > 0 ? Math.min(1, p.received / p.total) : 0;
    return { state: p.phase, progress };
  }

  function emit(voice, force = false) {
    if (!listener) return;
    const now = publicState(voice);
    const percent = Math.floor(now.progress * 100);
    const before = lastSent.get(voice);
    if (!force && before && before.state === now.state && before.percent === percent) return;
    lastSent.set(voice, { state: now.state, percent });
    try { listener({ voice, state: now.state, progress: now.progress }); } catch { /* tela fechando */ }
  }

  function setPhase(voice, phase) {
    phases.get(voice).phase = phase;
    emit(voice);
  }

  function open(url, from, redirects = 0) {
    return new Promise((resolve, reject) => {
      if (paused || stopped) { reject(new PausedError()); return; }
      const target = new URL(url);
      const lib = target.protocol === 'http:' ? http : https;
      if (!agent) agent = new lib.Agent({ keepAlive: true, maxSockets: PARALLEL_FILES });
      const headers = { 'User-Agent': USER_AGENT };
      if (from > 0) headers.Range = `bytes=${from}-`;
      const req = lib.get(target, { headers, agent }, (res) => {
        const code = res.statusCode;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 4) {
          res.resume();
          const next = new URL(res.headers.location, target);
          // o pacote só vem do próprio servidor de downloads
          if (next.origin !== target.origin) { reject(new Error('Redirecionamento para outro servidor recusado.')); return; }
          resolve(open(next.toString(), from, redirects + 1));
          return;
        }
        if (code !== 200 && code !== 206) {
          res.resume();
          const err = code === 404 ? new NotPublishedError('not_found') : new Error(`http_${code}`);
          err.status = code;
          reject(err);
          return;
        }
        resolve({ res, partial: code === 206 });
      });
      currentRequest = req;
      req.on('error', reject);
      req.setTimeout(30_000, () => req.destroy(new Error('timeout')));
    });
  }

  async function fetchManifest(voice, pin) {
    const dir = versionDir(voice, pin.version);
    const localFile = path.join(dir, 'manifest.json');
    try {
      const local = await fsp.readFile(localFile);
      if (local.length === pin.size && sha256(local) === pin.sha256) return parseManifest(local, voice, pin.version);
    } catch { /* ainda não baixado */ }

    const { res } = await open(`${baseUrl}/${voice}/${encodeURIComponent(pin.version)}/manifest.json`, 0);
    const chunks = [];
    let size = 0;
    for await (const chunk of res) {
      size += chunk.length;
      if (size > pin.size) { res.destroy(); throw new Error('Manifesto maior que o publicado.'); }
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks);
    if (raw.length !== pin.size || sha256(raw) !== pin.sha256) throw new Error('Manifesto não confere (SHA-256).');
    const manifest = parseManifest(raw, voice, pin.version);
    await fsp.mkdir(dir, { recursive: true });
    await writeAtomic(localFile, raw);
    return manifest;
  }

  async function checkDisk(dir, missing) {
    let info;
    try { info = await statfs(dir); } catch { return; }
    if (info.bavail * info.bsize < missing + DISK_MARGIN) {
      throw new Error('Falta espaço no disco para as falas do Maestro.');
    }
  }

  /** O disco aceita hard link entre as pastas? Sem isso, reaproveitar ocupa espaço de cópia. */
  async function canLink(source, dir) {
    const probe = path.join(dir, `.link-${process.pid}`);
    try {
      await fsp.link(source, probe);
      await fsp.rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Mesma fala da versão anterior: reaproveita o arquivo, sempre conferindo o SHA-256. */
  async function reuse(source, file, final, linkable) {
    checkpoint();
    await fsp.mkdir(path.dirname(final), { recursive: true });
    if (linkable) {
      if (!await hashMatches(source, file.sha256)) return false;
      checkpoint();
      try {
        await fsp.link(source, final);
        return true;
      } catch { /* cai na cópia */ }
    }
    const temp = `${final}.copy`;
    try {
      checkpoint();
      await fsp.copyFile(source, temp);
      checkpoint();
      if (await sha256File(temp) !== file.sha256) throw new Error('copia_invalida');
      await syncFile(temp);
      await fsp.rename(temp, final);
      return true;
    } catch (err) {
      await fsp.rm(temp, { force: true }).catch(() => {});
      if (err instanceof PausedError) throw err;
      return false;
    }
  }

  async function downloadFile(voice, version, file, onBytes) {
    const dir = versionDir(voice, version);
    const final = path.join(dir, file.path);
    const part = `${final}.part`;
    await fsp.mkdir(path.dirname(final), { recursive: true });
    let have = Math.max(0, await sizeOf(part));
    if (have > file.size) { await fsp.rm(part, { force: true }); onBytes(-have); have = 0; }

    if (have < file.size) {
      const url = `${baseUrl}/${voice}/${encodeURIComponent(version)}/${file.path}`;
      let opened;
      try {
        opened = await open(url, have);
      } catch (err) {
        // ".part" que o servidor não reconhece: recomeça este arquivo na próxima tentativa
        if (err.status === 416) { await fsp.rm(part, { force: true }); onBytes(-have); }
        if (err instanceof NotPublishedError) throw new Error(`Arquivo ausente no servidor: ${file.path}`);
        throw err;
      }
      const { res, partial } = opened;
      if (partial && have > 0) {
        const start = /^bytes (\d+)-/.exec(res.headers['content-range'] || '');
        if (!start || Number(start[1]) !== have) {
          res.destroy();
          await fsp.rm(part, { force: true });
          onBytes(-have);
          throw new Error('Retomada recusada pelo servidor.');
        }
      } else if (have > 0) {
        // o servidor não aceitou continuar do meio: recomeça o arquivo do zero
        onBytes(-have);
        have = 0;
      }
      let written = 0;
      const limit = async function* limit(source) {
        for await (const chunk of source) {
          if (paused || stopped) throw new PausedError();
          written += chunk.length;
          if (have + written > file.size) throw new Error(`O arquivo ${file.path} veio maior que o publicado.`);
          onBytes(chunk.length);
          yield chunk;
        }
      };
      try {
        await pipeline(res, limit, fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' }));
      } catch (err) {
        if (have + written > file.size) { await fsp.rm(part, { force: true }); onBytes(-(have + written)); }
        throw err;
      }
    }

    if (await sizeOf(part) !== file.size) throw new Error(`O arquivo ${file.path} veio incompleto.`);
    if (await sha256File(part) !== file.sha256) {
      await fsp.rm(part, { force: true });
      onBytes(-file.size);
      throw new Error(`O arquivo ${file.path} não confere (SHA-256).`);
    }
    await syncFile(part);
    await fsp.rename(part, final);
  }

  /** Apaga versões antigas, só depois que a nova já está ativa. */
  async function removeOldVersions(voice, keep) {
    let entries = [];
    try { entries = await fsp.readdir(voiceDir(voice), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      checkpoint();
      if (entry.isDirectory() && entry.name !== keep && validVersion(entry.name)) {
        await fsp.rm(path.join(voiceDir(voice), entry.name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async function installVoice(voice, pin) {
    const current = await activeVersion(voice);
    const progress = phases.get(voice);
    if (!current) setPhase(voice, 'baixando');
    const manifest = await fetchManifest(voice, pin);
    const dir = versionDir(voice, pin.version);
    await fsp.mkdir(dir, { recursive: true });

    let previous = null;
    let previousDir = null;
    if (current && current !== pin.version) {
      const old = await readInstalledManifest(voice, current);
      if (old) {
        previous = new Map(old.files.map((f) => [f.path, { size: f.size, sha256: f.sha256 }]));
        previousDir = versionDir(voice, current);
      }
    }

    // Sem carimbo, a versão ainda está sendo instalada e cada arquivo final já passou pelo SHA-256.
    // Com carimbo, só recalcula o que foi modificado depois da última conferência.
    const stamp = await readStamp(voice, pin.version);
    const trustedBefore = stamp ?? (current === pin.version ? 0 : Infinity);

    // 1a passada: só classifica, sem copiar nada
    const pending = [];
    const reusable = [];
    let received = 0;
    let missingBytes = 0;
    let reuseBytes = 0;
    let hashed = false;
    const queue = async (file) => {
      const partial = Math.min(file.size, Math.max(0, await sizeOf(`${path.join(dir, file.path)}.part`)));
      received += partial;
      missingBytes += file.size - partial;
      pending.push(file);
    };
    for (const file of manifest.files) {
      checkpoint();
      const final = path.join(dir, file.path);
      const info = await statOf(final);
      if (info?.size === file.size) {
        if (info.mtimeMs < trustedBefore) {
          received += file.size;
          continue;
        }
        hashed = true;
        if (await hashMatches(final, file.sha256)) {
          received += file.size;
          continue;
        }
        await fsp.rm(final, { force: true });
      }
      const old = previous?.get(file.path);
      if (old && old.sha256 === file.sha256 && old.size === file.size
        && await sizeOf(path.join(previousDir, file.path)) === file.size) {
        reusable.push(file);
        reuseBytes += file.size;
        continue;
      }
      await queue(file);
    }
    progress.received = received;
    progress.total = manifest.total;
    emit(voice);

    // versão já ativa com arquivo faltando: tira da lista da tela até o reparo terminar
    if (current === pin.version) {
      if (pending.length > 0) {
        missing.set(voice, new Set(pending.map((f) => f.path)));
        emit(voice, true);
      } else {
        missing.delete(voice);
      }
    }

    const changed = pending.length > 0 || reusable.length > 0;
    if (changed) {
      // 2a passada: confere o espaço antes de criar qualquer link ou cópia
      const linkable = reusable.length > 0 && await canLink(path.join(previousDir, reusable[0].path), dir);
      await checkDisk(dir, missingBytes + (linkable ? 0 : reuseBytes));
      let fellBack = false;
      for (const file of reusable) {
        if (await reuse(path.join(previousDir, file.path), file, path.join(dir, file.path), linkable)) {
          received += file.size;
        } else {
          fellBack = true;
          await queue(file);
        }
      }
      progress.received = received;
      emit(voice);
      if (fellBack && linkable) await checkDisk(dir, missingBytes);
      if (!current) setPhase(voice, 'baixando');
      // várias falas ao mesmo tempo: são milhares de arquivos pequenos, e uma por vez levava
      // perto de uma hora só pela espera de cada pedido; o primeiro erro (ou a pausa) para todas
      let next = 0;
      let failure = null;
      const worker = async () => {
        while (!failure && next < pending.length) {
          const file = pending[next++];
          try {
            await downloadFile(voice, pin.version, file, (n) => {
              progress.received = Math.max(0, progress.received + n);
              emit(voice);
            });
            if (current === pin.version) missing.get(voice)?.delete(file.path);
          } catch (err) {
            if (!failure) failure = err;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL_FILES, pending.length) }, worker));
      if (failure) throw failure;
    }

    if (changed || hashed || stamp === null) {
      await writeAtomic(stampFile(voice, pin.version), JSON.stringify({ at: Date.now() }));
    }
    if (current !== pin.version) {
      await writeAtomic(pointerFile(voice), JSON.stringify({ version: pin.version, at: new Date().toISOString() }));
      activeVersions.set(voice, pin.version);
    }
    missing.delete(voice);
    progress.phase = 'pronto';
    progress.received = manifest.total;
    emit(voice, true);
  }

  /** Baixa uma voz por vez. Sai com wanted=true só se ainda houver trabalho pendente. */
  async function runAll() {
    let failed = false;
    let interrupted = false;
    wanted = false;
    for (const [voice, pin] of pins) {
      if (paused || stopped) { interrupted = true; break; }
      const key = `${voice}@${pin.version}`;
      const generation = pauseGeneration;
      let redo = false;
      try {
        if (!verified.has(key) || recheck.has(voice)) {
          redo = recheck.delete(voice);
          await installVoice(voice, pin);
          redo = false;
          verified.add(key);
        }
        if (!pruned.has(key)) {
          await removeOldVersions(voice, pin.version);
          pruned.add(key);
        }
      } catch (err) {
        if (redo) recheck.add(voice);
        if (err instanceof PausedError || paused || stopped || generation !== pauseGeneration) {
          interrupted = true;
          if (!activeVersions.get(voice)) setPhase(voice, 'pausado');
          break;
        }
        if (err instanceof NotPublishedError) {
          // manifesto ainda não publicado: fica como está e tenta na próxima abertura
          if (!activeVersions.get(voice)) setPhase(voice, 'indisponivel');
          continue;
        }
        failed = true;
        console.warn(`[maestro-falas] ${voice}: ${err instanceof Error ? err.message : String(err)}`);
        if (!activeVersions.get(voice)) setPhase(voice, 'erro');
      }
    }
    if (interrupted || failed) wanted = true;
    if (failed && !stopped) {
      const wait = retryMs[Math.min(attempt, retryMs.length - 1)];
      attempt++;
      retryTimer = setTimeout(() => { retryTimer = null; start(); }, wait);
      retryTimer.unref?.();
    } else if (!interrupted) {
      attempt = 0;
    }
  }

  /** Começa ou retoma em segundo plano. Sem voz publicada, não faz nada. */
  function start() {
    if (pins.size === 0) return undefined;
    wanted = true;
    if (stopped || paused || running) return running || undefined;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    running = runAll()
      .catch(() => {})
      .then(() => {
        running = null;
        currentRequest = null;
        agent?.destroy();
        agent = null;
        if (wanted && !retryTimer && !paused && !stopped) start();
      });
    return running;
  }

  /** Pede nova conferência da voz, respeitando a espera entre tentativas. */
  function requestRepair(voice) {
    if (!pins.has(voice)) return;
    recheck.add(voice);
    wanted = true;
    if (!retryTimer) start();
  }

  /** Espera o trabalho em andamento acabar (usado nos testes). */
  async function idle() {
    while (running) await running;
  }

  function setPaused(value) {
    const was = paused;
    paused = !!value;
    if (paused && !was) {
      pauseGeneration++;
      currentRequest?.destroy(new PausedError());
    }
    if (!paused && was && wanted) start();
  }

  function stop() {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    currentRequest?.destroy(new PausedError());
  }

  /** Manifesto da versão ativa. Só um ENOENT da versão ainda ativa desfaz a instalação. */
  async function readActiveManifest(voice) {
    for (let tries = 0; tries < 3; tries++) {
      const version = await activeVersion(voice);
      if (!version) return { manifest: null, unreadable: false };
      try {
        const raw = await fsp.readFile(path.join(versionDir(voice, version), 'manifest.json'));
        return { manifest: parseManifest(raw, voice, version), unreadable: false };
      } catch (err) {
        if (activeVersions.get(voice) !== version) continue; // trocou de versão durante a leitura
        if (err?.code === 'ENOENT') {
          activeVersions.set(voice, null);
          missing.delete(voice);
          Object.assign(phases.get(voice), { phase: 'indisponivel', received: 0, total: 0 });
          emit(voice, true);
          requestRepair(voice);
          return { manifest: null, unreadable: false };
        }
        if (!err?.code) requestRepair(voice); // manifesto estragado: baixa de novo
        return { manifest: null, unreadable: true };
      }
    }
    return { manifest: null, unreadable: true };
  }

  /** Situação das duas vozes. "recorded" só lista o que está numa versão completa e presente. */
  async function status() {
    const out = [];
    for (const voice of VOICES) {
      const { manifest, unreadable } = await readActiveManifest(voice);
      const recorded = { normal: [], calma: [], forte: [] };
      const gone = missing.get(voice);
      if (manifest) {
        for (const item of manifest.files) {
          if (!gone?.has(item.path)) recorded[item.mode].push(item.id);
        }
      }
      // leitura falhou agora: a versão continua ativa, mas não anuncia "pronto" com lista vazia
      const state = unreadable ? { state: 'erro', progress: 0 } : publicState(voice);
      out.push({ voice, ...state, recorded });
    }
    return out;
  }

  /** Fala do manifesto que sumiu do disco: sai da lista e entra no reparo. */
  async function noteMissing(voice, version, rel) {
    const key = `${voice}@${version}/${rel}`;
    if (outsidePack.has(key) || missing.get(voice)?.has(rel)) return;
    const manifest = await readInstalledManifest(voice, version);
    if (!manifest) return;
    if (!manifest.files.some((f) => f.path === rel)) {
      if (outsidePack.size >= 256) outsidePack.clear();
      outsidePack.add(key);
      return;
    }
    if (activeVersions.get(voice) !== version) return;
    if (!missing.has(voice)) missing.set(voice, new Set());
    missing.get(voice).add(rel);
    emit(voice, true);
    requestRepair(voice);
  }

  /** Lê uma fala do disco, só quando pedida. Sem gravação: null. */
  async function file(payload) {
    const { voice, mode, id } = payload || {};
    if (!VOICES.includes(voice) || !MODES.includes(mode) || !validId(id)) return null;
    const rel = packPath(mode, id);
    for (let tries = 0; tries < 3; tries++) {
      const version = await activeVersion(voice);
      if (!version) return null;
      const target = path.join(versionDir(voice, version), rel);
      try {
        const info = await fsp.lstat(target);
        if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE_BYTES) return null;
        const data = await fsp.readFile(target);
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      } catch (err) {
        if (err?.code !== 'ENOENT') return null;
        if (activeVersions.get(voice) !== version) continue; // versão trocada no meio da leitura
        await noteMissing(voice, version, rel);
        return null;
      }
    }
    return null;
  }

  const setProgressListener = (cb) => { listener = cb; };

  return { start, stop, setPaused, status, file, idle, setProgressListener };
}

module.exports = { ...createMaestroPacks(), createMaestroPacks, parsePackPath, parseManifest, VOICES, MODES };
