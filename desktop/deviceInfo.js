// Quem é este Mac, para a regra de um Mac por vez em cada conta (src/lib/deviceLock.ts).
//
// O código sai do número da placa do Mac (o mesmo do antiTamper), embaralhado de novo para não
// ser o mesmo número dos avisos de segurança. Não muda ao reinstalar o programa nem o sistema.
// O nome é o que aparece em Ajustes > Geral > Sobre, para a pergunta dizer qual é o outro Mac.
//
// Os dois comandos (ioreg e scutil) rodam em segundo plano: antes travavam o principal por cerca
// de 35 ms na abertura, enquanto ele ainda servia os arquivos da tela.
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { getHardwareIdAsync } = require('./antiTamper');

let cached = null;
let pending = null;

const networkName = () => os.hostname().replace(/\.local$/i, '').slice(0, 80);

function computerName() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') { resolve(networkName()); return; }
    try {
      execFile('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeout: 2000, encoding: 'utf8' }, (err, out) => {
        const name = err ? '' : String(out || '').trim();
        resolve(name ? name.slice(0, 80) : networkName());
      });
    } catch {
      resolve(networkName()); // usa o nome de rede
    }
  });
}

/** `{ id, name }` deste computador. Guardado depois da primeira vez. */
function deviceInfo() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = Promise.all([getHardwareIdAsync(), computerName()]).then(([hw, name]) => {
      const id = crypto.createHash('sha256').update(`vsstage-device-v1:${hw}`).digest('hex').slice(0, 40);
      cached = { id, name };
      return cached;
    }).finally(() => { pending = null; });
  }
  return pending;
}

module.exports = { deviceInfo };
