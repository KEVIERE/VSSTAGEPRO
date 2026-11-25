import { convertForImport, decodeBlob, deviceSampleRate, generateMarkers, importBudgetFallback, importFileBytes, importPeakCount, ImportWorkerError, int16PeaksAsync, songsKeptDuringImport } from '@/lib/audioDecoder';
import { cleanClipName, routeByName, isUnreadableName } from '@/lib/nameRouter';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import * as audioLibraryModule from '@/lib/audioLibrary';
import { channelToFloat, clipAudioToBuffer, clipPlayLength, ensureSongLoaded, getClipAudio, getClipSource, onAudioLibraryCleared, openClipAudio, putClipAudio, registerClipSource, retainSongs, toClipAudioAsync } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';
import { canReadWavDirect, readWav, wavConvertsRate } from '@/lib/wavReader';
import { waveformPeaksAsync } from '@/lib/waveformPeaks';
import { computeNextSongId } from '@/lib/playFlow';
import type { AudioClip, PlaylistEntry, RoutingTarget, Song, SongTempoSegment } from '@/types';
import { detectBpm, detectClickTempo, type TempoResult } from '@/lib/beatDetector';
import { clickCoverageNotice, clickWeakNotice, hasTempoChanges, medleyEstimateNotice, readDownbeats, readTempoMap } from '@/lib/medleyTempo';
import { canReplaceTempoMap, isFinalRitOnly, mapOffShare, oldMapLooksEdited, shouldReplaceTempoMap, tempoMapSignature } from '@/lib/tempoFollow';
import { BAR_CHECK_VERSION, mixIntoRuler, planBarPhase } from '@/lib/barPhase';
import { gridClickBuffer, makeClickClip } from '@/lib/clickClip';
import { clickClipsOf } from '@/lib/clickEdit';
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
      const notices = [...groups.map((g) => g.notice).filter((n): n is string => !!n), ...medleyNotices.splice(0)];
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
async function applyBpm(songId: string, opts: { createClick?: boolean; asked?: boolean } = {}): Promise<boolean> {
  const before = useStore.getState().songs.find((s) => s.id === songId);
  // mapa à mão de projeto antigo: a origem fica registrada antes de qualquer medição
  if (before && (before.tempoSegments?.length ?? 0) > 1 && before.bpmSource === 'manual' && !before.tempoMapSource) {
    useStore.getState().updateSong(songId, { tempoMapSource: 'manual' });
  }
  const song = useStore.getState().songs.find((s) => s.id === songId);
  const asked = opts.asked ?? false;
  // mapa travado (à mão, REAPER ou antigo sem registro): nem o BPM nem a origem mudam
  if (song && lockedTempoMap(song, asked)) return true;
  // projeto trocado no meio da conta: o resultado é do projeto anterior e não vale para o novo
  const opened = projectEpoch;
  const alive = () => opened === projectEpoch;
  const ok = await applySingleBpm(songId, alive);
  if (alive()) await applyMedleyMap(songId, opts.createClick ?? false, alive, asked);
  return ok || !!useStore.getState().songs.find((s) => s.id === songId)?.tempoSegments?.length;
}

let projectEpoch = 0;
onAudioLibraryCleared(() => { projectEpoch++; });

