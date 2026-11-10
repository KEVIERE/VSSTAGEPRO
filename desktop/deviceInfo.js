// Quem é este Mac, para a regra de um Mac por vez em cada conta (src/lib/deviceLock.ts).
//
// O código sai do número da placa do Mac (o mesmo do antiTamper), embaralhado de novo para não
// ser o mesmo número dos avisos de segurança. Não muda ao reinstalar o programa nem o sistema.
// O nome é o que aparece em Ajustes > Geral > Sobre, para a pergunta dizer qual é o outro Mac.
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const { getHardwareId } = require('./antiTamper');

let cached = null;

function computerName() {
  try {
    if (process.platform === 'darwin') {
      const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeout: 2000, encoding: 'utf8' }).trim();
      if (name) return name.slice(0, 80);
    }
  } catch { /* usa o nome de rede */ }
  return os.hostname().replace(/\.local$/i, '').slice(0, 80);
}

function deviceInfo() {
  if (cached) return cached;
  const id = crypto.createHash('sha256').update(`vsstage-device-v1:${getHardwareId()}`).digest('hex').slice(0, 40);
  cached = { id, name: computerName() };
  return cached;
}

module.exports = { deviceInfo };
