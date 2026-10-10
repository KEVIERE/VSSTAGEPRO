import { encodeWavFloat32 } from '@/lib/wavEncoder';
import { faderToGain, isMelodicTrack } from '@/lib/audioEngine';
import { processClipAudioAsync, bpmAdjustToAlpha } from '@/lib/timeStretch';
import { clipAudioToBuffer, clipPlayLength, getClipPlayAudio, withSongAudio } from '@/lib/audioLibrary';
import { DiskFullError, openFileTarget, openFolderTarget, type ExportTarget } from '@/lib/exportTarget';
import { isTimecodeTrackId } from '@/lib/timecode';
import type { AudioClip, ProjectState, Song, Track } from '@/types';

export type BounceMode = 'lr' | 'multipista';

function sanitize(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Sem Nome';
}

// No multipista cada faixa sai inteira: mudo e solo da mesa não calam o arquivo.
function channelGain(track: Track, all: Track[], respectMuteSolo: boolean): number {
  if (respectMuteSolo) {
    if (track.mute) return 0;
    const anySolo = all.some((t) => t.solo && !t.isSubgroup && !isTimecodeTrackId(t.id));
    if (anySolo && !track.solo && !track.isSubgroup) return 0;
  }
  let g = faderToGain(track.volume);
  let p = track.parentId ? all.find((t) => t.id === track.parentId) : null;
  while (p) {
    if (respectMuteSolo && p.mute) return 0;
    g *= faderToGain(p.volume);
    p = p.parentId ? all.find((t) => t.id === p!.parentId) : null;
  }
  return g;
}

function effectivePan(track: Track, lrMasterActive: boolean): number {
  if (!lrMasterActive) return track.pan;
  if (track.id === 'track-guia' || track.id === 'track-click' || track.id === 'track-maestro') return -1;
  return 1;
}

function songLength(song: Song, clips: AudioClip[]): number {
  const songClips = clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId));
  const maxEnd = songClips.reduce((m, c) => Math.max(m, c.startTime + clipPlayLength(c)), 0);
  return Math.max(maxEnd, 1);
}

async function renderOffline(
  song: Song,
  tracks: Track[],
  clips: AudioClip[],
  lrMasterActive: boolean,
  trackFilter?: (t: Track) => boolean
): Promise<AudioBuffer> {
  const bpmAdjust = song.bpmAdjust || 0;
  const alpha = bpmAdjustToAlpha(bpmAdjust);
  const duration = songLength(song, clips) * alpha;
  const sampleRate = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const cents = (song.tuner || 0) * 100;
  const respectMuteSolo = !trackFilter;

  const trackChannels = new Map<string, { gain: GainNode; panner: StereoPannerNode }>();
  const ensureChannel = (track: Track) => {
    const existing = trackChannels.get(track.id);
    if (existing) return existing;
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    gain.gain.value = channelGain(track, tracks, respectMuteSolo);
    panner.pan.value = effectivePan(track, lrMasterActive);
    gain.connect(panner);
    panner.connect(ctx.destination);
    const node = { gain, panner };
    trackChannels.set(track.id, node);
    return node;
  };

  for (const clip of clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId))) {
    const clipAudio = getClipPlayAudio(clip);
    if (!clipAudio) continue;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (!track) continue;
    if (trackFilter && !trackFilter(track)) continue;

    const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
    const channel = ensureChannel(target);
    const source = ctx.createBufferSource();
    const melodic = isMelodicTrack(track, tracks);
    source.buffer = await processClipAudioAsync(ctx, clipAudio, alpha, melodic ? cents : 0);
    source.playbackRate.value = 1;
    const clipGain = ctx.createGain();
    clipGain.gain.value = target !== track ? channelGain(track, tracks, respectMuteSolo) / Math.max(1e-6, channelGain(target, tracks, respectMuteSolo)) : 1;
    source.connect(clipGain);
    clipGain.connect(channel.gain);
    source.start(clip.startTime * alpha);
  }

  return await ctx.startRendering();
}

