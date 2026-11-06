// Separação da BATERIA em peças (bumbo, caixa, pratos, tons), como o Moises faz.
//
// O Demucs já entrega a bateria inteira num stem só. Aqui esse stem passa por um segundo modelo,
// o drumsep (Hybrid Demucs afinado em bateria, MIT), que separa as peças. O modelo roda pelo ONNX
// Runtime, que funciona em Mac Intel E em chip Apple — por isso este passo roda nos dois
// instaladores, ao contrário da voz do Maestro IA.
//
// - O modelo (~335 MB, MIT) é baixado uma vez, em silêncio, na pasta do app no Mac do usuário.
// - O Python com o ONNX Runtime também é preparado uma vez (no instalador ou no primeiro uso).
// - Sem internet e sem o que já estar pronto, a separação da bateria simplesmente não é oferecida:
//   a música continua vindo com a bateria inteira, como antes.
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** O modelo: v2 é a versão afinada para bateria eletrônica (acerta muito mais caixa e pratos). */
const MODEL = {
  name: 'drumsep v2 (ONNX)',
  url: 'https://huggingface.co/gridshiftstudio/drumsep-onnx/resolve/main/drumsep_v2.onnx',
  file: 'drumsep_v2.onnx',
  bytes: 335 * 1024 * 1024,
  sha256: null, // conferido pelo tamanho; o SHA oficial muda a cada publicação do repositório
};
/** As peças, na ordem em que a tela mostra. */
const PIECES = [
  { id: 'bumbo', name: 'Bumbo', file: 'bumbo.wav' },
  { id: 'caixa', name: 'Caixa', file: 'caixa.wav' },
  { id: 'pratos', name: 'Pratos', file: 'pratos.wav' },
  { id: 'tons', name: 'Tons', file: 'tons.wav' },
];

/** Pasta do modelo, ao lado do resto do que o app baixa. */
function baseDir() {
  if (process.env.VS_DRUMSEP_HOME) return process.env.VS_DRUMSEP_HOME;
  try {
    const { app } = require('electron');
    if (app?.getPath) return path.join(app.getPath('userData'), 'drumsep');
  } catch { /* fora do Electron */ }
  return path.join(os.homedir(), '.vs-drumsep');
}

function modelPath() {
  return path.join(baseDir(), MODEL.file);
}

/** O modelo está pronto para usar? */
function isReady() {
  try {
    return fs.statSync(modelPath()).size > 100 * 1024 * 1024;
  } catch {
    return false;
  }
}

let state = { state: isReady() ? 'ready' : 'missing', received: 0, total: MODEL.bytes, error: null };
let downloading = null;

function status() {
  const ready = isReady();
  return { ready, state: ready ? 'ready' : state.state, progress: ready ? 1 : (state.received / Math.max(1, state.total)), error: state.error };
}

