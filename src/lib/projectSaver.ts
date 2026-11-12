import { encodeWavInt16 } from '@/lib/wavEncoder';
import { ensureSongLoaded, getClipAudio, getClipSource, registerClipSource } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';
import type { AudioClip, ProjectState, Track } from '@/types';
import { projectPlaylist, syncedShows } from '@/lib/shows';
import { withoutLoops } from '@/lib/regions';
import { keptAssetIndex, packageTrailer, readPackageTail, VSC_MAGIC, writePackageTail, type KeptAsset, type PackageAsset, type PackageTail } from '@/lib/vssPackage';
import { desktopFile, desktopFilePath, desktopProjects, sameFileVersion } from '@/lib/desktopProjectFiles';

type ProgressFn = (msg: string) => void;

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Operação cancelada', 'AbortError');
}


export type SavedManifest = {
  version: number;
  projectName: string;
  /** Placa de som desejada: ao abrir, o programa volta para ela e reaplica o roteamento abaixo. */
  audioInterface?: string;
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
  masterAntiClip?: boolean;
  levelMatch?: boolean;
  /** Alvo em LUFS do "volume igual" escolhido pelo usuário. */
  levelMatchDb?: number;
  /** LR mágico ligado e os pans de antes dele (para o botão poder voltar depois de reabrir). */
  magicRoutingActive?: boolean;
  prevOutputChannels?: Record<string, number> | null;
  songLoudness?: Record<string, import('@/types').SongLoudness>;
  songKeys?: Record<string, { key: string; sig: string }>;
  dawMode?: boolean;
  lyricMaps?: ProjectState['lyricMaps'];
  lyricStyle?: ProjectState['lyricStyle'];
  musicianBook?: ProjectState['musicianBook'];
  assets?: Array<{ clipId: string; path: string; offset: number; size: number }>;
};

export type SaveTarget =
  | { kind: 'package'; handle: FileSystemFileHandle }
  | { kind: 'folder'; dir: FileSystemDirectoryHandle; name: string }
  /** App do Mac: .vss pelo caminho no disco (salvar só a letra troca só o fim do arquivo). */
  | { kind: 'path'; path: string; name: string };

export interface LoadedProject {
  manifest: SavedManifest;
  sources: Map<string, Blob>;
  target?: SaveTarget;
}

// .vss (antigo .vsc): [magic][áudios...][manifest][f64 manifestOffset][u32 manifestLen][magic]
// (detalhes em vssPackage.ts). Áudio 100% de estúdio original sem nenhuma perda de qualidade.
const VSS_EXT = '.vss';
const VSC_EXT = '.vsc';

// Cada áudio aberto de um .vss é um pedaço do próprio arquivo. Guardar de onde veio cada pedaço
// permite salvar de novo trocando só o fim do arquivo quando nenhum áudio mudou.
const packageSlices = new WeakMap<Blob, { file: File; begin: number; size: number }>();

// O que foi gravado por último, para o ⌘S sem mudança nenhuma não gravar nada. `version` diz qual
// arquivo e em que estado ele ficou (se mudar no disco, grava de novo).
let lastSaved: { version: string; json: string } | null = null;

function sanitize(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Sem Nome';
}

// Salvar de novo sem ter mudado o áudio não deve recodificar o WAV outra vez: o clipe que não
// mudou usa o mesmo blob já codificado da vez anterior. A chave inclui a referência do buffer em
// memória (troca sozinha se o áudio for substituído) e o chip de indexador (length), então um
// áudio realmente diferente nunca reaproveita o blob de outro.
const wavEncodeCache = new Map<string, { audio: ClipAudio; blob: Blob }>();

function encodeWavCached(clipId: string, audio: ClipAudio): Blob {
  const cached = wavEncodeCache.get(clipId);
  if (cached && cached.audio === audio) return cached.blob;
  const blob = new Blob([encodeWavInt16(audio)], { type: 'audio/wav' });
  wavEncodeCache.set(clipId, { audio, blob });
  return blob;
}

