import { decodeFile, generateMarkers } from '@/lib/audioDecoder';
import { routeByName, isUnreadableName } from '@/lib/nameRouter';
import { audioEngine } from '@/lib/audioEngine';
import { useStore } from '@/store';
import { clipAudioToBuffer, ensureSongLoaded, getClipAudio, putClipAudio, registerClipSource, retainSongs, toClipAudioAsync } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';
import type { AudioClip, PlaylistEntry, RoutingTarget, Song } from '@/types';
import { detectBpm, detectClickTempo, type TempoResult } from '@/lib/beatDetector';

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

export interface SongGroup {
  name: string;
  files: File[];
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

/** Cada pasta solta vira uma música; arquivos soltos sem pasta viram uma música só. */
export async function groupDroppedEntries(entries: FsEntry[]): Promise<SongGroup[]> {
  const groups: SongGroup[] = [];
  const loose: File[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      const files = (await readFolderFiles(entry)).filter(isAudio);
      if (files.length) groups.push({ name: entry.name, files });
    } else if (entry.isFile) {
      const [file] = await readFolderFiles(entry).catch(() => [] as File[]);
      if (file && isAudio(file)) loose.push(file);
    }
  }
  groups.sort(byName);
  if (loose.length) groups.push({ name: 'Música Importada', files: loose });
  return groups;
}

let queueBusy = false;

export function isImportRunning() {
  return queueBusy;
}

/** Importa as músicas uma por vez, liberando memória entre elas, e mostra um resumo no final. */
export async function importSongGroups(groups: SongGroup[]): Promise<void> {
  if (groups.length === 0) {
    useStore.getState().setPlaybackError('Nenhum arquivo de áudio encontrado nas pastas escolhidas.');
    return;
  }
  if (queueBusy) {
    useStore.getState().setPlaybackError('Já existe uma importação em andamento. Espere ela terminar e tente de novo.');
    return;
  }
  queueBusy = true;
  const results: SongImportResult[] = [];
  const brokenSongs: string[] = [];
  try {
    for (let k = 0; k < groups.length; k++) {
      const label = groups.length > 1 ? `Música ${k + 1} de ${groups.length}: ` : '';
      try {
        results.push(await importSong(groups[k].name, groups[k].files, label));
      } catch (err) {
        console.warn('[import] música não importada', groups[k].name, err);
        brokenSongs.push(groups[k].name);
      }
    }
    reportSummary(results, brokenSongs);
    await measurePendingBpm(results);
  } finally {
    queueBusy = false;
  }
}

function reportSummary(results: SongImportResult[], brokenSongs: string[]) {
  const store = useStore.getState();
  const withErrors = results.filter((r) => r.failed.length > 0);
  const ok = results.filter((r) => r.imported > 0).length;
  const hasProblem = withErrors.length > 0 || brokenSongs.length > 0;
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
  if (parts.length) store.setPlaybackError(`${parts.join('; ')}. Confira se esses arquivos abrem em outro programa e importe de novo.`);

  setTimeout(() => useStore.getState().setImportProgress(null), hasProblem ? 8000 : 3000);
}

// Todo VS tem click: tenta primeiro tudo que pareça click (pela trilha ou pelo nome), depois os demais áudios.
// Só se nenhum deles tiver pulso regular é que a bateria/percussão vai para a estimativa por áudio.
async function applyBpm(songId: string): Promise<boolean> {
  const { clickFirst, audioFallback } = bpmCandidates(songId);
  const song = useStore.getState().songs.find((s) => s.id === songId);
  const beatsPerBar = song?.beatsPerBar ?? 4;
  let result: TempoResult | null = null;
  let sourceId: string | null = null;
  for (const id of clickFirst) {
    const audio = getClipAudio(id);
    if (!audio) continue;
    result = detectClickTempo(audio, beatsPerBar);
    if (result) { sourceId = id; break; }
  }
  if (!result && audioFallback) {
    const audio = getClipAudio(audioFallback);
    if (audio) {
      result = await detectBpm(clipAudioToBuffer(audio));
      sourceId = audioFallback;
    }
  }
  if (!result || !sourceId) {
    useStore.getState().updateSong(songId, { bpmMissing: true });
    return false;
  }
  const clipStart = useStore.getState().clips.find((c) => c.id === sourceId)?.startTime ?? 0;
  setSongBpm(songId, result.bpm, result.fromClick ? 'click' : 'audio', result.downbeat + clipStart);
  return true;
}

