// Download do modelo de voz do Maestro IA (Qwen3-TTS, ~1,8 GB), uma vez só, em silêncio.
//
// - Os arquivos e o SHA-256 de cada um estão fixos em maestro-voice-model.json (versão travada no
//   Hugging Face): o que chega é exatamente o que foi testado.
// - Fica na pasta do app no Mac do usuário (fora do .app): vale para as próximas versões, que só
//   trocam o .app.
// - Continua de onde parou (cada arquivo baixa num ".part"), pausa enquanto uma música toca (para
//   não disputar a rede e o disco num show) e tenta de novo sozinho se a internet cair.
// - Só marca como pronto (arquivo ".pronto") depois de conferir todos os arquivos.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

// nos testes: outra lista de arquivos e outro endereço (servidor local)
const MANIFEST = process.env.VS_MAESTRO_MODEL_MANIFEST
  ? JSON.parse(fs.readFileSync(process.env.VS_MAESTRO_MODEL_MANIFEST, 'utf8'))
  : require('./maestro-voice-model.json');

/** Espera entre tentativas depois de falha de rede: 30 s, 2 min, 10 min (e fica nos 10 min). */
const RETRY_MS = [30_000, 120_000, 600_000];
/** Folga de disco além do que falta baixar. */
const DISK_MARGIN = 500 * 1024 * 1024;

const TOTAL_BYTES = MANIFEST.files.reduce((n, f) => n + f.size, 0);

let state = { state: 'missing', received: 0, total: TOTAL_BYTES, error: null };
let paused = false;
let running = null;
let currentRequest = null;
let retryTimer = null;
let attempt = 0;

/** Pasta-base dos modelos: a do app (userData); nos testes e no build, a de VS_MAESTRO_MODEL_HOME. */
function baseDir() {
  if (process.env.VS_MAESTRO_MODEL_HOME) return process.env.VS_MAESTRO_MODEL_HOME;
  try {
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'maestro-voice');
  } catch { /* fora do Electron */ }
  return path.join(os.homedir(), '.vs-maestro-voice');
}

/** Pasta do modelo desta versão (outra versão do modelo vai para outra pasta). */
function modelDir() {
  const slug = MANIFEST.repo.split('/').pop();
  return path.join(baseDir(), `${slug}-${MANIFEST.revision.slice(0, 8)}`);
}

function readyMarker() {
  return path.join(modelDir(), '.pronto');
}

/** O modelo está inteiro e conferido? */
function isReady() {
  try {
    const mark = JSON.parse(fs.readFileSync(readyMarker(), 'utf8'));
    return mark.revision === MANIFEST.revision
      && MANIFEST.files.every((f) => fs.statSync(path.join(modelDir(), f.path)).size === f.size);
  } catch {
    return false;
  }
}

/** Situação para a tela: missing | downloading | paused | verifying | ready | error. */
function status() {
  if (isReady()) return { state: 'ready', received: TOTAL_BYTES, total: TOTAL_BYTES, progress: 1, error: null };
  const progress = state.total > 0 ? Math.min(1, state.received / state.total) : 0;
  return { ...state, state: paused && state.state === 'downloading' ? 'paused' : state.state, progress };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

function fileUrl(f) {
  const base = process.env.VS_MAESTRO_MODEL_BASE_URL;
  if (base) return `${base.replace(/\/$/, '')}/${f.path}`;
  return `https://huggingface.co/${MANIFEST.repo}/resolve/${MANIFEST.revision}/${f.path}`;
}

class PausedError extends Error {}

/** GET com Range, seguindo os redirecionamentos do Hugging Face (vão para a CDN). */
function openStream(url, from, redirects = 0) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'VS-Stage-Maestro-IA' };
    if (from > 0) headers.Range = `bytes=${from}-`;
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, { headers }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 8) {
        res.resume();
        resolve(openStream(new URL(res.headers.location, url).toString(), from, redirects + 1));
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new Error(`http_${res.statusCode}`));
        return;
      }
      resolve({ res, req, partial: res.statusCode === 206 });
    });
    currentRequest = req;
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
  });
}

