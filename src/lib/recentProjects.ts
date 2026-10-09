import type { SaveTarget } from '@/lib/projectSaver';

export interface RecentProject {
  id: string;
  name: string;
  label: string;
  openedAt: number;
  target: SaveTarget;
}

const DB_NAME = 'vs-stage';
const STORE = 'recentProjects';
const MAX_RECENT = 8;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Sem armazenamento local.')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  try {
    const all = (await run<RecentProject[]>('readonly', (s) => s.getAll())) ?? [];
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

async function sameTarget(a: SaveTarget, b: SaveTarget): Promise<boolean> {
  if (a.kind !== b.kind) return false;
  const ha = a.kind === 'package' ? a.handle : a.dir;
  const hb = b.kind === 'package' ? b.handle : b.dir;
  try { return await ha.isSameEntry(hb); } catch { return false; }
}

export async function rememberProject(name: string, target: SaveTarget | null | undefined): Promise<void> {
  if (!target) return;
  try {
    const all = await listRecentProjects();
    const stale: string[] = [];
    for (const r of all) if (await sameTarget(r.target, target)) stale.push(r.id);
    const label = target.kind === 'package' ? target.handle.name : target.name;
    const entry: RecentProject = { id: crypto.randomUUID(), name: name || 'Sem Nome', label, openedAt: Date.now(), target };
    const overflow = all.filter((r) => !stale.includes(r.id)).slice(MAX_RECENT - 1).map((r) => r.id);
    await run('readwrite', (s) => {
      for (const id of [...stale, ...overflow]) s.delete(id);
      s.put(entry);
    });
  } catch (err) {
    console.warn('[recentes] não foi possível registrar', err);
  }
}

export async function forgetRecentProject(id: string): Promise<void> {
  try { await run('readwrite', (s) => { s.delete(id); }); } catch { /* lista local; nada a fazer */ }
}

const AUTO_OPEN_KEY = 'vs-auto-open-last';

export function autoOpenEnabled(): boolean {
  try { return localStorage.getItem(AUTO_OPEN_KEY) !== 'off'; } catch { return true; }
}

export function setAutoOpenEnabled(on: boolean) {
  try { localStorage.setItem(AUTO_OPEN_KEY, on ? 'on' : 'off'); } catch { /* fica só nesta sessão */ }
}

type PermissionHandle = { queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState> };

/** Diz se o projeto abre sem pedir permissão (só pedir exige um clique da pessoa). */
export async function canReopenSilently(entry: RecentProject): Promise<boolean> {
  const h = (entry.target.kind === 'package' ? entry.target.handle : entry.target.dir) as unknown as PermissionHandle;
  if (!h.queryPermission) return true;
  try { return await h.queryPermission({ mode: 'read' }) === 'granted'; } catch { return false; }
}

export async function clearRecentProjects(): Promise<void> {
  try { await run('readwrite', (s) => { s.clear(); }); } catch { /* lista local; nada a fazer */ }
}
