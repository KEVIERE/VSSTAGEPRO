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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('sem armazenamento local')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('info')) db.createObjectStore('info', { keyPath: 'slot' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'slot' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error ?? new Error('não deu para guardar')); };
  }));
}

export async function loadPadInfos(): Promise<PadInfo[]> {
  return (await tx<PadInfo[]>(['info'], 'readonly', (t) => t.objectStore('info').getAll())) ?? [];
}

export async function loadPadAudio(slot: number): Promise<PadAudio | null> {
  return (await tx<PadAudio>(['audio'], 'readonly', (t) => t.objectStore('audio').get(slot))) ?? null;
}

/** Guarda o som novo do pad (arquivo e informações juntos). */
export async function savePad(info: PadInfo, type: string, bytes: ArrayBuffer): Promise<void> {
  await tx(['info', 'audio'], 'readwrite', (t) => {
    t.objectStore('audio').put({ slot: info.slot, type, bytes } satisfies PadAudio);
    t.objectStore('info').put(info);
  });
}

/** Muda só as informações (nome, cor, volume, loop). */
export async function savePadInfo(info: PadInfo): Promise<void> {
  await tx(['info'], 'readwrite', (t) => { t.objectStore('info').put(info); });
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