async function downloadFile(f, dir, onBytes) {
  const final = path.join(dir, f.path);
  const part = `${final}.part`;
  await fsp.mkdir(path.dirname(final), { recursive: true });
  if (fs.existsSync(final) && fs.statSync(final).size === f.size) {
    onBytes(f.size);
    return;
  }
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (have > f.size) { await fsp.rm(part, { force: true }); have = 0; }
  onBytes(have);
  if (have < f.size) {
    if (paused) throw new PausedError();
    const { res, partial } = await openStream(fileUrl(f), have);
    // o servidor não aceitou continuar do meio: recomeça o arquivo do zero
    if (!partial && have > 0) { have = 0; await fsp.rm(part, { force: true }); onBytes(0); }
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
      res.on('data', (chunk) => {
        onBytes(chunk.length, true);
        if (paused) res.destroy(new PausedError());
      });
      res.on('error', (e) => { out.end(); reject(e); });
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
  }
  if (fs.statSync(part).size !== f.size) throw new Error(`O arquivo ${f.path} veio incompleto.`);
  const sum = await sha256File(part);
  if (sum !== f.sha256) {
    await fsp.rm(part, { force: true });
    throw new Error(`O arquivo ${f.path} não confere (SHA-256).`);
  }
  await fsp.rename(part, final);
}

async function checkDisk(dir, missing) {
  try {
    const s = await fsp.statfs(dir);
    if (s.bavail * s.bsize < missing + DISK_MARGIN) {
      throw new Error(`Falta espaço no disco para a voz brasileira (precisa de ${Math.ceil((missing + DISK_MARGIN) / 1e9)} GB livres).`);
    }
  } catch (err) {
    if (/espaço/.test(err.message)) throw err;
  }
}

/** Baixa o que falta e confere tudo. Resolve quando pronto; rejeita em erro ou pausa. */
async function downloadAll() {
  if (isReady()) { state = { state: 'ready', received: TOTAL_BYTES, total: TOTAL_BYTES, error: null }; return; }
  const dir = modelDir();
  await fsp.mkdir(dir, { recursive: true });
  const doneBefore = (f) => {
    const final = path.join(dir, f.path);
    if (fs.existsSync(final) && fs.statSync(final).size === f.size) return f.size;
    const part = `${final}.part`;
    return fs.existsSync(part) ? Math.min(f.size, fs.statSync(part).size) : 0;
  };
  await checkDisk(dir, TOTAL_BYTES - MANIFEST.files.reduce((n, f) => n + doneBefore(f), 0));

  state = { state: 'downloading', received: 0, total: TOTAL_BYTES, error: null };
  let base = 0;
  for (const f of MANIFEST.files) {
    let fileBytes = 0;
    await downloadFile(f, dir, (n, incremental) => {
      fileBytes = incremental ? fileBytes + n : n;
      state.received = base + Math.min(f.size, fileBytes);
    });
    base += f.size;
    state.received = base;
  }
  state.state = 'verifying';
  await fsp.writeFile(readyMarker(), JSON.stringify({ revision: MANIFEST.revision, repo: MANIFEST.repo, at: new Date().toISOString() }));
  state = { state: 'ready', received: TOTAL_BYTES, total: TOTAL_BYTES, error: null };
}

/** Começa (ou retoma) o download em segundo plano, se ainda não estiver pronto. */
function start() {
  if (running || isReady()) return;
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  running = downloadAll()
    .then(() => { attempt = 0; })
    .catch((err) => {
      if (err instanceof PausedError || paused) {
        state.state = 'downloading'; // aparece como "paused" em status()
        return;
      }
      state = { ...state, state: 'error', error: err instanceof Error ? err.message : String(err) };
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
      attempt++;
      retryTimer = setTimeout(() => { retryTimer = null; start(); }, wait);
      retryTimer.unref?.();
    })
    .finally(() => { running = null; currentRequest = null; });
}

/** Pausa (música tocando) ou retoma o download. */
function setPaused(value) {
  const was = paused;
  paused = !!value;
  if (paused && !was) currentRequest?.destroy(new PausedError());
  if (!paused && was && !isReady() && state.state !== 'missing') start();
}

/** Para o download (o app vai fechar). O ".part" fica para continuar depois. */
function stop() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  paused = true;
  currentRequest?.destroy(new PausedError());
}

module.exports = { MANIFEST, TOTAL_BYTES, modelDir, isReady, status, start, setPaused, stop, downloadAll, sha256File };
