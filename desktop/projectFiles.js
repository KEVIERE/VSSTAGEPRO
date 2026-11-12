// Projeto .vss no app do Mac: abre e grava pelo caminho do arquivo, sem a API de arquivos do navegador.
// A do navegador grava sempre um arquivo novo inteiro (copiando o antigo antes): num projeto de 20 GB,
// salvar só a letra levava o mesmo tempo que salvar tudo. Aqui, quando só o projeto mudou, o fim do
// arquivo é trocado no lugar e os áudios nem são tocados.
//
// Formato: [magic][áudios...][manifest][f64 manifestOffset][u32 manifestLen][magic]
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAGIC = 'VSSTAGE1';
const DATA_START = MAGIC.length;
const TRAILER_SIZE = 20;
// Se o programa cair no meio de uma gravação, o rodapé antigo continua no arquivo um pouco antes
// do fim; quem lê procura ele de trás para frente até este tanto.
const SCAN_BACK = 64 * 1024 * 1024;
const PROJECT_EXT = /\.(vss|vsc)$/i;

function trailer(manifestStart, manifestLen) {
  const b = Buffer.alloc(TRAILER_SIZE);
  b.writeDoubleLE(manifestStart, 0);
  b.writeUInt32LE(manifestLen, 8);
  b.write(MAGIC, 12, 'latin1');
  return b;
}

/** Rodapé válido terminando em `end` (posição no arquivo), lido de `buf` que começa em `bufStart`. */
function trailerAt(buf, bufStart, end) {
  const at = end - TRAILER_SIZE - bufStart;
  if (at < 0 || at + TRAILER_SIZE > buf.length) return null;
  if (buf.toString('latin1', at + 12, at + 20) !== MAGIC) return null;
  const manifestStart = buf.readDoubleLE(at);
  const manifestLen = buf.readUInt32LE(at + 8);
  if (!Number.isFinite(manifestStart) || manifestStart < DATA_START) return null;
  if (manifestStart + manifestLen !== end - TRAILER_SIZE) return null;
  return { manifestStart, manifestLen, end };
}

async function readRange(fh, start, len) {
  const buf = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const { bytesRead } = await fh.read(buf, got, len - got, start + got);
    if (!bytesRead) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/** Onde está o manifest. Procura para trás quando o fim ficou pela metade (queda no meio do salvar). */
async function readTail(fh, size) {
  if (size < DATA_START + TRAILER_SIZE) return null;
  if ((await readRange(fh, 0, DATA_START)).toString('latin1') !== MAGIC) return null;
  const last = await readRange(fh, size - TRAILER_SIZE, TRAILER_SIZE);
  const direct = trailerAt(last, size - TRAILER_SIZE, size);
  if (direct) return direct;
  const start = Math.max(DATA_START, size - SCAN_BACK);
  const buf = await readRange(fh, start, size - start);
  for (let i = buf.lastIndexOf(MAGIC, buf.length - 1, 'latin1'); i >= 12; i = buf.lastIndexOf(MAGIC, i - 1, 'latin1')) {
    const found = trailerAt(buf, start, start + i + 8);
    if (found) return found;
  }
  return null;
}

async function writeAll(fh, buf, position) {
  let done = 0;
  while (done < buf.length) {
    const { bytesWritten } = await fh.write(buf, done, buf.length - done, position + done);
    done += bytesWritten;
  }
}

function checkProjectPath(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !PROJECT_EXT.test(filePath)) {
    throw new Error('Arquivo de projeto inválido.');
  }
  return filePath;
}

/** Tamanho, data e onde está o manifest de um .vss no disco. */
async function info(filePath) {
  checkProjectPath(filePath);
  const fh = await fsp.open(filePath, 'r');
  try {
    const st = await fh.stat();
    const tail = await readTail(fh, st.size);
    return { size: st.size, mtimeMs: st.mtimeMs, manifestStart: tail ? tail.manifestStart : null, manifestLen: tail ? tail.manifestLen : null };
  } finally {
    await fh.close();
  }
}

function maxAssetEnd(manifest) {
  let end = DATA_START;
  for (const a of Array.isArray(manifest && manifest.assets) ? manifest.assets : []) {
    if (a && a.size > 0 && Number.isFinite(a.offset)) end = Math.max(end, DATA_START + a.offset + a.size);
  }
  return end;
}

/**
 * Troca só o manifest (letras, mixagem, ordem). Os áudios ficam onde estão.
 * 1. grava o manifest novo + rodapé depois do fim atual (o rodapé antigo continua lá: se cair no
 *    meio, o arquivo abre como estava);
 * 2. se couber, copia o manifest para logo depois do último áudio e corta o arquivo ali (sem deixar
 *    sobra crescendo a cada salvar). Durante a cópia, o rodapé do passo 1 continua valendo.
 */
