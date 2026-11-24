const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { machineArch } = require('./machineArch');

const IS_WIN = process.platform === 'win32';
/** Python dentro de uma pasta ai-engine: no Windows o python-build-standalone traz python\\python.exe. */
const enginePython = (dir) => (IS_WIN ? path.join(dir, 'python', 'python.exe') : path.join(dir, 'python', 'bin', 'python3'));
const APP_AI_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'VS Stage', 'ai-engine');
const APP_AI_PYTHON = enginePython(APP_AI_DIR);
const APP_AI_DEMUCS = path.join(APP_AI_DIR, 'python', 'bin', 'demucs');

// Candidatos a executável direto do Demucs (Intel e Apple Silicon)
const DEMUCS_BIN_CANDIDATES = [
  APP_AI_DEMUCS,
  '/usr/local/bin/demucs', // Intel Homebrew / pip global
  '/opt/homebrew/bin/demucs', // Apple Silicon Homebrew
  '/Library/Frameworks/Python.framework/Versions/3.14/bin/demucs',
  '/Library/Frameworks/Python.framework/Versions/3.13/bin/demucs',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/demucs',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/demucs',
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/demucs',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/demucs',
  path.join(os.homedir(), 'Library/Python/3.14/bin/demucs'),
  path.join(os.homedir(), 'Library/Python/3.13/bin/demucs'),
  path.join(os.homedir(), 'Library/Python/3.12/bin/demucs'),
  path.join(os.homedir(), 'Library/Python/3.11/bin/demucs'),
  path.join(os.homedir(), 'Library/Python/3.10/bin/demucs'),
  path.join(os.homedir(), '.local/bin/demucs'),
  path.join(os.homedir(), '.pyenv/shims/demucs'),
];

// Candidatos a interpretador Python (Intel e Apple Silicon)
const PYTHON_CANDIDATES = [
  APP_AI_PYTHON,
  '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.9/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/usr/local/bin/python3', // Intel Homebrew / python.org padrão
  '/opt/homebrew/bin/python3', // Apple Silicon Homebrew
  path.join(os.homedir(), '.pyenv/shims/python3'),
  path.join(os.homedir(), 'miniconda3/bin/python3'),
  path.join(os.homedir(), '.miniconda3/bin/python3'),
  path.join(os.homedir(), 'anaconda3/bin/python3'),
  path.join(os.homedir(), '.local/bin/python3'),
];

const running = new Set();
let cancelRequested = false;

/**
 * Prioridade abaixo do normal para a IA (nice 10 no Mac, BELOW_NORMAL no Windows): quando a tela e
 * o som disputam o processador com a separação, eles vêm primeiro, e a IA usa todo o resto. Os
 * processos que ela abrir herdam a mesma prioridade.
 */
function lowerPriority(child) {
  try {
    if (child && child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch { /* já saiu, ou o sistema não deixou: segue na prioridade normal */ }
}

/**
 * Roda um programa sem travar o processo principal. Antes eram as versões síncronas do exec: sem
 * o motor embutido, a janela inteira congelava de segundos a minutos (curl de até 120 s, pip de
 * até 420 s). Resolve { ok, out, err } e nunca rejeita. `timeout` mata o programa e responde
 * ok: false, como a versão síncrona fazia. `capture` guarda a saída padrão; `logErr`, o fim da de erro.
 * Cancelar a separação ou fechar o programa mata o que estiver rodando aqui (`running`).
 */
function run(cmd, args, { timeout = 0, capture = false, logErr = false, env } = {}) {
  return new Promise((resolve) => {
    let child;
    let out = '';
    let err = '';
    let settled = false;
    let timer = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      running.delete(child);
      resolve({ ok, out, err });
    };
    try {
      child = spawn(cmd, args, {
        stdio: ['ignore', capture ? 'pipe' : 'ignore', logErr ? 'pipe' : 'ignore'],
        windowsHide: true,
        ...(env ? { env } : {}),
      });
    } catch {
      resolve({ ok: false, out: '', err: '' });
      return;
    }
    running.add(child);
    if (capture) child.stdout.on('data', (c) => { out += c.toString(); });
    if (logErr) child.stderr.on('data', (c) => { err = (err + c.toString()).slice(-2000); });
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    if (timeout > 0) {
      timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* já saiu */ }
        finish(false);
      }, timeout);
    }
  });
}

const cancelledError = () => new Error('separation_cancelled');

let cachedRunner = null;
let probing = null;

