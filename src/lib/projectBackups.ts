import type { SavedManifest } from '@/lib/projectSaver';
import { buildManifestBase } from '@/lib/projectSaver';
import { getClipAudio, getClipSource, putClipAudio, registerClipSource } from '@/lib/audioLibrary';
import { useStore } from '@/store';
import type { ProjectState } from '@/types';

export interface ProjectBackup {
  id: string;
  projectName: string;
  timestamp: number;
  label: string;
  songCount: number;
  trackCount: number;
  manifest: SavedManifest;
}

const DB_NAME = 'vs-stage';
const STORE = 'projectBackups';
const MAX_BACKUPS_PER_PROJECT = 10;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Sem armazenamento local disponível.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recentProjects')) {
        db.createObjectStore('recentProjects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('projectName', 'projectName', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    } catch (err) {
      db.close();
      reject(err);
    }
  }));
}

type BackupKey = { id: string; timestamp: number };

function hasKeyIndexes(store: IDBObjectStore): boolean {
  return store.indexNames.contains('projectName') && store.indexNames.contains('timestamp');
}

/**
 * Os backups de um projeto (sem nome: todos), do mais novo para o mais antigo, achados só pelas
 * chaves dos índices: nenhum backup é aberto. Antes cada ⌘S lia e montava na tela todos os backups
 * de todos os projetos (inclusive os antigos, que ainda têm os picos de onda) só para saber quais
 * apagar. O nome vale sem diferença de maiúscula, como antes.
 */
function collectBackupKeys(store: IDBObjectStore, projectName: string | undefined, done: (keys: BackupKey[]) => void, fail: (err: unknown) => void) {
  const wanted = projectName ? projectName.toLowerCase() : null;
  const ids = new Set<string>();
  const byName = store.index('projectName').openKeyCursor();
  byName.onerror = () => fail(byName.error);
  byName.onsuccess = () => {
    const c = byName.result;
    if (c) {
      if (wanted === null || String(c.key).toLowerCase() === wanted) ids.add(String(c.primaryKey));
      c.continue();
      return;
    }
    const keys: BackupKey[] = [];
    const byTime = store.index('timestamp').openKeyCursor();
    byTime.onerror = () => fail(byTime.error);
    byTime.onsuccess = () => {
      const t = byTime.result;
      if (t) {
        const id = String(t.primaryKey);
        if (ids.delete(id)) keys.push({ id, timestamp: Number(t.key) });
        t.continue();
        return;
      }
      // backup sem horário (não acontece): conta como o mais antigo
      for (const id of ids) keys.push({ id, timestamp: 0 });
      done(keys.sort((a, b) => b.timestamp - a.timestamp));
    };
  };
}