async function writeTail(filePath, { expectedSize, expectedManifestStart, manifest }) {
  checkProjectPath(filePath);
  const bytes = Buffer.from(manifest);
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Projeto inválido.'); }
  const fh = await fsp.open(filePath, 'r+');
  try {
    const st = await fh.stat();
    const tail = await readTail(fh, st.size);
    // o arquivo precisa ser o mesmo que o programa leu: senão, quem chamou grava tudo de novo
    if (!tail || st.size !== expectedSize || tail.manifestStart !== expectedManifestStart) {
      return { ok: false, reason: 'changed' };
    }
    const old = JSON.parse((await readRange(fh, tail.manifestStart, tail.manifestLen)).toString('utf8'));
    const keep = maxAssetEnd(old);
    // o manifest novo só pode apontar para áudio que já está no arquivo
    if (maxAssetEnd(parsed) > keep || keep > tail.manifestStart) return { ok: false, reason: 'assets' };

    const oldEnd = st.size;
    await writeAll(fh, Buffer.concat([bytes, trailer(oldEnd, bytes.length)]), oldEnd);
    await fh.sync();
    let size = oldEnd + bytes.length + TRAILER_SIZE;
    if (keep + bytes.length + TRAILER_SIZE <= oldEnd) {
      await writeAll(fh, Buffer.concat([bytes, trailer(keep, bytes.length)]), keep);
      await fh.sync();
      size = keep + bytes.length + TRAILER_SIZE;
      await fh.truncate(size);
      await fh.sync();
    }
    const after = await fh.stat();
    return { ok: true, size: after.size, mtimeMs: after.mtimeMs, manifestStart: size - TRAILER_SIZE - bytes.length };
  } finally {
    await fh.close();
  }
}

// Gravar o arquivo inteiro (quando entrou áudio novo): vai para um arquivo escondido ao lado e só
// troca pelo projeto no fim. Cancelou ou caiu no meio: o projeto antigo fica intacto.
const writers = new Map();

async function writeOpen(filePath) {
  checkProjectPath(filePath);
  const dir = path.dirname(filePath);
  await fsp.access(dir, fs.constants.W_OK);
  const temp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.salvando`);
  const fh = await fsp.open(temp, 'w');
  const id = crypto.randomUUID();
  writers.set(id, { fh, temp, filePath, pos: 0 });
  return id;
}

function writer(id) {
  const w = writers.get(id);
  if (!w) throw new Error('Gravação encerrada.');
  return w;
}

async function writeData(id, data) {
  const w = writer(id);
  const buf = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  await writeAll(w.fh, buf, w.pos);
  w.pos += buf.length;
  return w.pos;
}

/** Copia um áudio de outro .vss (ou do mesmo) direto no disco, sem passar pela tela. */
async function writeCopy(id, srcPath, begin, size) {
  const w = writer(id);
  checkProjectPath(srcPath);
  const src = await fsp.open(srcPath, 'r');
  try {
    const CHUNK = 8 * 1024 * 1024;
    const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size)));
    let done = 0;
    while (done < size) {
      const want = Math.min(buf.length, size - done);
      const { bytesRead } = await src.read(buf, 0, want, begin + done);
      if (!bytesRead) throw new Error('O áudio de origem terminou antes do esperado.');
      await writeAll(w.fh, buf.subarray(0, bytesRead), w.pos);
      w.pos += bytesRead;
      done += bytesRead;
    }
  } finally {
    await src.close();
  }
  return w.pos;
}

async function writeClose(id) {
  const w = writer(id);
  writers.delete(id);
  try {
    await w.fh.sync();
    await w.fh.close();
    await fsp.rename(w.temp, w.filePath);
  } catch (err) {
    await fsp.unlink(w.temp).catch(() => {});
    throw err;
  }
  const st = await fsp.stat(w.filePath);
  return { size: st.size, mtimeMs: st.mtimeMs };
}

async function writeAbort(id) {
  const w = writers.get(id);
  if (!w) return;
  writers.delete(id);
  await w.fh.close().catch(() => {});
  await fsp.unlink(w.temp).catch(() => {});
}

// A tela recebe o arquivo do disco como se a pessoa tivesse escolhido num campo de arquivo (o mesmo
// que os testes automáticos do Chrome fazem). Assim ela lê os áudios em pedaços, direto do disco.
async function giveFile(webContents, filePath, selector) {
  checkProjectPath(filePath);
  await fsp.access(filePath, fs.constants.R_OK);
  if (typeof selector !== 'string' || !/^#vs-project-file-[a-z0-9]+$/.test(selector)) throw new Error('Campo inválido.');
  const dbg = webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0 });
  const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error('Campo não encontrado.');
  await dbg.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId });
  return true;
}

function vssPath(chosen) {
  return PROJECT_EXT.test(chosen) ? chosen : `${chosen}.vss`;
}

async function pickOpen(win) {
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir projeto',
    properties: ['openFile'],
    filters: [{ name: 'Projeto VS Stage', extensions: ['vss', 'vsc'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const real = await fsp.realpath(r.filePaths[0]);
  return { name: path.basename(real), path: real };
}

async function pickSave(win, suggestedName) {
  const { dialog, app } = require('electron');
  const r = await dialog.showSaveDialog(win, {
    title: 'Salvar projeto',
    defaultPath: path.join(app.getPath('documents'), vssPath(String(suggestedName || 'Projeto').replace(/[/\\:]/g, '_'))),
    filters: [{ name: 'Projeto VS Stage', extensions: ['vss'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const chosen = vssPath(r.filePath);
  return { name: path.basename(chosen), path: chosen };
}

module.exports = {
  MAGIC, TRAILER_SIZE, trailer, readTail, info, writeTail,
  writeOpen, writeData, writeCopy, writeClose, writeAbort, giveFile, pickOpen, pickSave,
};
