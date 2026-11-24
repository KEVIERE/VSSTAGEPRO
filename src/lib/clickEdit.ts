import { beatSpans, gridBeatTimes, nearestBeatOf, reachSongStart, spanIndexAt } from './grid.ts';
import type { AudioClip, Song } from '@/types';

// Contas do click (compasso antes do início, recriar metrônomo e o click do VS por IA). Sem áudio,
// para dar para testar.

export const CLICK_TRACK_ID = 'track-click';

type SongTempo = Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>;

/** Andamento que vale no instante `at` (o trecho de andamento dele, ou o BPM da música). */
export function bpmAt(song: SongTempo, at: number): number {
  const spans = beatSpans(song);
  return spans[spanIndexAt(spans, at)].bpm;
}

export function beatsPerBarOf(song: Pick<Song, 'beatsPerBar'>): number {
  return song.beatsPerBar ?? 4;
}

/** Duração de um compasso no instante `at`, no compasso do trecho (valsa no medley tem 3 tempos). */
export function barSeconds(song: SongTempo, at: number): number {
  const spans = beatSpans(song);
  const span = spans[spanIndexAt(spans, at)];
  return span.perBar * span.beat;
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
 * de andamento, partes do medley e marcadores antigos. A primeira parte do medley continua no 0 e
 * o primeiro trecho de andamento volta a cobrir desde o 0, na mesma fase das batidas.
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
    tempoSegments: song.tempoSegments && reachSongStart(song.tempoSegments.map((s) => ({
      ...s,
      startTime: move(s.startTime),
      endTime: move(s.endTime),
      ...(s.downbeat !== undefined ? { downbeat: move(s.downbeat) } : {}),
    })), beatsPerBarOf(song)),
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
  // Tempo fraco entre dois acentos fortes fica abaixo do volume da região. Ele ainda conta quando é
  // um ataque limpo: pelo menos 4 vezes acima do que soava de 40 a 10 ms antes (contas em blocos de 1 ms).
  const fine = Math.max(1, Math.round(0.001 * sampleRate));
  const finePeak = new Float32Array(Math.ceil(data.length / fine));
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]);
    const b = (i / fine) | 0;
    if (v > finePeak[b]) finePeak[b] = v;
  }
  const fineFar = Math.max(1, Math.round(pre / fine));
  const fineNear = Math.max(1, Math.round(back / fine));
  const cleanAttack = new Uint8Array(finePeak.length);
  for (let b = 0; b < finePeak.length; b++) {
    if (finePeak[b] < floor) continue;
    let prior = 0;
    for (let k = Math.max(0, b - fineFar); k <= b - fineNear; k++) if (finePeak[k] > prior) prior = finePeak[k];
    if (finePeak[b] >= prior * 4) cleanAttack[b] = 1;
  }
  const hits: number[] = [];
  let free = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < free) continue;
    const v = Math.abs(data[i]);
    if (v < floor) continue;
    const region = regionPeak[(i / block) | 0];
    if (v < region * ratio && (v < region * 0.08 || !cleanAttack[(i / fine) | 0])) continue;
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

/** A batida da grade mais perto de `t` (a mesma lista de batidas que a régua desenha). */
export function nearestGridBeat(song: SongTempo, t: number): number {
  return nearestBeatOf(beatSpans(song), t)?.time ?? Math.max(0, t);
}

/**
 * Leva o click para a grade só quando o clipe INTEIRO está deslocado pelo mesmo tanto: pelo menos
 * 90% das batidas a até 0,5 ms do mesmo deslocamento, e ele pequeno (até 15 ms). É o caso do click
 * antigo do programa, todo adiantado ~6 ms. A decisão é uma só para o clipe, nunca por trecho: com
 * um mapa levemente errado o deslocamento vai mudando ao longo da música e nenhuma batida se move.
 * Batida fora desse deslocamento fica onde está.
 */
export function alignHitsToGrid(times: number[], gridBeat: (t: number) => number, maxOffset = 0.015, spread = 0.0005): number[] {
  if (times.length < 5) return times;
  const offsets = times.map((t) => t - gridBeat(t));
  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (Math.abs(median) > maxOffset) return times;
  const agree = offsets.filter((o) => Math.abs(o - median) <= spread).length;
  if (agree < Math.ceil(times.length * 0.9)) return times;
  return times.map((t, i) => (Math.abs(offsets[i] - median) <= spread ? gridBeat(t) : t));
}

/**
 * Batidas da grade da música de 0 até antes de `durationSeconds`: o click que o VS por IA põe na
 * faixa. Vem da mesma fonte da grade da timeline (beatSpans): com trechos, cada um recomeça na
 * própria mudança, e não há click duplo na emenda.
 */
export function clickGridTimes(song: SongTempo, durationSeconds: number): number[] {
  return gridBeatTimes(song, 0, durationSeconds);
}

/**
 * Som do click em cada instante de `times` (segundos), num áudio de `length` amostras. O começo
 * do som da amostra (clickOnsetIndex) fica em cima do instante. Batida antes de caber o que vem
 * antes do ataque pula esse pedaço (quase silêncio), em vez de atrasar o ataque. É a conta do
 * Recriar metrônomo e do VS por IA.
 */