// Medley: acha os andamentos de cada música da faixa e põe na grade. Trechos que já existem (feitos
// à mão ou vindos do REAPER) nunca são trocados, e música de um andamento só fica com o BPM exato do click.
async function applyMedleyMap(songId: string, createClick: boolean, alive: () => boolean, asked = false): Promise<void> {
  const state = useStore.getState();
  const song = state.songs.find((s) => s.id === songId);
  if (!song || lockedTempoMap(song, asked)) return;
  const { clickClips, audioFallback } = medleySources(songId);
  // Com click, os ataques dele bastam (rápido e exato). Sem click, o modelo ouve a bateria ou a mistura.
  const isClick = clickClips.length > 0;
  let buffer: AudioBuffer | null = null;
  let offset = 0;
  if (clickClips.length > 1) {
    // o click em mais de um clipe é lido junto, na régua: o mapa vale para a música inteira
    buffer = await clickRulerBuffer(clickClips, () => !alive());
    if (!alive()) return;
  } else {
    const id = clickClips[0] ?? audioFallback;
    const audio = id ? getClipAudio(id) : null;
    const clip = id ? state.clips.find((c) => c.id === id) : null;
    if (audio && clip) {
      buffer = clipAudioToBuffer(audio);
      // a análise conta do começo do arquivo: na régua ele pode começar depois do 0:00 ou com corte
      offset = clip.startTime - (clip.trimStart ?? 0);
    }
  }
  if (!buffer) return;
  const reading = await readTempoMap(buffer, song.beatsPerBar ?? 4, {
    isClick,
    keepSingle: !isClick,
    offset,
    duration: song.duration,
  });
  if (!alive()) return;
  if (reading?.lowCoverage) {
    medleyNotices.push(clickCoverageNotice(song.name, reading.coverage ?? 0));
    return;
  }
  const map = reading?.map;
  if (!map) return;
  const current = useStore.getState().songs.find((s) => s.id === songId);
  if (!current || lockedTempoMap(current, asked)) return;
  if (reading?.weakRanges?.length) medleyNotices.push(clickWeakNotice(current.name, reading.weakRanges));
  const source = isClick ? 'click' : 'audio';
  const segments = map.tempoSegments;
  // projeto do REAPER de um andamento só, que o click confirma: a grade é a do REAPER e a conferência
  // automática não mexe nela (nem no tempo 1)
  const hint = reaperTempoHints.get(songId);
  const fromReaper = isClick && !!hint && hint.tempo.length === 1 && Math.abs(hint.tempo[0].bpm - map.bpm) / map.bpm < 0.01
    && (!segments?.length || !hasTempoChanges(segments));
  const mapSource = fromReaper ? 'reaper' : source;
  if (!segments?.length) {
    // andamento único na grade simples: fica o BPM exato do click (o do detector arredonda e
    // dobra ou divide), e um mapa automático antigo sai. BPM de projeto que já bate com o click fica.
    const exact = isClick && current.bpmSource !== 'manual' && Math.abs(current.bpm - map.bpm) > 0.0005;
    if (exact || current.tempoSegments?.length) setSongBpm(songId, map.bpm, current.bpmSource ?? source);
    useStore.getState().updateSong(songId, {
      ...(current.tempoSegments?.length ? { tempoSegments: undefined } : {}),
      tempoMapSource: mapSource,
      tempoMapSig: tempoMapSignature(undefined),
    });
    medleyNotices.push(bpmFoundNotice(current.name, [map.bpm]));
    return;
  }
  setSongBpm(songId, map.bpm, source, 0, segments, mapSource);
  if (createClick && !isClick && hasTempoChanges(segments) && !isFinalRitOnly(segments)) {
    await addMedleyClick(songId);
    medleyNotices.push(medleyEstimateNotice(current.name, segments));
  } else {
    medleyNotices.push(bpmFoundNotice(current.name, segments.map((s) => s.bpm)));
  }
}

/** Aviso da importação (e do Medir BPM de novo): os andamentos encontrados na música. Ao abrir o projeto, não sai. */
export function bpmFoundNotice(songName: string, bpms: number[]): string {
  const fmt = (b: number) => Number(b.toFixed(2)).toLocaleString('pt-BR');
  const list: string[] = [];
  for (const b of bpms) {
    const t = fmt(b);
    if (list[list.length - 1] !== t) list.push(t);
  }
  if (list.length <= 1) return `"${songName}": ${list[0] ?? fmt(bpms[0] ?? 0)} BPM.`;
  const shown = list.length > 6 ? [...list.slice(0, 6), 'outros'] : list;
  return `"${songName}": ${list.length} andamentos encontrados (${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]} BPM).`;
}

// Mapa que a medição automática não pode refazer: feito à mão, do REAPER, ou antigo sem registro.
// `asked` (a pessoa pediu Medir de novo): o REAPER de um andamento só, que veio do click, é medido de novo.
function lockedTempoMap(song: Song, asked = false): boolean {
  if ((song.tempoSegments?.length ?? 0) <= 1) return false;
  if (asked && song.tempoMapSource === 'reaper' && song.bpmSource !== 'manual') return !canReplaceTempoMap({ ...song, tempoMapSource: 'click' });
  return !song.tempoMapSource || !canReplaceTempoMap(song);
}

function tempoKeyFor(songId: string, bpm: number, segments: SongTempoSegment[] | undefined): string | null {
  const state = useStore.getState();
  const clips = medleySources(songId, true).clickClips.flatMap((id) => state.clips.find((c) => c.id === id) ?? []);
  if (!clips.length) return null;
  const spans = clips.map((clip) => [clip.fileName, clip.duration.toFixed(3), clip.startTime.toFixed(3), (clip.trimStart ?? 0).toFixed(3), (clip.trimEnd ?? 0).toFixed(3)].join('/'));
  return [spans.join('+'), bpm, tempoMapSignature(segments)].join('/');
}

