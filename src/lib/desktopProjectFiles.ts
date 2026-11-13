// Projeto .vss no app do Mac: abrir e salvar pelo caminho do arquivo (desktop/projectFiles.js).
// No navegador nada disso existe e o programa continua usando a API de arquivos do navegador.

export interface DesktopProjectInfo {
  size: number;
  mtimeMs: number;
  manifestStart: number | null;
  manifestLen: number | null;
}

interface DesktopProjectApi {
  projectPickOpen: () => Promise<{ name: string; path: string } | null>;
  projectPickSave: (suggestedName: string) => Promise<{ name: string; path: string } | null>;
  projectInfo: (filePath: string) => Promise<DesktopProjectInfo>;
  /** Acha no disco o projeto aberto pela janela do navegador (apps a partir desta versão). */
  projectLocate?: (name: string, size: number, lastModified: number) => Promise<string | null>;
  projectWriteTail: (filePath: string, opts: { expectedSize: number; expectedManifestStart: number; manifest: ArrayBuffer }) =>
    Promise<{ ok: true; size: number; mtimeMs: number; manifestStart: number } | { ok: false; reason: string }>;
  projectWriteOpen: (filePath: string) => Promise<string>;
  projectWriteData: (id: string, data: ArrayBuffer) => Promise<number>;
  projectWriteCopy: (id: string, srcPath: string, begin: number, size: number) => Promise<number>;
  projectWriteClose: (id: string) => Promise<{ size: number; mtimeMs: number }>;
  projectWriteAbort: (id: string) => Promise<void>;
  projectGiveFile: (filePath: string, selector: string) => Promise<boolean>;
  /** Salvar só o que mudou (apps a partir desta versão; os antigos não têm). */
  projectAppendOpen?: (filePath: string, opts: { expectedSize: number; expectedManifestStart: number }) =>
    Promise<{ ok: true; id: string; start: number } | { ok: false; reason: string }>;
  projectAppendData?: (id: string, data: ArrayBuffer) => Promise<number>;
  projectAppendCopy?: (id: string, srcPath: string, begin: number, size: number) => Promise<number>;
  projectAppendClose?: (id: string, manifest: ArrayBuffer) => Promise<{ size: number; mtimeMs: number; manifestStart: number }>;
  projectAppendAbort?: (id: string) => Promise<void>;
}

export function desktopProjects(): DesktopProjectApi | null {
  const d = (window as unknown as { vsDesktop?: Partial<DesktopProjectApi> }).vsDesktop;
  return d && typeof d.projectGiveFile === 'function' && typeof d.projectWriteTail === 'function' ? d as DesktopProjectApi : null;
}

// Caminho de onde veio cada arquivo entregue pelo app: os áudios abertos são pedaços dele.
const filePaths = new WeakMap<File, string>();

export function desktopFilePath(file: File): string | null {
  const known = filePaths.get(file);
  if (known) return known;
  // aberto pela janela do navegador: o app ainda sabe onde ele está no disco
  const p = (window as unknown as { vsDesktop?: { pathForFile?: (f: File) => string } }).vsDesktop?.pathForFile?.(file);
  if (p && /\.(vss|vsc)$/i.test(p)) {
    filePaths.set(file, p);
    return p;
  }
  return null;
}

/**
 * Caminho no disco de um projeto aberto pela janela do navegador. Ela só dá nome, tamanho e data:
 * o app procura o arquivo com os três iguais (null se não achar ou se houver dúvida).
 */
export async function locateDesktopPath(file: File): Promise<string | null> {
  const known = desktopFilePath(file);
  if (known) return known;
  const api = desktopProjects();
  if (!api?.projectLocate || !/\.(vss|vsc)$/i.test(file.name)) return null;
  const found = await api.projectLocate(file.name, file.size, file.lastModified).catch(() => null);
  return typeof found === 'string' && found ? found : null;
}

/** O arquivo do disco, lido em pedaços direto de lá (nada é copiado para a memória). */
export async function desktopFile(filePath: string): Promise<File> {
  const api = desktopProjects();
  if (!api) throw new Error('Abra o projeto pelo app do VS Stage para Mac.');
  const input = document.createElement('input');
  input.type = 'file';
  input.id = `vs-project-file-${Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, '') || 'x'}`;
  input.style.display = 'none';
  document.body.appendChild(input);
  try {
    await api.projectGiveFile(filePath, `#${input.id}`);
    const file = input.files?.[0];
    if (!file) throw new Error('Não foi possível ler o arquivo do projeto.');
    filePaths.set(file, filePath);
    return file;
  } finally {
    input.remove();
  }
}

/** O pedaço lido ainda é do arquivo como ele está no disco agora (mesmo tamanho e data). */
export function sameFileVersion(file: File, info: { size: number; mtimeMs: number }): boolean {
  return file.size === info.size && Math.abs(file.lastModified - info.mtimeMs) < 1;
}
