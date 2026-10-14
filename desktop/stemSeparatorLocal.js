const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Motor Local de Separação de Stems via Demucs v4 (Meta AI).
 * Roda 100% nativo no Mac com aceleração Apple Silicon / Metal.
 */
async function separateStemsLocal(win, filename, audioData, onProgress) {
  const tmpId = `vs_demucs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const workDir = path.join(os.tmpdir(), tmpId);
  fs.mkdirSync(workDir, { recursive: true });

  const inputExt = path.extname(filename || 'song.wav') || '.wav';
  const inputPath = path.join(workDir, `input${inputExt}`);
  const outDir = path.join(workDir, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  // Salva o arquivo de áudio temporário
  fs.writeFileSync(inputPath, Buffer.from(audioData));

  return new Promise((resolve, reject) => {
    // python3 -m demucs.separate -n htdemucs -o <outDir> <inputPath>
    const proc = spawn('python3', [
      '-m', 'demucs.separate',
      '-n', 'htdemucs',
      '-o', outDir,
      inputPath
    ]);

    let lastProgress = 0;

    const parseProgress = (chunk) => {
      const text = chunk.toString();
      // Demucs emite progresso tipo " 45%|████...| 2.5/5.8 [00:01<00:01, 1.8s/s]"
      const match = text.match(/(\d+)%/);
      if (match) {
        const pct = parseInt(match[1], 10);
        if (pct !== lastProgress) {
          lastProgress = pct;
          if (win && !win.isDestroyed()) {
            win.webContents.send('separation:progress', {
              percent: pct,
              message: `Separando com Demucs v4 no Mac (${pct}%)...`
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
      reject(new Error(`Falha ao iniciar o Demucs: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        cleanup();
        reject(new Error(`O Demucs finalizou com erro (código ${code}).`));
        return;
      }

      try {
        const stemsDir = path.join(outDir, 'htdemucs', path.basename(inputPath, inputExt));
        const vocalsPath = path.join(stemsDir, 'vocals.wav');
        const bassPath = path.join(stemsDir, 'bass.wav');
        const drumsPath = path.join(stemsDir, 'drums.wav');
        const otherPath = path.join(stemsDir, 'other.wav');

        if (!fs.existsSync(vocalsPath) || !fs.existsSync(drumsPath)) {
          throw new Error('As faixas separadas não foram encontradas na pasta de saída.');
        }

        const vocals = fs.readFileSync(vocalsPath);
        const bass = fs.readFileSync(bassPath);
        const drums = fs.readFileSync(drumsPath);
        const other = fs.readFileSync(otherPath);

        cleanup();

        resolve({
          vocals: vocals.buffer.slice(vocals.byteOffset, vocals.byteOffset + vocals.byteLength),
          bass: bass.buffer.slice(bass.byteOffset, bass.byteOffset + bass.byteLength),
          drums: drums.buffer.slice(drums.byteOffset, drums.byteOffset + drums.byteLength),
          other: other.buffer.slice(other.byteOffset, other.byteOffset + other.byteLength),
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
