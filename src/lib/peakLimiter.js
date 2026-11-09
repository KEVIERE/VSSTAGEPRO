// Limitador de pico (brickwall) do anti-clip de cada canal do mixer.
//
// O mesmo código roda em três lugares, para o som ser igual em todos:
//   - na reprodução, dentro do AudioWorklet (peakLimiterProcessor.js, montado por peakLimiterWorklet.ts);
//   - na exportação (limitInPlace, chamado pelo bounceEngine);
//   - nos testes do Node (tests/peakLimiter.test.mjs).
// Por isso este arquivo não usa nada do navegador e só exporta no fim (o worklet tira o export).
//
// Como funciona: o sinal atrasa `lookahead` segundos. Nesse tempo o limitador já viu o pico que
// vem chegando e baixa o ganho numa rampa curta, terminando exatamente no ganho que o pico exige.
// Depois do pico o ganho volta aos poucos (release). Abaixo do teto o ganho fica em 1: o sinal
// passa sem nenhuma mudança, só atrasado. Uma trava final garante que nenhuma amostra passa do teto.

/** Teto do anti-clip: -0,1 dBFS (pico de amostra). */
const ANTI_CLIP_CEILING_DB = -0.1;
const ANTI_CLIP_CEILING = Math.pow(10, ANTI_CLIP_CEILING_DB / 20);
/** Antecipação do limitador (é também o atraso que ele põe no canal). */
const LIMITER_LOOKAHEAD = 0.0015;
/** Tempo para o ganho voltar depois de um pico. */
const LIMITER_RELEASE = 0.08;

// Maior número de 32 bits (o formato das amostras de áudio) que não passa de `x`.
function float32AtMost(x) {
  const f = new Float32Array(1);
  f[0] = x;
  if (f[0] <= x) return f[0];
  const bits = new Int32Array(f.buffer);
  bits[0] += f[0] > 0 ? -1 : 1;
  return f[0];
}

class PeakLimiter {
  /**
   * @param {number} sampleRate
   * @param {{ ceiling?: number, lookahead?: number, release?: number, channels?: number }} [options]
   */
  constructor(sampleRate, options) {
    const o = options || {};
    const ceiling = o.ceiling > 0 ? o.ceiling : ANTI_CLIP_CEILING;
    this.ceiling = ceiling;
    this.clamp = float32AtMost(ceiling);
    // atraso em amostras; a janela do mínimo e a da média têm atraso + 1 amostras
    this.delay = Math.max(0, Math.round((o.lookahead != null ? o.lookahead : LIMITER_LOOKAHEAD) * sampleRate));
    this.win = this.delay + 1;
    this.rel = Math.exp(-1 / (Math.max(0.001, o.release != null ? o.release : LIMITER_RELEASE) * sampleRate));
    const channels = Math.max(1, o.channels || 2);
    this.lines = [];
    for (let c = 0; c < channels; c++) this.lines.push(new Float32Array(Math.max(1, this.delay)));
    this.wi = 0;
    // fila monotônica com o menor ganho exigido nas últimas `win` amostras
    this.cap = this.win + 1;
    this.dqIdx = new Float64Array(this.cap);
    this.dqVal = new Float64Array(this.cap);
    this.dqHead = 0;
    this.dqCount = 0;
    this.n = 0;
    // média móvel do mínimo: a descida vira uma rampa que chega ao ganho do pico junto com ele
    this.box = new Float64Array(this.win).fill(1);
    this.boxSum = this.win;
    this.bi = 0;
    this.gain = 1;
    /** Menor ganho aplicado até agora (1 = nunca precisou agir). */
    this.minGain = 1;
  }