/** Acha como rodar o Demucs. Uma sondagem por vez: quem chegar durante uma espera a mesma. */
function findDemucsRunner() {
  if (cachedRunner) return Promise.resolve(cachedRunner);
  if (!probing) probing = probeDemucsRunner().finally(() => { probing = null; });
  return probing;
}

async function probeDemucsRunner() {
  // 0. Prioridade máxima: Motor de IA 100% EMBUTIDO na instalação do VS Stage (Contents/Resources/ai-engine)
  if (process.resourcesPath) {
    const embeddedPy = enginePython(path.join(process.resourcesPath, 'ai-engine'));
    const embeddedTorchHome = path.join(process.resourcesPath, 'ai-engine', 'torch-cache');
    if (fs.existsSync(embeddedPy)) {
      cachedRunner = { type: 'python', path: embeddedPy, torchHome: embeddedTorchHome, isEmbedded: true };
      return cachedRunner;
    }
  }

  // 0.1 Pasta local em desenvolvimento (desktop/ai-engine/python/bin/python3)
  const localDevPy = enginePython(path.join(__dirname, 'ai-engine'));
  const localDevTorch = path.join(__dirname, 'ai-engine', 'torch-cache');
  if (fs.existsSync(localDevPy)) {
    cachedRunner = { type: 'python', path: localDevPy, torchHome: localDevTorch, isEmbedded: true };
    return cachedRunner;
  }

  // No Windows só vale o motor embutido no instalador (os caminhos abaixo são do Mac).
  if (IS_WIN) return null;

  // 1. Testa se o comando "demucs" está acessível no PATH do sistema
  const whichDemucs = await run('which', ['demucs'], { timeout: 1000, capture: true });
  const demucsPath = whichDemucs.ok ? whichDemucs.out.trim() : '';
  if (demucsPath && fs.existsSync(demucsPath)) {
    cachedRunner = { type: 'bin', path: demucsPath };
    return cachedRunner;
  }

  // 2. Testa os caminhos conhecidos do executável demucs (Intel + Apple Silicon)
  for (const b of DEMUCS_BIN_CANDIDATES) {
    if (fs.existsSync(b) && (await run(b, ['--help'], { timeout: 2000 })).ok) {
      cachedRunner = { type: 'bin', path: b };
      return cachedRunner;
    }
  }

  // 3. Testa os interpretadores Python com "import demucs" (Intel + Apple Silicon)
  for (const p of PYTHON_CANDIDATES) {
    if (fs.existsSync(p) && (await run(p, ['-c', 'import demucs'], { timeout: 2000 })).ok) {
      cachedRunner = { type: 'python', path: p };
      return cachedRunner;
    }
  }

  // 4. Testa se o comando python3 do terminal tem demucs (evitando o stub do Xcode /usr/bin/python3)
  const whichPy = await run('which', ['python3'], { timeout: 1000, capture: true });
  const pyPath = whichPy.ok ? whichPy.out.trim() : '';
  if (pyPath && pyPath !== '/usr/bin/python3' && fs.existsSync(pyPath)
    && (await run(pyPath, ['-c', 'import demucs'], { timeout: 2000 })).ok) {
    cachedRunner = { type: 'python', path: pyPath };
    return cachedRunner;
  }

  return null;
}

async function findAnyWorkingPython() {
  for (const p of PYTHON_CANDIDATES) {
    if (fs.existsSync(p) && (await run(p, ['--version'], { timeout: 1500 })).ok) return p;
  }
  const whichPy = await run('which', ['python3'], { timeout: 1000, capture: true });
  const pyPath = whichPy.ok ? whichPy.out.trim() : '';
  if (pyPath && pyPath !== '/usr/bin/python3' && fs.existsSync(pyPath)) return pyPath;
  return null;
}

let preparing = null;

/** Prepara o motor de IA na primeira vez. Uma preparação por vez: baixar e instalar duas vezes juntas estragaria a pasta. */
function ensureAiEngine(win) {
  if (!preparing) preparing = prepareAiEngine(win).finally(() => { preparing = null; });
  return preparing;
}