/** Identifica a conferência de uma música: muda se o mapa ou algum clipe de click mudar. Sem click: null. */
export function tempoCheckKey(songId: string): string | null {
  const song = useStore.getState().songs.find((s) => s.id === songId);
  return song ? tempoKeyFor(songId, song.bpm, song.tempoSegments) : null;
}

/** Marca da conferência do tempo 1: vale para esta versão da regra, este compasso, este mapa e este click. */
function barMarkFor(songId: string, song: Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>): string | null {
  const key = tempoKeyFor(songId, song.bpm, song.tempoSegments);
  return key ? `${BAR_CHECK_VERSION}:${song.beatsPerBar ?? 4}:${key}` : null;
}

export function barCheckMark(songId: string): string | null {
  const song = useStore.getState().songs.find((s) => s.id === songId);
  return song ? barMarkFor(songId, song) : null;
}

function strongestChannel(audio: ClipAudio): Int16Array {
  let channel = audio.channels[0];
  let top = -1;
  for (const ch of audio.channels) {
    let m = 0;
    for (let i = 0; i < ch.length; i += 64) { const v = Math.abs(ch[i]); if (v > m) m = v; }
    if (m > top) { top = m; channel = ch; }
  }
  return channel;
}

// Cópia em pedaços, com folga para a tela e para o Play. Um canal basta: o mais forte, porque um
// click com canais em oposição de fase se cancelaria na mistura.
async function strongestChannelBuffer(audio: ClipAudio, stop: () => boolean): Promise<AudioBuffer | null> {
  const channel = strongestChannel(audio);
  const buffer = new AudioBuffer({ length: audio.length, numberOfChannels: 1, sampleRate: audio.sampleRate });
  const SLICE = 1 << 18;
  for (let i = 0; i < channel.length; i += SLICE) {
    if (stop()) return null;
    buffer.copyToChannel(channelToFloat(channel.subarray(i, i + SLICE)) as Float32Array<ArrayBuffer>, 0, i);
    await new Promise((r) => setTimeout(r, 0));
  }
  return buffer;
}

/** Taxa em que os clipes de click são juntados: a mesma da análise. */
const CLICK_RULER_RATE = 22050;

/**
 * Todos os clipes de click numa régua só, do 0:00 ao fim do último, respeitando início e corte de cada
 * um. Clipe sem áudio disponível devolve null: sem cobrir todos, o mapa da música não pode ser refeito.
 */