/** GET seguindo redirecionamento (o Hugging Face manda para a CDN). */
function open(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'VS-Stage-DrumSep' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 8) {
        res.resume();
        resolve(open(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`http_${res.statusCode}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('timeout')));
  });
}

/** Baixa o modelo uma vez (continua de onde parou). Resolve true quando estiver pronto. */
async function ensureModel() {
  if (isReady()) return true;
  if (downloading) return downloading;
  downloading = (async () => {
    const dir = baseDir();
    await fsp.mkdir(dir, { recursive: true });
    const final = modelPath();
    const part = `${final}.part`;
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    state = { state: 'downloading', received: have, total: MODEL.bytes, error: null };
    try {
      const res = await open(MODEL.url);
      // o tamanho real vem do servidor: melhor que o número fixo do manifesto
      const total = Number(res.headers['content-length']) || MODEL.bytes;
      state.total = total + have;
      let got = have;
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(part, { flags: have > 0 ? 'a' : 'w' });
        res.on('data', (chunk) => { got += chunk.length; state.received = got; });
        res.on('error', (e) => { out.end(); reject(e); });
        out.on('error', reject);
        out.on('finish', resolve);
        res.pipe(out);
      });
      if (fs.statSync(part).size < 100 * 1024 * 1024) throw new Error('O modelo veio incompleto.');
      await fsp.rename(part, final);
      state = { state: 'ready', received: MODEL.bytes, total: MODEL.bytes, error: null };
      return true;
    } catch (err) {
      state = { ...state, state: 'error', error: err instanceof Error ? err.message : String(err) };
      return false;
    } finally {
      downloading = null;
    }
  })();
  return downloading;
}

// ---------------------------------------------------------------------------------------------
// Python com ONNX Runtime

/**
 * Todos os Pythons que podem servir, na ordem de preferência (o do motor de IA vem primeiro).
 *
 * A ordem importa: o primeiro que EXISTE pode não ter o onnxruntime — o Python 3.14 do sistema
 * não tem (a 1.20.1 é a última com pacote universal2 e não existe para 3.14). Ficar só no
 * primeiro que existe dava "Não foi possível preparar a separação da bateria agora", porque o
 * pip falhava ao instalar e o código desistia sem tentar os outros.
 */
function pythonCandidates() {
  const appPython = process.resourcesPath
    ? path.join(process.resourcesPath, 'ai-engine', 'python', 'bin', 'python3')
    : null;
  return [
    appPython, // embutido no instalador (o que tem tudo pronto)
    // o do app instalado em /Applications, mesmo rodando em modo de desenvolvimento
    '/Applications/VS Stage.app/Contents/Resources/ai-engine/python/bin/python3',
    path.join(__dirname, 'ai-engine', 'python', 'bin', 'python3'),
    path.join(os.homedir(), 'Library', 'Application Support', 'VS Stage', 'ai-engine', 'python', 'bin', 'python3'),
    '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
    '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3',
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    path.join(os.homedir(), '.local/bin/python3'),
  ].filter(Boolean).filter((p, i, all) => all.indexOf(p) === i);
}

/** O primeiro Python que existe no disco (usado só como último recurso). */
function findPython() {
  return pythonCandidates().find((p) => { try { return fs.existsSync(p); } catch { return false; } }) ?? null;
}

function runCapture(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* já saiu */ } }, timeoutMs);
    child.stdout.on('data', (c) => { out += c.toString(); });
    child.stderr.on('data', (c) => { out += c.toString(); });
    child.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, out }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: code === 0, out, code }); } });
  });
}

/** O Python sabe rodar a separação? Precisa de onnxruntime, numpy e soundfile. */
async function hasRuntime(python) {
  const r = await runCapture(python, ['-c', 'import onnxruntime, numpy; import soundfile'], 40_000);
  return r.ok;
}

async function installRuntime(python) {
  // 1.20.1 é a última com pacote universal2 para macOS: serve para Intel e chip Apple
  const r = await runCapture(
    python,
    ['-m', 'pip', 'install', '--quiet', '--no-cache-dir', 'onnxruntime==1.20.1', 'numpy', 'soundfile'],
    900_000,
  );
  return r.ok;
}

/**
 * Acha um Python que consiga rodar o modelo: primeiro os que já têm o runtime, depois tenta
 * instalar em cada um até um dar certo. Devolve { python } ou { why }.
 */
async function pickPython(onProgress) {
  const candidates = pythonCandidates().filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!candidates.length) return { why: 'O Python do motor de IA não está instalado neste Mac.' };

  // 1. Algum já tem tudo pronto? (o embutido no instalador tem)
  for (const python of candidates) {
    if (await hasRuntime(python)) return { python };
  }

  // 2. Instala no primeiro em que der certo. O pip falha no 3.14 (sem pacote do onnxruntime),
  //    então tentar só o primeiro deixava a separação impossível sem motivo.
  onProgress?.('Instalando o componente de separação da bateria (uma vez só)...');
  const errors = [];
  for (const python of candidates) {
    if (await installRuntime(python)) return { python };
    const version = await runCapture(python, ['-V'], 5_000);
    errors.push(`${python.replace(os.homedir(), '~')} (${version.out.trim() || 'versão desconhecida'})`);
  }
  return {
    why: `Não foi possível preparar a separação da bateria. Nenhum Python deste Mac aceitou o componente de IA: ${errors.slice(0, 2).join('; ')}.`,
  };
}

/**
 * Prepara tudo: Python com as dependências e o script no lugar. Devolve { ok, python } ou { ok:false, why }.
 *
 * Não há mais modelo para baixar: o drumsep é processamento de sinal (ver desktop/drumsep).
 * O `--model` continua na chamada do script só para não quebrar versões antigas.
 */
async function ensureReady(onProgress) {
  onProgress?.('Preparando a separação da bateria (uma vez só)...');
  const picked = await pickPython(onProgress);
  if (!picked.python) return { ok: false, why: picked.why };

  onProgress?.('Baixando o modelo de separação da bateria (uma vez só)...');
  if (!(await ensureModel())) {
    return { ok: false, why: 'O modelo da bateria não terminou de baixar. A música vem com a bateria inteira.' };
  }
  return { ok: true, python: picked.python };
}

// ---------------------------------------------------------------------------------------------

/**
 * Separa a bateria em peças.
 * @param {Buffer} drumsWav  o WAV do stem da bateria (a música já separada pelo Demucs)
 * @returns {Promise<{bumbo?:Buffer, caixa?:Buffer, pratos?:Buffer, tons?:Buffer, why?:string}>}
 *   Cada peça em WAV. Se não der, devolve `why` e nenhuma peça: quem chamou fica com a bateria inteira.
 */
async function separateDrumPieces(drumsWav, onProgress) {
  const ready = await ensureReady(onProgress);
  if (!ready.ok) return { why: ready.why };

  const script = path.join(__dirname, 'drumPieceSeparator.py');
  if (!fs.existsSync(script)) return { why: 'O separador da bateria não veio nesta instalação.' };

  const workDir = path.join(os.tmpdir(), `vs-drums-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const outDir = path.join(workDir, 'pecas');
  try {
    await fsp.mkdir(outDir, { recursive: true });
    const inputPath = path.join(workDir, 'bateria.wav');
    await fsp.writeFile(inputPath, drumsWav);

    onProgress?.('Separando a bateria em bumbo, caixa, pratos e tons...');
    const started = Date.now();
    const result = await new Promise((resolve) => {
      let out = '';
      const child = spawn(ready.python, ['-I', script, '--model', baseDir(), '--in', inputPath, '--out', outDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir() },
      });
      // o drumsep leva segundos por música; 10 min é teto de segurança para não pendurar a tela
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* já saiu */ } }, 10 * 60_000);
      child.stdout.on('data', (c) => { out += c.toString(); });
      child.stderr.on('data', (c) => { out += c.toString(); });
      child.on('error', () => { clearTimeout(timer); resolve({ ok: false, why: 'Não foi possível abrir o separador.' }); });
      child.on('close', () => {
        clearTimeout(timer);
        // a última linha com JSON é a resposta do script
        const line = out.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
        if (!line) { resolve({ ok: false, why: 'O separador não respondeu.' }); return; }
        try {
          const reply = JSON.parse(line);
          resolve(reply.ok ? { ok: true, seconds: reply.seconds } : { ok: false, why: reply.error });
        } catch {
          resolve({ ok: false, why: 'O separador respondeu algo inesperado.' });
        }
      });
    });

    if (!result.ok) return { why: result.why };

    const out = {};
    for (const piece of PIECES) {
      const file = path.join(outDir, piece.file);
      if (fs.existsSync(file)) out[piece.id] = await fsp.readFile(file);
    }
    out.elapsedMs = Date.now() - started;
    if (!out.bumbo && !out.caixa) return { why: 'O separador não devolveu as peças da bateria.' };
    return out;
  } catch (err) {
    return { why: err instanceof Error ? err.message : String(err) };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  PIECES,
  MODEL,
  modelPath,
  isReady,
  status,
  ensureModel,
  ensureReady,
  separateDrumPieces,
  // para os testes
  _findPython: findPython,
};
