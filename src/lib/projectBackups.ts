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

    const all = await listProjectBackups(projectName);
    const stale = all.slice(MAX_BACKUPS_PER_PROJECT - 1);

    await run('readwrite', (s) => {
      for (const old of stale) s.delete(old.id);
      s.put(backup);
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
    const all = (await run<ProjectBackup[]>('readonly', (s) => s.getAll())) ?? [];
    const filtered = projectName
      ? all.filter((b) => b.projectName.toLowerCase() === projectName.toLowerCase())
      : all;
    return filtered.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_BACKUPS_PER_PROJECT);
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
