// Leitor de letra no Mac do diretor: separa a voz e lê a letra de cada música com o tempo de cada
// palavra, sem internet e sem custo (lyricsTranscriber.py no Python embutido no instalador).
//
// - O modelo (Whisper large-v3-turbo, ~1,6 GB) é baixado uma vez, quando o diretor envia o
//   repertório pela primeira vez. Vem da nossa VPS, com o SHA-256 de cada arquivo conferido
//   (lyrics-model.json); se a VPS falhar, do Hugging Face na mesma revisão.
// - Uma música por vez, com prioridade baixa. A tela cancela a leitura quando o play começa: o
//   show nunca disputa o processador com a IA.
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createModelDownload } = require('./modelDownload');

const MANIFEST = require('./lyrics-model.json');
/** Uma música de 5 min leva de 3 a 6 min num Mac M1; num Intel antigo, bem mais. */
const TIMEOUT_MS = 40 * 60_000;

const download = createModelDownload({
  manifest: MANIFEST,
  folder: 'leitor-de-letra',
  label: 'o leitor de letra',
  userAgent: 'VS-Stage-Leitor-de-Letra',
  baseUrl: MANIFEST.mirror,
  homeEnv: 'VS_LYRICS_MODEL_HOME',
  baseUrlEnv: 'VS_LYRICS_MODEL_BASE_URL',
  skipEnv: 'VS_LYRICS_MODEL_DIR',
});

let child = null;
let canceled = false;
/** Andamento da leitura em curso, para a barra da tela: etapa, fração ouvida e início. */
let current = null;
let supportedCache = null;

/** O Python do motor de IA embutido (no app instalado ou, em desenvolvimento, desktop/ai-engine). */
function engine() {
  // em desenvolvimento e nos testes: outro Python com o mesmo motor
  if (process.env.VS_LYRICS_PYTHON) return { python: process.env.VS_LYRICS_PYTHON, torchHome: process.env.TORCH_HOME || '' };
  const roots = [
    process.resourcesPath ? path.join(process.resourcesPath, 'ai-engine') : null,
    path.join(__dirname, 'ai-engine'),
  ].filter(Boolean);
  for (const root of roots) {
    const python = path.join(root, 'python', 'bin', 'python3');
    if (fs.existsSync(python)) return { python, torchHome: path.join(root, 'torch-cache') };
  }
  return null;
}

function modelDir() {
  return process.env.VS_LYRICS_MODEL_DIR || download.modelDir();
}

function modelReady() {
  if (process.env.VS_LYRICS_MODEL_DIR) return fs.existsSync(path.join(process.env.VS_LYRICS_MODEL_DIR, 'model.bin'));
  return download.isReady();
}

function script() {
  // Dentro do app.asar o Python não abre o arquivo: ele vai desempacotado (asarUnpack).
  return path.join(__dirname, 'lyricsTranscriber.py').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/** Este Mac tem o motor com o leitor de letra? (instaladores antigos não têm o faster-whisper) */
function supported() {
  if (supportedCache) return supportedCache;
  const eng = engine();
  if (!eng || !fs.existsSync(script())) {
    console.log('[leitor de letra] sem motor de IA ou sem o script neste programa');
    return (supportedCache = Promise.resolve(false));
  }
  supportedCache = new Promise((resolve) => {
    // mesmo jeito que o leitor abre: sem o PyAV (ver lyricsTranscriber.py)
    const check = 'import sys, types\ntry:\n  import av\nexcept Exception:\n  sys.modules["av"] = types.ModuleType("av")\nimport ctranslate2, tokenizers, faster_whisper';
    const p = spawn(eng.python, ['-I', '-c', check], { stdio: 'ignore' });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, 60_000);
    p.on('error', () => { clearTimeout(timer); console.log('[leitor de letra] Python do motor não abriu:', eng.python); resolve(false); });
    p.on('close', (code) => {
      clearTimeout(timer);
      console.log(`[leitor de letra] ${code === 0 ? 'pronto' : 'motor sem o faster-whisper'} (${eng.python})`);
      resolve(code === 0);
    });
  });
  return supportedCache;
}

