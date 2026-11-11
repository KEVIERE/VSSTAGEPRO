const { app, ipcMain } = require('electron');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const SUPABASE_HEARTBEAT_URL = 'https://eknjqqiamuztomdygalv.supabase.co/functions/v1/app-heartbeat';
const ANON_KEY = 'sb_publishable_9yDFOv1hd7w8MITGsE1ZgQ_mY5eJJI2';

let cachedHwId = null;
let sessionActive = false;
const startTime = Date.now();

/**
 * Lê o UUID imutável da placa-mãe do Mac (IOPlatformUUID).
 * Esse identificador é gerado pela Apple na fabricação da máquina
 * e não muda mesmo reinstalando o sistema operacional ou apagando dados.
 */
function getHardwareId() {
  if (cachedHwId) return cachedHwId;
  try {
    if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { timeout: 2000, encoding: 'utf8' });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (m && m[1]) {
        cachedHwId = crypto.createHash('sha256').update(m[1].trim()).digest('hex');
        return cachedHwId;
      }
    }
  } catch {
    /* fallback abaixo */
  }

  // Fallback baseado em características fixas do hardware da máquina
  const seed = `${os.hostname()}:${os.arch()}:${os.cpus()[0]?.model}:${os.homedir()}`;
  cachedHwId = crypto.createHash('sha256').update(seed).digest('hex');
  return cachedHwId;
}

/**
 * Confere o que não depende do conteúdo do pacote: pasta app/ descompactada (técnica de crack)
 * e app.asar ausente. Responde na hora, sem ler o arquivo.
 * Devolve `asarPath` quando há um pacote para conferir.
 */
function checkStructure() {
  if (!app.isPackaged) return { done: { tampered: false, asarSha: null, reason: null } };
  try {
    const resources = process.resourcesPath;
    const asarPath = path.join(resources, 'app.asar');
    const unpackedDir = path.join(resources, 'app');

    // Sinal 1: Cracker descompactou o ASAR em uma pasta 'app/' para rodar código alterado
    if (fs.existsSync(unpackedDir) && fs.statSync(unpackedDir).isDirectory()) {
      return {
        done: {
          tampered: true,
          asarSha: null,
          reason: 'Estrutura alterada: pasta app/ descompactada detectada no diretório Resources (técnica clássica de crack)',
        },
      };
    }

    // Sinal 2: O arquivo app.asar não existe
    if (!fs.existsSync(asarPath)) {
      return {
        done: {
          tampered: true,
          asarSha: null,
          reason: 'Pacote app.asar ausente no diretório de recursos da aplicação',
        },
      };
    }

    return { asarPath, resources };
  } catch {
    return { done: { tampered: false, asarSha: null, reason: null } };
  }
}

/** Compara o hash calculado com o registrado no build-info.json, se houver. */
function compareWithBuildInfo(resources, asarSha) {
  const buildInfoPath = path.join(resources, 'build-info.json');
  if (fs.existsSync(buildInfoPath)) {
    try {
      const info = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
      if (info.expectedAsarSha && info.expectedAsarSha !== asarSha) {
        return {
          tampered: true,
          asarSha,
          reason: `Assinatura de integridade incompatível (esperado: ${info.expectedAsarSha.slice(0, 12)}..., atual: ${asarSha.slice(0, 12)}...)`,
        };
      }
    } catch {
      /* ignore parse error */
    }
  }
  return { tampered: false, asarSha, reason: null };
}

/**
 * Calcula o hash SHA-256 do pacote executável app.asar.
 * Também detecta se o cracker descompactou o ASAR em uma pasta 'app/' para editar o código.
 * Versão síncrona: usada como reserva quando não há como rodar em processo separado.
 */
function inspectAppIntegrity() {
  const s = checkStructure();
  if (s.done) return s.done;
  try {
    return compareWithBuildInfo(s.resources, computeAsarShaSync(s.asarPath));
  } catch {
    return { tampered: false, asarSha: null, reason: null };
  }
}