async function clickRulerBuffer(clipIds: string[], stop: () => boolean): Promise<AudioBuffer | null> {
  const state = useStore.getState();
  const parts: Array<{ clip: AudioClip; audio: ClipAudio }> = [];
  for (const id of clipIds) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return null;
    let audio = getClipAudio(id);
    if (!audio) {
      const source = getClipSource(id);
      if (!source) return null;
      audio = await openClipAudio(clip.songId, id, source);
      if (stop()) return null;
    }
    parts.push({ clip, audio });
  }
  const end = Math.max(...parts.map(({ clip }) => clip.startTime + clipPlayLength(clip)));
  const buffer = new AudioBuffer({ length: Math.ceil(end * CLICK_RULER_RATE), numberOfChannels: 1, sampleRate: CLICK_RULER_RATE });
  const out = buffer.getChannelData(0);
  for (const { clip, audio } of parts) {
    const channel = strongestChannel(audio);
    const first = Math.round((clip.trimStart ?? 0) * audio.sampleRate);
    const frames = Math.min(channel.length - first, Math.round(clipPlayLength(clip) * audio.sampleRate));
    const at = clip.startTime * CLICK_RULER_RATE;
    const ratio = CLICK_RULER_RATE / audio.sampleRate;
    const SLICE = 1 << 18;
    for (let i = 0; i < frames; i += SLICE) {
      if (stop()) return null;
      const piece = channelToFloat(channel.subarray(first + i, first + Math.min(frames, i + SLICE)));
      for (let q = 0; q < piece.length; q++) {
        const to = Math.round(at + (i + q) * ratio);
        // clipes sobrepostos: fica o ataque mais forte
        if (to >= 0 && to < out.length && Math.abs(piece[q]) > Math.abs(out[to])) out[to] = piece[q];
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return buffer;
}

/** O click da música pronto para ler: um clipe só, ou todos juntos na régua. */
async function savedClickBuffer(songId: string, clips: AudioClip[], clickIds: string[], stop: () => boolean): Promise<{ buffer: AudioBuffer; offset: number } | 'interrupted' | 'failed'> {
  if (clips.length > 1) {
    // medley com o click em mais de um clipe: lê todos juntos, ou não troca
    const buffer = await clickRulerBuffer(clickIds, stop);
    if (stop()) return 'interrupted';
    if (!buffer) return 'failed';
    return { buffer, offset: 0 };
  }
  const [clip] = clips;
  let audio = getClipAudio(clip.id);
  if (!audio) {
    // logo ao abrir o projeto o arquivo do clipe pode ainda não estar registrado
    const source = getClipSource(clip.id);
    if (!source) return 'failed';
    audio = await openClipAudio(songId, clip.id, source);
  }
  if (stop()) return 'interrupted';
  const buffer = await strongestChannelBuffer(audio, stop);
  if (!buffer) return 'interrupted';
  return { buffer, offset: clip.startTime - (clip.trimStart ?? 0) };
}

/**
 * Confere o mapa salvo contra a faixa de click e troca só se o click contradiz a grade e a leitura
 * nova fecha. `canGoOn` fica falso se o Play voltar ou o projeto mudar: nada é trocado nesse caso.
 */
export async function checkSavedTempoMap(songId: string, canGoOn: () => boolean): Promise<'kept' | 'replaced' | 'no-click' | 'interrupted' | 'failed'> {
  const state = useStore.getState();
  const song = state.songs.find((s) => s.id === songId);
  const clickIds = medleySources(songId, true).clickClips;
  const clips = clickIds.flatMap((id) => state.clips.find((c) => c.id === id) ?? []);
  if (!song || !clips.length) return 'no-click';
  if (!canReplaceTempoMap(song)) return 'kept';
  const startKey = tempoCheckKey(songId);
  const signature = tempoMapSignature(song.tempoSegments);
  const stop = () => !canGoOn();
  const opened = await savedClickBuffer(songId, clips, clickIds, stop);
  if (typeof opened === 'string') return opened;
  const { buffer, offset } = opened;
  const reading = await readTempoMap(buffer, song.beatsPerBar ?? 4, {
    isClick: true,
    offset,
    duration: song.duration,
  });
  if (stop()) return 'interrupted';
  if (!reading) return buffer.duration < 30 ? 'kept' : 'failed';
  if (!reading.hits?.length) return 'kept';
  const inClip = (t: number) => clips.some((c) => t >= c.startTime - 0.005 && t <= c.startTime + clipPlayLength(c));
  const hits = reading.hits.filter(inClip);
  const next = { map: reading.map, coverage: reading.coverage };
  const wanted = shouldReplaceTempoMap(song, hits, next);
  // projeto antigo não registrava o ajuste à mão de uma placa: mapa diferente do que o algoritmo antigo
  // geraria fica como está, e a pessoa fica sabendo
  if (oldMapLooksEdited(song, reading.hits)) {
    if (wanted) useStore.getState().setPlaybackError(`"${song.name}": a grade não bate com a faixa de click, mas parece ajustada à mão, então ficou como estava. Para refazer, apague as placas de andamento e use Medir BPM.`);
    return 'kept';
  }
  if (!wanted) return 'kept';
  const map = reading.map!;

  // só com o programa parado, e se ninguém mexeu no mapa nem no click enquanto a conta rodava
  await audioEngine.waitUntilIdle();
  if (stop()) return 'interrupted';
  const latest = useStore.getState().songs.find((s) => s.id === songId);
  if (!latest || tempoMapSignature(latest.tempoSegments) !== signature || latest.bpm !== song.bpm) return 'interrupted';
  if (tempoCheckKey(songId) !== startKey || !canReplaceTempoMap(latest)) return 'interrupted';
  const withBpm = (list: PlaylistEntry[]) => list.map((p) => (p.songId === songId ? { ...p, bpm: map.bpm } : p));
  // uma mudança só no histórico: um Desfazer volta o mapa anterior inteiro
  useStore.setState((s) => ({
    songs: s.songs.map((sg) => (sg.id === songId ? {
      ...sg,
      bpm: map.bpm,
      bpmDetected: true,
      bpmMissing: false,
      bpmSource: 'click' as const,
      tempoSegments: map.tempoSegments,
      tempoMapSource: 'click' as const,
      tempoMapSig: tempoMapSignature(map.tempoSegments),
    } : sg)),
    playlist: withBpm(s.playlist),
    defaultPlaylist: s.defaultPlaylist ? withBpm(s.defaultPlaylist) : null,
    shows: s.shows.map((sh) => ({ ...sh, playlist: withBpm(sh.playlist) })),
  }));
  useStore.getState().setPlaybackError(`Grade de "${latest.name}" corrigida pela faixa de click. Para voltar, use Desfazer.`);
  return 'replaced';
}

/** Clipes que formam a mistura da banda: sem click, guia, maestro e clipe mudo. */
function bandClips(songId: string): AudioClip[] {
  const { clips, tracks } = useStore.getState();
  const targetOf = (c: AudioClip) => tracks.find((tr) => tr.id === c.trackId)?.parentId ?? c.trackId;
  const outside = new Set<string>(['track-click', 'track-guia', 'track-maestro']);
  return clips.filter((c) => {
    if (c.songId !== songId || c.mute) return false;
    const target = targetOf(c);
    if (outside.has(target)) return false;
    return INSTRUMENT_TRACKS.has(target) || !(hasClickWord(c.fileName) || hasClickWord(c.name));
  });
}

const BAND_RATE = 22050;
const BAND_SLICE = 1 << 17;

/**
 * Mistura da banda na régua, mono a 22050 Hz. Abre e soma um clipe por vez: só a mistura fica na memória,
 * e o clipe que precisou ser aberto é solto logo depois. Null se não há banda. 'no-audio' se algum clipe
 * da banda está sem o arquivo ou não abre: a mistura sairia incompleta e a conferência fica para depois.
 */
async function bandRulerMono(songId: string, duration: number, stop: () => boolean): Promise<Float32Array | 'interrupted' | 'no-audio' | null> {
  const clips = bandClips(songId);
  if (!clips.length) return null;
  if (clips.some((c) => !getClipAudio(c.id) && !getClipSource(c.id))) return 'no-audio';
  const end = Math.min(duration, Math.max(...clips.map((c) => c.startTime + clipPlayLength(c))));
  if (!(end > 0)) return null;
  const out = new Float32Array(Math.ceil(end * BAND_RATE));
  let used = 0;
  for (const clip of clips) {
    if (stop()) return 'interrupted';
    let audio = getClipAudio(clip.id);
    if (!audio) {
      const source = getClipSource(clip.id);
      if (!source) return 'no-audio';
      try {
        audio = await openClipAudio(songId, clip.id, source);
      } catch (err) {
        // arquivo que não abre também é áudio faltando: sem ele a mistura não serve para conferir
        console.warn('[tempo 1] clipe não abriu', clip.fileName, err);
        return 'no-audio';
      }
      if (stop()) return 'interrupted';
    }
    const placed = { startTime: clip.startTime, trimStart: clip.trimStart, playLength: clipPlayLength(clip), gain: clip.gain };
    const from = Math.max(0, Math.round(clip.startTime * BAND_RATE));
    const to = Math.min(out.length, from + Math.ceil(placed.playLength * BAND_RATE));
    for (let at = from; at < to; at += BAND_SLICE) {
      mixIntoRuler(out, BAND_RATE, placed, audio, at, Math.min(to, at + BAND_SLICE));
      await new Promise((r) => setTimeout(r, 0));
      if (stop()) return 'interrupted';
    }
    used++;
  }
  if (!used) return null;
  let peak = 0;
  for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]); if (v > peak) peak = v; }
  if (peak <= 1e-6) return null;
  const scale = 0.95 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/**
 * Confere qual batida é o tempo 1, sem mexer em nenhuma batida. Com acento no click vale a fase dele
 * (conta de milissegundos). Sem acento, o modelo ouve a mistura da banda, com o programa parado.
 * A correção entra no Desfazer como uma mudança só, junto com a marca da conferência. 'no-audio': falta
 * arquivo da banda, nada foi conferido.
 */
