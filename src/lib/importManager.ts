import { decodeFile, generateMarkers } from '@/lib/audioDecoder';
import { cleanClipName, routeByName, isUnreadableName } from '@/lib/nameRouter';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import { clipAudioToBuffer, clipPlayLength, ensureSongLoaded, getClipAudio, getClipSource, putClipAudio, registerClipSource, retainSongs, toClipAudioAsync } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';
import type { AudioClip, PlaylistEntry, RoutingTarget, Song, SongTempoSegment } from '@/types';
import { detectBpm, detectClickTempo, type TempoResult } from '@/lib/beatDetector';
import { parseWavMetadata } from '@/lib/reaperMetadata';
import { parseRpp, resolveMediaPath, splitShow, type ShowItem, type ShowSplit } from '@/lib/reaperProject';
import { REGION_COLORS, presetColor } from '@/lib/regions';
import { askImportAgain } from '@/lib/appPrompt';

const AUDIO_EXTENSIONS = /\.(wav|mp3|aac|ogg|flac|m4a|aif|aiff|wma|opus)$/i;
const DECODE_CONCURRENCY = 4;
const CLICKISH_NAME = /cli[cqk]|klick|metr[oô]|\bclk|\bbpm|\btempo|\bbeat|\bguia\s*click|\bcount/i;

interface DecodedEntry {
  index: number;
  file: File;
  clipId: string;
  audio: ClipAudio;
  duration: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: number[];
}

/** Música que veio de um projeto do REAPER: onde cada áudio entra e o andamento do trecho. */
export interface ReaperSongData {
  /** Na mesma ordem de `files`. */
  placements: ShowItem[];
  /** Tamanho da música (a região do REAPER). */
  length: number;
  tempo: Array<{ startTime: number; bpm: number }>;
  beatsPerBar: number;
  sections: Array<{ name: string; start: number; end: number }>;
}

export interface SongGroup {
  name: string;
  files: File[];
  reaper?: ReaperSongData;
  /** Aviso para mostrar no fim da importação (o que não veio do projeto). */
  notice?: string;
}

interface SongImportResult {
  name: string;
  imported: number;
  total: number;
  failed: string[];
  hasBpmSource: boolean;
  songId: string;
  bpmDone: boolean;
}

const isAudio = (f: File) => AUDIO_EXTENSIONS.test(f.name);
const byName = (a: SongGroup, b: SongGroup) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' });
const relPath = (f: File) => (f.webkitRelativePath || f.name).split('/');

/** Uma pasta escolhida = uma música, incluindo áudios de subpastas. */
export function groupAsSingleSong(files: File[]): SongGroup[] {
  const audio = files.filter(isAudio);
  if (audio.length === 0) return [];
  return [{ name: relPath(audio[0])[0] || 'Música Importada', files: audio }];
}

/** Pasta mãe: cada subpasta de primeiro nível vira uma música; áudios soltos viram uma música com o nome da pasta mãe. */
export function groupByParentFolder(files: File[]): SongGroup[] {
  const groups = new Map<string, File[]>();
  for (const f of files.filter(isAudio)) {
    const parts = relPath(f);
    const key = parts.length > 2 ? parts[1] : parts[0] || 'Música Importada';
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return Array.from(groups, ([name, list]) => ({ name, files: list })).sort(byName);
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, fail: (e: unknown) => void) => void };
}

/** Precisa ser chamado durante o evento de soltar: depois disso o navegador apaga a lista. */
export function takeDroppedEntries(dt: DataTransfer): FsEntry[] {
  const out: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) out.push(entry);
  }
  return out;
}

async function readFolderFiles(entry: FsEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
    return [file];
  }
  const reader = entry.createReader!();
  const children: FsEntry[] = [];
  // o navegador entrega o conteúdo da pasta em lotes; lê até vir vazio
  while (true) {
    const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((c) => readFolderFiles(c).catch(() => [] as File[])));
  return nested.flat();
}

