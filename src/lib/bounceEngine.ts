import { encodeWavPcm24, encodePcm24, wavHeaderPcm24 } from '@/lib/wavEncoder';
import { clipGainFor, channelGainFor, createSafetyLimiter, faderToGain, isMelodicTrack } from '@/lib/audioEngine';
import { processClipAudioAsync, bpmAdjustToAlpha } from '@/lib/timeStretch';
import { clipAudioToBuffer, clipPlayLength, getClipPlayAudio, getClipSource, openClipAudio, putClipAudio, releaseClipAudio, withSongAudio, type ClipAudio } from '@/lib/audioLibrary';
import { DiskFullError, openFileTarget, openFolderTarget, type ExportTarget } from '@/lib/exportTarget';
import { isTimecodeTrackId } from '@/lib/timecode';
import { isMedley, isSliceEnabled, medleySlices, sliceParams } from '@/lib/medley';
import { evaluateFadeCurve } from '@/types';
import type { AudioClip, ProjectState, Song, Track } from '@/types';

export type BounceMode = 'lr' | 'multipista' | 'show-continuo';

function sanitize(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || 'Sem Nome';
}

function effectivePan(trackId: string, trackPan: number, lrMasterActive: boolean): number {
  if (isTimecodeTrackId(trackId)) return 0;
  if (!lrMasterActive) return trackPan;
  if (trackId === 'track-guia' || trackId === 'track-click' || trackId === 'track-maestro') return -1;
  return 1;
}

function songLength(song: Song, clips: AudioClip[]): number {
  const songClips = clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId));
  const maxEnd = songClips.reduce((m, c) => Math.max(m, c.startTime + clipPlayLength(c)), 0);
  return Math.max(maxEnd, 1);
}

function createBufferFallback(length: number, channels: number, sampleRate: number): AudioBuffer {
  try {
    return new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate });
  } catch {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const dummy = new AudioContextClass();
    const buf = dummy.createBuffer(channels, Math.max(1, length), sampleRate);
    dummy.close().catch(() => {});
    return buf;
  }
}

function concatAudioBuffers(buffers: AudioBuffer[]): AudioBuffer {
  if (buffers.length === 0) return createBufferFallback(1, 2, 48000);
  if (buffers.length === 1) return buffers[0];
  const sampleRate = buffers[0].sampleRate;
  const totalFrames = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = createBufferFallback(totalFrames, 2, sampleRate);
  let offset = 0;
  for (const b of buffers) {
    for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) {
      out.copyToChannel(b.getChannelData(c), c, offset);
    }
    offset += b.length;
  }
  return out;
}

// Quantos clipes entram juntos em cada passada de renderização. Cada passada converte só o áudio
// dela para o formato nativo e libera tudo ao terminar: o pico de memória deixa de crescer com o
// número de faixas, que era o que fazia faixas sumirem (mudas) ou a exportação falhar no navegador.
const EXPORT_BATCH = 1;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Áudio aberto de um clipe para exportar. Se a memória já soltou o áudio, reabre do arquivo e
 * tenta de novo antes de desistir. Quando realmente não abre, avisa com erro: uma faixa NUNCA
 * pode sair muda no arquivo exportado sem ninguém saber.
 * Se o arquivo estiver ausente, falha com o nome do clipe em vez de gerar silêncio.
 */
async function exportAudioFor(clip: AudioClip): Promise<ClipAudio> {
  const cached = getClipPlayAudio(clip);
  if (cached) return cached;
  const src = getClipSource(clip.id);
  if (!src) {
    throw new Error(`O clipe "${clip.name}" não tem áudio acessível para exportar. Relocalize o arquivo ausente e tente novamente.`);
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const audio = await openClipAudio(clip.songId, clip.id, src);
      putClipAudio(clip.id, clip.songId, audio);
      const playable = getClipPlayAudio(clip);
      if (playable) return playable;
      throw new Error(`O áudio do clipe "${clip.name}" está vazio ou não pôde ser lido.`);
    } catch (err) {
      lastErr = err;
      console.warn(`[bounce] tentativa ${attempt + 1} de abrir "${clip.name}" falhou:`, err);
    }
    await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
  }
  console.error('[bounce] clipe não abriu para exportar:', clip.name, lastErr);
  throw new Error(`Não foi possível abrir o áudio "${clip.name}" para exportar (memória insuficiente ou arquivo ilegível). Feche outros programas e tente de novo.`);
}