export function buildManifestBase(state: ProjectState): SavedManifest {
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
    masterAntiClip: state.masterAntiClip ?? false,
    levelMatch: state.levelMatch ?? false,
    levelMatchDb: state.levelMatchDb,
    magicRoutingActive: (state as ProjectState & { magicRoutingActive?: boolean }).magicRoutingActive ?? false,
    prevOutputChannels: (state as ProjectState & { prevOutputChannels?: Record<string, number> | null }).prevOutputChannels ?? null,
    songLoudness: state.songLoudness ?? {},
    songKeys: state.songKeys ?? {},
    dawMode: state.dawMode,
    audioInterface: state.audioInterface,
    lyricMaps: state.lyricMaps,
    lyricStyle: state.lyricStyle ?? null,
    musicianBook: state.musicianBook ?? null,
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
  signal?: AbortSignal,
): Promise<AssetPlan[]> {
  const plan = planAssets(state);
  const all = plan.flatMap((p) => p.assets);
  const total = Math.max(1, all.length);
  // Conta arquivos (cada faixa de cada música), não músicas: antes a tela dizia "1 de 225" com
  // 14 músicas no projeto, e parecia que o programa via músicas que não existem.
  const songNames = new Map(state.songs.map((sg) => [sg.id, sg.name]));
  const trackNames = new Map(state.tracks.map((t) => [t.id, t.name]));
  const songOrder = new Map(plan.filter((p) => p.assets.length > 0).map((p, i) => [p.songId, i + 1]));
  const songsWithAudio = plan.filter((p) => p.assets.length > 0).length;
  let done = 0;

  for (const a of all) {
    checkCancelled(signal);
    done++;
    const song = songNames.get(a.clip.songId) ?? 'Música';
    const track = trackNames.get(a.clip.trackId) ?? 'Faixa';
    onProgress(`Salvando os áudios: ${done} de ${total} arquivos · música ${songOrder.get(a.clip.songId) ?? 1} de ${Math.max(1, songsWithAudio)} · ${song}, ${track}`);
    let data: Blob | null = getClipSource(a.clip.id);
    // Testa se o source original é acessível; se o arquivo foi movido ou o descritor expirou,
    // reconstrói a partir do buffer de áudio em memória com fallback automático.
    if (data) {
      try {
        await data.slice(0, 16).arrayBuffer();
      } catch {
        data = null;
      }
    }
    if (!data) {
      let audio = getClipAudio(a.clip.id);
      if (!audio) {
        await ensureSongLoaded(a.clip.songId).catch(() => {});
        audio = getClipAudio(a.clip.id);
      }
      if (audio) {
        try {
          data = encodeWavCached(a.clip.id, audio);
        } catch { /* ignore: salva sem este áudio e avisa no resumo */ }
      }
    }
    checkCancelled(signal);
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
  'Salvar em pasta precisa do VS Stage aberto em uma janela própria do Chrome, Edge, Arc ou Brave. Enquanto isso, use "Arquivo único .vss".';
const PICKER_BLOCKED = 'O navegador bloqueou a janela de escolha. Abra o VS Stage em uma janela própria e tente de novo.';

export function isFolderSaveSupported(): boolean {
  return typeof fsWin().showDirectoryPicker === 'function' && !inSubFrame();
}

export function canChooseSaveLocation(): boolean {
  return typeof fsWin().showSaveFilePicker === 'function' && !inSubFrame();
}

function stripProjectExt(name: string): string {
  return name.replace(/\.(vss|vsc)$/i, '');
}

export function vssFileName(name: string): string {
  return `${sanitize(stripProjectExt(name))}${VSS_EXT}`;
}
export const vscFileName = vssFileName; // compatibilidade com código existente

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

async function writeFile(dir: FileSystemDirectoryHandle, name: string, data: Blob, signal?: AbortSignal) {
  const fh = await dir.getFileHandle(name, { create: true });
  const ws = await fh.createWritable();
  try {
    checkCancelled(signal);
    await ws.write(data);
    checkCancelled(signal);
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

async function writeProjectFolder(projDir: FileSystemDirectoryHandle, projName: string, state: ProjectState, onProgress: ProgressFn, signal?: AbortSignal) {
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
    await writeFile(dir, fileName, data, signal);
  }, signal);

  const manifest = buildManifestBase(state);
  manifest.projectName = projName;
  withAssetPaths(manifest, assets);

  checkCancelled(signal);
  onProgress('Gravando arquivo do projeto...');
  await writeFile(projDir, `${projName}.vsproj`, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), signal);
}

export async function saveProjectAsFolder(state: ProjectState, projectName: string, onProgress: ProgressFn, signal?: AbortSignal, requireNew = false): Promise<SaveTarget> {
  const picker = fsWin().showDirectoryPicker;
  if (!picker || inSubFrame()) throw new Error(FOLDER_SAVE_UNAVAILABLE);
  let parentDir: DirHandle;
  try {
    parentDir = await picker({ mode: 'readwrite', id: 'vs-save' });
  } catch (err) {
    if (isSecurityError(err)) throw new Error(FOLDER_SAVE_UNAVAILABLE);
    throw err;
  }
  checkCancelled(signal);
  const projName = sanitize(projectName);
  if (requireNew) {
    try {
      await parentDir.getDirectoryHandle(projName);
      throw new Error(`Já existe uma pasta chamada "${projName}". Escolha outro local para não sobrescrever arquivos.`);
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') throw err;
    }
  }
  const projDir = await parentDir.getDirectoryHandle(projName, { create: true });
  await writeProjectFolder(projDir, projName, state, onProgress, signal);
  return { kind: 'folder', dir: projDir, name: projName };
}

type Chunk = Blob | ArrayBuffer;

async function writePackage(
  state: ProjectState,
  projectName: string,
  onProgress: ProgressFn,
  write: (chunk: Chunk) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ missingCount: number; json: string }> {
  checkCancelled(signal);
  const enc = new TextEncoder();
  const magic = enc.encode(VSC_MAGIC);
  await write(magic.buffer as ArrayBuffer);

  const index: NonNullable<SavedManifest['assets']> = [];
  let offset = 0;
  let missingCount = 0;
  const assets = await forEachAsset(state, onProgress, async (a, data) => {
    const size = data?.size ?? 0;
    if (!data || size === 0) {
      missingCount++;
    }
    index.push({ clipId: a.clip.id, path: a.relPath, offset, size });
    if (data) await write(data);
    offset += size;
  }, signal);

  const manifest = buildManifestBase(state);
  manifest.projectName = projectName;
  withAssetPaths(manifest, assets);
  manifest.assets = index;

  checkCancelled(signal);
  onProgress('Gravando pacote...');
  const json = JSON.stringify(manifest);
  const manifestBytes = enc.encode(json);
  await write(manifestBytes.buffer as ArrayBuffer);

  await write(packageTrailer(magic.byteLength + offset, manifestBytes.byteLength));

  return { missingCount, json };
}

async function writePackageToHandle(state: ProjectState, handle: FileSystemFileHandle, onProgress: ProgressFn, signal?: AbortSignal): Promise<{ missingCount: number; json: string }> {
  const ws = await handle.createWritable();
  try {
    const res = await writePackage(state, stripProjectExt(handle.name), onProgress, (chunk) => ws.write(chunk), signal);
    checkCancelled(signal);
    await ws.close();
    return res;
  } catch (err) {
    await ws.abort().catch(() => undefined);
    throw err;
  }
}

// Os áudios abertos de um .vsc apontam para o arquivo antigo; depois de regravá-lo, passam a apontar para o novo.
async function rebindPackageSources(state: ProjectState, handle: FileSystemFileHandle) {
  try {
    const file = await handle.getFile();
    const { sources } = await readPackage(file, () => undefined);
    for (const c of state.clips) {
      const src = sources.get(c.id);
      if (src) registerClipSource(c.id, c.songId, src);
    }
  } catch (err) {
    // Não-crítico: se o handle ainda estiver temporariamente bloqueado pelo OS após o close(),
    // o arquivo já foi gravado no disco com sucesso absoluto.
    console.warn('[projectSaver] rebind pós-salvamento ignorado:', err);
  }
}

/** Devolve onde o projeto ficou salvo, ou null quando o navegador só permitiu baixar o arquivo. */
export async function saveProjectAsPackage(state: ProjectState, fileName: string, onProgress: ProgressFn, signal?: AbortSignal, rebind = true): Promise<{ target: SaveTarget | null; missingCount: number }> {
  const name = vssFileName(fileName);
  const desktop = desktopProjects();
  if (desktop) {
    const picked = await desktop.projectPickSave(name);
    if (!picked) throw new DOMException('Cancelado', 'AbortError');
    checkCancelled(signal);
    const currentTarget = (state as ProjectState & { saveTarget?: SaveTarget | null }).saveTarget;
    if (!rebind && currentTarget?.kind === 'path' && currentTarget.path === picked.path) {
      throw new Error('Escolha outro arquivo para preservar o projeto original.');
    }
    const { missingCount } = await writePackageToPath(state, picked.path, stripProjectExt(picked.name), onProgress, signal);
    if (rebind) await rebindDesktopSources(state, picked.path);
    return { target: { kind: 'path', path: picked.path, name: picked.name }, missingCount };
  }
  const picker = fsWin().showSaveFilePicker;
  if (picker && !inSubFrame()) {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = await picker({
        suggestedName: name,
        types: [{ description: 'Projeto VS Stage (.vss)', accept: { 'application/octet-stream': [VSS_EXT, VSC_EXT] } }],
      });
    } catch (err) {
      if (!isSecurityError(err)) throw err;
    }
    if (handle) {
      checkCancelled(signal);
      const currentTarget = (state as ProjectState & { saveTarget?: SaveTarget | null }).saveTarget;
      if (!rebind && currentTarget?.kind === 'package' && await handle.isSameEntry(currentTarget.handle)) {
        throw new Error('Escolha outro arquivo para preservar o projeto original.');
      }
      const { missingCount } = await writePackageToHandle(state, handle, onProgress, signal);
      if (rebind) await rebindPackageSources(state, handle);
      return { target: { kind: 'package', handle }, missingCount };
    }
  }

  const parts: Chunk[] = [];
  const { missingCount } = await writePackage(state, stripProjectExt(name), onProgress, async (chunk) => { parts.push(chunk); }, signal);
  checkCancelled(signal);
  downloadBlob(new Blob(parts, { type: 'application/octet-stream' }), name);
  return { target: null, missingCount };
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

/** Os áudios do projeto, cada um já dentro do arquivo; null se algum é novo ou veio de outro lugar. */
function keptAssets(state: ProjectState, fromThisFile: (file: File) => boolean): { assets: AssetPlan[]; kept: KeptAsset[] } | null {
  const assets = planAssets(state).flatMap((p) => p.assets);
  const kept: KeptAsset[] = [];
  for (const a of assets) {
    const src = getClipSource(a.clip.id);
    const from = src ? packageSlices.get(src) : undefined;
    // o pedaço precisa ser deste mesmo arquivo, do jeito que ele está no disco agora
    if (!from || !fromThisFile(from.file)) return null;
    kept.push({ clipId: a.clip.id, path: a.relPath, begin: from.begin, size: from.size });
  }
  return { assets, kept };
}

function tailManifestJson(state: ProjectState, projectName: string, assets: AssetPlan[], index: PackageAsset[]): string {
  const manifest = buildManifestBase(state);
  manifest.projectName = projectName;
  withAssetPaths(manifest, assets);
  manifest.assets = index;
  return JSON.stringify(manifest);
}

type TailResult = 'written' | 'unchanged' | false;
const TAIL_PROGRESS = 'Gravando o projeto (os áudios já estão no arquivo)...';

/**
 * Salvar de novo sem ter mudado nenhum áudio (só letras, mixagem, ordem): troca só o fim do .vss.
 * Devolve false quando algum áudio é novo ou veio de outro arquivo; aí o .vss é regravado inteiro.
 * No navegador, a API de arquivos ainda copia o arquivo inteiro por baixo; no app do Mac, não.
 */
async function writeTailToHandle(state: ProjectState, handle: FileSystemFileHandle, onProgress: ProgressFn, signal?: AbortSignal): Promise<TailResult> {
  const file = await handle.getFile();
  const tail = await readPackageTail(file);
  if (!tail) return false;
  const plan = keptAssets(state, (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
  const index = plan && keptAssetIndex(plan.kept, tail);
  if (!plan || !index) return false;
  const json = tailManifestJson(state, stripProjectExt(handle.name), plan.assets, index);
  if (lastSaved?.version === handleVersion(file) && lastSaved.json === json) return 'unchanged';

  checkCancelled(signal);
  onProgress(TAIL_PROGRESS);
  const ws = await handle.createWritable({ keepExistingData: true });
  try {
    await writePackageTail({
      write: (params) => ws.write(params),
      truncate: (size) => ws.truncate(size),
    }, tail.manifestStart, json);
    checkCancelled(signal);
    await ws.close();
  } catch (err) {
    await ws.abort().catch(() => undefined);
    throw err;
  }
  lastSaved = { version: handleVersion(await handle.getFile()), json };
  return 'written';
}

function handleVersion(file: File): string {
  return `arquivo|${file.name}|${file.size}|${file.lastModified}`;
}

function pathVersion(filePath: string, info: { size: number; mtimeMs: number }): string {
  return `caminho|${filePath}|${info.size}|${info.mtimeMs}`;
}

/** App do Mac: troca o fim do .vss no próprio arquivo, sem copiar nada. */
async function writeTailToPath(state: ProjectState, target: { path: string; name: string }, onProgress: ProgressFn, signal?: AbortSignal): Promise<TailResult> {
  const api = desktopProjects();
  if (!api) return false;
  const info = await api.projectInfo(target.path);
  if (info.manifestStart == null || info.manifestLen == null) return false;
  const tail: PackageTail = { manifestStart: info.manifestStart, manifestLen: info.manifestLen };
  const plan = keptAssets(state, (f) => desktopFilePath(f) === target.path && sameFileVersion(f, info));
  const index = plan && keptAssetIndex(plan.kept, tail);
  if (!plan || !index) return false;
  const json = tailManifestJson(state, stripProjectExt(target.name), plan.assets, index);
  if (lastSaved?.version === pathVersion(target.path, info) && lastSaved.json === json) return 'unchanged';

  checkCancelled(signal);
  onProgress(TAIL_PROGRESS);
  const bytes = new TextEncoder().encode(json);
  const res = await api.projectWriteTail(target.path, {
    expectedSize: info.size,
    expectedManifestStart: tail.manifestStart,
    manifest: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  if (!res.ok) return false;
  lastSaved = { version: pathVersion(target.path, res), json };
  return 'written';
}

const IPC_PIECE = 8 * 1024 * 1024;

/** App do Mac: grava o .vss inteiro num arquivo escondido ao lado e troca no fim. */
async function writePackageToPath(state: ProjectState, filePath: string, projectName: string, onProgress: ProgressFn, signal?: AbortSignal): Promise<{ missingCount: number }> {
  const api = desktopProjects();
  if (!api) throw new Error('Salve o projeto pelo app do VS Stage para Mac.');
  const id = await api.projectWriteOpen(filePath);
  const sameVersion = new Map<string, boolean>();
  try {
    const res = await writePackage(state, projectName, onProgress, async (chunk) => {
      if (chunk instanceof Blob) {
        // áudio que já está num .vss do disco: o app copia de lá direto, sem passar pela tela
        const from = packageSlices.get(chunk);
        const src = from ? desktopFilePath(from.file) : null;
        if (from && src) {
          const key = `${src}|${from.file.size}|${from.file.lastModified}`;
          let ok = sameVersion.get(key);
          if (ok === undefined) {
            const info = await api.projectInfo(src).catch(() => null);
            ok = !!info && sameFileVersion(from.file, info);
            sameVersion.set(key, ok);
          }
          if (ok) {
            await api.projectWriteCopy(id, src, from.begin, from.size);
            return;
          }
        }
        for (let at = 0; at < chunk.size; at += IPC_PIECE) {
          checkCancelled(signal);
          await api.projectWriteData(id, await chunk.slice(at, at + IPC_PIECE).arrayBuffer());
        }
        return;
      }
      await api.projectWriteData(id, chunk);
    }, signal);
    checkCancelled(signal);
    const closed = await api.projectWriteClose(id);
    lastSaved = { version: pathVersion(filePath, closed), json: res.json };
    return { missingCount: res.missingCount };
  } catch (err) {
    await api.projectWriteAbort(id).catch(() => undefined);
    throw err;
  }
}

async function readDesktopPackage(filePath: string, onProgress: ProgressFn): Promise<LoadedProject> {
  let file: File;
  try {
    file = await desktopFile(filePath);
  } catch {
    throw new Error('Este projeto foi movido, renomeado ou apagado. Use "Abrir Projeto..." para localizá-lo.');
  }
  return readPackage(file, onProgress);
}

// Depois de gravar, os pedaços antigos do arquivo não leem mais: passam a apontar para o arquivo novo.
async function rebindDesktopSources(state: ProjectState, filePath: string) {
  try {
    const { sources } = await readDesktopPackage(filePath, () => undefined);
    for (const c of state.clips) {
      const src = sources.get(c.id);
      if (src) registerClipSource(c.id, c.songId, src);
    }
  } catch (err) {
    console.warn('[projectSaver] rebind pós-salvamento ignorado:', err);
  }
}

export async function quickSave(state: ProjectState, target: SaveTarget, onProgress: ProgressFn, signal?: AbortSignal): Promise<{ missingCount: number; unchanged?: boolean }> {
  if (target.kind === 'path') {
    const tail = await writeTailToPath(state, target, onProgress, signal);
    if (tail === 'unchanged') return { missingCount: 0, unchanged: true };
    if (tail === 'written') {
      await rebindDesktopSources(state, target.path);
      return { missingCount: 0 };
    }
    const { missingCount } = await writePackageToPath(state, target.path, stripProjectExt(target.name), onProgress, signal);
    await rebindDesktopSources(state, target.path);
    return { missingCount };
  }
  if (target.kind === 'package') {
    await ensureWritable(target.handle);
    const tail = await writeTailToHandle(state, target.handle, onProgress, signal);
    if (tail === 'unchanged') return { missingCount: 0, unchanged: true };
    if (tail === 'written') {
      await rebindPackageSources(state, target.handle);
      return { missingCount: 0 };
    }
    const { missingCount, json } = await writePackageToHandle(state, target.handle, onProgress, signal);
    lastSaved = { version: handleVersion(await target.handle.getFile()), json };
    await rebindPackageSources(state, target.handle);
    return { missingCount };
  }
  await ensureWritable(target.dir);
  await writeProjectFolder(target.dir, target.name, state, onProgress, signal);
  return { missingCount: 0 };
}

async function pickProjectFile(): Promise<{ file: File; handle?: FileSystemFileHandle }> {
  const picker = fsWin().showOpenFilePicker;
  if (picker && !inSubFrame()) {
    try {
      const [handle] = await picker({
        types: [{ description: 'Projeto VS Stage (.vss / .vsc)', accept: { 'application/octet-stream': [VSS_EXT, VSC_EXT] } }],
      });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (isSecurityError(err)) throw new Error(PICKER_BLOCKED);
      throw err;
    }
  }
  const [file] = await pickWithInput((input) => { input.accept = `${VSS_EXT},${VSC_EXT}`; });
  return { file };
}

export async function openProjectFile(onProgress: ProgressFn): Promise<LoadedProject> {
  const desktop = desktopProjects();
  if (desktop) {
    const picked = await desktop.projectPickOpen();
    if (!picked) throw new DOMException('Cancelado', 'AbortError');
    if (!/\.(vss|vsc)$/i.test(picked.name)) throw new Error('Escolha um arquivo de projeto .vss ou .vsc.');
    const loaded = await readDesktopPackage(picked.path, onProgress);
    return { ...loaded, target: { kind: 'path', path: picked.path, name: picked.name } };
  }
  const { file, handle } = await pickProjectFile();
  const nameLower = file.name.toLowerCase();
  if (!nameLower.endsWith(VSS_EXT) && !nameLower.endsWith(VSC_EXT)) {
    throw new Error('Escolha um arquivo de projeto .vss ou .vsc.');
  }
  const loaded = await readPackage(file, onProgress);
  return handle ? { ...loaded, target: { kind: 'package', handle } } : loaded;
}
/** Projeto aberto pelo Finder (duplo clique no arquivo): lê do disco pelo app, sem carregar o arquivo todo. */
export async function openProjectFromPath(name: string, filePath: string, onProgress: ProgressFn): Promise<LoadedProject> {
  if (!/\.(vss|vsc)$/i.test(name)) throw new Error('Escolha um arquivo de projeto .vss ou .vsc.');
  if (desktopProjects()) {
    // lê os áudios em pedaços direto do disco e o ⌘S já grava neste mesmo arquivo
    const loaded = await readDesktopPackage(filePath, onProgress);
    return { ...loaded, target: { kind: 'path', path: filePath, name } };
  }
  const url = window.vsDesktop?.projectFileUrl?.(filePath);
  if (!url) throw new Error('Abra o projeto pelo app do VS Stage para Mac.');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Não foi possível ler o arquivo do projeto.');
  // O protocolo do app entrega os pedaços (Range) direto do disco: projetos acima de 2 GiB abrem igual.
  const blob = await res.blob();
  return readPackage(new File([blob], name), onProgress);
}

type ReadPermissionHandle = FileSystemHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>;
};

export async function reopenProject(target: SaveTarget, onProgress: ProgressFn): Promise<LoadedProject> {
  if (target.kind === 'path') {
    if (!desktopProjects()) throw new Error('Este projeto só abre pelo app do VS Stage para Mac.');
    return { ...(await readDesktopPackage(target.path, onProgress)), target };
  }
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
  const dataStart = VSC_MAGIC.length;
  const tail = await readPackageTail(file);
  if (!tail) throw new Error('Este arquivo de projeto (.vss) está incompleto ou corrompido.');
  const { manifestStart, manifestLen } = tail;

  onProgress('Lendo projeto...');
  const manifest = parseManifest(await file.slice(manifestStart, manifestStart + manifestLen).text());
  const sources = new Map<string, Blob>();
  for (const a of manifest.assets ?? []) {
    if (!a.size) continue;
    const begin = dataStart + a.offset;
    if (begin + a.size > manifestStart) continue;
    const slice = file.slice(begin, begin + a.size);
    packageSlices.set(slice, { file, begin, size: a.size });
    sources.set(a.clipId, slice);
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