  /**
   * Processa `frames` amostras. `inputs`/`outputs` são listas de canais (Float32Array).
   * Entrada sem canais (desconectada) vale como silêncio; entrada mono vai para todas as saídas.
   */
  process(inputs, outputs, frames) {
    const nIn = inputs ? inputs.length : 0;
    const nOut = Math.min(outputs.length, this.lines.length);
    const ceiling = this.ceiling;
    const clamp = this.clamp;
    const win = this.win;
    const cap = this.cap;
    const delay = this.delay;
    const dqIdx = this.dqIdx;
    const dqVal = this.dqVal;
    const box = this.box;
    const rel = this.rel;
    let { dqHead, dqCount, n, boxSum, bi, gain, wi } = this;
    let minGain = this.minGain;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < nIn; c++) {
        const v = inputs[c][i];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      const need = peak > ceiling ? ceiling / peak : 1;
      // entra na fila tirando de trás quem exige menos que esta amostra
      while (dqCount > 0 && dqVal[(dqHead + dqCount - 1) % cap] >= need) dqCount--;
      const slot = (dqHead + dqCount) % cap;
      dqIdx[slot] = n;
      dqVal[slot] = need;
      dqCount++;
      // sai da frente quem já ficou fora da janela
      while (dqIdx[dqHead] <= n - win) { dqHead = (dqHead + 1) % cap; dqCount--; }
      const hold = dqVal[dqHead];
      boxSum += hold - box[bi];
      box[bi] = hold;
      bi++;
      if (bi === win) {
        // a cada volta a soma é refeita do zero: o arredondamento nunca acumula (shows de horas)
        bi = 0;
        boxSum = 0;
        for (let k = 0; k < win; k++) boxSum += box[k];
      }
      let smooth = boxSum / win;
      if (smooth > 1) smooth = 1;
      // desce na hora; sobe aos poucos, sempre abaixo do suavizado (nunca passa do teto)
      gain = smooth < gain ? smooth : smooth + (gain - smooth) * rel;
      // de volta a menos de 0,0001 dB do ganho 1: fica em 1 de vez (o sinal volta a passar intacto)
      if (smooth === 1 && gain > 0.99999) gain = 1;
      if (gain < minGain) minGain = gain;
      for (let c = 0; c < nOut; c++) {
        let x = 0;
        if (c < nIn) x = inputs[c][i];
        else if (nIn === 1) x = inputs[0][i];
        let y;
        if (delay > 0) {
          const line = this.lines[c];
          y = line[wi] * gain;
          line[wi] = x;
        } else {
          y = x * gain;
        }
        if (y > clamp) y = clamp;
        else if (y < -clamp) y = -clamp;
        outputs[c][i] = y;
      }
      if (delay > 0) wi = wi + 1 === delay ? 0 : wi + 1;
      n++;
    }
    this.dqHead = dqHead;
    this.dqCount = dqCount;
    this.n = n;
    this.boxSum = boxSum;
    this.bi = bi;
    this.gain = gain;
    this.wi = wi;
    this.minGain = minGain;
  }
}

/**
 * Limita um áudio inteiro já na memória (exportação), no próprio lugar e sem atraso: o atraso
 * do limitador é descontado, então o resultado fica alinhado com o resto do mix.
 * Devolve o menor ganho aplicado (1 = não precisou agir).
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 * @param {{ ceiling?: number, lookahead?: number, release?: number }} [options]
 */
function limitInPlace(channels, sampleRate, options) {
  const total = channels.length ? channels[0].length : 0;
  if (total === 0) return 1;
  const lim = new PeakLimiter(sampleRate, Object.assign({}, options, { channels: channels.length }));
  const delay = lim.delay;
  const BLOCK = 4096;
  const tmp = channels.map(() => new Float32Array(BLOCK));
  const zeros = channels.map(() => new Float32Array(BLOCK));
  // a entrada vai até o fim e depois mais `delay` amostras de silêncio, para sair o finalzinho
  for (let start = 0; start < total + delay; start += BLOCK) {
    const frames = Math.min(BLOCK, total + delay - start);
    const real = Math.max(0, Math.min(frames, total - start));
    const ins = channels.map((ch, c) => {
      if (real === frames) return ch.subarray(start, start + frames);
      const buf = zeros[c];
      buf.fill(0);
      if (real > 0) buf.set(ch.subarray(start, start + real));
      return buf;
    });
    lim.process(ins, tmp, frames);
    // a saída do bloco corresponde à entrada `delay` amostras antes
    const outStart = start - delay;
    const skip = outStart < 0 ? -outStart : 0;
    const count = Math.min(frames, total - outStart) - skip;
    if (count <= 0) continue;
    for (let c = 0; c < channels.length; c++) channels[c].set(tmp[c].subarray(skip, skip + count), outStart + skip);
  }
  return lim.minGain;
}

export { ANTI_CLIP_CEILING, ANTI_CLIP_CEILING_DB, LIMITER_LOOKAHEAD, LIMITER_RELEASE, PeakLimiter, limitInPlace };