/** Converte e libera o original imediatamente; o grafo offline conserva só o buffer processado do clipe atual. */
async function processExportClip(
  ctx: BaseAudioContext,
  clip: AudioClip,
  alpha: number,
  cents: number,
): Promise<AudioBuffer> {
  const audio = await exportAudioFor(clip);
  try {
    return await processClipAudioAsync(ctx, audio, alpha, cents);
  } finally {
    releaseClipAudio(clip.id);
    await yieldToUi();
  }
}

// Renderiza um trecho isolado [sliceStart, sliceEnd] com BPM e Tom específicos daquele trecho
async function renderSliceOffline(
  song: Song,
  sliceStart: number,
  sliceEnd: number,
  bpmAdjust: number,
  tuner: number,
  tracks: Track[],
  clips: AudioClip[],
  lrMasterActive: boolean,
  trackFilter?: (t: Track) => boolean,
  applyMasterLimiter = false
): Promise<AudioBuffer> {
  const alpha = bpmAdjustToAlpha(bpmAdjust);
  const sliceDurSec = Math.max(0.05, sliceEnd - sliceStart);
  const outDuration = sliceDurSec * alpha;
  const sampleRate = 48000;
  const totalFrames = Math.max(1, Math.ceil(outDuration * sampleRate));
  const cents = tuner * 100;
  const respectMuteSolo = !trackFilter;

  const songClips = clips.filter((c) => c.songId === song.id && !isTimecodeTrackId(c.trackId));

  // Só entram os clipes que cruzam este trecho e pertencem às faixas pedidas. O filtro vem ANTES
  // de abrir qualquer áudio: na multipista cada arquivo abre só o que é dele.
  const wanted: Array<{ clip: AudioClip; track: Track }> = [];
  for (const clip of songClips) {
    const clipEnd = clip.startTime + clipPlayLength(clip);
    if (clipEnd <= sliceStart || clip.startTime >= sliceEnd) continue;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (!track) throw new Error(`O clipe "${clip.name}" de "${song.name}" aponta para uma faixa inexistente. Corrija o roteamento antes de exportar.`);
    if (trackFilter && !trackFilter(track)) continue;
    wanted.push({ clip, track });
  }

  // O mix das passadas é somado aqui (a soma de sinais é exatamente o que o Web Audio faz no destino).
  const accL = new Float32Array(totalFrames);
  const accR = new Float32Array(totalFrames);

  for (let from = 0; from < wanted.length; from += EXPORT_BATCH) {
    const batch = wanted.slice(from, from + EXPORT_BATCH);
    const ctx = new OfflineAudioContext(2, totalFrames, sampleRate);

    const trackChannels = new Map<string, { gain: GainNode; panner: StereoPannerNode }>();
    const ensureChannel = (targetTrack: Track) => {
      const existing = trackChannels.get(targetTrack.id);
      if (existing) return existing;
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();
      gain.gain.value = respectMuteSolo ? channelGainFor(targetTrack, tracks, targetTrack.volume) : faderToGain(targetTrack.volume);
      panner.pan.value = effectivePan(targetTrack.id, targetTrack.pan, lrMasterActive);
      gain.connect(panner);
      panner.connect(ctx.destination);
      const node = { gain, panner };
      trackChannels.set(targetTrack.id, node);
      return node;
    };

    let scheduled = 0;
    for (const { clip, track } of batch) {
      const clipPlayLen = clipPlayLength(clip);
      const melodic = isMelodicTrack(track, tracks);
      const processed = await processExportClip(ctx, clip, alpha, melodic ? cents : 0);

      const target = track.parentId ? tracks.find((t) => t.id === track.parentId) ?? track : track;
      const channel = ensureChannel(target);
      const source = ctx.createBufferSource();
      source.buffer = processed;
      source.playbackRate.value = 1;

      const clipGain = ctx.createGain();
      const trackVolumeGain = track.parentId
        ? (respectMuteSolo ? channelGainFor(track, tracks, track.volume) : faderToGain(track.volume))
        : 1;
      const baseGain = trackVolumeGain * clipGainFor(clip, songClips);

      const playDuration = clipPlayLen * alpha;
      const startWall = Math.max(0, clip.startTime - sliceStart) * alpha;
      const fadeIn = (clip.fadeIn ?? 0) * alpha;
      const fadeOut = (clip.fadeOut ?? 0) * alpha;
      if (fadeIn > 0 || fadeOut > 0) {
        const fadeOutStart = Math.max(fadeIn, playDuration - fadeOut);
        if (fadeIn > 0) {
          const curveIn = clip.fadeCurveIn ?? 'linear';
          clipGain.gain.setValueAtTime(0, startWall);
          if (curveIn === 'linear') {
            clipGain.gain.linearRampToValueAtTime(baseGain, startWall + fadeIn);
          } else {
            const STEPS = 8;
            for (let i = 1; i <= STEPS; i++) {
              const frac = i / STEPS;
              clipGain.gain.linearRampToValueAtTime(evaluateFadeCurve(curveIn, frac, true) * baseGain, startWall + frac * fadeIn);
            }
          }
        } else {
          clipGain.gain.setValueAtTime(baseGain, startWall);
        }
        if (fadeOut > 0) {
          const curveOut = clip.fadeCurveOut ?? 'linear';
          clipGain.gain.setValueAtTime(baseGain, startWall + fadeOutStart);
          if (curveOut === 'linear') {
            clipGain.gain.linearRampToValueAtTime(0, startWall + playDuration);
          } else {
            const STEPS = 8;
            for (let i = 1; i <= STEPS; i++) {
              const frac = i / STEPS;
              clipGain.gain.linearRampToValueAtTime(evaluateFadeCurve(curveOut, frac, false) * baseGain, startWall + fadeOutStart + frac * fadeOut);
            }
          }
        }
      } else {
        clipGain.gain.value = baseGain;
      }

      source.connect(clipGain);

      if (track.parentId) {
        const clipPan = ctx.createStereoPanner();
        clipPan.pan.value = effectivePan(track.id, track.pan, lrMasterActive);
        clipGain.connect(clipPan);
        clipPan.connect(channel.gain);
      } else {
        clipGain.connect(channel.gain);
      }

      const localStart = clip.startTime - sliceStart;
      const when = Math.max(0, localStart * alpha);
      const offset = localStart < 0 ? Math.max(0, -localStart * alpha) : 0;
      const bufDur = source.buffer?.duration ?? 0;
      if (offset >= bufDur - 0.005) {
        throw new Error(`O clipe "${clip.name}" termina antes da fatia "${song.name}" (${sliceStart.toFixed(2)}s). Confira os cortes e a posição do clipe.`);
      }
      try {
        if (offset > 0.001) source.start(when, offset);
        else source.start(when);
        scheduled++;
      } catch (err) {
        console.error('[bounce] agendamento falhou:', clip.name, err);
        throw new Error(`Não foi possível agendar o clipe "${clip.name}" na exportação.`);
      }
      await yieldToUi();
    }

    if (scheduled > 0) {
      const rendered = await ctx.startRendering();
      const l = rendered.getChannelData(0);
      const r = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : l;
      const n = Math.min(totalFrames, rendered.length);
      for (let i = 0; i < n; i++) {
        accL[i] += l[i];
        accR[i] += r[i];
      }
    }
    await yieldToUi();
  }

  const mixed = createBufferFallback(totalFrames, 2, sampleRate);
  mixed.copyToChannel(accL, 0);
  mixed.copyToChannel(accR, 1);
  if (!applyMasterLimiter) return mixed;

  // Limitador de segurança do master, aplicado sobre a soma final (como na mesa de reprodução).
  const master = new OfflineAudioContext(2, totalFrames, sampleRate);
  const src = master.createBufferSource();
  src.buffer = mixed;
  const makeup = master.createGain();
  makeup.gain.value = Math.pow(10, 1.5 / 20);
  const limiter = createSafetyLimiter(master);
  src.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(master.destination);
  src.start(0);
  return await master.startRendering();
}

