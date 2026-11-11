// Arquivo lacrado com uma chave que mora no próprio app, misturada com o número da placa do Mac.
//
// Substitui o safeStorage (Chaves do macOS). O app não tem certificado da Apple, então a cada
// versão o macOS não reconhecia o VS Stage e pedia a senha das chaves na abertura. Aqui não há
// janela nenhuma: o arquivo continua ilegível, não dá para editar à mão (AES-GCM recusa qualquer
// byte trocado) e copiado para outro Mac não abre.
const crypto = require('crypto');

const MAGIC = Buffer.from('VSL1');
const APP_SECRET = 'vsstage:conferencia-da-conta:7f3c9a1e5b2d4086';

/** Chave do arquivo neste Mac. `hardwareId` vem de antiTamper.getHardwareId(). */
function sealKey(hardwareId) {
  return crypto.createHash('sha256').update(`${APP_SECRET}:${hardwareId}`).digest();
}

function seal(text, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/** Texto original, ou null se o arquivo foi mexido, é de outro Mac ou não é deste formato. */
function unseal(buffer, key) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 32 || !buffer.subarray(0, 4).equals(MAGIC)) return null;
    const iv = buffer.subarray(4, 16);
    const tag = buffer.subarray(16, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buffer.subarray(32)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { sealKey, seal, unseal };
