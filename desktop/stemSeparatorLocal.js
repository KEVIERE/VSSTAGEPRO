const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PYTHON_CANDIDATES = [
  '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
  '/opt/homebrew/bin/python3',
  '/usr/local/bin/python3',
  'python3'
];

let cachedPythonPath = null;

function findPythonWithDemucs() {
  if (cachedPythonPath) return cachedPythonPath;
  for (const p of PYTHON_CANDIDATES) {
    try {
      if (p.startsWith('/') && !fs.existsSync(p)) continue;
      execSync(`"${p}" -c "import demucs"`, { stdio: 'ignore' });
      cachedPythonPath = p;
      return p;
    } catch {}
  }
  return 'python3';
}

/**
 * Motor Local de Separação de Stems via Demucs v4 (Meta AI).
 * Roda 100% nativo no Mac com aceleração Apple Silicon / Metal.
 */
async function separateStemsLocal(win, filename, audioData, onProgress) {
  const pythonPath = findPythonWithDemucs();

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
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    process.env.PATH || ''
  ].join(':');

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, [
      '-m', 'demucs.separate',
      '-n', 'htdemucs_6s',
      '-o', outDir,
      inputPath
    ], {
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
      reject(new Error(`Falha ao iniciar Python (${pythonPath}): ${err.message}`));
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

module.exports = { separateStemsLocal };
