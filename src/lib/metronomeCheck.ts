// Confere no próprio áudio se é mesmo um click de metrônomo antes de a IA mandar para a faixa
// Click. A IA (YAMNet) ouve bloco de madeira, cowbell, aro e outras percussões tocadas como
// "Wood block", "Plop" ou "Tick", as mesmas classes do click; sem esta conferência a percussão
// do VS ia parar na faixa Click. Metrônomo é: ataques curtos, com silêncio entre um e outro,
// todos do mesmo tamanho (no máximo o acento do tempo 1) e no mesmo espaçamento.

/** Áudio lido amostra por amostra (-1 a 1), o mesmo formato que a IA usa para votar. */
export interface MetronomeSource {
  length: number;
  sampleRate: number;
  channels: number;
  sample: (channel: number, index: number) => number;
}

export interface MetronomeStats {
  onsets: number;
  /** ataques que caem a menos de 1/10 da força em 80 ms */
  shortShare: number;
  /** força mediana entre um ataque e outro, em relação à mediana dos ataques */
  gapLevel: number;
  /** intervalos seguidos de mesmo tamanho (diferença até 4%) */
  regularShare: number;
  /** ataques com a mesma força (até 0,75 dB) de um dos 4 anteriores: o click repete o toque, o músico não */
  repeatShare: number;
}

/** Para onde vai o som que a IA chamou de click mas não é metrônomo. */
export const PERCUSSION_ROUTE = { target: 'track-percussoes', childName: 'Percussão' } as const;

const HOP_S = 0.005;

/** Mede o áudio inteiro em quadros de 5 ms e devolve os números que decidem se é metrônomo. */
export function metronomeStats(src: MetronomeSource): MetronomeStats | null {
  const sr = src.sampleRate;
  const hop = Math.max(1, Math.round(sr * HOP_S));
  const frames = Math.floor(src.length / hop);
  if (frames < 400 || src.channels < 1) return null;
  const mono = (i: number) => {
    let v = 0;
    for (let c = 0; c < src.channels; c++) v += src.sample(c, i);
    return v / src.channels;
  };
  const stride = Math.max(1, Math.floor(hop / 60));
  const env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const at = f * hop;
    for (let i = 0; i < hop; i += stride) { const v = mono(at + i); e = Math.max(e, v * v); }
    env[f] = e;
  }
  const sorted = Array.from(env).sort((a, b) => a - b);
  const ref = sorted[Math.floor(frames * 0.995)];
  if (!(ref > 1e-8)) return null;

  // ataque: sobe de repente (6 dB em 20 ms), passa de -30 dB do topo e é o pico dos próximos 30 ms
  const per = (s: number) => Math.round(s / HOP_S);
  const onsets: number[] = [];
  const minGap = per(0.1);
  for (let f = per(0.02); f < frames - per(0.03); f++) {
    if (env[f] < ref * 0.001 || env[f] < env[f - per(0.02)] * 4) continue;
    let p = f;
    for (let k = f + 1; k <= f + per(0.03); k++) if (env[k] > env[p]) p = k;
    if (onsets.length && p - onsets[onsets.length - 1] < minGap) continue;
    onsets.push(p);
    f = p + minGap - 1;
  }
  const n = onsets.length;
  if (n < 16) return { onsets: n, shortShare: 0, gapLevel: 1, regularShare: 0, repeatShare: 0 };

  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const peaks = onsets.map((p) => env[p]);
  const peakMed = median(peaks);
  const decay = per(0.08);
  let short = 0;
  const gaps: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = onsets[k];
    const end = k + 1 < n ? onsets[k + 1] : Math.min(frames, p + per(1));
    if (p + decay < end && env[p + decay] < peaks[k] * 0.1) short++;
    for (let f = p + decay; f < end - per(0.01); f++) gaps.push(env[f]);
  }
  const gapLevel = gaps.length ? median(gaps) / peakMed : 1;

  // força exata de cada toque (pico de cada amostra em volta do ataque), em dB, e a hora exata
  // dele (1ª amostra com metade do pico): o quadro de 5 ms sozinho balança uns 10 ms
  const level: number[] = [];
  const time: number[] = [];
  for (const p of onsets) {
    let m = 0;
    const from = Math.max(0, (p - per(0.02)) * hop);
    const to = Math.min(src.length, (p + per(0.02)) * hop);
    for (let i = from; i < to; i++) m = Math.max(m, Math.abs(mono(i)));
    let at = from;
    while (at < to && Math.abs(mono(at)) < m * 0.5) at++;
    level.push(20 * Math.log10(m + 1e-9));
    time.push(at / sr);
  }

  // intervalos: pausa de mais de 2,5 s (breque do click) não conta
  let pairs = 0;
  let regular = 0;
  for (let k = 2; k < n; k++) {
    const a = time[k - 1] - time[k - 2];
    const b = time[k] - time[k - 1];
    if (a > 2.5 || b > 2.5) continue;
    pairs++;
    if (Math.abs(a - b) <= Math.max(0.005, 0.04 * Math.max(a, b))) regular++;
  }

  let repeat = 0;
  for (let k = 4; k < n; k++) {
    for (let lag = 1; lag <= 4; lag++) if (Math.abs(level[k] - level[k - lag]) <= 0.75) { repeat++; break; }
  }
  return {
    onsets: n,
    shortShare: short / n,
    gapLevel,
    regularShare: pairs ? regular / pairs : 0,
    repeatShare: repeat / (n - 4),
  };
}

/** Só diz sim quando tudo bate; na dúvida é percussão tocada, não metrônomo. */
export function looksLikeMetronome(src: MetronomeSource): boolean {
  const s = metronomeStats(src);
  if (!s) return false;
  return s.onsets >= 16 && s.shortShare >= 0.8 && s.gapLevel <= 0.01 && s.regularShare >= 0.8 && s.repeatShare >= 0.85;
}