/**
 * Hash SHA-256 do app.asar, calculado fora do processo principal.
 *
 * Ler e calcular esse hash aqui travava o processo principal por ~200 ms a cada batida do
 * heartbeat, e é ele quem desenha a janela: o programa abria com a tela presa. Em processo
 * separado, o resultado é o mesmo e a janela nasce livre. Sem processo disponível, cai no
 * cálculo de antes.
 */
const integrityWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const crypto = require('node:crypto');
const fs = require('node:fs');
try {
  const buf = fs.readFileSync(workerData.asarPath);
  parentPort.postMessage({ asarSha: crypto.createHash('sha256').update(buf).digest('hex') });
} catch (e) {
  parentPort.postMessage({ error: String(e && e.message) });
}
`;

function hashAsar(asarPath) {
  return new Promise((resolve, reject) => {
    let Worker;
    try {
      ({ Worker } = require('node:worker_threads'));
    } catch {
      resolve(computeAsarShaSync(asarPath));
      return;
    }
    const w = new Worker(integrityWorkerSource, { eval: true, workerData: { asarPath } });
    let settled = false;
    w.once('message', (msg) => {
      settled = true;
      w.terminate().catch(() => {});
      if (msg && msg.asarSha) resolve(msg.asarSha);
      else reject(new Error((msg && msg.error) || 'hash falhou'));
    });
    w.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    w.once('exit', () => {
      if (settled) return;
      settled = true;
      reject(new Error('hash encerrou sem resposta'));
    });
  });
}

function computeAsarShaSync(asarPath) {
  const buf = fs.readFileSync(asarPath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Envia o sinal de integridade/heartbeat silencioso para o Supabase.
 */
/** Integridade sem travar o processo principal: o hash sai num processo separado. */
async function readIntegrityAsync() {
  const s = checkStructure();
  if (s.done) return s.done;
  try {
    return compareWithBuildInfo(s.resources, await hashAsar(s.asarPath));
  } catch {
    // sem processo separado disponível: faz aqui mesmo, como antes
    return inspectAppIntegrity();
  }
}

async function sendHeartbeat(isFirst = false) {
  const hw = getHardwareId();
  const integrity = await readIntegrityAsync();
  const runningMinutes = Math.floor((Date.now() - startTime) / 60000);

  // Se o programa está rodando há mais de 10 minutos sem login ativo, marca bypass
  let tampered = integrity.tampered;
  let tamperReason = integrity.reason;

  if (!sessionActive && !isFirst && runningMinutes >= 10 && !tampered) {
    tampered = true;
    tamperReason = `Uso contínuo do programa (${runningMinutes} minutos) sem login autenticado (possível remoção da tela de entrada)`;
  }

  const payload = JSON.stringify({
    hw,
    appVersion: app.getVersion(),
    // arm64 = Apple Silicon, x64 = Intel (painel "Acessos" do admin)
    arch: process.arch,
    asarSha: integrity.asarSha,
    hasSession: sessionActive,
    tampered,
    tamperReason,
    runningMinutes,
    firstLaunch: isFirst,
  });

  try {
    const u = new URL(SUPABASE_HEARTBEAT_URL);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const body = JSON.parse(d);
            if (body?.blocked) {
              // Dispositivo na blacklist: encerra de forma limpa
              app.quit();
            }
          } catch {
            /* ignore */
          }
        });
      }
    );
    req.on('error', () => { /* silencioso para nunca travar o app */ });
    req.write(payload);
    req.end();
  } catch {
    /* silencioso */
  }
}

/**
 * Inicializa a proteção no processo principal do Electron.
 */
function initAntiTamper() {
  // Escuta confirmação de sessão ativa enviada pelo renderer legítimo
  ipcMain.on('auth:sessionState', (_event, active) => {
    sessionActive = Boolean(active);
  });

  // Primeiro heartbeat após 10 segundos da inicialização (dá tempo da rede estabilizar)
  setTimeout(() => sendHeartbeat(true).catch(() => { /* silencioso */ }), 10000);

  // Heartbeats periódicos a cada 30 minutos
  setInterval(() => sendHeartbeat(false).catch(() => { /* silencioso */ }), 30 * 60 * 1000);
}

module.exports = {
  initAntiTamper,
  getHardwareId,
  inspectAppIntegrity,
};