async function renderOffline(
  song: Song,
  tracks: Track[],
  clips: AudioClip[],
  lrMasterActive: boolean,
  trackFilter?: (t: Track) => boolean,
  applyMasterLimiter = false
): Promise<AudioBuffer> {
  // Se for um Medley com fatias:
  // - Renderiza apenas as fatias marcadas (enabled !== false), pulando as desmarcadas!
  // - Cada fatia respeita o seu próprio Tom (tuner) e BPM (bpmAdjust)!
  // - Emenda as fatias marcadas em sequência contínua
  if (isMedley(song)) {
    const slices = medleySlices(song).filter(isSliceEnabled);
    if (slices.length === 0) {
      return new AudioBuffer({ length: 48000, numberOfChannels: 2, sampleRate: 48000 });
    }
    const buffers: AudioBuffer[] = [];
    for (const s of slices) {
      const p = sliceParams(song, s);
      const buf = await renderSliceOffline(
        song,
        s.start,
        s.end,
        p.bpmAdjust,
        p.tuner,
        tracks,
        clips,
        lrMasterActive,
        trackFilter,
        applyMasterLimiter
      );
      buffers.push(buf);
    }
    return concatAudioBuffers(buffers);
  }

  // Música padrão (sem fatias de medley): renderiza do início ao fim respeitando BPM e Tom da música
  const duration = songLength(song, clips);
  return renderSliceOffline(
    song,
    0,
    duration,
    song.bpmAdjust || 0,
    song.tuner || 0,
    tracks,
    clips,
    lrMasterActive,
    trackFilter,
    applyMasterLimiter
  );
}