export function placeClickSamples(
  times: number[], length: number, sampleRate: number, sL: Float32Array, sR: Float32Array,
): [Float32Array, Float32Array] {
  const outL = new Float32Array(length);
  const outR = new Float32Array(length);
  const onset = clickOnsetIndex(sL);
  for (const t of times) {
    const at = Math.round(t * sampleRate) - onset;
    const skip = Math.max(0, -at);
    const start = at + skip;
    for (let i = skip; i < sL.length; i++) {
      const dest = start + i - skip;
      if (dest >= length) break;
      outL[dest] += sL[i];
      outR[dest] += sR[i];
    }
  }
  return [outL, outR];
}

/**
 * Click com dois sons: o `accent` nas batidas marcadas em `accents` (o 1 de cada compasso) e o
 * `normal` nas outras. Sem som de acento, todas as batidas usam o normal.
 */
export function placeAccentedClicks(
  times: number[], accents: boolean[] | undefined, length: number, sampleRate: number,
  normal: [Float32Array, Float32Array], accent?: [Float32Array, Float32Array],
): [Float32Array, Float32Array] {
  if (!accent || !accents) return placeClickSamples(times, length, sampleRate, normal[0], normal[1]);
  const [nL, nR] = placeClickSamples(times.filter((_, i) => !accents[i]), length, sampleRate, normal[0], normal[1]);
  const [aL, aR] = placeClickSamples(times.filter((_, i) => accents[i]), length, sampleRate, accent[0], accent[1]);
  for (let i = 0; i < length; i++) {
    nL[i] += aL[i];
    nR[i] += aR[i];
  }
  return [nL, nR];
}

/**
 * Quais batidas (em segundos da timeline) são o 1 do compasso, para o som de dois toques:
 * 1 2 3 4 | 1 2 3 4. Segue a grade da timeline: o compasso começa no 0 e, com trechos de
 * andamento, recomeça na mudança (igual às linhas de compasso da grade). Só vale para a batida
 * que está na grade (até 30 ms da linha). Fora dela (ex.: medley com andamento que a grade não
 * conhece), continua a contagem da batida anterior, e depois de uma pausa recomeça no 1.
 */
export function barStartFlags(song: SongTempo, times: number[], tolerance = 0.03): boolean[] {
  const spans = beatSpans(song);
  let prev = -1;
  let prevT = 0;
  let prevGap = 0;
  return times.map((t) => {
    const near = nearestBeatOf(spans, t);
    const span = near?.span ?? spans[spanIndexAt(spans, t)];
    const bpb = span.perBar;
    const gap = prev < 0 ? 0 : t - prevT;
    // ataque entre duas batidas da grade (swing, colcheia): é subdivisão, não conta como tempo
    if (near && prev >= 0 && gap < span.beat * 0.75 && Math.abs(t - near.time) > Math.min(tolerance, span.beat / 4)) {
      prevT = t;
      return false;
    }
    let pos: number;
    if (near && Math.abs(t - near.time) <= Math.min(tolerance, span.beat / 4)) pos = (((near.k - span.pickup) % bpb) + bpb) % bpb;
    else if (prev < 0 || (prevGap > 0 && gap > prevGap * 1.75)) pos = 0;
    else pos = (prev + 1) % bpb;
    prev = pos;
    prevGap = gap;
    prevT = t;
    return pos === 0;
  });
}

/** Tamanho em amostras do áudio de click de `durationSeconds` (pelo menos 50 ms). */
export function clickBufferLength(durationSeconds: number, sampleRate: number): number {
  return Math.max(1, Math.ceil(Math.max(0.05, durationSeconds) * sampleRate));
}

/**
 * Batidas do click que está na faixa, em segundos a partir do começo do clipe (Recriar
 * metrônomo). Lê o canal mais forte de cada amostra (click em um lado só também vale) entre
 * `playStart` e `playStart + playLen`, e leva para a grade só quando o click inteiro está
 * deslocado por igual (alignHitsToGrid). Com `preserve` (click importado), as batidas ficam
 * exatamente onde estão: ele é a referência da música.
 */
export function remakeClickTimes(
  channels: Float32Array[], playStart: number, playLen: number, sampleRate: number, clipStart: number, song: SongTempo,
  preserve = false,
): number[] {
  const data = new Float32Array(playLen);
  for (const ch of channels) {
    for (let i = 0; i < playLen; i++) {
      const v = ch[playStart + i];
      if (Math.abs(v) > Math.abs(data[i])) data[i] = v;
    }
  }
  const hits = clickHits(data, sampleRate);
  if (preserve) return hits.map((h) => h / sampleRate);
  const onTimeline = hits.map((h) => clipStart + h / sampleRate);
  const spans = beatSpans(song);
  return alignHitsToGrid(onTimeline, (t) => nearestBeatOf(spans, t)?.time ?? t).map((t) => t - clipStart);
}
