// O SoundTouch entrega o áudio um pouco adiantado: guarda a primeira sobreposição sem tocar, e dentro
// de cada janela o som anda no passo do original. Quanto adianta depende do material (o encaixe de cada
// janela procura o melhor ponto), então a medida é feita faixa a faixa, no próprio resultado. Vale para
// tom alterado no BPM original, onde a faixa precisa cair junto da bateria, que não passa pelo SoundTouch.
// Contas puras: rodam no worker de processamento e nos testes.

type Samples = Int16Array | Float32Array;

/** Um valor de envelope por milissegundo. */
const ENV_RATE = 1000;
/** Janela de cada comparação. */
const WINDOW_MS = 4000;
/** Quanto a saída pode estar fora do lugar (adiantada ou atrasada). */
const REACH_MS = 90;
/** Janelas conferidas, espalhadas pela faixa. */
const MAX_WINDOWS = 28;
const MIN_WINDOWS = 3;

/** Ataques do áudio, um valor por milissegundo: subida do envelope em 3 ms. */
export function attackEnvelope(left: Samples, right: Samples, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate / ENV_RATE));
  const frames = Math.floor(left.length / hop);
  const level = new Float32Array(frames);
  const k = left instanceof Int16Array ? 1 / 32768 : 1;
  const stereo = right !== left;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const end = (f + 1) * hop;
    for (let i = f * hop; i < end; i++) sum += stereo ? (Math.abs(left[i]) + Math.abs(right[i])) * 0.5 : Math.abs(left[i]);
    level[f] = (sum / hop) * k;
  }
  const out = new Float32Array(frames);
  for (let f = 3; f < frames; f++) out[f] = Math.max(0, level[f] - level[f - 3]);
  return out;
}

/**
 * Atraso (ms) da saída em relação ao lugar certo dela: negativo = adiantada. Compara os ataques da
 * saída com os do original no andamento `tempo`, em várias janelas, e fica com a mediana. Devolve null
 * sem material para medir (faixa muda ou curta): quem chama usa a conta nominal.
 */
export function measureStretchOffsetMs(inputAttacks: Float32Array, outputAttacks: Float32Array, tempo: number): number | null {
  const last = Math.floor(Math.min(outputAttacks.length, inputAttacks.length / tempo)) - WINDOW_MS - REACH_MS - 2;
  if (last <= REACH_MS) return null;
  const count = Math.min(MAX_WINDOWS, Math.floor((last - REACH_MS) / (WINDOW_MS / 2)) + 1);
  const offsets: number[] = [];
  for (let w = 0; w < count; w++) {
    const start = REACH_MS + Math.floor(((last - REACH_MS) * w) / Math.max(1, count - 1));
    // Os ataques do original vão para o lugar deles no andamento novo, sem esticar a forma: dentro
    // de cada janela o SoundTouch copia o som como está, e um ataque esticado puxaria a medida.
    const from = Math.ceil(start * tempo), to = Math.floor((start + WINDOW_MS) * tempo);
    let top = 0;
    for (let j = from; j < to; j++) if (inputAttacks[j] > top) top = inputAttacks[j];
    if (top < 1e-4) continue;
    const at: number[] = [], weight: number[] = [];
    for (let j = Math.max(1, from); j < to; j++) {
      const v = inputAttacks[j];
      if (v >= top * 0.25 && v >= inputAttacks[j - 1] && v > inputAttacks[j + 1]) { at.push(Math.round(j / tempo)); weight.push(v); }
    }
    if (at.length < 2) continue;
    let best = -Infinity, sum = 0, bestLag = 0;
    for (let lag = -REACH_MS; lag <= REACH_MS; lag++) {
      let v = 0;
      for (let k = 0; k < at.length; k++) {
        const i = at[k] + lag;
        v += weight[k] * (outputAttacks[i] + 0.5 * (outputAttacks[i - 1] + outputAttacks[i + 1]));
      }
      sum += v;
      if (v > best) { best = v; bestLag = lag; }
    }
    // sem um pico claro (som contínuo) a janela não diz onde a batida está
    if (best > (sum / (2 * REACH_MS + 1)) * 1.15) offsets.push(bestLag);
  }
  if (offsets.length < MIN_WINDOWS) return null;
  offsets.sort((x, y) => x - y);
  return offsets[offsets.length >> 1];
}

/** Quanto o SoundTouch adianta na conta nominal (ms de saída), quando a medida não é possível. */
export function nominalStretchLeadMs(tempo: number, pitch: number): number {
  const stretch = tempo / pitch;
  const scale = pitch < 1 ? pitch : 1;
  return ((12 + 35 * (1 - stretch)) * scale) / tempo;
}

// ---------- BPM alterado: onde o som de cada batida caiu ----------

/** Taxa da cópia reduzida usada na medida: leve de mandar ao worker e fina o bastante (1/6 ms). */
export const MEASURE_RATE = 6000;
const GRAIN_BEFORE_MS = 4;
const GRAIN_AFTER_MS = 36;
const SEARCH_MS = 90;
const MIN_MATCH = 0.6;
const HIT_SPACING_MS = 90;
const MAX_HITS = 320;
const MIN_HITS = 12;

/** Quantas amostras do áudio viram uma da cópia reduzida. */
export function measureStep(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate / MEASURE_RATE));
}