export async function checkSavedBarPhase(songId: string, canGoOn: () => boolean): Promise<'kept' | 'replaced' | 'no-click' | 'interrupted' | 'failed' | 'no-audio'> {
  const state = useStore.getState();
  const song = state.songs.find((s) => s.id === songId);
  const clickIds = medleySources(songId, true).clickClips;
  const clips = clickIds.flatMap((id) => state.clips.find((c) => c.id === id) ?? []);
  if (!song || !clips.length) return 'no-click';
  if (!canReplaceTempoMap(song)) return 'kept';
  const startKey = tempoCheckKey(songId);
  const signature = tempoMapSignature(song.tempoSegments);
  const stop = () => !canGoOn();
  const opened = await savedClickBuffer(songId, clips, clickIds, stop);
  if (typeof opened === 'string') return opened;
  const reading = await readTempoMap(opened.buffer, song.beatsPerBar ?? 4, { isClick: true, offset: opened.offset, duration: song.duration });
  if (stop()) return 'interrupted';
  if (!reading) return opened.buffer.duration < 30 ? 'kept' : 'failed';
  if (!reading.hits?.length || !reading.placed?.length) return 'kept';
  // mapa antigo ajustado à mão, ou grade que não passa pelo click: o 1 não é o problema dela
  if (oldMapLooksEdited(song, reading.hits)) return 'kept';
  const inClip = (t: number) => clips.some((c) => t >= c.startTime - 0.005 && t <= c.startTime + clipPlayLength(c));
  if (mapOffShare(song, reading.hits.filter(inClip), song.duration) > 0.02) return 'kept';

  let model: { downbeat: Float32Array; fps: number } | null = null;
  if (!reading.accented) {
    const mono = await bandRulerMono(songId, song.duration, stop);
    if (mono === 'interrupted' || stop()) return 'interrupted';
    if (mono === 'no-audio') return 'no-audio';
    if (!mono) return 'kept';
    const read = await readDownbeats(mono, canGoOn);
    if (read === 'interrupted' || stop()) return 'interrupted';
    if (!read) return 'failed';
    model = read;
  }
  // os ataques do click dizem onde ele para: a emenda de um medley no mesmo BPM só vale com o click parado
  const next = planBarPhase(song, { accented: reading.accented, placed: reading.placed, hits: reading.hits }, model);
  if (!next) return 'kept';

  await audioEngine.waitUntilIdle();
  if (stop()) return 'interrupted';
  const latest = useStore.getState().songs.find((s) => s.id === songId);
  if (!latest || tempoMapSignature(latest.tempoSegments) !== signature || latest.bpm !== song.bpm) return 'interrupted';
  // o compasso mudou enquanto a conta rodava: o 1 calculado era para o compasso antigo
  if ((latest.beatsPerBar ?? 4) !== (song.beatsPerBar ?? 4)) return 'interrupted';
  if (tempoCheckKey(songId) !== startKey || !canReplaceTempoMap(latest)) return 'interrupted';
  const mark = barMarkFor(songId, { ...latest, tempoSegments: next });
  useStore.setState((s) => ({
    songs: s.songs.map((sg) => (sg.id === songId ? {
      ...sg,
      tempoSegments: next,
      tempoMapSource: 'click' as const,
      tempoMapSig: tempoMapSignature(next),
      ...(mark ? { tempoBarCheck: mark } : {}),
    } : sg)),
  }));
  // sem aviso: as batidas não mudam, só qual delas é o 1, e o Desfazer volta (o aviso repetia a cada
  // abertura de projeto que não foi salvo depois da correção)
  return 'replaced';
}