async function prepareAiEngine(win) {
  // Cancelar durante o preparo mata o que estiver rodando e para aqui, sem seguir para o download.
  const stopIfCancelled = () => { if (cancelRequested) throw cancelledError(); };
  let runner = await findDemucsRunner();
  if (runner) return runner;
  if (IS_WIN) throw new Error('O motor de Inteligência Artificial não veio nesta instalação. Reinstale o VS Stage.');
  stopIfCancelled();

  if (fs.existsSync(APP_AI_PYTHON) && (await run(APP_AI_PYTHON, ['-c', 'import demucs'], { timeout: 3000 })).ok) {
    cachedRunner = { type: 'python', path: APP_AI_PYTHON };
    return cachedRunner;
  }
  stopIfCancelled();

  // Notifica o progresso na janela do programa
  const notify = (percent, message) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('separation:progress', { percent, message });
    }
  };

  notify(5, 'Configurando a Inteligência Artificial interna no seu Mac pela primeira vez...');

  const arch = machineArch() === 'arm64' ? 'aarch64' : 'x86_64';
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-${arch}-apple-darwin-install_only.tar.gz`;
  const tarFile = path.join(os.tmpdir(), `vs-stage-python-${Date.now()}.tar.gz`);

  try {
    await fsp.mkdir(APP_AI_DIR, { recursive: true });
    const got = await run('/usr/bin/curl', [
      '-fL',
      '-sS',
      '--retry', '3',
      '--connect-timeout', '15',
      '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      '-o', tarFile,
      url
    ], { timeout: 120000, logErr: true });
    if (!got.ok) throw new Error(`curl: ${got.err.trim() || 'falhou'}`);
    stopIfCancelled();
    const unpacked = await run('/usr/bin/tar', ['-xzf', tarFile, '-C', APP_AI_DIR], { logErr: true });
    if (!unpacked.ok) throw new Error(`tar: ${unpacked.err.trim() || 'falhou'}`);
  } catch (err) {
    if (cancelRequested) throw cancelledError();
    console.error('Erro ao baixar/extrair Python portátil via curl:', err);
  } finally {
    await fsp.unlink(tarFile).catch(() => {});
  }
  stopIfCancelled();

  if (fs.existsSync(APP_AI_PYTHON)) {
    notify(12, 'Instalando motor neural de áudio de estúdio...');
    // Só força Rosetta quando o Mac é Intel de verdade: num Mac Apple Silicon com o
    // programa de Intel instalado, `process.arch` diz "x64" mas o Python baixado é arm64,
    // e o `arch -x86_64` fazia o pip falhar por incompatibilidade.
    const rosetta = machineArch() === 'x64' && process.platform === 'darwin';
    const pipArgs = ['-m', 'pip', 'install', '--no-cache-dir', '--quiet', 'demucs==4.0.1', 'torch', 'torchaudio'];
    const pip = await run(rosetta ? '/usr/bin/arch' : APP_AI_PYTHON, rosetta ? ['-x86_64', APP_AI_PYTHON, ...pipArgs] : pipArgs, {
      timeout: 420000,
      logErr: true,
      env: {
        ...process.env,
        PATH: `${path.dirname(APP_AI_PYTHON)}:/usr/bin:/bin:/usr/sbin:/sbin`
      }
    });
    if (pip.ok) {
      cachedRunner = { type: 'python', path: APP_AI_PYTHON };
      return cachedRunner;
    }
    stopIfCancelled();
    console.error('Erro no pip install do Demucs:', pip.err.trim() || 'sem mensagem');
  }

  // Tenta auto-instalação em qualquer Python existente na máquina
  const python = await findAnyWorkingPython();
  stopIfCancelled();
  if (python) {
    notify(15, 'Ativando motor de IA no sistema...');
    if ((await run(python, ['-m', 'pip', 'install', '--quiet', 'demucs==4.0.1'], { timeout: 180000 })).ok) {
      cachedRunner = null;
      runner = await findDemucsRunner();
      if (runner) return runner;
    }
    stopIfCancelled();
  }

  throw new Error('Não foi possível iniciar o motor de Inteligência Artificial. Verifique sua conexão com a internet para a ativação inicial.');
}

function hasLocalDemucs() {
  return true; // Sempre suportado localmente (se não estiver pré-instalado, o ensureAiEngine configura no primeiro uso)
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (IS_WIN) {
    // mata o Python e os processos filhos dele
    try { spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }); } catch { try { proc.kill(); } catch {} }
    return;
  }
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
}
function cancelStemSeparation() {
  cancelRequested = true;
  for (const proc of running) killTree(proc);
  return true;
}

/**
 * O ArrayBuffer do Buffer sem copiar quando o Buffer ocupa o ArrayBuffer inteiro (o caso do
 * fs.promises.readFile de um arquivo grande). Senão, copia só o trecho do Buffer, como antes.
 * A tela recebe ArrayBuffer do mesmo jeito.
 */
function wholeArrayBuffer(buf) {
  if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf.buffer;
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Lê as faixas prontas sem travar o processo principal (antes: leitura síncrona, uma de cada vez). */
async function readStems(stemsDir) {
  const file = (name) => path.join(stemsDir, `${name}.wav`);
  if (!fs.existsSync(file('vocals')) || !fs.existsSync(file('drums'))) {
    throw new Error('As faixas separadas não foram encontradas na pasta de saída.');
  }
  // guitarra e piano podem faltar; as outras quatro, não
  const optional = (name) => fsp.readFile(file(name)).catch((err) => {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  });
  const [vocals, bass, drums, other, guitar, piano] = await Promise.all([
    fsp.readFile(file('vocals')),
    fsp.readFile(file('bass')),
    fsp.readFile(file('drums')),
    fsp.readFile(file('other')),
    optional('guitar'),
    optional('piano'),
  ]);
  return {
    vocals: wholeArrayBuffer(vocals),
    bass: wholeArrayBuffer(bass),
    drums: wholeArrayBuffer(drums),
    other: wholeArrayBuffer(other),
    guitar: guitar ? wholeArrayBuffer(guitar) : null,
    piano: piano ? wholeArrayBuffer(piano) : null,
  };
}

/**
 * Motor Local de Separação de Stems via Demucs v4 (Meta AI).
 * Roda 100% nativo no Mac (Universal: Intel e Apple Silicon).
 */
/**
 * Faixas prontas deixadas no disco (modo `files`): só os caminhos, sem ler. Guitarra e piano
 * podem faltar; as outras quatro, não (a mesma regra de readStems).
 */
function stemFilesIn(stemsDir) {
  const file = (name) => path.join(stemsDir, `${name}.wav`);
  if (!fs.existsSync(file('vocals')) || !fs.existsSync(file('drums'))) {
    throw new Error('As faixas separadas não foram encontradas na pasta de saída.');
  }
  const files = {};
  for (const name of ['vocals', 'bass', 'drums', 'other', 'guitar', 'piano']) {
    if (fs.existsSync(file(name))) files[name] = file(name);
  }
  if (!files.bass || !files.other) throw new Error('As faixas separadas não foram encontradas na pasta de saída.');
  return files;
}

/** A entrada é `{ path }` (arquivo no disco, mandado pelo principal) ou os bytes de sempre. */
function inputFilePath(audioData) {
  return audioData && typeof audioData === 'object' && !ArrayBuffer.isView(audioData) && typeof audioData.path === 'string'
    ? audioData.path
    : null;
}

/**
 * @param audioData  bytes da música, ou `{ path }` com o arquivo no disco (acceptsInputPath)
 * @param opts       `{ files: true }`: devolve `{ files: { vocals: caminho, ... }, dir }` sem ler as
 *                   faixas; a pasta fica para o principal servir e apagar depois. Sem isso, os bytes.
 */
async function separateStemsLocal(win, filename, audioData, onProgress, opts) {
  cancelRequested = false;
  let runner = await findDemucsRunner();

  if (!runner) {
    try {
      runner = await ensureAiEngine(win);
    } catch (err) {
      if (cancelRequested) throw cancelledError();
      throw err;
    }
  }
  if (cancelRequested) throw cancelledError();

  const tmpId = `vs_demucs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const workDir = path.join(os.tmpdir(), tmpId);

  const inputExt = path.extname(filename || 'song.wav') || '.wav';
  const inputPath = path.join(workDir, `input${inputExt}`);
  const outDir = path.join(workDir, 'out');
  // No Windows um arquivo ainda aberto não sai: só apaga depois de o Demucs fechar e de ler tudo.
  const cleanup = () => fsp.rm(workDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});

  try {
    await fsp.mkdir(outDir, { recursive: true });
    const source = inputFilePath(audioData);
    if (source) {
      // Arquivo no disco: cópia com o mesmo nome de sempre (input.ext), para a pasta de saída do
      // Demucs continuar sendo out/htdemucs_6s/input. No APFS a cópia é um clone instantâneo.
      await fsp.copyFile(source, inputPath, fs.constants.COPYFILE_FICLONE);
    } else {
      // Salva o arquivo de áudio temporário (Buffer e Uint8Array vão direto, sem outra cópia)
      await fsp.writeFile(inputPath, ArrayBuffer.isView(audioData) ? audioData : Buffer.from(audioData));
    }
  } catch (err) {
    await cleanup();
    throw err;
  }

  // Constrói PATH completo para que ffmpeg, python e pacotes sejam encontrados em apps GUI no Mac
  const extendedPath = [
    '/Library/Frameworks/Python.framework/Versions/Current/bin',
    '/Library/Frameworks/Python.framework/Versions/3.14/bin',
    '/Library/Frameworks/Python.framework/Versions/3.13/bin',
    '/Library/Frameworks/Python.framework/Versions/3.12/bin',
    '/Library/Frameworks/Python.framework/Versions/3.11/bin',
    '/Library/Frameworks/Python.framework/Versions/3.10/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), 'Library/Python/3.14/bin'),
    path.join(os.homedir(), 'Library/Python/3.13/bin'),
    path.join(os.homedir(), 'Library/Python/3.12/bin'),
    path.join(os.homedir(), 'Library/Python/3.11/bin'),
    path.join(os.homedir(), '.local/bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    process.env.PATH || ''
  ].join(':');
  const runPath = IS_WIN
    ? [path.dirname(runner.path), path.join(path.dirname(runner.path), 'Scripts'), process.env.PATH || ''].join(path.delimiter)
    : `${path.dirname(runner.path)}:${extendedPath}`;

  return new Promise((resolve, reject) => {
    const spawnCmd = runner.type === 'bin' ? runner.path : runner.path;
    const spawnArgs = runner.type === 'bin'
      ? ['-n', 'htdemucs_6s', '-o', outDir, inputPath]
      : ['-m', 'demucs.separate', '-n', 'htdemucs_6s', '-o', outDir, inputPath];

    const proc = spawn(spawnCmd, spawnArgs, {
      // detached no Mac: cancelar mata o grupo inteiro. No Windows abriria uma janela de console.
      detached: !IS_WIN,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: runPath,
        ...(runner.torchHome ? { TORCH_HOME: runner.torchHome } : {})
      }
    });
    lowerPriority(proc);
    running.add(proc);
    if (cancelRequested) killTree(proc);

    let lastProgress = 0;
    const stderrLogs = [];

    const parseProgress = (chunk) => {
      const text = chunk.toString();
      stderrLogs.push(text);
      if (stderrLogs.length > 50) stderrLogs.shift();

      // Procura porcentagem do tqdm: " 45%|████"
      const match = text.match(/(\d+)%/);
      if (match) {
        const pct = parseInt(match[1], 10);
        if (pct !== lastProgress) {
          lastProgress = pct;
          if (win && !win.isDestroyed()) {
            win.webContents.send('separation:progress', {
              percent: pct,
              message: `Separando faixas com a Inteligência Artificial do VS Stage (${pct}%)...`
            });
          }
          if (onProgress) onProgress(pct);
        }
      }
    };

    proc.stdout.on('data', parseProgress);
    proc.stderr.on('data', parseProgress);

    proc.on('error', (err) => {
      running.delete(proc);
      void cleanup();
      reject(new Error(cancelRequested ? 'separation_cancelled' : `Falha ao iniciar o motor de IA (${spawnCmd}): ${err.message}`));
    });

    proc.on('close', (code) => {
      running.delete(proc);
      void finish(code);
    });

    async function finish(code) {
      if (cancelRequested) {
        await cleanup();
        reject(cancelledError());
        return;
      }
      if (code !== 0) {
        const lastErr = stderrLogs.slice(-10).join('\n').trim();
        await cleanup();
        reject(new Error(`A Inteligência Artificial finalizou com erro (código ${code}): ${lastErr || 'Verifique o formato do áudio.'}`));
        return;
      }

      if (opts && opts.files) {
        try {
          const files = stemFilesIn(path.join(outDir, 'htdemucs_6s', 'input'));
          if (cancelRequested) { await cleanup(); reject(cancelledError()); return; }
          // a pasta fica: o principal serve as faixas e apaga quando a tela terminar de ler
          resolve({ files, dir: workDir });
        } catch (err) {
          await cleanup();
          reject(err);
        }
        return;
      }
      try {
        const stems = await readStems(path.join(outDir, 'htdemucs_6s', 'input'));
        await cleanup();
        // cancelou enquanto lia: o mesmo resultado de cancelar um instante antes
        if (cancelRequested) { reject(cancelledError()); return; }
        resolve(stems);
      } catch (err) {
        await cleanup();
        reject(err);
      }
    }
  });
}

module.exports = {
  separateStemsLocal,
  // o principal pode mandar `{ path }` no lugar dos bytes (main.js, separationInput)
  acceptsInputPath: true,
  cancelStemSeparation,
  hasLocalDemucs,
  // para os testes
  _run: run,
  _wholeArrayBuffer: wholeArrayBuffer,
  _findDemucsRunner: findDemucsRunner,
};
