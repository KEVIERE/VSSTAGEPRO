// Última conferência da conta guardada no Mac, para o programa abrir sem internet.
//
// O arquivo é criptografado pelo Keychain do Mac (safeStorage): não dá para abrir e editar a mão.
// Junto vai a maior hora já vista neste Mac, para voltar o relógio não esticar o teste nem a
// assinatura. A regra do que vale sem internet fica em src/lib/offlineLicense.ts.
const { app, safeStorage, net } = require('electron');
const fs = require('fs');
const path = require('path');

// Qualquer resposta do servidor traz a hora certa no cabeçalho Date.
const CLOCK_URL = 'https://eknjqqiamuztomdygalv.supabase.co/auth/v1/health';
// Diferença maior que isso entre o relógio do Mac e o do servidor: relógio errado.
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const LICENSE_FIELDS = ['status', 'reason', 'ends_at', 'hours_left', 'plan', 'subscription', 'current_period_end', 'partner'];

const file = () => path.join(app.getPath('userData'), 'conferencia-da-conta.bin');

function readRaw() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    return data && data.v === 1 ? data : null;
  } catch {
    return null;
  }
}

function writeRaw(data) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const tmp = `${file()}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify({ ...data, v: 1 })));
    fs.renameSync(tmp, file());
    return true;
  } catch {
    return false;
  }
}

function cleanLicense(license) {
  const out = {};
  if (!license || typeof license !== 'object') return out;
  for (const key of LICENSE_FIELDS) {
    const value = license[key];
    if (value === undefined) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value;
  }
  return out;
}

/** Hora do servidor em ms, ou null se não respondeu. */
async function serverTime() {
  try {
    const res = await net.fetch(CLOCK_URL, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    const t = new Date(res.headers.get('date') || '').getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

/** Anda a maior hora vista para frente (nunca para trás). */
function bumpMaxSeen() {
  const data = readRaw();
  const now = Date.now();
  if (data && now > (data.maxSeen || 0)) writeRaw({ ...data, maxSeen: now });
}

/**
 * Devolve a última conferência com a maior hora vista ANTES desta abertura
 * (é com ela que a tela percebe o relógio voltado) e depois guarda a hora de agora.
 */
function load() {
  const data = readRaw();
  if (!data) return null;
  const result = {
    userId: data.userId,
    license: data.license,
    checkedAt: data.checkedAt,
    maxSeen: data.maxSeen,
    clockWrong: data.clockWrong === true,
  };
  bumpMaxSeen();
  return result;
}

/** O servidor acabou de responder: guarda o que ele disse. */
async function save(userId, license) {
  if (typeof userId !== 'string' || !userId || userId.length > 64) return false;
  const now = Date.now();
  const prev = readRaw();
  const server = await serverTime();
  const clockWrong = server !== null && Math.abs(server - now) > CLOCK_SKEW_MS;
  // Relógio conferido com o servidor: a maior hora vista recomeça daqui (corrige um relógio
  // que esteve adiantado). Sem conferir, só anda para frente.
  const maxSeen = server !== null && !clockWrong ? now : Math.max(prev?.maxSeen || 0, now);
  return writeRaw({ userId, license: cleanLicense(license), checkedAt: now, maxSeen, clockWrong });
}

function clear() {
  try { fs.rmSync(file(), { force: true }); } catch { /* nada guardado */ }
}

/** Com o programa aberto por dias, a maior hora vista também anda. */
function startClockWatch() {
  setInterval(bumpMaxSeen, 10 * 60 * 1000).unref?.();
}

module.exports = { load, save, clear, startClockWatch };