export function setSongBpm(songId: string, bpm: number, source: NonNullable<Song['bpmSource']>, downbeat?: number) {
  useStore.getState().updateSong(songId, {
    bpm, bpmDetected: true, bpmMissing: false, bpmSource: source, ...(downbeat !== undefined ? { downbeat } : {}),
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
}

async function importSong(folderName: string, audioFiles: File[], label: string): Promise<SongImportResult> {
  const store = useStore.getState();
  const songId = `song-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
  };

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

  const clipIds = audioFiles.map((_, i) => `clip-${Date.now()}-${i}`);
  const errors = new Map<number, string>();

  const tryDecode = async (i: number): Promise<boolean> => {
    const file = audioFiles[i];
    try {
      const { audioBuffer, duration, sampleRate, channels } = await decodeFile(file);
      const waveformPeaks = audioEngine.generateWaveformPeaks(audioBuffer, 2000);
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
    await tryDecode(i);
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
      const idx = cursor++;
      if (idx >= total) return;
      await runOne(idx);
    }
  };
  for (let w = 0; w < Math.min(DECODE_CONCURRENCY, total); w++) workers.push(next());
  await Promise.all(workers);

  // Falhas costumam ser falta de memória momentânea: tenta de novo, um arquivo por vez.
  for (let attempt = 1; attempt <= 3 && errors.size > 0; attempt++) {
    for (const i of Array.from(errors.keys())) {
      useStore.getState().setImportProgress({
        clipId: clipIds[i],
        status: 'decoding',
        message: `${label}Tentando de novo (${attempt}/3): ${audioFiles[i].name}`,
        current: total - errors.size,
        total,
      });
      await new Promise((r) => setTimeout(r, 150 * attempt));
      await tryDecode(i);
    }
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
  let maxDuration = 0;

  for (const entry of decodedEntries) {
    if (!entry) continue;
    const { file, clipId, audio, duration, sampleRate, channels, waveformPeaks, index } = entry;

    const route = routeByName(file.name);
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

    const existingChild = useStore.getState().tracks.find((t) => {
      if (t.parentId !== trackId) return false;
      const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
      return norm(t.name) === norm(numberedName) || norm(t.name.replace(/\s+\d+$/, '')) === norm(childTrackName);
    });

    let actualTrackId: string;
    if (trackId === 'track-guia' || trackId === 'track-click' || trackId === 'track-maestro') {
      actualTrackId = trackId;
    } else if (existingChild) {
      actualTrackId = existingChild.id;
    } else {
      const childId = `${trackId}-child-${Date.now()}-${index}`;
      useStore.getState().addChildTrack(trackId, numberedName, childId);
      actualTrackId = childId;
    }

    const markers = generateMarkers(duration);

    const clip: AudioClip = {
      id: clipId,
      trackId: actualTrackId,
      name: numberedName,
      fileName: file.name,
      filePath: URL.createObjectURL(file),
      songId,
      startTime: 0,
      duration,
      sampleRate,
      channels,
      bpm: null,
      markers,
      routingMethod,
      routingConfidence,
      waveformPeaks,
    };

    registerClipSource(clipId, songId, file);
    putClipAudio(clipId, songId, audio);
    useStore.getState().addClip(clip);
    if (duration > maxDuration) maxDuration = duration;
  }

  useStore.getState().updateSong(songId, { duration: maxDuration });

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
