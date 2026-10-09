import { encodeWavInt16 } from '@/lib/wavEncoder';
import { getClipAudio, getClipSource, registerClipSource } from '@/lib/audioLibrary';
import type { AudioClip, ProjectState, Track } from '@/types';
import { projectPlaylist, syncedShows } from '@/lib/shows';
import { withoutLoops } from '@/lib/regions';

type ProgressFn = (msg: string) => void;

export type SavedManifest = {
  version: number;
  projectName: string;
  tracks: Track[];
  clips: AudioClip[];
  songs: ProjectState['songs'];
  blocks: ProjectState['blocks'];
  playlist: ProjectState['playlist'];
  playlistOrder: string[];
  shows?: ProjectState['shows'];
  activeShowId?: string | null;
  timelineOrder: string[];
  mixerVisible: boolean;
  playlistVisible: boolean;
  playlistMaximized: boolean;
  timelineVisible: boolean;
  mixerHeight: number;
  zoomH: number;
  zoomV: number;
  lrMasterActive: boolean;
  audioInterface: string;
  lyricMaps?: ProjectState['lyricMaps'];
  assets?: Array<{ clipId: string; path: string; offset: number; size: number }>;
};

export type SaveTarget =
  | { kind: 'package'; handle: FileSystemFileHandle }
  | { kind: 'folder'; dir: FileSystemDirectoryHandle; name: string };

export interface LoadedProject {
  manifest: SavedManifest;
  sources: Map<string, Blob>;
  target?: SaveTarget;
}

// .vsc: [magic][áudios...][manifest][f64 manifestOffset][u32 manifestLen][magic]
// O índice fica no final para que o arquivo possa ser gravado só acrescentando dados.
const VSC_MAGIC = 'VSSTAGE1';
const VSC_EXT = '.vsc';
const TRAILER_SIZE = 20;

function sanitize(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Sem Nome';
}

function buildManifestBase(state: ProjectState): SavedManifest {
  return {
    version: 3,
    projectName: state.projectName,
    tracks: state.tracks,
    clips: state.clips.map((c) => ({ ...c })),
    songs: state.songs.map(withoutLoops),
    blocks: state.blocks,
    playlist: projectPlaylist(state),
    playlistOrder: projectPlaylist(state).map((p) => p.songId),
    shows: syncedShows(state),
    activeShowId: state.activeShowId,
    timelineOrder: state.timelineOrder,
    mixerVisible: state.mixerVisible,
    playlistVisible: state.playlistVisible,
    playlistMaximized: state.playlistMaximized,
    timelineVisible: state.timelineVisible,
    mixerHeight: state.mixerHeight,
    zoomH: state.zoomH,
    zoomV: state.zoomV,
    lrMasterActive: state.lrMasterActive,
    audioInterface: state.audioInterface,
    lyricMaps: state.lyricMaps,
  };
}

// O arquivo original vai como foi importado (um MP3 continua MP3); só o áudio sem arquivo vira WAV.
function assetExtension(clip: AudioClip): string {
  if (!getClipSource(clip.id)) return 'wav';
  const ext = clip.fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  return ext ? ext.toLowerCase() : 'wav';
}

interface AssetPlan {
  clip: AudioClip;
  relPath: string;
}

function planAssets(state: ProjectState): Array<{ songId: string; assets: AssetPlan[] }> {
  const trackName = new Map<string, string>();
  state.tracks.forEach((t) => trackName.set(t.id, t.name));
  return state.songs.map((song) => {
    const songClips = state.clips
      .filter((c) => c.songId === song.id)
      .sort((a, b) => a.startTime - b.startTime);
    const assets = songClips.map((clip, idx) => {
      const tName = sanitize(trackName.get(clip.trackId) ?? 'Faixa');
      const order = String(idx + 1).padStart(2, '0');
      return { clip, relPath: `Músicas/${sanitize(song.name)}/${order} - ${tName}.${assetExtension(clip)}` };
    });
    return { songId: song.id, assets };
  });
}