async function status() {
  return {
    supported: await supported(),
    model: modelReady() ? { ...download.status(), state: 'ready' } : download.status(),
    busy: !!child,
    progress: child && current ? { ...current, elapsed: Math.round((Date.now() - current.startedAt) / 1000) } : null,
  };
}

/** Começa (ou retoma) o download do modelo em segundo plano. */
async function prepare() {
  if (await supported()) download.start();
  return status();
}

/**
 * Lê a letra de uma música.
 * @param {ArrayBuffer|Buffer} wav  o áudio em WAV (a faixa Guia da música)
 * @param {{separate?: boolean}} [opts]  separate: tirar a voz da banda antes (para mixagem
 *   inteira). A faixa Guia já é a voz, então por padrão não separa (e fica bem mais rápido).
 * @returns {Promise<{segments: object[], seconds: number} | {why: string}>}
 */
async function transcribe(wav, opts = {}) {
  if (!(await supported())) return { why: 'unsupported' };
  if (!modelReady()) { download.start(); return { why: 'model_missing' }; }
  if (child) return { why: 'busy' };
  const eng = engine();
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vs-letra-'));
  const input = path.join(workDir, 'musica.wav');
  const output = path.join(workDir, 'letra.json');
  canceled = false;
  current = { stage: 'load', pct: 0, startedAt: Date.now() };
  try {
    await fsp.writeFile(input, Buffer.from(wav));
    const reply = await new Promise((resolve) => {
      let out = '';
      const args = ['-I', script(), '--in', input, '--model', modelDir(), '--out', output];
      if (!opts.separate) args.push('--no-separate');
      const p = spawn(eng.python, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TMPDIR: os.tmpdir(), TORCH_HOME: eng.torchHome, HF_HUB_OFFLINE: '1' },
      });
      child = p;
      const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, TIMEOUT_MS);
      let pending = '';
      p.stdout.on('data', (c) => {
        const text = c.toString();
        out += text;
        // linhas {"progress": "...", "pct": 0.4}: andamento para a barra da tela
        pending += text;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('{"progress"')) continue;
          try {
            const msg = JSON.parse(line);
            current = { ...current, stage: msg.progress, pct: typeof msg.pct === 'number' ? msg.pct : current.pct };
          } catch { /* linha quebrada */ }
        }
      });
      p.stderr.on('data', (c) => { out = (out + c.toString()).slice(-20000); });
      p.on('error', () => { clearTimeout(timer); resolve({ ok: false, error: 'Não foi possível abrir o leitor de letra.' }); });
      p.on('close', () => {
        clearTimeout(timer);
        const line = out.trim().split('\n').reverse().find((l) => l.trim().startsWith('{"ok"'));
        if (!line) { resolve({ ok: false, error: 'O leitor de letra parou sem responder.' }); return; }
        try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, error: 'O leitor de letra respondeu algo inesperado.' }); }
      });
    });
    if (canceled) { console.log('[leitor de letra] parou: o play começou'); return { why: 'canceled' }; }
    if (!reply.ok) { console.log('[leitor de letra] falhou:', reply.error); return { why: reply.error || 'failed' }; }
    const result = JSON.parse(await fsp.readFile(output, 'utf8'));
    console.log(`[leitor de letra] leu ${Array.isArray(result.segments) ? result.segments.length : 0} frases em ${reply.seconds ?? '?'} s`);
    return { segments: Array.isArray(result.segments) ? result.segments : [], seconds: reply.seconds ?? null };
  } catch (err) {
    return { why: canceled ? 'canceled' : err instanceof Error ? err.message : String(err) };
  } finally {
    child = null;
    current = null;
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Para a leitura em andamento (o play começou ou o programa vai fechar). */
function cancel() {
  if (!child) return false;
  canceled = true;
  try { child.kill('SIGKILL'); } catch { /* já saiu */ }
  return true;
}

/** Música tocando: o download do modelo também pausa. */
function setPlaying(playing) {
  download.setPaused(!!playing);
  if (playing) cancel();
}

function stop() {
  cancel();
  download.stop();
}

module.exports = { status, prepare, transcribe, cancel, setPlaying, stop, MANIFEST };
