const { app } = require('electron');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const os = require('os');
const { machineArch } = require('./machineArch');

const execFileAsync = promisify(execFile);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`http_${res.statusCode}`)); res.resume(); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/** Baixa uma URL e grava no fluxo já aberto (append), sem carregar nada na memória. */
function downloadAppendTo(url, writeStream, onBytes) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`http_${res.statusCode}`)); res.resume(); return; }
      res.on('data', (chunk) => onBytes(chunk.length));
      res.on('error', reject);
      res.pipe(writeStream, { end: false });
      res.on('end', resolve);
    }).on('error', reject);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Instalador certo para este Mac: o do processador de verdade.
 * Antes usava `process.arch`, então um Mac Silicon com o programa de Intel instalado
 * (rodando traduzido) se atualizava sempre para o Intel de novo e nunca saía do lento.
 */
function archForThisMac() {
  return machineArch();
}

/** Este programa é o de Intel rodando traduzido num Mac com chip Apple? */
function isTranslatedProcess() {
  return machineArch() === 'arm64' && process.arch !== 'arm64';
}

/** Compara "1.2.10" vs "1.2.9": 1 se a for maior, -1 se for menor, 0 se igual. */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * Número do build empacotado neste app (gravado pelo CI em build-info.json antes de
 * gerar o .dmg). Em dev, ou se o arquivo não existir por algum motivo, assume 0 —
 * assim qualquer publicação já conta como mais nova.
 */
function currentBuild() {
  try {
    const p = app.isPackaged
      ? path.join(process.resourcesPath, 'build-info.json')
      : path.join(__dirname, 'build-info.json');
    return Number(JSON.parse(fs.readFileSync(p, 'utf8')).build) || 0;
  } catch {
    return 0;
  }
}

/**
 * Confere se a versão publicada é diferente da instalada — tanto para cima (atualização
 * normal) quanto para baixo (o admin reverteu uma versão no backoffice, e todo app com
 * versão mais nova também precisa voltar). `direction` diz qual dos dois casos é.
 * Não lança: qualquer falha (sem internet, etc.) retorna null.
 */
const UPDATES_BASE = 'https://download.vsstagepro.com.br/';

/** Pasta da atualização em andamento agora (a limpeza não pode apagá-la). */
let currentWork = '';

async function checkForUpdate(_supabaseUrl) {
  try {
    const base = UPDATES_BASE;
    const manifest = await fetchJson(`${base}mac/manifest.json?t=${Date.now()}`);
    if (typeof manifest?.version !== 'string' || !Array.isArray(manifest.builds)) return null;
    const cmp = compareVersions(manifest.version, app.getVersion());
    // Mesmo número de versão: só é "mudança" se o build publicado for diferente do
    // instalado (ex.: republicou o mesmo 1.1.17 com outro build, ou só trocou a
    // obrigatoriedade). Sem isso o app ignorava republicações da própria versão.
    //
    // Exceção: este processo é o programa de Intel rodando traduzido num Mac com chip
    // Apple. Aí a versão é a mesma mas o programa está errado, então troca mesmo assim
    // pelo do chip (é o que tira a lentidão). Sem isso o app nunca sairia do Intel.
    const wrongChip = isTranslatedProcess();
    if (cmp === 0 && Number(manifest.build) === currentBuild() && !wrongChip) return null;
    const build = manifest.builds.find((b) => b.arch === archForThisMac());
    if (!build) return null;
    // Programa do processador errado instalado: é sempre "atualizar", nunca "voltar",
    // mesmo com a versão publicada igual ou mais baixa que a instalada.
    const direction = wrongChip
      ? 'upgrade'
      : cmp !== 0 ? (cmp > 0 ? 'upgrade' : 'downgrade') : (Number(manifest.build) > currentBuild() ? 'upgrade' : 'downgrade');
    return { version: manifest.version, build, base, direction, required: manifest.required === true, archSwap: wrongChip };
  } catch {
    return null;
  }
}