/** Entrega o arquivo de cada clipe direto do disco, um por vez, sem abrir o áudio na memória. */
async function forEachAsset(
  state: ProjectState,
  onProgress: ProgressFn,
  write: (asset: AssetPlan, data: Blob | null) => Promise<void>,
): Promise<AssetPlan[]> {
  const plan = planAssets(state);
  const all = plan.flatMap((p) => p.assets);
  const total = Math.max(1, all.length);
  let done = 0;

  for (const a of all) {
    done++;
    onProgress(`Salvando ${done} de ${total}: ${a.relPath}`);
    let data: Blob | null = getClipSource(a.clip.id);
    if (!data) {
      const audio = getClipAudio(a.clip.id);
      if (audio) data = new Blob([encodeWavInt16(audio)], { type: 'audio/wav' });
    }
    await write(a, data);
  }
  return all;
}

function withAssetPaths(manifest: SavedManifest, assets: AssetPlan[]) {
  const pathById = new Map(assets.map((a) => [a.clip.id, a.relPath]));
  manifest.clips = manifest.clips.map((c) => {
    const relPath = pathById.get(c.id);
    return relPath ? { ...c, filePath: relPath } : c;
  });
}

type DirHandle = FileSystemDirectoryHandle & {
  values: () => AsyncIterable<FileSystemHandle>;
};

type FsPickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirHandle>;
  showSaveFilePicker?: (opts?: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts?: {
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
};

function fsWin(): FsPickerWindow {
  return window as unknown as FsPickerWindow;
}

// Dentro de uma moldura (ex.: a prévia), o navegador bloqueia as janelas de escolher local.
function inSubFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isSecurityError(err: unknown): boolean {
  return (err as DOMException)?.name === 'SecurityError';
}

const FOLDER_SAVE_UNAVAILABLE =
  'Salvar em pasta precisa do VS Stage aberto em uma janela própria do Chrome, Edge, Arc ou Brave. Enquanto isso, use "Arquivo único .vsc".';
const PICKER_BLOCKED = 'O navegador bloqueou a janela de escolha. Abra o VS Stage em uma janela própria e tente de novo.';

export function isFolderSaveSupported(): boolean {
  return typeof fsWin().showDirectoryPicker === 'function' && !inSubFrame();
}

export function canChooseSaveLocation(): boolean {
  return typeof fsWin().showSaveFilePicker === 'function' && !inSubFrame();
}

function stripVsc(name: string): string {
  return name.replace(/\.vsc$/i, '');
}

export function vscFileName(name: string): string {
  return `${sanitize(stripVsc(name))}${VSC_EXT}`;
}

function parseManifest(text: string): SavedManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O arquivo do projeto está corrompido ou não é um projeto do VS Stage.');
  }
  const m = data as Partial<SavedManifest> | null;
  if (!m || typeof m !== 'object' || !Array.isArray(m.tracks) || !Array.isArray(m.clips) || !Array.isArray(m.songs)) {
    throw new Error('O arquivo escolhido não é um projeto válido do VS Stage.');
  }
  return m as SavedManifest;
}

function pickWithInput(configure: (input: HTMLInputElement) => void): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.display = 'none';
    configure(input);
    document.body.appendChild(input);
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      if (files.length) resolve(files);
      else reject(new DOMException('Cancelado', 'AbortError'));
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const ws = await fh.createWritable();
  try {
    await ws.write(data);
    await ws.close();
  } catch (err) {
    await ws.abort().catch(() => undefined);
    throw err;
  }
}

async function isSameFile(dir: FileSystemDirectoryHandle, name: string, src: Blob | null): Promise<boolean> {
  if (!(src instanceof File)) return false;
  try {
    const existing = await (await dir.getFileHandle(name)).getFile();
    return existing.size === src.size && existing.lastModified === src.lastModified;
  } catch {
    return false;
  }
}