// O timecode sai como o arquivo original: sem BPM, sem afinador e sem fader.
async function timecodeBuffer(clip: AudioClip): Promise<AudioBuffer> {
  const audio = await exportAudioFor(clip);
  try {
    return clipAudioToBuffer(audio);
  } finally {
    releaseClipAudio(clip.id);
  }
}

export async function renderLrMasterForSong(song: Song, state: ProjectState): Promise<AudioBuffer> {
  return withSongAudio(song.id, () => renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true));
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
  if (mode === 'lr' || mode === 'show-continuo') return 1;
  const known = new Set(state.tracks.map((t) => t.id));
  return new Set(state.clips.filter((c) => c.songId === song.id && known.has(c.trackId)).map((c) => c.trackId)).size;
}

function multitrackJobs(song: Song, state: ProjectState): FileJob[] {
  const songClips = state.clips
    .filter((c) => c.songId === song.id)
    .sort((a, b) => a.startTime - b.startTime);
  const order = new Map(state.tracks.map((t, i) => [t.id, i]));
  const orphan = songClips.find((c) => !order.has(c.trackId));
  if (orphan) throw new Error(`O clipe "${orphan.name}" de "${song.name}" aponta para uma faixa inexistente. Corrija o roteamento antes de exportar.`);
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
        const buf = await timecodeBuffer(tcClip);
        return encodeWavPcm24(buf);
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
        encodeWavPcm24(await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, (t) => t.id === track.id)),
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
  const suffix = req.mode === 'lr' ? 'LR MASTER' : req.mode === 'show-continuo' ? 'SHOW CONTINUO' : 'MULTIPISTA';
  let target: ExportTarget;
  let baseRel: string;
  let lrFileName = '';
  if (req.mode === 'show-continuo') {
    const picked = await openFileTarget(`${projectName} - SHOW COMPLETO CONTÍNUO.wav`);
    if (!picked) return null;
    target = picked.target;
    lrFileName = picked.name;
    baseRel = '';
  } else if (req.scope === 'musica' && req.mode === 'lr') {
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

  // Modo Show Contínuo: mixa cada música do show e emenda todas em sequência num único WAV master estéreo.
  // Cada música é renderizada, gravada no disco e descartada da memória antes da próxima começar —
  // em nenhum momento o show inteiro fica inteiro em RAM, mesmo com dezenas de músicas longas.
  if (req.mode === 'show-continuo') {
    const outName = lrFileName || `${projectName} - SHOW COMPLETO CONTÍNUO.wav`;
    const sampleRate = 48000;

    // Precisa saber a duração total ANTES de escrever (o cabeçalho WAV declara o tamanho do arquivo
    // logo no início). Considera exatamente as fatias marcadas em cada medley e o BPM de cada uma.
    const songFrames = songs.map((s) => {
      if (isMedley(s)) {
        const slices = medleySlices(s).filter(isSliceEnabled);
        return slices.reduce((sum, sl) => {
          const p = sliceParams(s, sl);
          const alpha = bpmAdjustToAlpha(p.bpmAdjust);
          return sum + Math.max(1, Math.ceil((sl.end - sl.start) * alpha * sampleRate));
        }, 0);
      }
      const alpha = bpmAdjustToAlpha(s.bpmAdjust || 0);
      return Math.max(1, Math.ceil(songLength(s, state.clips) * alpha * sampleRate));
    });
    const totalFrames = songFrames.reduce((a, b) => a + b, 0);

    if (!target.openStream) {
      // Destino sem suporte a gravação em pedaços (ex.: download direto no navegador sem app
      // nem acesso a pastas): mantém o caminho em memória como alternativa, com aviso de escala.
      const renderedBuffers: AudioBuffer[] = [];
      for (let si = 0; si < songs.length; si++) {
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        const song = songs[si];
        report(`Música ${si + 1} de ${songs.length} – ${song.name} · mixando`, 0);
        try {
          await withSongAudio(song.id, async () => {
            const buf = await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true);
            renderedBuffers.push(buf);
          });
          saved++;
          songsSaved++;
        } catch (err) {
          console.warn('[bounce] falha na música', song.name, err);
          incomplete.push(song.name);
        }
      }
      if (run.status === 'cancelled' || renderedBuffers.length === 0) {
        return {
          status: run.status, location: target.location, saved: songsSaved, total: songs.length,
          songsSaved, songsTotal: songs.length, incomplete, empty, reveal: null,
        };
      }
      report('Emendando músicas em sequência contínua...', 0.92);
      const sr = renderedBuffers[0].sampleRate;
      const totalF = renderedBuffers.reduce((sum, b) => sum + b.length, 0);
      const fullBuffer = createBufferFallback(totalF, 2, sr);
      let frameOffset = 0;
      for (const b of renderedBuffers) {
        for (let ch = 0; ch < Math.min(2, b.numberOfChannels); ch++) {
          fullBuffer.copyToChannel(b.getChannelData(ch), ch, frameOffset);
        }
        frameOffset += b.length;
      }
      report('Codificando WAV do show completo...', 0.96);
      const data = encodeWavPcm24(fullBuffer);
      report(`Salvando ${outName}...`, 0.98);
      await target.write(outName, data);
      return {
        status: 'done', location: target.location, saved: 1, total: 1,
        songsSaved, songsTotal: songs.length, incomplete, empty,
        reveal: target.reveal ? () => target.reveal!(outName) : null,
      };
    }

    const stream = await target.openStream(outName);
    try {
      await stream.append(wavHeaderPcm24(totalFrames, 2, sampleRate));

      for (let si = 0; si < songs.length; si++) {
        if (hooks.cancelled()) { run.status = 'cancelled'; break; }
        const song = songs[si];
        const songLabel = `Música ${si + 1} de ${songs.length} – ${song.name}`;
        report(`${songLabel} · mixando faixa`, 0);
        try {
          await withSongAudio(song.id, async () => {
            const buf = await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true);
            report(`${songLabel} · gravando no disco`, 0.5);
            // PCM dessa música vai direto pro arquivo; o buffer sai de escopo e pode ser liberado
            // pelo coletor de lixo antes da próxima música começar a renderizar.
            await stream.append(encodePcm24(buf));
          });
          saved++;
          songsSaved++;
        } catch (err) {
          console.warn('[bounce] falha na música', song.name, err);
          incomplete.push(song.name);
        }
        report(`${songLabel} · concluída`, 1);
      }

      if (run.status === 'cancelled') {
        await stream.abort();
        return {
          status: 'cancelled', location: target.location, saved: songsSaved, total: songs.length,
          songsSaved, songsTotal: songs.length, incomplete, empty, reveal: null,
        };
      }
      if (songsSaved === 0) {
        await stream.abort();
        throw new Error('Nenhuma música do show pôde ser mixada para o áudio contínuo.');
      }

      report('Finalizando arquivo do show completo...', 0.99);
      await stream.close();
    } catch (err) {
      await stream.abort().catch(() => {});
      throw err;
    }

    return {
      status: 'done', location: target.location, saved: 1, total: 1,
      songsSaved, songsTotal: songs.length, incomplete, empty,
      reveal: target.reveal ? () => target.reveal!(outName) : null,
    };
  }

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
            render: async () => encodeWavPcm24(await renderOffline(song, state.tracks, state.clips, state.lrMasterActive, undefined, true)),
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