// O timecode sai como o arquivo original: sem BPM, sem afinador e sem fader.
function timecodeBuffer(clip: AudioClip): AudioBuffer | null {
  const audio = getClipPlayAudio(clip);
  return audio ? clipAudioToBuffer(audio) : null;
}

export async function renderLrMasterForSong(song: Song, state: ProjectState): Promise<AudioBuffer> {
  return withSongAudio(song.id, () => renderOffline(song, state.tracks, state.clips, state.lrMasterActive));
}

export interface ExportProgress {
  fraction: number;
  label: string;
  saved: number;
  total: number;
  location: string;
}

export interface DiskFullInfo {
  saved: number;
  total: number;
  needed: number;
  file: string;
  checkFree: () => Promise<number | null>;
}

export interface ExportHooks {
  onProgress: (p: ExportProgress) => void;
  onDiskFull: (info: DiskFullInfo) => Promise<'continue' | 'stop'>;
  cancelled: () => boolean;
}

export interface ExportRequest {
  scope: 'musica' | 'projeto';
  songId?: string;
  mode: BounceMode;
}

export interface ExportResult {
  status: 'done' | 'stopped' | 'cancelled';
  saved: number;
  total: number;
  songsSaved: number;
  songsTotal: number;
  incomplete: string[];
  empty: string[];
  location: string;
  reveal: (() => Promise<void>) | null;
}

interface FileJob {
  name: string;
  label: string;
  render: () => Promise<ArrayBuffer>;
}

// Antes de carregar o áudio, conta as faixas que têm clipe para a barra de progresso já começar certa.
function estimateFiles(song: Song, state: ProjectState, mode: BounceMode): number {
  if (mode === 'lr') return 1;
  const known = new Set(state.tracks.map((t) => t.id));
  return new Set(state.clips.filter((c) => c.songId === song.id && known.has(c.trackId)).map((c) => c.trackId)).size;
}

function multitrackJobs(song: Song, state: ProjectState): FileJob[] {
  const songClips = state.clips
    .filter((c) => c.songId === song.id && getClipPlayAudio(c))
    .sort((a, b) => a.startTime - b.startTime);
  const order = new Map(state.tracks.map((t, i) => [t.id, i]));
  const trackIds = Array.from(new Set(songClips.map((c) => c.trackId)))
    .filter((id) => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  const jobs: FileJob[] = [];
  const tcClip = songClips.find((c) => isTimecodeTrackId(c.trackId));
  if (tcClip) {
    jobs.push({
      name: 'TIMECODE (LTC).wav',
      label: 'Timecode (LTC)',
      render: async () => {
        const buf = timecodeBuffer(tcClip);
        if (!buf) throw new Error('Não foi possível ler o áudio do timecode.');
        return encodeWavFloat32(buf);
      },
    });
  }
  const stems = trackIds.filter((id) => !isTimecodeTrackId(id)).map((id) => state.tracks.find((t) => t.id === id)!);
  const used = new Map<string, number>();
  stems.forEach((track, i) => {
    const base = sanitize(track.name);
    const n = (used.get(base.toLowerCase()) ?? 0) + 1;
    used.set(base.toLowerCase(), n);
    jobs.push({
      name: n === 1 ? `${base}.wav` : `${base} (${n}).wav`,
      label: `Faixa ${i + 1} de ${stems.length}: ${track.name}`,
      render: async () =>
        encodeWavFloat32(await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, (t) => t.id === track.id)),
    });
  });
  return jobs;
}

