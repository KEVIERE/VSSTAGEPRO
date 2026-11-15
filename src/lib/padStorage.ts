// Onde os sons dos pads ficam guardados no computador (IndexedDB). Banco próprio, "vs-stage-pads",
// separado do "vs-stage" (projetos recentes e backups), para não depender da versão dele.
// Dois depósitos: "info" (nome, cor, volume, loop, duração: lido ao abrir) e "audio" (o arquivo,
// lido só quando o banco do pad é aberto).

import type { PadInfo } from './samplePads.ts';

const DB_NAME = 'vs-stage-pads';
const DB_VERSION = 1;

interface PadAudio {
  slot: number;
  type: string;
  bytes: ArrayBuffer;
}

/** Registro do depósito "info": as informações do pad e o tamanho do arquivo guardado (bytes). */
type StoredInfo = PadInfo & { size?: number };

/**
 * Uma conexão só, aberta na primeira vez e reaproveitada: abrir o banco a cada gravação (cada
 * movimento do knob) custava uma abertura inteira na thread da tela. Se ela fechar (outra versão
 * do banco, o sistema fechou), a próxima gravação abre de novo.
 */
let dbOpen: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbOpen) return dbOpen;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('sem armazenamento local')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('info')) db.createObjectStore('info', { keyPath: 'slot' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'slot' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const forget = () => { if (dbOpen === opening) dbOpen = null; };
      // outra versão do banco pedindo para abrir: solta esta conexão (senão trava a outra)
      db.onversionchange = () => { db.close(); forget(); };
      db.onclose = forget;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbOpen = opening;
  opening.catch(() => { if (dbOpen === opening) dbOpen = null; });
  return opening;
}

function runTx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('não deu para guardar'));
  });
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => runTx(db, stores, mode, fn).catch((err: unknown) => {
    // a conexão guardada já tinha fechado: abre de novo e tenta uma vez
    if ((err as { name?: string } | null)?.name !== 'InvalidStateError') throw err;
    dbOpen = null;
    return openDb().then((fresh) => runTx(fresh, stores, mode, fn));
  }));
}

function infoOf(rec: StoredInfo): PadInfo {
  const info: StoredInfo = { ...rec };
  delete info.size;
  return info;
}

export async function loadPadInfos(): Promise<PadInfo[]> {
  return (await loadPadRecords()).map((r) => r.info);
}

/** As informações guardadas com o tamanho do arquivo de cada pad (undefined nos guardados antes). */
export async function loadPadRecords(): Promise<Array<{ info: PadInfo; size?: number }>> {
  const list = (await tx<StoredInfo[]>(['info'], 'readonly', (t) => t.objectStore('info').getAll())) ?? [];
  return list.map((rec) => ({ info: infoOf(rec), size: rec.size }));
}

export async function loadPadAudio(slot: number): Promise<PadAudio | null> {
  return (await tx<PadAudio>(['audio'], 'readonly', (t) => t.objectStore('audio').get(slot))) ?? null;
}

/** Guarda o som novo do pad (arquivo e informações juntos). */
export async function savePad(info: PadInfo, type: string, bytes: ArrayBuffer): Promise<void> {
  await tx(['info', 'audio'], 'readwrite', (t) => {
    t.objectStore('audio').put({ slot: info.slot, type, bytes } satisfies PadAudio);
    // o tamanho vai junto: ao abrir um projeto, som igual ao guardado não é gravado de novo
    t.objectStore('info').put({ ...info, size: bytes.byteLength } satisfies StoredInfo);
  });
}

/** Muda só as informações (nome, cor, volume, loop), mantendo o tamanho do arquivo guardado. */
export async function savePadInfo(info: PadInfo): Promise<void> {
  await tx(['info'], 'readwrite', (t) => {
    const store = t.objectStore('info');
    const req = store.get(info.slot);
    req.onsuccess = () => {
      const size = (req.result as StoredInfo | undefined)?.size;
      store.put(size !== undefined ? { ...info, size } satisfies StoredInfo : info);
    };
  });
}

export async function deletePad(slot: number): Promise<void> {
  await tx(['info', 'audio'], 'readwrite', (t) => {
    t.objectStore('info').delete(slot);
    t.objectStore('audio').delete(slot);
  });
}

/** Apaga todos os pads guardados (ao abrir um projeto que tem os pads dele). */
export async function clearPads(): Promise<void> {
  await tx(['info', 'audio'], 'readwrite', (t) => {
    t.objectStore('info').clear();
    t.objectStore('audio').clear();
  });
}