async function writeProjectFolder(projDir: FileSystemDirectoryHandle, projName: string, state: ProjectState, onProgress: ProgressFn) {
  const assets = await forEachAsset(state, onProgress, async (a, data) => {
    if (!data) return;
    const parts = a.relPath.split('/');
    let dir: FileSystemDirectoryHandle = projDir;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileName = parts[parts.length - 1];
    // o áudio que já está nessa pasta não é regravado: mais rápido e não invalida o arquivo em uso
    if (await isSameFile(dir, fileName, getClipSource(a.clip.id))) return;
    await writeFile(dir, fileName, data);
  });

  const manifest = buildManifestBase(state);
  manifest.projectName = projName;
  withAssetPaths(manifest, assets);

  onProgress('Gravando arquivo do projeto...');
  await writeFile(projDir, `${projName}.vsproj`, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
}

export async function saveProjectAsFolder(state: ProjectState, projectName: string, onProgress: ProgressFn): Promise<SaveTarget> {
  const picker = fsWin().showDirectoryPicker;
  if (!picker || inSubFrame()) throw new Error(FOLDER_SAVE_UNAVAILABLE);
  let parentDir: DirHandle;
  try {
    parentDir = await picker({ mode: 'readwrite', id: 'vs-save' });
  } catch (err) {
    if (isSecurityError(err)) throw new Error(FOLDER_SAVE_UNAVAILABLE);
    throw err;
  }
  const projName = sanitize(projectName);
  const projDir = await parentDir.getDirectoryHandle(projName, { create: true });
  await writeProjectFolder(projDir, projName, state, onProgress);
  return { kind: 'folder', dir: projDir, name: projName };
}

type Chunk = Blob | ArrayBuffer;

async function writePackage(
  state: ProjectState,
  projectName: string,
  onProgress: ProgressFn,
  write: (chunk: Chunk) => Promise<void>,
): Promise<void> {
  const enc = new TextEncoder();
  const magic = enc.encode(VSC_MAGIC);
  await write(magic.buffer as ArrayBuffer);

  const index: NonNullable<SavedManifest['assets']> = [];
  let offset = 0;
  const assets = await forEachAsset(state, onProgress, async (a, data) => {
    const size = data?.size ?? 0;
    index.push({ clipId: a.clip.id, path: a.relPath, offset, size });
    if (data) await write(data);
    offset += size;
  });

  const manifest = buildManifestBase(state);
  manifest.projectName = projectName;
  withAssetPaths(manifest, assets);
  manifest.assets = index;

  onProgress('Gravando pacote...');
  const manifestBytes = enc.encode(JSON.stringify(manifest));
  await write(manifestBytes.buffer as ArrayBuffer);

  const trailer = new ArrayBuffer(TRAILER_SIZE);
  const dv = new DataView(trailer);
  dv.setFloat64(0, magic.byteLength + offset, true);
  dv.setUint32(8, manifestBytes.byteLength, true);
  for (let i = 0; i < 8; i++) dv.setUint8(12 + i, VSC_MAGIC.charCodeAt(i));
  await write(trailer);
}

async function writePackageToHandle(state: ProjectState, handle: FileSystemFileHandle, onProgress: ProgressFn) {
  const ws = await handle.createWritable();
  try {
    await writePackage(state, stripVsc(handle.name), onProgress, (chunk) => ws.write(chunk));
    await ws.close();
  } catch (err) {
    await ws.abort().catch(() => undefined);
    throw err;
  }
}

// Os áudios abertos de um .vsc apontam para o arquivo antigo; depois de regravá-lo, passam a apontar para o novo.
async function rebindPackageSources(state: ProjectState, handle: FileSystemFileHandle) {
  const { sources } = await readPackage(await handle.getFile(), () => undefined);
  for (const c of state.clips) {
    const src = sources.get(c.id);
    if (src) registerClipSource(c.id, c.songId, src);
  }
}

/** Devolve onde o projeto ficou salvo, ou null quando o navegador só permitiu baixar o arquivo. */
export async function saveProjectAsPackage(state: ProjectState, fileName: string, onProgress: ProgressFn): Promise<SaveTarget | null> {
  const name = vscFileName(fileName);
  const picker = fsWin().showSaveFilePicker;
  if (picker && !inSubFrame()) {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await picker({
        suggestedName: name,
        types: [{ description: 'Projeto VS Stage', accept: { 'application/octet-stream': [VSC_EXT] } }],
      });
    } catch (err) {
      if (!isSecurityError(err)) throw err;
    }
    if (handle) {
      await writePackageToHandle(state, handle, onProgress);
      await rebindPackageSources(state, handle);
      return { kind: 'package', handle };
    }
  }

  const parts: Chunk[] = [];
  await writePackage(state, stripVsc(name), onProgress, async (chunk) => { parts.push(chunk); });
  downloadBlob(new Blob(parts, { type: 'application/octet-stream' }), name);
  return null;
}

type PermissionHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

async function ensureWritable(handle: FileSystemHandle) {
  const h = handle as PermissionHandle;
  if (!h.queryPermission || !h.requestPermission) return;
  if (await h.queryPermission({ mode: 'readwrite' }) === 'granted') return;
  if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('Sem permissão para gravar no arquivo do projeto. Use "Salvar Projeto..." para escolher outro local.');
  }
}

export function saveTargetLabel(target: SaveTarget): string {
  return target.kind === 'package' ? target.handle.name : target.name;
}

export async function quickSave(state: ProjectState, target: SaveTarget, onProgress: ProgressFn): Promise<void> {
  if (target.kind === 'package') {
    await ensureWritable(target.handle);
    await writePackageToHandle(state, target.handle, onProgress);
    await rebindPackageSources(state, target.handle);
  } else {
    await ensureWritable(target.dir);
    await writeProjectFolder(target.dir, target.name, state, onProgress);
  }
}

async function pickProjectFile(): Promise<{ file: File; handle?: FileSystemFileHandle }> {
  const picker = fsWin().showOpenFilePicker;
  if (picker && !inSubFrame()) {
    try {
      const [handle] = await picker({
        types: [{ description: 'Projeto VS Stage', accept: { 'application/octet-stream': [VSC_EXT] } }],
      });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (isSecurityError(err)) throw new Error(PICKER_BLOCKED);
      throw err;
    }
  }
  const [file] = await pickWithInput((input) => { input.accept = VSC_EXT; });
  return { file };
}

export async function openProjectFile(onProgress: ProgressFn): Promise<LoadedProject> {
  const { file, handle } = await pickProjectFile();
  if (!file.name.toLowerCase().endsWith(VSC_EXT)) {
    throw new Error('Escolha um arquivo de projeto .vsc.');
  }
  const loaded = await readPackage(file, onProgress);
  return handle ? { ...loaded, target: { kind: 'package', handle } } : loaded;
}

type ReadPermissionHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
};

export async function reopenProject(target: SaveTarget, onProgress: ProgressFn): Promise<LoadedProject> {
  const h = (target.kind === 'package' ? target.handle : target.dir) as ReadPermissionHandle;
  if (h.queryPermission && h.requestPermission && await h.queryPermission({ mode: 'read' }) !== 'granted'
    && await h.requestPermission({ mode: 'read' }) !== 'granted') {
    throw new Error('Sem permissão para abrir este projeto. Use "Abrir Projeto..." para escolher o arquivo.');
  }
  try {
    if (target.kind === 'package') {
      const loaded = await readPackage(await target.handle.getFile(), onProgress);
      return { ...loaded, target };
    }
    return await readProjectDir(target.dir as DirHandle, onProgress);
  } catch (err) {
    if ((err as DOMException)?.name === 'NotFoundError') {
      throw new Error('Este projeto foi movido, renomeado ou apagado. Use "Abrir Projeto..." para localizá-lo.');
    }
    throw err;
  }
}

async function readPackage(file: File, onProgress: ProgressFn): Promise<LoadedProject> {
  const invalid = () => new Error('Este arquivo .vsc está incompleto ou corrompido.');
  const dataStart = VSC_MAGIC.length;
  if (file.size < dataStart + TRAILER_SIZE) throw invalid();
  if (await file.slice(0, dataStart).text() !== VSC_MAGIC) throw invalid();

  const trailer = new DataView(await file.slice(file.size - TRAILER_SIZE).arrayBuffer());
  let tail = '';
  for (let i = 0; i < 8; i++) tail += String.fromCharCode(trailer.getUint8(12 + i));
  const manifestStart = trailer.getFloat64(0, true);
  const manifestLen = trailer.getUint32(8, true);
  if (tail !== VSC_MAGIC || !Number.isFinite(manifestStart) || manifestStart < dataStart
    || manifestStart + manifestLen > file.size - TRAILER_SIZE) {
    throw invalid();
  }

  onProgress('Lendo projeto...');
  const manifest = parseManifest(await file.slice(manifestStart, manifestStart + manifestLen).text());
  const sources = new Map<string, Blob>();
  for (const a of manifest.assets ?? []) {
    if (!a.size) continue;
    const begin = dataStart + a.offset;
    if (begin + a.size > manifestStart) continue;
    sources.set(a.clipId, file.slice(begin, begin + a.size));
  }
  onProgress(`Projeto aberto (${sources.size} áudios).`);
  return { manifest, sources };
}

