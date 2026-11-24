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
const os = require('os');
const { execFile } = require('child_process');

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

/**
 * Grava vários pedaços seguidos (manifest e rodapé) sem juntar antes num buffer só: o manifest de
 * um show grande tem dezenas de MB, e o Buffer.concat copiava tudo de novo na memória do app.
 */
async function writeAllv(fh, bufs, position) {
  let done = 0;
  if (typeof fh.writev === 'function') done = (await fh.writev(bufs, position)).bytesWritten;
  // o que ficou de fora (gravação pela metade), pedaço por pedaço
  let skip = done;
  for (const b of bufs) {
    if (skip >= b.length) { skip -= b.length; continue; }
    const rest = skip ? b.subarray(skip) : b;
    skip = 0;
    await writeAll(fh, rest, position + done);
    done += rest.length;
  }
}

/** Os bytes que a tela mandou, sem cópia (antes `Buffer.from(new Uint8Array(...))` copiava 8 MB por pedaço). */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

// O manifest de um show grande tem dezenas de MB (os picos da onda) e era analisado inteiro aqui,
// na thread do app (de 80 a 120 ms parada a cada ⌘S, e o dobro no primeiro depois de abrir), só
// para saber até onde vão os áudios. O programa grava o índice `assets` como última chave: dele
// basta o fim. Manifest pequeno continua sendo conferido inteiro (custa pouco e acha texto quebrado).
const FULL_PARSE_MAX = 512 * 1024;
// Até onde, do fim, procurar o índice no manifest antigo do disco (o índice de 225 áudios tem uns 30 KB).
const TAIL_WINDOW = 1024 * 1024;
const ASSETS_KEY = Buffer.from('"assets":[', 'latin1');

/**
 * O índice `assets` lido só do fim do manifest, quando ele é a última chave e o texto está sem
 * espaços (como o programa grava). null quando não dá: aí quem chamou analisa o manifest inteiro.
 * Num JSON válido, `"assets":[` logo depois de `,` ou `{` só pode ser chave (aspas dentro de texto
 * vão como \"), e a última vez que aparece é a da chave de fora: qualquer outra deixaria colchete
 * ou chave sobrando no resto, e o JSON.parse do resto falha.
 */
function tailAssets(buf) {
  if (buf.length < ASSETS_KEY.length + 3 || buf[buf.length - 1] !== 0x7d) return null;
  const at = buf.lastIndexOf(ASSETS_KEY);
  if (at < 1 || (buf[at - 1] !== 0x2c && buf[at - 1] !== 0x7b)) return null;
  let list;
  try {
    list = JSON.parse(buf.toString('utf8', at + ASSETS_KEY.length - 1, buf.length - 1));
  } catch {
    return null;
  }
  return Array.isArray(list) ? list : null;
}

/** Até onde vão os áudios que o manifest novo (vindo da tela) aponta. */
function newManifestAssetsEnd(bytes) {
  if (bytes.length > FULL_PARSE_MAX) {
    const list = tailAssets(bytes);
    if (list) return maxAssetEnd({ assets: list });
  }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Projeto inválido.'); }
  return maxAssetEnd(parsed);
}

/** Até onde vão os áudios que o manifest gravado no disco aponta. Grande: lê só o fim dele. */
async function storedAssetsEnd(fh, tail) {
  if (tail.manifestLen > FULL_PARSE_MAX) {
    const len = Math.min(tail.manifestLen, TAIL_WINDOW);
    const list = tailAssets(await readRange(fh, tail.manifestStart + tail.manifestLen - len, len));
    if (list) return maxAssetEnd({ assets: list });
  }
  return maxAssetEnd(JSON.parse((await readRange(fh, tail.manifestStart, tail.manifestLen)).toString('utf8')));
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
  await recover(filePath);
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

// Onde termina o último áudio do manifest que este app acabou de gravar em cada projeto. O salvar
// seguinte usa isso em vez de reler e analisar o manifest antigo inteiro: num show grande eram
// dezenas de MB de texto analisados na thread da janela (teclado e mouse paravam junto). Só vale
// enquanto o arquivo está exatamente como ficou (tamanho, data e lugar do manifest).
const lastWritten = new Map();

function rememberWritten(filePath, st, manifestStart, manifestLen, assetsEnd) {
  lastWritten.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, manifestStart, manifestLen, assetsEnd });
}

