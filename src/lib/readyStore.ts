// Cópias prontas para tocar, guardadas no disco do app: começo de cada faixa, começo já
// ajustado em BPM/tom, a faixa inteira ajustada e, para arquivos que não abrem direto, o áudio inteiro já convertido.
const DIR_NAME = 'instant-start-v2';
const OLD_DIRS = ['instant-start-v1'];
const MAGIC = 0x56534831;
const HEADER_INTS = 6;
const SEEN_KEY = 'vs-ready-seen-v2';
// O que nenhum projeto aberto usa há esse tempo sai do disco; o resto fica, de todos os projetos.
const MAX_UNUSED_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_QUOTA_SHARE = 0.7;

export interface ReadyEntry {
  sampleRate: number;
  channels: Int16Array[];
  fullFrames: number;
  validFrames: number;
}

let dirPromise: Promise<FileSystemDirectoryHandle | null> | null = null;
const known = new Set<string>();
const usedThisSession = new Set<string>();

export function markUsed(name: string) {
  usedThisSession.add(name);
}

export function readyDir(): Promise<FileSystemDirectoryHandle | null> {
  if (!dirPromise) {
    dirPromise = (async () => {
      try {
        const root = await navigator.storage.getDirectory();
        for (const old of OLD_DIRS) await root.removeEntry(old, { recursive: true }).catch(() => { /* já não existe */ });
        return await root.getDirectoryHandle(DIR_NAME, { create: true });
      } catch {
        return null;
      }
    })();
  }
  return dirPromise;
}

export function hash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function sourceIdentity(songId: string, clipId: string, source: Blob): string {
  const modified = source instanceof File ? source.lastModified : 0;
  return `${songId}|${clipId}|${source.size}|${modified}`;
}

export function fullCopyName(songId: string, clipId: string, source: Blob, sampleRate: number): string {
  return `f_${hash(`${sourceIdentity(songId, clipId, source)}|${sampleRate}`)}`;
}

/** Faixa inteira já ajustada em BPM/tom: feita uma vez e reaproveitada nas próximas aberturas. */
export function renderedName(songId: string, clipId: string, source: Blob, sampleRate: number, frames: number, tempo: number, pitch: number): string {
  return `r_${hash(`${sourceIdentity(songId, clipId, source)}|${sampleRate}|${frames}|${tempo.toFixed(6)}|${pitch.toFixed(6)}`)}`;
}

export async function entryExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  if (known.has(name)) return true;
  try {
    await dir.getFileHandle(name);
    known.add(name);
    return true;
  } catch {
    return false;
  }
}

export async function writeEntry(dir: FileSystemDirectoryHandle, name: string, sampleRate: number, channels: Int16Array[], fullFrames: number, validFrames: number) {
  const frames = channels[0].length;
  const header = new Int32Array([MAGIC, sampleRate, channels.length, frames, fullFrames, validFrames]);
  // O navegador só grava o arquivo de verdade no close(): uma gravação interrompida não deixa arquivo pela metade.
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(header);
    for (const ch of channels) await writable.write(ch);
    await writable.close();
    known.add(name);
  } catch (err) {
    await writable.abort().catch(() => { /* ignore */ });
    await dir.removeEntry(name).catch(() => { /* ignore */ });
    throw err;
  }
}

export async function readEntry(dir: FileSystemDirectoryHandle, name: string): Promise<ReadyEntry | null> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    const buf = await file.arrayBuffer();
    if (buf.byteLength < HEADER_INTS * 4) return null;
    const [magic, sampleRate, count, frames, fullFrames, validFrames] = new Int32Array(buf, 0, HEADER_INTS);
    if (magic !== MAGIC || count < 1 || count > 2 || buf.byteLength !== HEADER_INTS * 4 + count * frames * 2) return null;
    const channels: Int16Array[] = [];
    for (let c = 0; c < count; c++) channels.push(new Int16Array(buf, HEADER_INTS * 4 + c * frames * 2, frames));
    known.add(name);
    return { sampleRate, channels, fullFrames, validFrames };
  } catch {
    return null;
  }
}

function loadSeen(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Marca o que o projeto aberto usa e apaga só o que ficou muito tempo sem uso por nenhum projeto. */
export async function purgeStale(dir: FileSystemDirectoryHandle, projectNames: Set<string>) {
  const inUse = new Set([...projectNames, ...usedThisSession]);
  const names: string[] = [];
  try {
    for await (const name of (dir as unknown as { keys: () => AsyncIterable<string> }).keys()) names.push(name);
  } catch {
    return;
  }
  const now = Date.now();
  const seen = loadSeen();
  const next: Record<string, number> = {};
  for (const name of names) {
    const last = inUse.has(name) ? now : seen[name] ?? now;
    if (now - last > MAX_UNUSED_MS) {
      known.delete(name);
      await dir.removeEntry(name).catch(() => { /* ignore */ });
      continue;
    }
    next[name] = last;
  }
  await trimRenderedForSpace(dir, inUse, next);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch { /* sem espaço: só deixa de limpar */ }
}

// Com o disco apertado, as músicas ajustadas que o projeto aberto não usa saem primeiro, das mais antigas.
async function trimRenderedForSpace(dir: FileSystemDirectoryHandle, inUse: Set<string>, seen: Record<string, number>) {
  const estimate = await navigator.storage.estimate().catch(() => null);
  if (!estimate?.quota || estimate.usage === undefined) return;
  let excess = estimate.usage - estimate.quota * MAX_QUOTA_SHARE;
  if (excess <= 0) return;
  const candidates = Object.keys(seen).filter((n) => n.startsWith('r_') && !inUse.has(n)).sort((a, b) => seen[a] - seen[b]);
  for (const name of candidates) {
    if (excess <= 0) break;
    try {
      const size = (await (await dir.getFileHandle(name)).getFile()).size;
      await dir.removeEntry(name);
      known.delete(name);
      delete seen[name];
      excess -= size;
    } catch { /* ignore */ }
  }
}
