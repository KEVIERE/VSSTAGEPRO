import type { AudioClip, Song } from '@/types';

// Contas do click (compasso antes do início e recriar metrônomo). Sem áudio, para dar para testar.

export const CLICK_TRACK_ID = 'track-click';

type SongTempo = Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>;

/** Andamento que vale no instante `at` (o trecho de andamento dele, ou o BPM da música). */
export function bpmAt(song: SongTempo, at: number): number {
  const segs = song.tempoSegments;
  if (segs && segs.length > 1) {
    const seg = segs.find((s) => at >= s.startTime && at < s.endTime)
      ?? (at < segs[0].startTime ? segs[0] : segs[segs.length - 1]);
    if (seg?.bpm > 0) return seg.bpm;
  }
  return song.bpm > 0 ? song.bpm : 120;
}

export function beatsPerBarOf(song: Pick<Song, 'beatsPerBar'>): number {
  return song.beatsPerBar ?? 4;
}

/** Duração de um compasso no instante `at`. */
export function barSeconds(song: SongTempo, at: number): number {
  return beatsPerBarOf(song) * 60 / bpmAt(song, at);
}

/** Tempo que o clipe toca (sem as partes cortadas). Igual ao `clipPlayLength` do audioLibrary. */
export function playLength(clip: Pick<AudioClip, 'duration' | 'trimStart' | 'trimEnd'>): number {
  return Math.max(0.05, clip.duration - (clip.trimStart ?? 0) - (clip.trimEnd ?? 0));
}

/** Clipes de click da música, do primeiro para o último. */
export function clickClipsOf(clips: AudioClip[], songId: string): AudioClip[] {
  return clips
    .filter((c) => c.songId === songId && c.trackId === CLICK_TRACK_ID)
    .sort((a, b) => a.startTime - b.startTime);
}

/**
 * Empurra tudo da música `seconds` para a direita: clipes, regiões, falas do Maestro, trechos
 * de andamento, partes do medley e marcadores antigos. O primeiro trecho de andamento e a
 * primeira parte do medley continuam começando no 0 (a grade sempre começa no 0).
 * Os marcadores de dentro do clipe são relativos ao clipe e não mudam.
 */
export function shiftSong(song: Song, clips: AudioClip[], seconds: number): { song: Song; clips: AudioClip[] } {
  if (!seconds) return { song, clips };
  const move = (t: number) => t + seconds;
  const next: Song = {
    ...song,
    duration: move(song.duration),
    regions: song.regions?.map((r) => ({ ...r, start: move(r.start), end: move(r.end) })),
    narrations: song.narrations?.map((n) => ({ ...n, start: move(n.start), end: move(n.end) })),
    markers: song.markers?.map((m) => ({ ...m, position: move(m.position) })),
    medley: song.medley?.map((p) => (p.start <= 1e-6 ? p : { ...p, start: move(p.start) })),
    tempoSegments: song.tempoSegments?.map((s, i) => ({
      ...s,
      startTime: i === 0 && s.startTime <= 1e-6 ? 0 : move(s.startTime),
      endTime: move(s.endTime),
      ...(s.downbeat !== undefined ? { downbeat: i === 0 && s.startTime <= 1e-6 ? s.downbeat : move(s.downbeat) } : {}),
    })),
  };
  return {
    song: next,
    clips: clips.map((c) => (c.songId === song.id ? { ...c, startTime: move(c.startTime) } : c)),
  };
}

/** Onde o som da amostra começa: a primeira amostra acima de `ratio` do pico (0,01 = -40 dB). */
export function clickOnsetIndex(data: Float32Array, ratio = 0.01): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak <= 0) return 0;
  const limit = peak * ratio;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) >= limit) return i;
  return 0;
}

/**
 * Onde começa cada batida de um áudio de click (índices de amostra). Acha cada pancada acima de
 * `ratio` do volume da região em volta (num medley o click de uma música pode estar mais baixo
 * que o de outra) e volta até o começo do som dela (5% do pico daquela pancada,
 * no máximo 10 ms antes). Duas batidas ficam a pelo menos `minGapSec` uma da outra.
 */
