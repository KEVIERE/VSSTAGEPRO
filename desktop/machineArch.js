const os = require('os');
const { execFileSync } = require('child_process');

let cached = null;

/**
 * Processador de verdade do Mac, não o do processo.
 *
 * `process.arch` não serve sozinho: quando o VS Stage de Intel abre num Mac com chip
 * Apple, o macOS o roda traduzido (Rosetta) e ele continua dizendo "x64" para sempre.
 * Era isso que prendia o app no instalador errado: ele se atualizava sempre para o
 * Intel de novo, mesmo no Silicon, e ficava lento (toda a interface e o motor de áudio
 * traduzidos) e sem a voz do Maestro IA (que só existe no arm64).
 */
function machineArch() {
  if (cached) return cached;
  if (process.platform !== 'darwin') {
    cached = process.arch === 'arm64' ? 'arm64' : 'x64';
    return cached;
  }
  if (process.arch === 'arm64') {
    cached = 'arm64';
    return cached;
  }
  // Processo x64: pode ser um Mac Intel de verdade ou um app Intel traduzido no chip Apple.
  cached = isTranslated() ? 'arm64' : 'x64';
  return cached;
}

/** O processo está rodando traduzido pelo Rosetta num Mac com chip Apple? */
function isTranslated() {
  // Processo arm64 nunca está traduzido.
  if (process.arch === 'arm64') return false;
  // 1. Reforço do próprio macOS: 1 = traduzido, 0 = nativo, ausente = Mac Intel.
  try {
    const out = execFileSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out === '1') return true;
    if (out === '0') return false;
  } catch {
    /* sysctl indisponível: cai no nome da CPU */
  }
  // 2. O nome da CPU entrega na hora: chip Apple só existe em Mac Apple Silicon.
  //    (Confirmado: sob Rosetta o Node reporta "Apple M2", não um Xeon.)
  return /apple\s+m\d/i.test(os.cpus()?.[0]?.model || '');
}

/** Só para leitura: útil em aviso e diagnóstico. */
function isAppleSilicon() {
  return machineArch() === 'arm64';
}

module.exports = { machineArch, isAppleSilicon, isTranslated };