const nfc = (s: string) => s.normalize('NFC');

async function findProjectDir(dir: DirHandle): Promise<{ dir: DirHandle; file: File } | null> {
  const subdirs: DirHandle[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.vsproj')) {
      return { dir, file: await (entry as FileSystemFileHandle).getFile() };
    }
    if (entry.kind === 'directory') subdirs.push(entry as DirHandle);
  }
  for (const sub of subdirs) {
    for await (const entry of sub.values()) {
      if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.vsproj')) {
        return { dir: sub, file: await (entry as FileSystemFileHandle).getFile() };
      }
    }
  }
  return null;
}

const NO_VSPROJ = 'Não encontrei o arquivo do projeto (.vsproj) dentro da pasta escolhida.';

async function readProjectDir(root: DirHandle, onProgress: ProgressFn): Promise<LoadedProject> {
  const found = await findProjectDir(root);
  if (!found) throw new Error(NO_VSPROJ);
  const manifest = parseManifest(await found.file.text());
  const sources = new Map<string, Blob>();
  const clips = manifest.clips;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    onProgress(`Localizando ${i + 1} de ${clips.length}`);
    if (!c.filePath) continue;
    const parts = String(c.filePath).split('/');
    try {
      let d: FileSystemDirectoryHandle = found.dir;
      for (let j = 0; j < parts.length - 1; j++) d = await d.getDirectoryHandle(parts[j]);
      const fh = await d.getFileHandle(parts[parts.length - 1]);
      sources.set(c.id, await fh.getFile());
    } catch (err) {
      console.warn('[projectSaver] falha ao localizar', c.filePath, err);
    }
  }
  onProgress(`Projeto carregado (${sources.size}/${clips.length} áudios).`);
  return { manifest, sources, target: { kind: 'folder', dir: found.dir, name: found.file.name.replace(/\.vsproj$/i, '') } };
}

async function readProjectFileList(files: File[], onProgress: ProgressFn): Promise<LoadedProject> {
  const relOf = (f: File) => nfc(f.webkitRelativePath || f.name);
  const projFile = files
    .filter((f) => f.name.toLowerCase().endsWith('.vsproj'))
    .sort((a, b) => relOf(a).split('/').length - relOf(b).split('/').length)[0];
  if (!projFile) throw new Error(NO_VSPROJ);
  const rel = relOf(projFile);
  const base = rel.slice(0, rel.lastIndexOf('/') + 1);
  const byPath = new Map(files.map((f) => [relOf(f), f]));

  const manifest = parseManifest(await projFile.text());
  const sources = new Map<string, Blob>();
  for (const c of manifest.clips) {
    if (!c.filePath) continue;
    const f = byPath.get(base + nfc(String(c.filePath)));
    if (f) sources.set(c.id, f);
  }
  onProgress(`Projeto carregado (${sources.size}/${manifest.clips.length} áudios).`);
  return { manifest, sources };
}

export async function openProjectFolder(onProgress: ProgressFn): Promise<LoadedProject> {
  const picker = fsWin().showDirectoryPicker;
  if (picker && !inSubFrame()) {
    let dir: DirHandle;
    try {
      dir = await picker({ mode: 'read', id: 'vs-open' });
    } catch (err) {
      if (isSecurityError(err)) throw new Error(PICKER_BLOCKED);
      throw err;
    }
    return readProjectDir(dir, onProgress);
  }
  const files = await pickWithInput((input) => { input.webkitdirectory = true; });
  return readProjectFileList(files, onProgress);
}