async function readFolderPaths(entry: FsEntry, base: string): Promise<PathFile[]> {
  const path = entry.fullPath?.replace(/^\//, '') || (base ? `${base}/${entry.name}` : entry.name);
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
    return [{ path, file }];
  }
  const reader = entry.createReader!();
  const children: FsEntry[] = [];
  while (true) {
    const batch = await new Promise<FsEntry[]>((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map((c) => readFolderPaths(c, path).catch(() => [] as PathFile[])));
  return nested.flat();
}

/** Por que a última leva solta não trouxe música (para a mensagem não ser a genérica). */
let emptyDropReason: string | null = null;

/**
 * Cada pasta solta vira uma música; arquivos soltos sem pasta viram uma música só.
 * Pasta com projeto do REAPER (.rpp) vira o show separado em músicas.
 */
export async function groupDroppedEntries(entries: FsEntry[]): Promise<SongGroup[]> {
  const groups: SongGroup[] = [];
  const reaperGroups: SongGroup[] = [];
  const loose: File[] = [];
  let loneRpp = false;
  let reaperEmpty: string | null = null;
  for (const entry of entries) {
    if (entry.isDirectory) {
      const all = await readFolderPaths(entry, '').catch(() => [] as PathFile[]);
      const show = await groupReaperProject(all);
      if (show) {
        reaperGroups.push(...show.groups);
        if (show.groups.length === 0) reaperEmpty = show.notice ?? null;
        continue;
      }
      const files = all.map((f) => f.file).filter(isAudio);
      if (files.length) groups.push({ name: entry.name, files });
    } else if (entry.isFile) {
      const [file] = await readFolderFiles(entry).catch(() => [] as File[]);
      if (file && isAudio(file)) loose.push(file);
      else if (file && isRpp(file.name)) loneRpp = true;
    }
  }
  groups.sort(byName);
  if (loose.length) groups.push({ name: 'Música Importada', files: loose });
  // o show do REAPER entra na ordem da linha do tempo, antes das outras pastas
  const out = [...reaperGroups, ...groups];
  if (out.length === 0) {
    emptyDropReason = reaperEmpty
      ?? (loneRpp ? 'O arquivo .RPP sozinho não traz os áudios. Arraste a pasta do projeto (a que tem o .RPP e a pasta dos áudios).' : null);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Projeto do REAPER

interface PathFile {
  path: string;
  file: File;
}

const isRpp = (name: string) => /\.rpp$/i.test(name);
const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() || p;

/** Arquivos escolhidos pelo seletor de pasta, com o caminho dentro da pasta. */
export function pickedPaths(files: File[]): PathFile[] {
  return files.map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

function reaperNotice(split: ShowSplit, missing: string[]): string | undefined {
  const parts: string[] = [];
  if (missing.length) {
    const list = missing.slice(0, 4).join(', ') + (missing.length > 4 ? ` e mais ${missing.length - 4}` : '');
    parts.push(`Não achei ${missing.length === 1 ? '1 áudio' : `${missing.length} áudios`} que o projeto .RPP usa (${list}). Confira se a pasta dos áudios está junto do .RPP.`);
  }
  const count = (r: string) => split.skipped.filter((x) => x.reason === r).length;
  const out: string[] = [];
  if (count('midi')) out.push(`${count('midi')} de MIDI`);
  if (count('velocidade')) out.push(`${count('velocidade')} com a velocidade alterada`);
  if (count('trecho')) out.push(`${count('trecho')} invertidos ou recortados`);
  if (count('sem-audio')) out.push(`${count('sem-audio')} sem áudio`);
  if (out.length) parts.push(`Ficaram de fora itens do projeto: ${out.join(', ')}.`);
  if (split.tracksWithFx.length) {
    const n = split.tracksWithFx.length;
    parts.push(`${n === 1 ? 'Uma faixa tem' : `${n} faixas têm`} plugins no projeto original; aqui ${n === 1 ? 'ela toca' : 'elas tocam'} sem os efeitos.`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

/**
 * Se entre os arquivos houver um projeto do REAPER, separa o show em músicas (uma por região,
 * ou por marcador) e acha os áudios que ele cita. Sem .rpp, devolve null.
 */
export async function groupReaperProject(all: PathFile[]): Promise<{ groups: SongGroup[]; notice?: string; projectName: string } | null> {
  const rpps = all.filter((f) => isRpp(f.file.name));
  if (rpps.length === 0) return null;
  const depth = (p: string) => p.split('/').length;
  // o mais perto da pasta escolhida; empate: o salvo por último
  rpps.sort((a, b) => depth(a.path) - depth(b.path) || b.file.lastModified - a.file.lastModified);
  const rpp = rpps[0];
  const projectName = rpp.file.name.replace(/\.rpp$/i, '');
  let split: ShowSplit;
  try {
    split = splitShow(parseRpp(await rpp.file.text()), projectName);
  } catch (err) {
    console.warn('[import] projeto do REAPER não lido', rpp.path, err);
    return { groups: [], notice: `Não consegui ler o projeto "${rpp.file.name}".`, projectName };
  }
  const dir = rpp.path.split('/').slice(0, -1).join('/');
  const audio = all.filter((f) => isAudio(f.file));
  const missing = new Set<string>();
  const groups: SongGroup[] = [];
  for (const song of split.songs) {
    const files: File[] = [];
    const placements: ShowItem[] = [];
    for (const p of song.items) {
      const file = p.item.file ? resolveMediaPath(p.item.file, dir, audio) : null;
      if (!file) {
        missing.add(baseName(p.item.file ?? p.item.name));
        continue;
      }
      files.push(file);
      placements.push(p);
    }
    if (files.length === 0) continue;
    groups.push({
      name: song.name,
      files,
      reaper: { placements, length: song.end - song.start, tempo: song.tempo, beatsPerBar: song.beatsPerBar, sections: song.sections },
    });
  }
  const notice = reaperNotice(split, [...missing]);
  if (groups.length === 0) {
    return { groups, notice: notice ?? `O projeto "${rpp.file.name}" não tem áudio para importar.`, projectName };
  }
  groups[0].notice = notice;
  return { groups, notice, projectName };
}

/** Faixa do VS Stage para um áudio do REAPER: pelo nome do arquivo, senão pelo da faixa ou da pasta. */
function routeReaperItem(file: File, placement: ShowItem | undefined) {
  const byFile = routeByName(file.name);
  if (byFile || !placement) return byFile;
  for (const name of [placement.track.name, placement.item.name, ...[...placement.track.folders].reverse()]) {
    const r = name ? routeByName(name.replace(/[[\]]/g, ' ')) : null;
    if (r) return r;
  }
  return null;
}

/** Cortes, volume e fades do item do REAPER no clipe. */
function reaperClipFields(p: ShowItem, duration: number): Partial<AudioClip> {
  const trimStart = Math.max(0, Math.min(p.trimStart, Math.max(0, duration - 0.05)));
  const playLength = Math.min(p.playLength, duration - trimStart);
  const trimEnd = Math.max(0, duration - trimStart - playLength);
  const out: Partial<AudioClip> = {};
  if (trimStart > 1e-4) out.trimStart = trimStart;
  if (trimEnd > 1e-4) out.trimEnd = trimEnd;
  if (Math.abs(p.gain - 1) > 1e-4) out.gain = p.gain;
  if (p.mute) out.mute = true;
  if (p.fadeIn > 1e-4) out.fadeIn = Math.min(p.fadeIn, playLength);
  if (p.fadeOut > 1e-4) out.fadeOut = Math.min(p.fadeOut, playLength);
  return out;
}

/** Andamento que veio do REAPER, por música: usado para conferir (ou trazer) o BPM. */
const reaperTempoHints = new Map<string, { tempo: ReaperSongData['tempo']; length: number }>();

function reaperSegments(hint: { tempo: ReaperSongData['tempo']; length: number }): SongTempoSegment[] {
  return hint.tempo.map((t, i) => ({
    startTime: t.startTime,
    endTime: hint.tempo[i + 1]?.startTime ?? hint.length,
    bpm: t.bpm,
    downbeat: t.startTime,
  }));
}

let queueBusy = false;
let cancelRequested = false;
const currentImportSongIds = new Set<string>();

export function isImportRunning() {
  return queueBusy;
}

/** Cancela imediatamente qualquer importação de VSs em andamento e limpa músicas incompletas. */
export function cancelImport() {
  if (!queueBusy) return;
  cancelRequested = true;
  const store = useStore.getState();
  store.setImportProgress({
    clipId: 'cancelled',
    status: 'error',
    message: 'Importação cancelada pelo usuário.',
  });
  // Remove as músicas adicionadas nesta leva que foram interrompidas
  for (const sId of currentImportSongIds) {
    store.removeSong(sId);
  }
  currentImportSongIds.clear();
  setTimeout(() => useStore.getState().setImportProgress(null), 2500);
}

/** Importa as músicas uma por vez, liberando memória entre elas, e mostra um resumo no final. */
export async function importSongGroups(groups: SongGroup[]): Promise<void> {
  if (groups.length === 0) {
    useStore.getState().setPlaybackError(emptyDropReason ?? 'Nenhum arquivo de áudio encontrado nas pastas escolhidas.');
    emptyDropReason = null;
    return;
  }
  emptyDropReason = null;
  if (queueBusy) {
    useStore.getState().setPlaybackError('Já existe uma importação em andamento. Espere ela terminar e tente de novo.');
    return;
  }
  queueBusy = true;
  cancelRequested = false;
  currentImportSongIds.clear();

  const results: SongImportResult[] = [];
  const brokenSongs: string[] = [];
  try {
    for (let k = 0; k < groups.length; k++) {
      if (cancelRequested) break;
      const groupName = groups[k].name;

      // 9. Quando tentar importar uma música que já está no projeto, o programa avisa o usuário
      const existing = useStore.getState().songs.find(
        (s) => s.name.trim().toLowerCase() === groupName.trim().toLowerCase()
      );
      if (existing) {
        // janela do app (não window.confirm, que para o programa inteiro e engasga a música no ar)
        const proceed = await askImportAgain(groupName);
        if (cancelRequested) break;
        if (!proceed) {
          useStore.getState().setPlaybackError(`Importação ignorada: "${groupName}" já existe no repertório.`);
          continue;
        }
      }

      const label = groups.length > 1 ? `Música ${k + 1} de ${groups.length}: ` : '';
      try {
        const res = await importSong(groups[k].name, groups[k].files, label, groups[k].reaper);
        if (cancelRequested) break;
        results.push(res);
      } catch (err) {
        if (cancelRequested || (err instanceof Error && err.message === 'import_cancelled')) break;
        console.warn('[import] música não importada', groups[k].name, err);
        brokenSongs.push(groups[k].name);
      }
    }
    if (!cancelRequested) {
      const notices = groups.map((g) => g.notice).filter((n): n is string => !!n);
      reportSummary(results, brokenSongs, notices);
      releaseImportedAudio();
      await measurePendingBpm(results);
    }
  } finally {
    queueBusy = false;
    currentImportSongIds.clear();
    cancelRequested = false;
  }
}

function reportSummary(results: SongImportResult[], brokenSongs: string[], notices: string[] = []) {
  const store = useStore.getState();
  const withErrors = results.filter((r) => r.failed.length > 0);
  const ok = results.filter((r) => r.imported > 0).length;
  const hasProblem = withErrors.length > 0 || brokenSongs.length > 0 || notices.length > 0;
  const message = results.length === 1 && brokenSongs.length === 0
    ? `VS "${results[0].name}": ${results[0].imported} de ${results[0].total} áudios importados`
    : `${ok} ${ok === 1 ? 'música importada' : 'músicas importadas'}${hasProblem ? ' (com avisos)' : ''}`;
  store.setImportProgress({ clipId: 'done', status: hasProblem ? 'error' : 'done', message, current: ok, total: results.length + brokenSongs.length });

  const parts: string[] = [];
  for (const r of withErrors) {
    const one = r.failed.length === 1;
    parts.push(`"${r.name}": ${one ? `o arquivo ${r.failed[0]} não pôde ser lido` : `${r.failed.length} arquivos não puderam ser lidos (${r.failed.join(', ')})`}`);
  }
  if (brokenSongs.length) parts.push(`não consegui importar: ${brokenSongs.map((n) => `"${n}"`).join(', ')}`);
  const messages: string[] = [];
  if (parts.length) messages.push(`${parts.join('; ')}. Confira se esses arquivos abrem em outro programa e importe de novo.`);
  messages.push(...notices);
  if (messages.length) store.setPlaybackError(messages.join(' '));

  setTimeout(() => useStore.getState().setImportProgress(null), hasProblem ? 8000 : 3000);
}

// Todo VS tem click e ele começa no compasso 1 (0:00), como na DAW de onde o VS saiu.
// O BPM é medido pulso a pulso no começo do click (num medley, a primeira música).
// Não adiciona outros tempos automaticamente na régua: caso o andamento mude lá na frente
// (ex.: medley), o próprio usuário clica com o botão direito na régua no ponto exato e insere o novo BPM.
async function applyBpm(songId: string): Promise<boolean> {
  // Mapa de andamento feito à mão no REAPER (mais de um BPM na música): vale como está.
  const hint = reaperTempoHints.get(songId);
  if (hint && hint.tempo.length > 1) {
    setSongBpm(songId, hint.tempo[0].bpm, 'manual', 0, reaperSegments(hint));
    return true;
  }
  const { clickFirst, audioFallback } = bpmCandidates(songId);
  const song = useStore.getState().songs.find((s) => s.id === songId);
  const beatsPerBar = song?.beatsPerBar ?? 4;
  let result: TempoResult | null = null;

  // 1. Pulsos do click: é a referência
  for (const id of clickFirst) {
    const audio = getClipAudio(id);
    if (!audio) continue;
    result = detectClickTempo(audio, beatsPerBar);
    if (result) break;
  }

  // O BPM do projeto do REAPER traz as casas decimais exatas quando bate com o click. Se não bate,
  // costuma ser o 120 que o REAPER põe sozinho em projeto novo: vale o click.
  if (hint && result && Math.abs(hint.tempo[0].bpm - result.bpm) / result.bpm < 0.01) {
    setSongBpm(songId, hint.tempo[0].bpm, 'click', 0);
    return true;
  }

  // 2. BPM gravado no arquivo (Reaper/DAWs): só vale se o click não deu para medir ou se bate com
  // ele (aí traz as casas decimais exatas). Um loop, por exemplo, traz o andamento do loop, não da música.
  for (const id of clickFirst) {
    const src = getClipSource(id);
    if (!src) continue;
    const wavMeta = await parseWavMetadata(src);
    if (!wavMeta?.bpm) continue;
    if (!result || Math.abs(wavMeta.bpm - result.bpm) / result.bpm < 0.005) {
      setSongBpm(songId, wavMeta.bpm, 'click', 0);
      return true;
    }
  }

  // 3. Fallback pela bateria/mix se não houver click audível
  if (!result && audioFallback) {
    const audio = getClipAudio(audioFallback);
    if (audio) result = await detectBpm(clipAudioToBuffer(audio));
  }
  if (!result && hint && Math.abs(hint.tempo[0].bpm - 120) > 1e-3) {
    setSongBpm(songId, hint.tempo[0].bpm, 'manual', 0);
    return true;
  }
  if (!result) {
    useStore.getState().updateSong(songId, { bpmMissing: true });
    return false;
  }
  // A timeline inicia cravada no compasso 1, no 0:00
  setSongBpm(songId, result.bpm, result.fromClick ? 'click' : 'audio', 0);
  return true;
}

export function setSongBpm(
  songId: string,
  bpm: number,
  source: NonNullable<Song['bpmSource']>,
  downbeat?: number,
  tempoSegments?: SongTempoSegment[]
) {
  useStore.getState().updateSong(songId, {
    bpm,
    bpmDetected: true,
    bpmMissing: false,
    bpmSource: source,
    ...(downbeat !== undefined ? { downbeat } : {}),
    ...(tempoSegments && tempoSegments.length > 1 ? { tempoSegments } : {}),
  });
  const withBpm = (list: PlaylistEntry[]) => list.map((p) => p.songId === songId ? { ...p, bpm } : p);
  useStore.setState((s) => ({
    playlist: withBpm(s.playlist),
    defaultPlaylist: s.defaultPlaylist ? withBpm(s.defaultPlaylist) : null,
    shows: s.shows.map((sh) => ({ ...sh, playlist: withBpm(sh.playlist) })),
  }));
}

function bpmCandidates(songId: string): { clickFirst: string[]; audioFallback: string | null } {
  const { clips, tracks } = useStore.getState();
  const songClips = clips.filter((c) => c.songId === songId);
  const targetOf = (c: AudioClip) => tracks.find((tr) => tr.id === c.trackId)?.parentId ?? c.trackId;
  const routed = (target: RoutingTarget) => songClips.filter((c) => targetOf(c) === target);
  const clickish = songClips.filter((c) => CLICKISH_NAME.test(c.fileName) || CLICKISH_NAME.test(c.name));
  const ordered = [...routed('track-click'), ...clickish, ...routed('track-bateria'), ...routed('track-percussoes'), ...songClips];
  const clickFirst = [...new Set(ordered.map((c) => c.id))];
  const drums = [...routed('track-bateria'), ...routed('track-percussoes')][0] ?? routed('track-click')[0] ?? songClips[0];
  return { clickFirst, audioFallback: drums?.id ?? null };
}

export async function remeasureSongBpm(songId: string): Promise<'ok' | 'no-source' | 'failed'> {
  if (!useStore.getState().clips.some((c) => c.songId === songId)) return 'no-source';
  await ensureSongLoaded(songId);
  return (await applyBpm(songId)) ? 'ok' : 'failed';
}

// Terminada a importação, os áudios decodificados saem da memória e as músicas passam a tocar
// lendo do disco, como um projeto aberto. Antes a última música importada ficava inteira na
// memória até salvar e reabrir: num show longo, num Mac de 8 GB, a timeline travava.
function releaseImportedAudio() {
  const { transport } = useStore.getState();
  const playingId = transport.isStopped ? null : transport.currentSongId;
  audioEngine.releaseUnretained([playingId]);
  retainSongs([playingId], { strict: true });
}

// BPM que não deu para medir durante a importação (algo estava tocando): mede quando o play parar.
async function measurePendingBpm(results: SongImportResult[]) {
  const pending = results.filter((r) => r.hasBpmSource && !r.bpmDone);
  if (pending.length === 0) return;
  await audioEngine.waitUntilIdle();
  for (const r of pending) {
    if (!useStore.getState().songs.some((s) => s.id === r.songId)) continue;
    try {
      await ensureSongLoaded(r.songId);
      await applyBpm(r.songId);
    } catch (err) {
      console.warn('[import] BPM não medido', r.name, err);
    }
  }
  releaseImportedAudio();
}

async function importSong(folderName: string, audioFiles: File[], label: string, reaper?: ReaperSongData): Promise<SongImportResult> {
  const store = useStore.getState();
  const songId = `song-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  currentImportSongIds.add(songId);

  const song: Song = {
    id: songId,
    name: folderName,
    clips: [],
    bpm: 120,
    bpmDetected: false,
    bpmAdjust: 0,
    tuner: 0,
    duration: 0,
    timelineStart: 0,
    blockId: null,
    regions: [],
    ...(reaper && (reaper.beatsPerBar === 3 || reaper.beatsPerBar === 6) ? { beatsPerBar: reaper.beatsPerBar } : {}),
  };
  if (reaper) reaperTempoHints.set(songId, { tempo: reaper.tempo, length: reaper.length });

  // Libera para a importação a memória de tudo que não está tocando agora.
  const playingId = store.transport.isStopped ? null : store.transport.currentSongId;
  retainSongs([playingId], { strict: true });
  audioEngine.releaseUnretained([playingId]);

  store.addSong(song);
  store.addToPlaylist(songId, folderName, 0, 120);

  // Fase 1: decodifica todos os arquivos em paralelo com concorrência limitada.
  const total = audioFiles.length;
  let completed = 0;
  const decodedEntries: (DecodedEntry | null)[] = new Array(total).fill(null);

  // Identificadores de clipe únicos com songId e entropia para nunca colidirem em importações em lote
  const clipIds = audioFiles.map((_, i) => `clip-${songId}-${i}-${Math.random().toString(36).slice(2, 7)}`);
  const errors = new Map<number, string>();

  const tryDecode = async (i: number): Promise<boolean> => {
    if (cancelRequested) return false;
    const file = audioFiles[i];
    try {
      const { audioBuffer, duration, sampleRate, channels } = await decodeFile(file);
      if (cancelRequested) return false;
      // Resolução de estúdio HD (100 picos por segundo), padrão Apple Logic Pro 11 / Pro Tools HD
      const peakResolution = Math.min(24000, Math.max(8000, Math.round(duration * 100)));
      const waveformPeaks = audioEngine.generateWaveformPeaks(audioBuffer, peakResolution);
      // guarda já no formato leve; o formato nativo do navegador ocupa o dobro
      decodedEntries[i] = { index: i, file, clipId: clipIds[i], audio: await toClipAudioAsync(audioBuffer), duration, sampleRate, channels, waveformPeaks };
      errors.delete(i);
      return true;
    } catch (err) {
      errors.set(i, err instanceof Error ? err.message : 'Falha');
      return false;
    }
  };

  const runOne = async (i: number) => {
    if (cancelRequested) return;
    await tryDecode(i);
    if (cancelRequested) return;
    completed++;
    useStore.getState().setImportProgress({
      clipId: clipIds[i],
      status: 'decoding',
      message: `${label}Decodificando ${completed}/${total}: ${audioFiles[i].name}`,
      current: completed,
      total,
    });
  };

  let cursor = 0;
  const workers: Promise<void>[] = [];
  const next = async (): Promise<void> => {
    while (true) {
      if (cancelRequested) return;
      const idx = cursor++;
      if (idx >= total) return;
      await runOne(idx);
    }
  };
  for (let w = 0; w < Math.min(DECODE_CONCURRENCY, total); w++) workers.push(next());
  await Promise.all(workers);

  if (cancelRequested) {
    store.removeSong(songId);
    currentImportSongIds.delete(songId);
    throw new Error('import_cancelled');
  }

  // Falhas costumam ser falta de memória momentânea: tenta de novo, um arquivo por vez.
  for (let attempt = 1; attempt <= 3 && errors.size > 0 && !cancelRequested; attempt++) {
    for (const i of Array.from(errors.keys())) {
      if (cancelRequested) break;
      useStore.getState().setImportProgress({
        clipId: clipIds[i],
        status: 'decoding',
        message: `${label}Tentando de novo (${attempt}/3): ${audioFiles[i].name}`,
        current: total - errors.size,
        total,
      });
      await new Promise((r) => setTimeout(r, 150 * attempt));
      if (cancelRequested) break;
      await tryDecode(i);
    }
  }

  if (cancelRequested) {
    store.removeSong(songId);
    currentImportSongIds.delete(songId);
    throw new Error('import_cancelled');
  }
  if (errors.size > 0) {
    console.warn('[import] arquivos que não abriram', Array.from(errors, ([i, msg]) => `${audioFiles[i].name}: ${msg}`));
  }

  useStore.getState().setImportProgress({
    clipId: 'routing',
    status: 'routing',
    message: `${label}Organizando as faixas de "${folderName}"...`,
    current: total - errors.size,
    total,
  });

  // Fase 2: roteia, cria faixas e insere clipes (serial, mas rápido — só manipula estado).
  const childTrackCounts: Record<string, Record<string, number>> = {};
  const usedTracksInSong = new Set<string>();
  let maxDuration = 0;

  for (const entry of decodedEntries) {
    if (!entry) continue;
    const { file, clipId, audio, duration, sampleRate, channels, waveformPeaks, index } = entry;

    const placement = reaper?.placements[index];
    const route = reaper ? routeReaperItem(file, placement) : routeByName(file.name);
    let trackId: RoutingTarget;
    let childTrackName: string;
    const routingMethod: AudioClip['routingMethod'] = 'name';
    let routingConfidence = 1;

    if (route) {
      trackId = route.target;
      childTrackName = route.instrumentName;
    } else {
      trackId = 'track-outros';
      childTrackName = 'Extra';
      routingConfidence = isUnreadableName(file.name) ? 0.2 : 0.3;
    }

    if (!childTrackCounts[trackId]) childTrackCounts[trackId] = {};
    if (!childTrackCounts[trackId][childTrackName]) childTrackCounts[trackId][childTrackName] = 0;
    childTrackCounts[trackId][childTrackName]++;

    const count = childTrackCounts[trackId][childTrackName];
    const numberedName = `${childTrackName} ${count}`;
    // Quando o nome não bateu com nenhum instrumento (grupo "Extra"), o clipe mostra o
    // nome original do arquivo em vez de "Extra 1", "Extra 2"... — assim a pessoa sabe
    // o que é o áudio sem precisar abrir o arquivo. A faixa continua numerada normalmente.
    const clipDisplayName = route ? numberedName : cleanClipName(file.name);

    // S\u00f3 reaproveita a faixa se o nome for EXATAMENTE id\u00eantico e se a faixa ainda N\u00c3O tiver sido
    // ocupada por outro clipe nesta mesma m\u00fasica.
    // Isso garante de forma absoluta que NENHUM \u00e1udio fique por cima do outro na timeline!
    const existingChild = useStore.getState().tracks.find((t) => {
      if (t.parentId !== trackId || usedTracksInSong.has(t.id)) return false;
      const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      return norm(t.name) === norm(numberedName);
    });

    let actualTrackId: string;
    if ((trackId === 'track-guia' || trackId === 'track-click' || trackId === 'track-maestro') && !usedTracksInSong.has(trackId)) {
      actualTrackId = trackId;
    } else if (existingChild) {
      actualTrackId = existingChild.id;
    } else {
      let finalName = numberedName;
      let suffix = count;
      const currentTracks = useStore.getState().tracks;
      while (currentTracks.some((t) => t.parentId === trackId && t.name.toLowerCase() === finalName.toLowerCase())) {
        suffix++;
        finalName = `${childTrackName} ${suffix}`;
      }
      const childId = `${trackId}-child-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
      useStore.getState().addChildTrack(trackId, finalName, childId);
      actualTrackId = childId;
    }
    usedTracksInSong.add(actualTrackId);

    const markers = generateMarkers(duration);

    const clip: AudioClip = {
      id: clipId,
      trackId: actualTrackId,
      name: clipDisplayName,
      fileName: file.name,
      filePath: URL.createObjectURL(file),
      songId,
      startTime: placement?.startTime ?? 0,
      duration,
      sampleRate,
      channels,
      bpm: null,
      markers,
      routingMethod,
      routingConfidence,
      waveformPeaks,
      ...(placement ? reaperClipFields(placement, duration) : {}),
    };

    registerClipSource(clipId, songId, file);
    putClipAudio(clipId, songId, audio);
    useStore.getState().addClip(clip);
    const end = placement ? clip.startTime + clipPlayLength(clip) : duration;
    if (end > maxDuration) maxDuration = end;
  }

  if (reaper) {
    maxDuration = Math.max(maxDuration, reaper.length);
    const regions = reaper.sections.map((sec, i) => ({
      id: `region-${songId}-${i}`,
      name: sec.name,
      start: sec.start,
      end: sec.end,
      color: presetColor(sec.name) ?? REGION_COLORS[i % REGION_COLORS.length].value,
      loop: false,
    }));
    useStore.getState().updateSong(songId, { duration: maxDuration, regions });
  } else {
    useStore.getState().updateSong(songId, { duration: maxDuration });
  }

  const playlistEntry = useStore.getState().playlist.find((p) => p.songId === songId);
  if (playlistEntry) {
    useStore.setState((s) => ({
      playlist: s.playlist.map((p) => p.songId === songId ? { ...p, duration: maxDuration } : p),
    }));
  }

  useStore.getState().reconcileTracks();
  useStore.getState().selectSong(songId);
  useStore.getState().recalcTimeline();

  const hasBpmSource = useStore.getState().clips.some((c) => c.songId === songId);
  let bpmDone = false;
  if (hasBpmSource && !audioEngine.isRunning()) {
    useStore.getState().setImportProgress({
      clipId: 'bpm',
      status: 'detecting-bpm',
      message: `${label}Medindo o BPM de "${folderName}"...`,
      current: total - errors.size,
      total,
    });
    await applyBpm(songId);
    bpmDone = true;
  }

  return {
    name: folderName,
    imported: total - errors.size,
    total,
    failed: Array.from(errors.keys()).map((i) => audioFiles[i].name),
    hasBpmSource,
    songId,
    bpmDone,
  };
}