function formatBackupTime(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${time} · ${date}`;
}

/** Guarda um snapshot do projeto antes de sobrescrever, mantendo os últimos 10 de cada projeto.
 * Remove os arrays pesados de picos de forma de onda (waveformPeaks) do backup: eles só servem
 * para desenhar a onda na tela e ocupavam mais de 90% do tamanho (dezenas de megabytes que
 * congelavam o navegador no structuredClone a cada ⌘S). Ao restaurar, os picos continuam
 * nos clipes já abertos ou são recarregados pelo projeto. */
export async function saveProjectBackup(state: ProjectState): Promise<ProjectBackup | null> {
  try {
    const rawManifest = buildManifestBase(state);
    const lightClips = rawManifest.clips.map((c) => (c.waveformPeaks && c.waveformPeaks.length > 0 ? { ...c, waveformPeaks: [] } : c));
    const manifest: SavedManifest = { ...rawManifest, clips: lightClips };
    const projectName = state.projectName || 'Sem Nome';
    const now = Date.now();
    const backup: ProjectBackup = {
      id: `bkp-${now}-${Math.random().toString(36).slice(2, 7)}`,
      projectName,
      timestamp: now,
      label: formatBackupTime(now),
      songCount: state.songs.length,
      trackCount: state.tracks.length,
      manifest,
    };

    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      let failed = false;
      const fail = (err: unknown) => {
        if (failed) return;
        failed = true;
        db.close();
        reject(err);
      };
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const s = tx.objectStore(STORE);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => fail(tx.error);
        tx.onabort = () => fail(tx.error);
        const keep = (keys: BackupKey[]) => {
          // apaga os mais antigos e grava o novo na mesma transação
          try {
            for (const old of keys.slice(MAX_BACKUPS_PER_PROJECT - 1)) s.delete(old.id);
            s.put(backup);
          } catch (err) {
            try { tx.abort(); } catch { /* já terminou */ }
            fail(err);
          }
        };
        if (hasKeyIndexes(s)) {
          collectBackupKeys(s, projectName, keep, fail);
        } else {
          // banco sem os índices (não deveria existir): do jeito antigo
          const all = s.getAll();
          all.onsuccess = () => {
            const wanted = projectName.toLowerCase();
            const list = (all.result as ProjectBackup[])
              .filter((b) => String(b.projectName).toLowerCase() === wanted)
              .sort((a, b) => b.timestamp - a.timestamp);
            keep(list.map((b) => ({ id: b.id, timestamp: b.timestamp })));
          };
        }
      } catch (err) {
        fail(err);
      }
    });

    return backup;
  } catch (err) {
    console.warn('[projectBackups] falha ao gravar backup automático:', err);
    return null;
  }
}

/** Devolve os backups ordenados do mais novo para o mais antigo (máx. 10 por projeto). */
export async function listProjectBackups(projectName?: string): Promise<ProjectBackup[]> {
  try {
    const db = await openDb();
    // só os 10 mais novos deste projeto são abertos (antes: todos os backups de todos os projetos)
    const indexed = await new Promise<ProjectBackup[] | null>((resolve, reject) => {
      const fail = (err: unknown) => { db.close(); reject(err); };
      try {
        const tx = db.transaction(STORE, 'readonly');
        const s = tx.objectStore(STORE);
        const ok = hasKeyIndexes(s);
        const out: ProjectBackup[] = [];
        tx.oncomplete = () => { db.close(); resolve(ok ? out : null); };
        tx.onerror = () => fail(tx.error);
        if (!ok) return;
        collectBackupKeys(s, projectName, (keys) => {
          for (const k of keys.slice(0, MAX_BACKUPS_PER_PROJECT)) {
            const r = s.get(k.id);
            r.onsuccess = () => { if (r.result) out.push(r.result as ProjectBackup); };
          }
        }, fail);
      } catch (err) {
        fail(err);
      }
    });
    const all = indexed ?? ((await run<ProjectBackup[]>('readonly', (s) => s.getAll())) ?? []).filter((b) => (
      !projectName || b.projectName.toLowerCase() === projectName.toLowerCase()
    ));
    return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_BACKUPS_PER_PROJECT);
  } catch {
    return [];
  }
}

/**
 * Restaura o estado salvo no backup escolhido. O backup só guarda a estrutura (sem áudio, para
 * ficar leve e instantâneo); o som de cada clipe continua vindo do que já está aberto no projeto
 * atual. Por isso, antes de trocar de estado, guarda o que cada clipe já tem registrado (arquivo
 * original e/ou áudio decodificado) e devolve para os clipes com o mesmo id depois da troca —
 * `loadProject` limpa a biblioteca de áudio inteira, e sem isso a música ficaria muda.
 */
export async function restoreProjectBackup(backup: ProjectBackup): Promise<void> {
  const store = useStore.getState();
  const savedSources = new Map<string, Blob>();
  const savedAudio = new Map<string, ReturnType<typeof getClipAudio>>();
  const savedPeaks = new Map<string, number[]>();
  for (const c of store.clips) {
    const src = getClipSource(c.id);
    if (src) savedSources.set(c.id, src);
    const audio = getClipAudio(c.id);
    if (audio) savedAudio.set(c.id, audio);
    if (c.waveformPeaks && c.waveformPeaks.length > 0) savedPeaks.set(c.id, c.waveformPeaks);
  }

  // Devolve os picos de onda para os clipes do backup restaurado
  const restoredClips = (backup.manifest.clips || []).map((c) => {
    const peaks = (c.waveformPeaks && c.waveformPeaks.length > 0) ? c.waveformPeaks : (savedPeaks.get(c.id) || []);
    return { ...c, waveformPeaks: peaks };
  });

  store.loadProject({ ...backup.manifest, clips: restoredClips });

  for (const c of useStore.getState().clips) {
    const src = savedSources.get(c.id);
    if (src) registerClipSource(c.id, c.songId, src);
    const audio = savedAudio.get(c.id);
    if (audio) putClipAudio(c.id, c.songId, audio);
  }

  store.setProjectName(backup.projectName);
}

export async function deleteProjectBackup(id: string): Promise<void> {
  try {
    await run('readwrite', (s) => { s.delete(id); });
  } catch { /* lista local; nada a fazer */ }
}