/**
 * Preenche `out[at..]` com a média (mono) de cada `step` amostras, de `from` até no máximo `frames`
 * amostras. Em pedaços: quem chama na thread da tela solta a vez entre um pedaço e outro.
 */
export function reduceForMeasure(left: Int16Array, right: Int16Array, step: number, out: Int16Array, at: number, frames: number): number {
  const stereo = right !== left;
  const count = Math.min(out.length - at, Math.floor(frames / step));
  for (let n = 0; n < count; n++) {
    const a = (at + n) * step;
    let sum = 0;
    for (let i = a; i < a + step; i++) sum += stereo ? (left[i] + right[i]) * 0.5 : left[i];
    out[at + n] = Math.round(sum / step);
  }
  return count;
}

/** Início dos ataques do original (em ms): os 12% de maior subida, afastados e espalhados pela faixa. */
function strongHits(attacks: Float32Array): number[] {
  const sorted = Float32Array.from(attacks).sort();
  const limit = Math.max(sorted[Math.floor(sorted.length * 0.88)] ?? 0, 1e-4);
  const hits: number[] = [];
  let last = -Infinity;
  for (let j = 1; j < attacks.length - 1; j++) {
    if (attacks[j] < limit || j - last < HIT_SPACING_MS) continue;
    hits.push(j);
    last = j;
  }
  if (hits.length <= MAX_HITS) return hits;
  return Array.from({ length: MAX_HITS }, (_, k) => hits[Math.floor((k * hits.length) / MAX_HITS)]);
}

/**
 * Atraso (ms) da saída do SoundTouch com o BPM alterado: negativo = adiantada. Procura a forma de
 * onda de cada batida do original perto do lugar dela no andamento novo e fica com a mediana. A
 * subida do envelope não serve aqui: em andamento lento a janela repete o ataque e a medida cai na
 * primeira cópia. Devolve null sem batidas reconhecíveis (som contínuo, faixa muda ou tom alterado).
 */
export function measureHitLagMs(input: Int16Array, output: Int16Array, rate: number, tempo: number): number | null {
  const toFrames = rate / 1000;
  const before = Math.round(GRAIN_BEFORE_MS * toFrames);
  const size = before + Math.round(GRAIN_AFTER_MS * toFrames);
  const reach = Math.round(SEARCH_MS * toFrames);
  const lags: number[] = [];
  const grain = new Float32Array(size);
  for (const ms of strongHits(attackEnvelope(input, input, rate))) {
    const from = Math.round(ms * toFrames) - before;
    if (from < 0 || from + size > input.length) continue;
    const center = Math.round(from / tempo);
    const a = center - reach;
    const z = center + reach;
    if (a < 0 || z + size > output.length) continue;
    let mean = 0;
    for (let i = 0; i < size; i++) mean += input[from + i];
    mean /= size;
    let norm = 0;
    for (let i = 0; i < size; i++) {
      grain[i] = input[from + i] - mean;
      norm += grain[i] * grain[i];
    }
    if (norm < 1) continue;
    let energy = 0;
    for (let i = 0; i < size; i++) energy += output[a + i] * output[a + i];
    let best = -Infinity;
    let bestAt = 0;
    for (let p = a; p <= z; p++) {
      if (energy > 1) {
        let dot = 0;
        for (let i = 0; i < size; i++) dot += grain[i] * output[p + i];
        const match = dot / Math.sqrt(norm * energy);
        if (match > best) { best = match; bestAt = p; }
      }
      energy += output[p + size] * output[p + size] - output[p] * output[p];
    }
    if (best >= MIN_MATCH) lags.push(((bestAt - center) / rate) * 1000);
  }
  if (lags.length < MIN_HITS) return null;
  lags.sort((x, y) => x - y);
  return lags[lags.length >> 1];
}

/**
 * Quanto a faixa processada está adiantada (ms de saída): pela forma de onda das batidas, senão
 * pelos ataques, senão pela conta nominal. Com o tom alterado (só faixas melódicas: bateria e
 * percussão não mudam de tom) vale sempre a medida pelos ataques. A forma de onda de um som com
 * nota é periódica e a energia dela fica no corpo da nota, não no começo: mesmo voltando a saída ao
 * tom original, o grão casa com o corpo, e com notas de começo conhecido a faixa ficava até 30 ms
 * fora (a medida pelos ataques fica perto do começo da nota).
 */
export function stretchLeadMs(input: Int16Array, output: Int16Array, rate: number, tempo: number, pitch: number): number {
  const byHits = Math.abs(pitch - 1) < 1e-3 ? measureHitLagMs(input, output, rate, tempo) : null;
  if (byHits !== null) return -byHits;
  const byAttacks = measureStretchOffsetMs(attackEnvelope(input, input, rate), attackEnvelope(output, output, rate), tempo);
  return byAttacks !== null ? -byAttacks : nominalStretchLeadMs(tempo, pitch);
}

/** Devolve o áudio deslocado `frames` amostras para frente (positivo) ou para trás, do mesmo tamanho. */
export function shiftSamples<T extends Samples>(x: T, frames: number): T {
  if (!frames) return x;
  const out = new (x.constructor as new (n: number) => T)(x.length);
  if (frames > 0) out.set(x.subarray(0, Math.max(0, x.length - frames)) as never, frames);
  else out.set(x.subarray(Math.min(x.length, -frames)) as never, 0);
  return out;
}