export async function runExport(req: ExportRequest, state: ProjectState, hooks: ExportHooks): Promise<ExportResult | null> {
  const ordered = state.playlistOrder
    .map((id) => state.songs.find((s) => s.id === id))
    .filter((s): s is Song => !!s);
  const songs = req.scope === 'musica'
    ? state.songs.filter((s) => s.id === req.songId)
    : ordered.length ? ordered : state.songs;
  if (songs.length === 0) {
    throw new Error(req.scope === 'musica' ? 'Música não encontrada.' : 'O projeto não tem músicas para exportar.');
  }

  const projectName = sanitize(state.projectName);
  const suffix = req.mode === 'lr' ? 'LR MASTER' : 'MULTIPISTA';
  let target: ExportTarget;
  let baseRel: string;
  let lrFileName = '';
  if (req.scope === 'musica' && req.mode === 'lr') {
    const picked = await openFileTarget(`${sanitize(songs[0].name)} - LR MASTER.wav`);
    if (!picked) return null;
    target = picked.target;
    lrFileName = picked.name;
    baseRel = '';
  } else if (req.scope === 'musica') {
    const t = await openFolderTarget('Escolha onde salvar a multipista', `${sanitize(songs[0].name)} - MULTIPISTA.zip`);
    if (!t) return null;
    target = t;
    baseRel = `${sanitize(songs[0].name)}/`;
  } else {
    const t = await openFolderTarget('Escolha onde salvar o projeto', `${projectName} - ${suffix}.zip`);
    if (!t) return null;
    target = t;
    baseRel = `${projectName}/`;
  }

  const estimates = songs.map((s) => estimateFiles(s, state, req.mode));
  let total = estimates.reduce((a, b) => a + b, 0);
  let saved = 0;
  let songsSaved = 0;
  const run: { status: ExportResult['status'] } = { status: 'done' };
  const incomplete: string[] = [];
  const empty: string[] = [];
  const report = (label: string, part: number) =>
    hooks.onProgress({ fraction: total ? Math.min(1, (saved + part) / total) : 0, label, saved, total, location: target.location });

  report('Preparando...', 0);
  for (let si = 0; si < songs.length; si++) {
    const song = songs[si];
    const songLabel = songs.length > 1 ? `Música ${si + 1} de ${songs.length} – ${song.name}` : song.name;
    if (run.status !== 'done') { incomplete.push(song.name); continue; }
    report(`${songLabel} · carregando áudio`, 0);
    const songSaved = await withSongAudio(song.id, async () => {
      const jobs: FileJob[] = req.mode === 'lr'
        ? [{
            name: lrFileName || `${sanitize(song.name)} - LR MASTER.wav`,
            label: 'mix LR Master',
            render: async () => encodeWavFloat32(await renderOffline(song, state.tracks, state.clips, state.lrMasterActive)),
          }]
        : multitrackJobs(song, state);
      total += jobs.length - estimates[si];
      let count = 0;
      for (const job of jobs) {
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        report(`${songLabel} · ${job.label}`, 0);
        const data = await job.render();
        report(`${songLabel} · salvando ${job.name}`, 0.9);
        const rel = req.scope === 'projeto' ? `${baseRel}${sanitize(song.name)}/${job.name}` : `${baseRel}${job.name}`;
        for (;;) {
          try {
            await target.write(rel, data);
            break;
          } catch (err) {
            if (!(err instanceof DiskFullError)) throw err;
            const choice = await hooks.onDiskFull({ saved, total, needed: data.byteLength, file: job.name, checkFree: target.freeSpace });
            if (choice === 'stop') { run.status = 'stopped'; break; }
          }
        }
        if (run.status !== 'done') break;
        saved++;
        count++;
      }
      if (jobs.length === 0) empty.push(song.name);
      else if (count < jobs.length) incomplete.push(song.name);
      return count;
    });
    if (songSaved > 0) songsSaved++;
  }

  if (saved === 0 && run.status === 'done') {
    throw new Error(req.scope === 'musica'
      ? `"${songs[0].name}" não tem nenhuma faixa com áudio para exportar.`
      : 'Nenhuma música do projeto tem faixas com áudio para exportar.');
  }
  if (saved > 0) {
    report('Finalizando...', 0);
    await target.finish();
  }
  const revealRel = req.scope === 'musica' && req.mode === 'lr' ? lrFileName : baseRel.replace(/\/$/, '');
  return {
    status: run.status,
    saved,
    total,
    songsSaved,
    songsTotal: songs.length,
    incomplete,
    empty,
    location: target.location,
    reveal: target.reveal && saved > 0 ? () => target.reveal!(revealRel) : null,
  };
}