function writtenAssetsEnd(filePath, st, tail) {
  const w = lastWritten.get(filePath);
  if (!w || w.size !== st.size || w.mtimeMs !== st.mtimeMs) return null;
  if (w.manifestStart !== tail.manifestStart || w.manifestLen !== tail.manifestLen) return null;
  return w.assetsEnd;
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
  if (appending(filePath)) return { ok: false, reason: 'busy' };
  const bytes = toBuffer(manifest);
  const newEnd = newManifestAssetsEnd(bytes);
  const fh = await fsp.open(filePath, 'r+');
  try {
    const st = await fh.stat();
    const tail = await readTail(fh, st.size);
    // o arquivo precisa ser o mesmo que o programa leu: senão, quem chamou grava tudo de novo
    if (!tail || st.size !== expectedSize || tail.manifestStart !== expectedManifestStart) {
      return { ok: false, reason: 'changed' };
    }
    let keep = writtenAssetsEnd(filePath, st, tail);
    if (keep === null) keep = await storedAssetsEnd(fh, tail);
    // o manifest novo só pode apontar para áudio que já está no arquivo
    if (newEnd > keep || keep > tail.manifestStart) return { ok: false, reason: 'assets' };

    const oldEnd = st.size;
    await writeAllv(fh, [bytes, trailer(oldEnd, bytes.length)], oldEnd);
    await fh.sync();
    let size = oldEnd + bytes.length + TRAILER_SIZE;
    if (keep + bytes.length + TRAILER_SIZE <= oldEnd) {
      await writeAllv(fh, [bytes, trailer(keep, bytes.length)], keep);
      await fh.sync();
      size = keep + bytes.length + TRAILER_SIZE;
      await fh.truncate(size);
      await fh.sync();
    }
    const after = await fh.stat();
    const manifestStart = size - TRAILER_SIZE - bytes.length;
    rememberWritten(filePath, after, manifestStart, bytes.length, newEnd);
    return { ok: true, size: after.size, mtimeMs: after.mtimeMs, manifestStart };
  } finally {
    await fh.close();
  }
}

// Gravar o arquivo inteiro (quando entrou áudio novo): vai para um arquivo escondido ao lado e só
// troca pelo projeto no fim. Cancelou ou caiu no meio: o projeto antigo fica intacto.
const writers = new Map();

