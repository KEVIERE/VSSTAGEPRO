const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Candidatos a executável direto do Demucs (Intel e Apple Silicon)
const DEMUCS_BIN_CANDIDATES = [
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

let cachedRunner = null;

function findDemucsRunner() {
  if (cachedRunner) return cachedRunner;

  // 1. Testa se o comando "demucs" está acessível no PATH do sistema
  try {
    const whichDemucs = execSync('which demucs', { encoding: 'utf8', timeout: 1000 }).trim();
    if (whichDemucs && fs.existsSync(whichDemucs)) {
      cachedRunner = { type: 'bin', path: whichDemucs };
      return cachedRunner;
    }
  } catch {}

  // 2. Testa os caminhos conhecidos do executável demucs (Intel + Apple Silicon)
  for (const b of DEMUCS_BIN_CANDIDATES) {
    if (fs.existsSync(b)) {
      try {
        execSync(`"${b}" --help`, { stdio: 'ignore', timeout: 2000 });
        cachedRunner = { type: 'bin', path: b };
        return cachedRunner;
      } catch {}
    }
  }

  // 3. Testa os interpretadores Python com "import demucs" (Intel + Apple Silicon)
  for (const p of PYTHON_CANDIDATES) {
    if (fs.existsSync(p)) {
      try {
        execSync(`"${p}" -c "import demucs"`, { stdio: 'ignore', timeout: 2000 });
        cachedRunner = { type: 'python', path: p };
        return cachedRunner;
      } catch {}
    }
  }

  // 4. Testa se o comando python3 do terminal tem demucs (evitando o stub do Xcode /usr/bin/python3)
  try {
    const whichPy = execSync('which python3', { encoding: 'utf8', timeout: 1000 }).trim();
    if (whichPy && whichPy !== '/usr/bin/python3' && fs.existsSync(whichPy)) {
      execSync(`"${whichPy}" -c "import demucs"`, { stdio: 'ignore', timeout: 2000 });
      cachedRunner = { type: 'python', path: whichPy };
      return cachedRunner;
    }
  } catch {}

  return null;
}

function findAnyWorkingPython() {
  for (const p of PYTHON_CANDIDATES) {
    if (fs.existsSync(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: 'ignore', timeout: 1500 });
        return p;
      } catch {}
    }
  }
  try {
    const whichPy = execSync('which python3', { encoding: 'utf8', timeout: 1000 }).trim();
    if (whichPy && whichPy !== '/usr/bin/python3' && fs.existsSync(whichPy)) {
      return whichPy;
    }
  } catch {}
  return null;
}

function hasLocalDemucs() {
  return Boolean(findDemucsRunner());
}

/**
 * Motor Local de Separação de Stems via Demucs v4 (Meta AI).
 * Roda 100% nativo no Mac (Universal: Intel e Apple Silicon).
 */
async function separateStemsLocal(win, filename, audioData, onProgress) {
  let runner = findDemucsRunner();

  // Se o Demucs não está instalado, mas há um Python no Mac, instala o Demucs automaticamente
  if (!runner) {
    const python = findAnyWorkingPython();
    if (python) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('separation:progress', {
          percent: 5,
          message: 'Ativando a Inteligência Artificial interna no seu Mac pela primeira vez...'
        });
      }
      try {
        execSync(`"${python}" -m pip install --quiet demucs`, { stdio: 'ignore', timeout: 180000 });
        cachedRunner = null;
        runner = findDemucsRunner();
      } catch (installErr) {
        console.warn('Tentativa de auto-instalação do Demucs falhou:', installErr);
      }
    }
  }

  if (!runner) {
    throw new Error('demucs_not_available');
  }

  const tmpId = `vs_demucs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const workDir = path.join(os.tmpdir(), tmpId);
  fs.mkdirSync(workDir, { recursive: true });

  const inputExt = path.extname(filename || 'song.wav') || '.wav';
  const inputPath = path.join(workDir, `input${inputExt}`);
  const outDir = path.join(workDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  // Salva o arquivo de áudio temporário
  fs.writeFileSync(inputPath, Buffer.from(audioData));

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

  return new Promise((resolve, reject) => {
    const spawnCmd = runner.type === 'bin' ? runner.path : runner.path;
    const spawnArgs = runner.type === 'bin'
      ? ['-n', 'htdemucs_6s', '-o', outDir, inputPath]
      : ['-m', 'demucs.separate', '-n', 'htdemucs_6s', '-o', outDir, inputPath];

    const proc = spawn(spawnCmd, spawnArgs, {
      env: {
        ...process.env,
        PATH: extendedPath
      }
    });

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
      cleanup();
      reject(new Error(`Falha ao iniciar o motor de IA (${spawnCmd}): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const lastErr = stderrLogs.slice(-10).join('\n').trim();
        cleanup();
        reject(new Error(`A Inteligência Artificial finalizou com erro (código ${code}): ${lastErr || 'Verifique o formato do áudio.'}`));
        return;
      }

      try {
        const stemsDir = path.join(outDir, 'htdemucs_6s', 'input');
        const vocalsPath = path.join(stemsDir, 'vocals.wav');
        const bassPath = path.join(stemsDir, 'bass.wav');
        const drumsPath = path.join(stemsDir, 'drums.wav');
        const otherPath = path.join(stemsDir, 'other.wav');

        if (!fs.existsSync(vocalsPath) || !fs.existsSync(drumsPath)) {
          throw new Error('As faixas separadas não foram encontradas na pasta de saída.');
        }

        const guitarPath = path.join(stemsDir, 'guitar.wav');
        const pianoPath = path.join(stemsDir, 'piano.wav');

        const vocals = fs.readFileSync(vocalsPath);
        const bass = fs.readFileSync(bassPath);
        const drums = fs.readFileSync(drumsPath);
        const other = fs.readFileSync(otherPath);
        const guitar = fs.existsSync(guitarPath) ? fs.readFileSync(guitarPath) : null;
        const piano = fs.existsSync(pianoPath) ? fs.readFileSync(pianoPath) : null;

        cleanup();

        resolve({
          vocals: vocals.buffer.slice(vocals.byteOffset, vocals.byteOffset + vocals.byteLength),
          bass: bass.buffer.slice(bass.byteOffset, bass.byteOffset + bass.byteLength),
          drums: drums.buffer.slice(drums.byteOffset, drums.byteOffset + drums.byteLength),
          other: other.buffer.slice(other.byteOffset, other.byteOffset + other.byteLength),
          guitar: guitar ? guitar.buffer.slice(guitar.byteOffset, guitar.byteOffset + guitar.byteLength) : null,
          piano: piano ? piano.buffer.slice(piano.byteOffset, piano.byteOffset + piano.byteLength) : null,
        });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function cleanup() {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {}
    }
  });
}

module.exports = {
  separateStemsLocal,
  hasLocalDemucs,
};