/**
 * Baixa o .dmg da versão nova, monta, copia o .app por cima do atual, assina ad-hoc
 * e devolve o caminho do app atualizado, pronto para relançar. Reporta progresso (0 a 1).
 * Em qualquer falha, desfaz o que já tiver feito e relança um erro — o app atual continua intacto.
 */
async function downloadAndInstall({ build, base }, onProgress) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-update-'));
  currentWork = work;
  const dmgPath = path.join(work, build.file);
  try {
    const out = fs.createWriteStream(dmgPath);
    let received = 0;
    try {
      for (const part of build.parts) {
        await downloadAppendTo(base + part, out, (n) => {
          received += n;
          onProgress(Math.min(0.85, (received / build.size) * 0.85));
        });
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
    if (received !== build.size) throw new Error('size_mismatch');

    const hash = await sha256File(dmgPath);
    if (hash !== build.sha256) throw new Error('hash_mismatch');
    onProgress(0.88);

    const mountPoint = path.join(work, 'mnt');
    fs.mkdirSync(mountPoint, { recursive: true });
    await execFileAsync('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
    onProgress(0.9);

    try {
      const entries = fs.readdirSync(mountPoint);
      const appName = entries.find((e) => e.endsWith('.app'));
      if (!appName) throw new Error('app_not_found_in_dmg');
      const srcApp = path.join(mountPoint, appName);

      const currentAppPath = app.getAppPath().replace(/\/Contents\/Resources\/app\.asar$/, '');
      if (!currentAppPath.endsWith('.app')) throw new Error('not_a_bundle');

      const destParent = path.dirname(currentAppPath);
      const stagedApp = path.join(destParent, `.${appName}.updating`);
      await execFileAsync('rm', ['-rf', stagedApp]);
      await execFileAsync('cp', ['-R', srcApp, stagedApp]);
      onProgress(0.95);

      await execFileAsync('codesign', ['--force', '--deep', '--sign', '-', stagedApp]);
      onProgress(0.97);

      const backupApp = `${currentAppPath}.old`;
      await execFileAsync('rm', ['-rf', backupApp]);
      await execFileAsync('mv', [currentAppPath, backupApp]);
      try {
        await execFileAsync('mv', [stagedApp, currentAppPath]);
      } catch (e) {
        // Não deu: desfaz para o Mac continuar com a versão antiga intacta.
        await execFileAsync('mv', [backupApp, currentAppPath]).catch(() => {});
        throw e;
      }
      await execFileAsync('rm', ['-rf', backupApp]).catch(() => { /* não crítico */ });
      onProgress(1);

      return currentAppPath;
    } finally {
      await execFileAsync('hdiutil', ['detach', mountPoint, '-quiet']).catch(() => { /* já pode ter sido ejetado */ });
    }
  } finally {
    fs.rm(work, { recursive: true, force: true }, () => {});
  }
}

/** Abre a cópia já atualizada e encerra o processo atual. */
function relaunchFromPath(appPath) {
  execFile('open', ['-n', appPath], () => {});
  app.exit(0);
}

/**
 * Apaga as pastas `vs-update-*` que sobraram de tentativas anteriores.
 *
 * `downloadAndInstall` já limpa a sua pasta no `finally`, mas quando o processo morre no meio
 * (app fechado, Mac reiniciado, `.dmg` travado) o `.dmg` de ~400 MB fica para trás em `/tmp`.
 * Em 05/11/2026 havia seis pastas assim, somando 2,4 GB. Roda uma vez, ao abrir o programa.
 */
function cleanLeftovers() {
  let removed = 0;
  try {
    const dir = os.tmpdir();
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('vs-update-')) continue;
      // Pasta de uma atualização em andamento agora não pode ser apagada.
      if (name === path.basename(currentWork)) continue;
      try {
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
        removed += 1;
      } catch { /* em uso por outro processo: fica para a próxima */ }
    }
  } catch { /* sem acesso ao /tmp */ }
  if (removed > 0) console.log(`Limpeza: ${removed} pasta(s) de atualização antiga removida(s).`);
  return removed;
}

module.exports = { checkForUpdate, downloadAndInstall, relaunchFromPath, cleanLeftovers };
