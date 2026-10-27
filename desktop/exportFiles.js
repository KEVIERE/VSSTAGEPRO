const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Só grava dentro das pastas que a pessoa escolheu no Finder.
const roots = new Map();

function remember(dir) {
  const id = crypto.randomUUID();
  roots.set(id, dir);
  return id;
}

function resolveInside(id, rel) {
  const root = roots.get(String(id));
  if (!root) throw new Error('pasta_desconhecida');
  const target = path.resolve(root, String(rel || ''));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('caminho_invalido');
  return target;
}

const DISK_FULL = new Set(['ENOSPC', 'EDQUOT', 'EFBIG']);

function errorCode(err) {
  const code = err && err.code ? String(err.code) : 'EIO';
  return DISK_FULL.has(code) ? 'disk_full' : code;
}

async function pickFolder(win, title) {
  const r = await dialog.showOpenDialog(win, {
    title: title || 'Escolha onde salvar',
    buttonLabel: 'Salvar aqui',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.resolve(r.filePaths[0]);
  return { id: remember(dir), path: dir };
}

async function pickFile(win, suggestedName) {
  const r = await dialog.showSaveDialog(win, {
    title: 'Salvar áudio',
    buttonLabel: 'Salvar',
    defaultPath: String(suggestedName || 'audio.wav'),
    filters: [{ name: 'Áudio WAV', extensions: ['wav'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const full = path.resolve(r.filePath);
  return { id: remember(path.dirname(full)), path: path.dirname(full), name: path.basename(full) };
}

async function writeFile(id, rel, data) {
  const target = resolveInside(id, rel);
  const tmp = `${target}.parcial`;
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(tmp, Buffer.from(data));
    await fs.promises.rename(tmp, target);
    return { ok: true };
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    return { ok: false, code: errorCode(err) };
  }
}

// Gravação em pedaços direto no disco (um arquivo aberto por stream), usado pelo Show Contínuo:
// cada música é escrita assim que fica pronta, sem nunca juntar o show inteiro na memória do app.
const streams = new Map();

async function streamOpen(id, rel) {
  const target = resolveInside(id, rel);
  const tmp = `${target}.parcial`;
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const handle = await fs.promises.open(tmp, 'w');
    const streamId = crypto.randomUUID();
    streams.set(streamId, { handle, tmp, target });
    return { ok: true, streamId };
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
}

async function streamAppend(streamId, chunk) {
  const entry = streams.get(String(streamId));
  if (!entry) return { ok: false, code: 'stream_desconhecido' };
  try {
    await entry.handle.appendFile(Buffer.from(chunk));
    return { ok: true };
  } catch (err) {
    return { ok: false, code: errorCode(err) };
  }
}

async function streamClose(streamId) {
  const entry = streams.get(String(streamId));
  if (!entry) return { ok: false, code: 'stream_desconhecido' };
  streams.delete(String(streamId));
  try {
    await entry.handle.close();
    await fs.promises.rename(entry.tmp, entry.target);
    return { ok: true };
  } catch (err) {
    await fs.promises.rm(entry.tmp, { force: true }).catch(() => {});
    return { ok: false, code: errorCode(err) };
  }
}

async function streamAbort(streamId) {
  const entry = streams.get(String(streamId));
  if (!entry) return;
  streams.delete(String(streamId));
  await entry.handle.close().catch(() => {});
  await fs.promises.rm(entry.tmp, { force: true }).catch(() => {});
}

async function freeSpace(id) {
  try {
    const s = await fs.promises.statfs(resolveInside(id, ''));
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

async function reveal(id, rel) {
  const target = resolveInside(id, rel);
  const st = await fs.promises.stat(target).catch(() => null);
  if (st && st.isFile()) { shell.showItemInFolder(target); return; }
  await shell.openPath(st ? target : resolveInside(id, ''));
}

module.exports = { pickFolder, pickFile, writeFile, freeSpace, reveal, streamOpen, streamAppend, streamClose, streamAbort };
