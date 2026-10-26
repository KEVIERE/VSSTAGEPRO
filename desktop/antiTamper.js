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
 * Calcula o hash SHA-256 do pacote executável app.asar.
 * Também detecta se o cracker descompactou o ASAR em uma pasta 'app/' para editar o código.
 */
function inspectAppIntegrity() {
  if (!app.isPackaged) {
    return { tampered: false, asarSha: null, reason: null };
  }

  try {
    const resources = process.resourcesPath;
    const asarPath = path.join(resources, 'app.asar');
    const unpackedDir = path.join(resources, 'app');

    // Sinal 1: Cracker descompactou o ASAR em uma pasta 'app/' para rodar código alterado
    if (fs.existsSync(unpackedDir) && fs.statSync(unpackedDir).isDirectory()) {
      return {
        tampered: true,
        asarSha: null,
        reason: 'Estrutura alterada: pasta app/ descompactada detectada no diretório Resources (técnica clássica de crack)',
      };
    }

    // Sinal 2: O arquivo app.asar não existe
    if (!fs.existsSync(asarPath)) {
      return {
        tampered: true,
        asarSha: null,
        reason: 'Pacote app.asar ausente no diretório de recursos da aplicação',
      };
    }

    // Sinal 3: Cálculo do SHA-256 real do app.asar
    const buf = fs.readFileSync(asarPath);
    const asarSha = crypto.createHash('sha256').update(buf).digest('hex');

    // Confere com o build-info.json se houver hash registrado
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
  } catch (e) {
    return { tampered: false, asarSha: null, reason: null };
  }
}

/**
 * Envia o sinal de integridade/heartbeat silencioso para o Supabase.
 */
function sendHeartbeat(isFirst = false) {
  const hw = getHardwareId();
  const integrity = inspectAppIntegrity();
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
  setTimeout(() => sendHeartbeat(true), 10000);

  // Heartbeats periódicos a cada 30 minutos
  setInterval(() => sendHeartbeat(false), 30 * 60 * 1000);
}

module.exports = {
  initAntiTamper,
  getHardwareId,
  inspectAppIntegrity,
};
