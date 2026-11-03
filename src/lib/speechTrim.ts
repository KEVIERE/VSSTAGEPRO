// Corte do silêncio das falas do Maestro por IA (todas as vozes: a do Mac, a de IA do próprio Mac
// e as online). A fala tem de começar JUSTO na linha da grade, junto com o click: o clipe começa
// na amostra em que a palavra começa, sem espaço antes.
//
// O que sai da frente:
//  - silêncio e chiado de fundo;
//  - respiração e estalos fracos antes da palavra;
//  - na contagem, o restinho da palavra anterior ("Um" anasalado que vazava no começo do "Dois").
// O que fica: consoantes fracas de verdade, como o "s" de "Seis"/"Cinco"/"Segura" (chiado com
// muitos cruzamentos por zero) e o "v" de "Vamos" (fraco, mas colado na vogal).
//
// Funções puras (amostras → posições), para testar no Node sem navegador.

/** Janela de análise (5 ms) e passo (1 ms): precisão de 1 ms no ponto de corte. */
const WIN_S = 0.005;
const HOP_S = 0.001;
/** A palavra "pegou" quando passa de 20% do volume máximo da fala. */
const STRONG = 0.2;
/** Som que ainda é fala colada na palavra: 8% do máximo... */
const VOICED = 0.08;
/** ...ou chiado de consoante ("s", "ch", "f"): fraco, mas com muitos cruzamentos por zero. */
const HISS_LEVEL = 0.015;
const HISS_ZCR = 0.2;
/** Buraco de até 20 ms entre a consoante e a vogal não separa a palavra ("s" ... "eis"). */
const MAX_INNER_GAP_S = 0.02;
/** Até onde voltar a partir do ponto forte (o "s" de "Cinco" chega a 160 ms). */
const MAX_BACK_S = 0.3;
/** Pausa que separa um pedaço solto da palavra de verdade (só em palavra solta, como na contagem). */
const FRAGMENT_GAP_S = 0.02;
/** No fim: o que ainda conta como som (3% do máximo) e o respiro que fica depois dele. */
const TAIL_LEVEL = 0.03;
const TAIL_KEEP_S = 0.06;

export interface SpeechTrimOptions {
  /**
   * Uma palavra só (cada número da contagem). Aí tudo o que vem antes de uma pausa e é mais fraco
   * que a palavra sai: é resto da palavra anterior, respiração ou estalo.
   */
  singleWord?: boolean;
}

interface Frame {
  pos: number;
  level: number;
  zcr: number;
}

function analyze(samples: Float32Array, rate: number): { frames: Frame[]; max: number } {
  const win = Math.max(1, Math.round(rate * WIN_S));
  const hop = Math.max(1, Math.round(rate * HOP_S));
  const frames: Frame[] = [];
  let max = 0;
  for (let pos = 0; pos + win <= samples.length; pos += hop) {
    let sum = 0;
    let zc = 0;
    let prev = samples[pos];
    for (let i = pos; i < pos + win; i++) {
      const v = samples[i];
      sum += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    const level = Math.sqrt(sum / win);
    frames.push({ pos, level, zcr: zc / win });
    if (level > max) max = level;
  }
  return { frames, max };
}

/**
 * Onde a fala começa e termina (em amostras): `start` é a primeira amostra da palavra e `end` o fim
 * com um respiro de 60 ms. Sem som nenhum, devolve o áudio inteiro.
 */
export function speechBounds(samples: Float32Array, rate: number, opts: SpeechTrimOptions = {}): { start: number; end: number } {
  const n = samples.length;
  const { frames, max } = analyze(samples, rate);
  if (frames.length === 0 || max <= 0) return { start: 0, end: n };
  const hopS = Math.max(1, Math.round(rate * HOP_S)) / rate;
  const r = (i: number) => frames[i].level / max;
  const hiss = (i: number) => r(i) >= HISS_LEVEL && frames[i].zcr >= HISS_ZCR;
  const attached = (i: number) => r(i) >= VOICED || hiss(i);

  // Palavra solta: a palavra de verdade é o trecho do volume máximo. O que vem antes dele, depois de
  // uma pausa, é sobra (fim da palavra anterior, respiração, estalo) e sai.
  let floor = 0;
  if (opts.singleWord) {
    let peak = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i].level > frames[peak].level) peak = i;
    let quiet = 0;
    for (let j = peak - 1; j >= 0; j--) {
      if (attached(j)) { quiet = 0; continue; }
      quiet++;
      if (quiet * hopS >= FRAGMENT_GAP_S) {
        // tudo antes desta pausa só sai se for mais fraco que a palavra (nunca corta metade dela)
        let before = 0;
        for (let k = 0; k < j; k++) before = Math.max(before, r(k));
        if (before < 0.6) floor = j + quiet;
        break;
      }
    }
  }

  let strong = -1;
  for (let i = floor; i < frames.length; i++) if (r(i) >= STRONG) { strong = i; break; }
  if (strong < 0) strong = floor;

  // Volta do ponto forte enquanto ainda é a mesma palavra: som de voz (8%+) ou chiado de consoante,
  // atravessando buracos curtos (o "s" de "Seis" e a vogal têm 5 a 10 ms de folga entre eles).
  let first = strong;
  let quiet = 0;
  const maxBack = Math.round(MAX_BACK_S / hopS);
  for (let j = strong - 1; j >= floor && strong - j <= maxBack; j--) {
    if (attached(j)) { first = j; quiet = 0; continue; }
    quiet++;
    if (quiet * hopS > MAX_INNER_GAP_S) break;
  }

  // Dentro da janela, a primeira amostra que já é som (1% do pico da fala).
  let peakAbs = 0;
  for (let i = 0; i < n; i++) peakAbs = Math.max(peakAbs, Math.abs(samples[i]));
  const winLen = Math.max(1, Math.round(rate * WIN_S));
  let start = frames[first].pos;
  const stop = Math.min(n, start + winLen);
  while (start < stop && Math.abs(samples[start]) < peakAbs * 0.01) start++;
  if (start >= stop) start = frames[first].pos;

  let last = frames.length - 1;
  while (last > first && r(last) < TAIL_LEVEL && !hiss(last)) last--;
  const end = Math.min(n, frames[last].pos + winLen + Math.round(rate * TAIL_KEEP_S));
  return { start, end: Math.max(start + 1, end) };
}

/** Mistura os canais em mono (só para a análise). */
export function monoMix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * Corta a fala nos limites de `speechBounds` com uma entrada de 1 ms (só para não estalar: a voz
 * entra no volume em que foi gerada). Devolve os canais novos.
 */
export function trimSpeechChannels(channels: Float32Array[], rate: number, opts: SpeechTrimOptions = {}): Float32Array[] {
  const { start, end } = speechBounds(monoMix(channels), rate, opts);
  const fade = Math.max(1, Math.round(rate * 0.001));
  return channels.map((ch) => {
    const out = ch.slice(start, end);
    for (let i = 0; i < Math.min(fade, out.length); i++) out[i] *= (i + 1) / (fade + 1);
    return out;
  });
}