// Sem faixa de click o mapa é uma estimativa: o usuário fica sabendo e confere as emendas.
const medleyNotices: string[] = [];

// Medley sem faixa de click: o programa cria o click seguindo o andamento de cada música.
async function addMedleyClick(songId: string): Promise<void> {
  const song = useStore.getState().songs.find((s) => s.id === songId);
  if (!song || clickClipsOf(useStore.getState().clips, songId).length) return;
  try {
    const buffer = await gridClickBuffer(song, song.duration);
    useStore.getState().addClip(await makeClickClip(song, buffer, 0));
  } catch (err) {
    console.warn('[medley] não consegui criar o click', err);
  }
}

// Palavra de click no nome do arquivo, inteira: "Metrô Linha 743" é música, não metrônomo.
const CLICK_WORD = /(^|[^\p{L}\p{N}])(click|clicks|clik|cliks|clique|cliques|klick|klik|clk|metronomo|metronome)(?=$|[^\p{L}\p{N}])/iu;
const hasClickWord = (text: string | undefined) => !!text && CLICK_WORD.test(text.normalize('NFD').replace(/\p{M}/gu, ''));
// Clipe de instrumento nunca é click, mesmo com a palavra no nome.
const INSTRUMENT_TRACKS = new Set<string>(['track-bateria', 'track-percussoes', 'track-contrabaixo', 'track-guitarras', 'track-violoes', 'track-sanfonas', 'track-teclados', 'track-solos', 'track-guia', 'track-maestro']);

/**
 * Clipes de click da música (todos, do primeiro para o último) e, sem eles, o áudio mais longo da
 * bateria ou da banda. `routedOnly` é a conferência automática: lá só vale o que está na faixa de click.
 */