async function writeOpen(filePath) {
  checkProjectPath(filePath);
  await recover(filePath);
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
  const buf = toBuffer(data);
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
  // arquivo novo inteiro: o salvar seguinte lê o manifest dele uma vez
  lastWritten.delete(w.filePath);
  try {
    await w.fh.sync();
    await w.fh.close();
    await fsp.rename(w.temp, w.filePath);
    // marca de um salvar pela metade não vale para o arquivo novo
    await fsp.unlink(markerPath(w.filePath)).catch(() => {});
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

// Salvar só o que mudou (entrou áudio novo, mas a maior parte já está no arquivo): os áudios que já
// estão lá ficam no lugar; os novos entram no fim do arquivo, seguidos do manifest novo e do rodapé.
// Num projeto de 20 GB, entrar uma música nova grava só ela, sem copiar os 20 GB.
// Segurança: antes de começar, um arquivo escondido ao lado guarda o tamanho antigo. Se o programa
// cair no meio, ao abrir de novo o arquivo volta a esse tamanho (recover) e abre como estava.
const appenders = new Map();

function markerPath(filePath) {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.anexando`);
}

function appending(filePath) {
  for (const a of appenders.values()) if (a.filePath === filePath) return true;
  return false;
}

/** Salvar anterior que ficou pela metade (programa caiu): volta o arquivo para como estava. */
async function recover(filePath) {
  if (appending(filePath)) return false;
  const marker = markerPath(filePath);
  let oldEnd;
  try {
    oldEnd = JSON.parse(await fsp.readFile(marker, 'utf8')).oldEnd;
  } catch {
    return false;
  }
  if (Number.isFinite(oldEnd) && oldEnd > DATA_START) {
    const st = await fsp.stat(filePath).catch(() => null);
    if (st && st.size > oldEnd) {
      const fh = await fsp.open(filePath, 'r+');
      try {
        await fh.truncate(oldEnd);
        await fh.sync();
      } finally {
        await fh.close();
      }
    }
  }
  await fsp.unlink(marker).catch(() => {});
  return true;
}

async function appendOpen(filePath, { expectedSize, expectedManifestStart }) {
  checkProjectPath(filePath);
  if (appending(filePath)) return { ok: false, reason: 'busy' };
  await recover(filePath);
  const fh = await fsp.open(filePath, 'r+');
  try {
    const st = await fh.stat();
    const tail = await readTail(fh, st.size);
    // o arquivo precisa ser o mesmo que o programa leu: senão, quem chamou grava tudo de novo
    if (!tail || st.size !== expectedSize || tail.manifestStart !== expectedManifestStart) {
      await fh.close();
      return { ok: false, reason: 'changed' };
    }
    const marker = await fsp.open(markerPath(filePath), 'w');
    try {
      await marker.writeFile(JSON.stringify({ oldEnd: st.size }));
      await marker.sync();
    } finally {
      await marker.close();
    }
    const id = crypto.randomUUID();
    appenders.set(id, { fh, filePath, pos: st.size, oldEnd: st.size });
    return { ok: true, id, start: st.size };
  } catch (err) {
    await fh.close().catch(() => {});
    throw err;
  }
}

function appender(id) {
  const a = appenders.get(id);
  if (!a) throw new Error('Gravação encerrada.');
  return a;
}

async function appendData(id, data) {
  const a = appender(id);
  const buf = toBuffer(data);
  await writeAll(a.fh, buf, a.pos);
  a.pos += buf.length;
  return a.pos;
}

/** Copia um áudio de outro .vss direto no disco para o fim do projeto. */
async function appendCopy(id, srcPath, begin, size) {
  const a = appender(id);
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
      await writeAll(a.fh, buf.subarray(0, bytesRead), a.pos);
      a.pos += bytesRead;
      done += bytesRead;
    }
  } finally {
    await src.close();
  }
  return a.pos;
}

/** Fecha o salvar: manifest novo e rodapé depois dos áudios novos. */
async function appendClose(id, manifest) {
  const a = appender(id);
  const bytes = toBuffer(manifest);
  // o manifest só pode apontar para áudio que está no arquivo
  const assetsEnd = newManifestAssetsEnd(bytes);
  if (assetsEnd > a.pos) throw new Error('O projeto aponta para áudio que não foi gravado.');
  await writeAllv(a.fh, [bytes, trailer(a.pos, bytes.length)], a.pos);
  const size = a.pos + bytes.length + TRAILER_SIZE;
  await a.fh.truncate(size);
  await a.fh.sync();
  appenders.delete(id);
  await a.fh.close();
  await fsp.unlink(markerPath(a.filePath)).catch(() => {});
  const st = await fsp.stat(a.filePath);
  rememberWritten(a.filePath, st, a.pos, bytes.length, assetsEnd);
  return { size: st.size, mtimeMs: st.mtimeMs, manifestStart: a.pos };
}

/** Cancelou ou deu erro: o arquivo volta ao tamanho de antes (abre como estava). */
async function appendAbort(id) {
  const a = appenders.get(id);
  if (!a) return;
  appenders.delete(id);
  try {
    await a.fh.truncate(a.oldEnd);
    await a.fh.sync();
  } finally {
    await a.fh.close().catch(() => {});
    await fsp.unlink(markerPath(a.filePath)).catch(() => {});
  }
}

// A tela recebe o arquivo do disco como se a pessoa tivesse escolhido num campo de arquivo (o mesmo
// que os testes automáticos do Chrome fazem). Assim ela lê os áudios em pedaços, direto do disco.
//
// O depurador da janela fica ligado só enquanto entrega o arquivo. Antes ficava ligado o resto da
// sessão depois do primeiro projeto aberto, e cada menu, dica ou janela que aparecia mandava
// eventos a mais ao app (400 com 200 avisos aparecendo e sumindo, contados no Electron 33). O
// arquivo continua no campo e lendo depois de soltar. Só solta o que esta função ligou: se outro
// já estava ligado (a ferramenta de medição), não mexe.
//
// Uma entrega por vez em cada janela: o DOM.getDocument de uma invalida o número do campo que a
// outra acabou de achar ("Could not find node with given id", e um dos projetos abria sem arquivo).
const giveQueue = new WeakMap();

async function giveFile(webContents, filePath, selector) {
  checkProjectPath(filePath);
  await recover(filePath);
  await fsp.access(filePath, fs.constants.R_OK);
  if (typeof selector !== 'string' || !/^#vs-project-file-[a-z0-9]+$/.test(selector)) throw new Error('Campo inválido.');
  const dbg = webContents.debugger;
  const before = giveQueue.get(dbg) || Promise.resolve();
  let done;
  const turn = new Promise((resolve) => { done = resolve; });
  giveQueue.set(dbg, before.then(() => turn));
  await before;
  try {
    const mine = !dbg.isAttached();
    if (mine) dbg.attach('1.3');
    try {
      const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0 });
      const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error('Campo não encontrado.');
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId });
      return true;
    } finally {
      if (mine) {
        try { dbg.sendCommand('DOM.disable').catch(() => {}); } catch { /* já solto */ }
        try { dbg.detach(); } catch { /* já solto */ }
      }
    }
  } finally {
    done();
  }
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

/**
 * Acha no disco um projeto que o programa só conhece pela janela do navegador (nome, tamanho e
 * data, sem o caminho). Procura pelo Spotlight e, se ele não achar, nas pastas de costume. Só
 * devolve quando há um arquivo só com o mesmo nome, o mesmo tamanho e a mesma data: na dúvida,
 * não devolve nada (o programa continua salvando do jeito lento, mas certo).
 */
const LOCATE_DIRS = ['Downloads', 'Desktop', 'Documents', 'Music', 'Movies'];
const LOCATE_SKIP = new Set(['node_modules', 'Library', '.Trash']);

function spotlight(name) {
  return new Promise((resolve) => {
    execFile('mdfind', ['-name', name], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? [] : String(stdout).split('\n').filter((p) => p && path.basename(p) === name));
    });
  });
}

async function walkFor(dir, name, depth, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || LOCATE_SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) out.push(full);
    else if (e.isDirectory() && depth > 0 && !PROJECT_EXT.test(e.name)) await walkFor(full, name, depth - 1, out);
  }
}

// `opts` só nos testes (pastas onde procurar, sem Spotlight); o programa chama com três argumentos.
async function locate(name, size, lastModified, opts = {}) {
  if (typeof name !== 'string' || !PROJECT_EXT.test(name) || name.includes('/') || name.includes('\0')) return null;
  if (!(Number.isFinite(size) && size > 0) || !Number.isFinite(lastModified)) return null;
  const same = async (candidates) => {
    const hits = [];
    for (const c of new Set(candidates)) {
      const st = await fsp.stat(c).catch(() => null);
      if (st && st.isFile() && st.size === size && Math.abs(st.mtimeMs - lastModified) < 1000) hits.push(c);
    }
    return hits;
  };
  let hits = opts.spotlight === false ? [] : await same(await spotlight(name));
  if (hits.length === 0) {
    const found = [];
    const roots = Array.isArray(opts.roots) ? opts.roots : LOCATE_DIRS.map((d) => path.join(os.homedir(), d));
    for (const d of roots) await walkFor(d, name, 3, found);
    hits = await same(found);
  }
  return hits.length === 1 ? hits[0] : null;
}

module.exports = {
  MAGIC, TRAILER_SIZE, trailer, readTail, info, writeTail,
  writeOpen, writeData, writeCopy, writeClose, writeAbort,
  appendOpen, appendData, appendCopy, appendClose, appendAbort, recover, locate,
  giveFile, pickOpen, pickSave,
  // só para os testes
  tailAssets, writeAllv,
};
