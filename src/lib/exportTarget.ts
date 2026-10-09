import { buildZip, triggerDownload } from '@/lib/zipWriter';

export class DiskFullError extends Error {
  constructor() {
    super('disk_full');
    this.name = 'DiskFullError';
  }
}

export interface ExportTarget {
  location: string;
  write: (rel: string, data: ArrayBuffer) => Promise<void>;
  freeSpace: () => Promise<number | null>;
  finish: () => Promise<void>;
  reveal: ((rel: string) => Promise<void>) | null;
}

type WriteResult = { ok: true } | { ok: false; code: string };
interface DesktopExport {
  exportPickFolder: (title: string) => Promise<{ id: string; path: string } | null>;
  exportPickFile: (name: string) => Promise<{ id: string; path: string; name: string } | null>;
  exportWrite: (id: string, rel: string, data: ArrayBuffer) => Promise<WriteResult>;
  exportFreeSpace: (id: string) => Promise<number | null>;
  exportReveal: (id: string, rel: string) => Promise<void>;
}

type FsPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (opts?: {
    suggestedName?: string;
    id?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};
const fsWin = (): FsPickerWindow => window as unknown as FsPickerWindow;

const isInIframe = (): boolean => {
  try { return window.self !== window.top; } catch { return true; }
};

function desktopExport(): DesktopExport | null {
  const d = (window as unknown as { vsDesktop?: Partial<DesktopExport> }).vsDesktop;
  return d && typeof d.exportPickFolder === 'function' ? (d as DesktopExport) : null;
}

// O Finder/Explorer só abre fora da pré-visualização e em navegadores com acesso a pastas (Chrome/Edge).
export const exportOpensFinder = (): boolean =>
  !!desktopExport() ||
  (typeof fsWin().showDirectoryPicker === 'function' && typeof fsWin().showSaveFilePicker === 'function' && !isInIframe());

const DESKTOP_ERRORS: Record<string, string> = {
  EACCES: 'O Mac não deu permissão para salvar nessa pasta. Escolha outra pasta e tente de novo.',
  EPERM: 'O Mac não deu permissão para salvar nessa pasta. Escolha outra pasta e tente de novo.',
  EROFS: 'Esse disco só permite leitura. Escolha outro disco ou pasta para salvar.',
  ENOENT: 'A pasta escolhida não foi encontrada. Se era um HD externo, confira se ele continua conectado.',
  EBUSY: 'O arquivo está aberto em outro programa. Feche-o e tente de novo.',
  ENAMETOOLONG: 'O nome do arquivo ficou longo demais. Encurte o nome da música ou da faixa.',
};

function isQuotaError(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : '';
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return name === 'QuotaExceededError' || msg.includes('quota') || msg.includes('no space') || msg.includes('enospc');
}

function pickerBlocked(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('cross origin') || msg.includes('cross-origin') || msg.includes('sub frame') || msg.includes('not allowed') || msg.includes('securityerror');
}

function isPickerCancel(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function desktopTarget(d: DesktopExport, id: string, path: string): ExportTarget {
  return {
    location: path,
    write: async (rel, data) => {
      const r = await d.exportWrite(id, rel, data);
      if (r.ok) return;
      if (r.code === 'disk_full') throw new DiskFullError();
      throw new Error(DESKTOP_ERRORS[r.code] ?? `Não foi possível salvar o arquivo no disco (código ${r.code}).`);
    },
    freeSpace: () => d.exportFreeSpace(id),
    finish: async () => {},
    reveal: (rel) => d.exportReveal(id, rel),
  };
}

async function writeHandle(fh: FileSystemFileHandle, data: ArrayBuffer, onFail: () => Promise<void>) {
  const ws = await fh.createWritable();
  try {
    await ws.write(data);
    await ws.close();
  } catch (err) {
    await ws.abort().catch(() => {});
    await onFail().catch(() => {});
    if (isQuotaError(err)) throw new DiskFullError();
    throw err;
  }
}

function folderTarget(root: FileSystemDirectoryHandle): ExportTarget {
  return {
    location: `pasta "${root.name}"`,
    write: async (rel, data) => {
      const parts = rel.split('/');
      const name = parts.pop()!;
      let dir = root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      await writeHandle(fh, data, () => dir.removeEntry(name));
    },
    freeSpace: async () => null,
    finish: async () => {},
    reveal: null,
  };
}

function downloadTarget(zipName: string): ExportTarget {
  const entries: Array<{ path: string; data: Uint8Array }> = [];
  return {
    location: 'pasta Downloads do navegador',
    write: async (rel, data) => { entries.push({ path: rel, data: new Uint8Array(data) }); },
    freeSpace: async () => null,
    finish: async () => {
      if (entries.length === 0) return;
      if (entries.length === 1 && !entries[0].path.includes('/')) {
        triggerDownload(new Blob([entries[0].data], { type: 'audio/wav' }), entries[0].path);
        return;
      }
      triggerDownload(buildZip(entries), zipName);
    },
    reveal: null,
  };
}

/** Abre o Finder para escolher a pasta. Devolve null se a pessoa cancelar. */
export async function openFolderTarget(title: string, zipName: string): Promise<ExportTarget | null> {
  const d = desktopExport();
  if (d) {
    const picked = await d.exportPickFolder(title);
    return picked ? desktopTarget(d, picked.id, picked.path) : null;
  }
  const picker = fsWin().showDirectoryPicker;
  if (picker && !isInIframe()) {
    try {
      return folderTarget(await picker({ mode: 'readwrite', id: 'vs-bounce' }));
    } catch (err) {
      if (isPickerCancel(err)) return null;
      if (!pickerBlocked(err)) throw err;
    }
  }
  return downloadTarget(zipName);
}

/** Abre o Finder para salvar um único WAV. `name` é o nome final escolhido. */
export async function openFileTarget(suggestedName: string): Promise<{ target: ExportTarget; name: string } | null> {
  const d = desktopExport();
  if (d) {
    const picked = await d.exportPickFile(suggestedName);
    return picked ? { target: desktopTarget(d, picked.id, picked.path), name: picked.name } : null;
  }
  const picker = fsWin().showSaveFilePicker;
  if (picker && !isInIframe()) {
    try {
      const fh = await picker({
        suggestedName,
        id: 'vs-bounce-lr',
        types: [{ description: 'Áudio WAV', accept: { 'audio/wav': ['.wav'] } }],
      });
      const target: ExportTarget = {
        location: `arquivo "${fh.name}"`,
        write: (_rel, data) => writeHandle(fh, data, async () => {}),
        freeSpace: async () => null,
        finish: async () => {},
        reveal: null,
      };
      return { target, name: fh.name };
    } catch (err) {
      if (isPickerCancel(err)) return null;
      if (!pickerBlocked(err)) throw err;
    }
  }
  return { target: downloadTarget(suggestedName), name: suggestedName };
}

export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${units[i]}`;
}