function medleySources(songId: string, routedOnly = false): { clickClips: string[]; audioFallback: string | null } {
  const { clips, tracks } = useStore.getState();
  const songClips = clips.filter((c) => c.songId === songId);
  const targetOf = (c: AudioClip) => tracks.find((tr) => tr.id === c.trackId)?.parentId ?? c.trackId;
  const longest = (list: AudioClip[]) => [...list].sort((a, b) => b.duration - a.duration)[0]?.id ?? null;
  const isClick = (c: AudioClip) => {
    const target = targetOf(c);
    if (target === 'track-click') return true;
    return !routedOnly && !INSTRUMENT_TRACKS.has(target) && (hasClickWord(c.fileName) || hasClickWord(c.name));
  };
  const click = songClips.filter(isClick).sort((a, b) => a.startTime - b.startTime);
  const drums = songClips.filter((c) => targetOf(c) === 'track-bateria' || targetOf(c) === 'track-percussoes');
  const band = songClips.filter((c) => !['track-guia', 'track-maestro', 'track-click'].includes(targetOf(c)));
  return { clickClips: click.map((c) => c.id), audioFallback: longest(drums) ?? longest(band) ?? longest(songClips) };
}

async function applySingleBpm(songId: string, alive: () => boolean = () => true): Promise<boolean> {
  // Mapa de andamento feito à mão no REAPER (mais de um BPM na música): vale como está.
  const hint = reaperTempoHints.get(songId);
  if (hint && hint.tempo.length > 1) {
    setSongBpm(songId, hint.tempo[0].bpm, 'manual', 0, reaperSegments(hint), 'reaper');
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
    if (!alive()) return false;
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
    if (!alive()) return false;
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
  tempoSegments?: SongTempoSegment[],
  mapSource?: NonNullable<Song['tempoMapSource']>,
) {
  useStore.getState().updateSong(songId, {
    bpm,
    bpmDetected: true,
    bpmMissing: false,
    bpmSource: source,
    ...(downbeat !== undefined ? { downbeat } : {}),
    ...(tempoSegments && tempoSegments.length > 1 ? { tempoSegments } : {}),
    ...(mapSource && tempoSegments && tempoSegments.length > 1 ? { tempoMapSource: mapSource, tempoMapSig: tempoMapSignature(tempoSegments) } : {}),
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
  const ok = await applyBpm(songId, { asked: true });
  // aviso de trecho ruim ou de click que não fechou: fora da importação ele sairia daqui, sem resumo
  const notices = medleyNotices.splice(0);
  if (notices.length) useStore.getState().setPlaybackError(notices.join(' '));
  return ok ? 'ok' : 'failed';
}

// Terminada a importação, os áudios decodificados saem da memória e as músicas passam a tocar
// lendo do disco, como um projeto aberto. Antes a última música importada ficava inteira na
// memória até salvar e reabrir: num show longo, num Mac de 8 GB, a timeline travava.
// Ficam só a do ar e, se couberem no orçamento, a selecionada e a próxima (a mesma conta do App):
// assim o Play e a passagem para a próxima não começam a frio depois de importar.
function releaseImportedAudio() {
  const keep = keptWhileImporting(0);
  audioEngine.releaseUnretained(keep);
  retainSongs(keep, { strict: true });
}

/** Orçamento do áudio aberto: o da biblioteca, quando ela tem a função, senão a conta de reserva. */
function importMemoryBudget(): number {
  // a função de orçamento pode não existir nesta versão da biblioteca: procura sem depender dela
  const fromLibrary = Reflect.get(audioLibraryModule, 'audioMemoryBudget') as (() => { songs?: number }) | undefined;
  const songs = typeof fromLibrary === 'function' ? Number(fromLibrary()?.songs) : NaN;
  if (Number.isFinite(songs) && songs > 0) return songs;
  const desktop = (window as unknown as { vsDesktop?: { totalMemory?: number } }).vsDesktop;
  return importBudgetFallback(Number(desktop?.totalMemory), (navigator as Navigator & { deviceMemory?: number }).deviceMemory);
}

/** Bytes de uma música aberta: a cópia da biblioteca (se está aberta) mais a do reprodutor. */
function songOpenBytes(songId: string): number {
  const rate = deviceSampleRate();
  let bytes = 0;
  for (const c of useStore.getState().clips) {
    if (c.songId !== songId) continue;
    const full = Math.ceil(Math.max(0, c.duration || 0) * rate) * Math.min(2, Math.max(1, c.channels || 2)) * 2;
    const open = getClipAudio(c.id);
    bytes += full + (open ? open.channels.reduce((n, ch) => n + ch.byteLength, 0) : 0);
  }
  return bytes;
}

/** A do ar, e a selecionada e a próxima quando cabem junto com `importBytes` (a música que entra). */
function keptWhileImporting(importBytes: number): string[] {
  const st = useStore.getState();
  const playingId = st.transport.isStopped ? null : st.transport.currentSongId;
  const selId = st.selectedSongId ?? st.playlist[0]?.songId ?? null;
  const anchor = playingId ?? selId;
  const nextId = st.transport.nextSongId
    ?? (anchor ? computeNextSongId(anchor, st.playlist, st.playlistOrder, st.transport.playFlow) : null);
  return songsKeptDuringImport({
    playingId,
    candidates: [selId, nextId].map((id) => ({ id, bytes: id && id !== playingId ? songOpenBytes(id) : 0 })),
    usedBytes: (playingId ? songOpenBytes(playingId) : 0) + importBytes,
    budget: importMemoryBudget(),
  });
}

interface OpenedImport {
  audio: ClipAudio;
  duration: number;
  sampleRate: number;
  channels: number;
  waveformPeaks: number[];
}

/**
 * Abre um arquivo da importação. WAV na taxa da saída: pelo mesmo leitor em segundo plano da
 * reabertura do projeto (as amostras do arquivo, sem passar pelo Float32 do navegador). WAV em
 * outra taxa, MP3, M4A e os outros: pela decodificação do navegador, como antes, porque a troca de
 * taxa dele é bem mais rápida que a do leitor (medido no Chromium: 6 WAV de 3 min a 44,1 kHz numa
 * saída de 48 kHz, 0,83 s contra 2,1 s) e dá o mesmo tamanho e o mesmo alinhamento. Em todos, a
 * conversão para 16 bits e os picos da onda saem da tela.
 */
async function openImportFile(file: File): Promise<OpenedImport> {
  try {
    return await openImportFileOnce(file, true);
  } catch (err) {
    // o worker falhou depois de receber o áudio: abre de novo, com a conta na tela, como antes
    if (err instanceof ImportWorkerError) return openImportFileOnce(file, false);
    throw err;
  }
}

async function openImportFileOnce(file: File, useWorker: boolean): Promise<OpenedImport> {
  const rate = deviceSampleRate();
  // a mesma sonda do leitor (guardada por arquivo): não lê o cabeçalho duas vezes
  const sameRateWav = (await canReadWavDirect(file, rate)) && !(await wavConvertsRate(file, rate));
  const wav = sameRateWav ? await readWav(file, rate) : null;
  if (wav) {
    const duration = wav.length / wav.sampleRate;
    const numPeaks = importPeakCount(duration);
    const channels = wav.channels.length;
    const job = useWorker ? convertForImport('int16', wav.channels, numPeaks) : null;
    const done = job ? await job : { channels: wav.channels, peaks: await int16PeaksAsync(wav.channels, numPeaks) };
    return {
      audio: { channels: done.channels, sampleRate: wav.sampleRate, length: done.channels[0].length },
      duration,
      sampleRate: wav.sampleRate,
      channels,
      waveformPeaks: done.peaks,
    };
  }
  const buffer = await decodeBlob(file);
  // lidos antes de enviar: os canais vão transferidos ao worker e o AudioBuffer fica vazio
  const { duration, sampleRate, length, numberOfChannels } = buffer;
  const numPeaks = importPeakCount(duration);
  const floats: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, numberOfChannels); c++) floats.push(buffer.getChannelData(c));
  const job = useWorker ? convertForImport('float', floats, numPeaks) : null;
  if (job) {
    const done = await job;
    return { audio: { channels: done.channels, sampleRate, length }, duration, sampleRate, channels: numberOfChannels, waveformPeaks: done.peaks };
  }
  return {
    audio: await toClipAudioAsync(buffer),
    duration,
    sampleRate,
    channels: numberOfChannels,
    waveformPeaks: await waveformPeaksAsync(buffer, numPeaks),
  };
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
      await applyBpm(r.songId, { createClick: true });
    } catch (err) {
      console.warn('[import] BPM não medido', r.name, err);
    }
  }
  // o resumo da importação já saiu: o aviso de mapa medido depois aparece aqui
  const late = medleyNotices.splice(0);
  if (late.length) useStore.getState().setPlaybackError(late.join(' '));
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

  // Libera para a importação a memória de tudo que não está tocando agora. A selecionada e a
  // próxima só são soltas se não couberem no orçamento junto com esta música aberta (biblioteca
  // e reprodutor): com memória sobrando, o Play delas continua pronto durante a importação.
  const keep = keptWhileImporting(2 * audioFiles.reduce((n, f) => n + importFileBytes(f), 0));
  retainSongs(keep, { strict: true });
  audioEngine.releaseUnretained(keep);

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
      // já no formato leve (16 bits), com os picos da onda (100 por segundo) feitos fora da tela
      const opened = await openImportFile(file);
      if (cancelRequested) return false;
      decodedEntries[i] = { index: i, file, clipId: clipIds[i], ...opened };
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
    await applyBpm(songId, { createClick: true });
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