export function clickHits(data: Float32Array, sampleRate: number, ratio = 0.3, minGapSec = 0.1): number[] {
  let peak = 0;
  for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
  if (peak <= 0) return [];
  // pico de cada bloco de 50 ms, e o maior pico num raio de 2 s de cada bloco
  const block = Math.max(1, Math.round(0.05 * sampleRate));
  const nBlocks = Math.ceil(data.length / block);
  const blockPeak = new Float32Array(nBlocks);
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    const bi = (i / block) | 0;
    if (v > blockPeak[bi]) blockPeak[bi] = v;
  }
  // Volume da região: o menor entre o maior pico do segundo de antes e o do segundo de depois.
  // Assim, na troca de música de um medley, a parte mais alta não esconde a mais baixa.
  const reach = 20; // 20 blocos de 50 ms = 1 s
  const regionPeak = new Float32Array(nBlocks);
  for (let b = 0; b < nBlocks; b++) {
    let past = 0;
    let next = 0;
    for (let k = Math.max(0, b - reach); k <= b; k++) if (blockPeak[k] > past) past = blockPeak[k];
    for (let k = b; k <= Math.min(nBlocks - 1, b + reach); k++) if (blockPeak[k] > next) next = blockPeak[k];
    regionPeak[b] = Math.min(past, next);
  }
  const floor = peak * 0.01; // abaixo de -40 dB do pico geral é ruído, não batida
  const gap = Math.round(minGapSec * sampleRate);
  const look = Math.round(0.02 * sampleRate);
  const back = Math.round(0.01 * sampleRate);
  const pre = Math.round(0.04 * sampleRate);
  const hits: number[] = [];
  let free = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < free) continue;
    const v = Math.abs(data[i]);
    if (v < floor || v < regionPeak[(i / block) | 0] * ratio) continue;
    let local = 0;
    for (let k = i; k < Math.min(data.length, i + look); k++) local = Math.max(local, Math.abs(data[k]));
    // Batida é subida: o pico dela tem de ser pelo menos o dobro do que soava de 40 a 10 ms antes.
    // O fim de um click que vai sumindo nunca passa (sem isso, depois da última batida ou numa
    // pausa do medley, o rabo do som virava uma batida a mais).
    let before = 0;
    for (let k = Math.max(0, i - pre); k < Math.max(0, i - back); k++) before = Math.max(before, Math.abs(data[k]));
    if (local < before * 2) { free = i + 1; continue; }
    let start = i;
    for (let k = i; k >= Math.max(free, i - back); k--) if (Math.abs(data[k]) >= local * 0.05) start = k;
    hits.push(start);
    free = i + gap;
  }
  return hits;
}

/** A batida da grade mais perto de `t` (a grade começa no 0; com trechos, cada um recomeça na mudança). */
export function nearestGridBeat(song: SongTempo, t: number): number {
  const segs = song.tempoSegments;
  if (segs && segs.length > 1) {
    const seg = segs.find((s) => t >= s.startTime && t < s.endTime) ?? (t < segs[0].startTime ? segs[0] : segs[segs.length - 1]);
    const spb = 60 / (seg.bpm > 0 ? seg.bpm : song.bpm || 120);
    return seg.startTime + Math.round((t - seg.startTime) / spb) * spb;
  }
  const spb = 60 / (song.bpm > 0 ? song.bpm : 120);
  return Math.max(0, Math.round(t / spb) * spb);
}

/**
 * Leva as batidas para a grade só onde o click e a grade concordam: as batidas vizinhas (até 4
 * de cada lado) estão deslocadas da linha pelo MESMO tanto (até 2 ms de diferença) e esse tanto
 * é pequeno (até 15 ms). É o caso do click antigo, todo adiantado ~6 ms.
 * Onde a grade não acompanha a música (ex.: medley com andamentos que a grade não conhece), o
 * deslocamento muda de batida em batida e elas ficam exatamente onde o click de referência está.
 */
export function alignHitsToGrid(times: number[], gridBeat: (t: number) => number, maxOffset = 0.015, spread = 0.002): number[] {
  const offsets = times.map((t) => t - gridBeat(t));
  return times.map((t, i) => {
    const win = offsets.slice(Math.max(0, i - 4), i + 5);
    if (win.length < 5) return t;
    const sorted = [...win].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (Math.abs(median) > maxOffset || Math.abs(offsets[i] - median) > spread) return t;
    const agree = win.filter((o) => Math.abs(o - median) <= spread).length;
    return agree >= Math.ceil(win.length * 0.7) ? gridBeat(t) : t;
  });
}
