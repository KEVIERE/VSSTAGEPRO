// Áudio das falas do Maestro por IA (voz do Mac e voz de IA): WAV, corte de silêncio e o ajuste
// de velocidade que faz a fala caber na marcação. Funções puras, sem Electron.

/**
 * O tamanho da marcação manda na velocidade, nos dois sentidos: fala mais longa que a marcação
 * acelera; fala bem mais curta desacelera (o maestro "segura"). Cada voz responde à velocidade
 * de um jeito (algumas dobram entre 200 e 260 palavras/min), então mede o áudio e procura a
 * velocidade mais calma que ainda cabe, por bisseção. Para quando a fala ocupa de 88% a 100%
 * da marcação.
 *
 * - `speak(pace)` gera a fala e devolve `{ seconds, ... }`; quanto maior `pace`, mais rápida.
 * - `limits.min/max`: a faixa que o motor aceita; `round` arredonda o passo (o `say` só aceita
 *   inteiros); `minGap` é quando parar de dividir o intervalo.
 * Devolve `{ pace, result }` da mais devagar que coube, ou da mais rápida testada se nada coube.
 */
async function fitPace(speak, start, span, limits) {
  const { min, max, round = (x) => x, minGap = 0 } = limits;
  const clamp = (x) => Math.max(min, Math.min(max, round(x)));
  const MIN_FILL = 0.88;
  let lo = min; // devagar
  let hi = max; // rápido
  let best = null;
  let fastest = null;
  const tried = new Set();
  let pace = clamp(start);
  for (let attempt = 0; attempt < 7; attempt++) {
    tried.add(pace);
    const result = await speak(pace);
    if (!fastest || pace > fastest.pace) fastest = { pace, result };
    if (result.seconds <= span) {
      if (!best || pace < best.pace) best = { pace, result };
      if (result.seconds >= span * MIN_FILL || pace <= min) break;
      hi = pace; // cabe com folga: dá para ir mais devagar
    } else {
      if (pace >= max) break; // nem no máximo cabe
      lo = pace; // passou do fim: precisa ir mais rápido
    }
    // palpite pela proporção, dentro do intervalo que ainda falta testar (os limites do motor
    // entram: a marcação enorme pede a velocidade mínima; a minúscula, a máxima)
    const guess = clamp(pace * (result.seconds / (span * 0.95)));
    const next = guess >= lo && guess <= hi && !tried.has(guess) ? guess : clamp((lo + hi) / 2);
    if (tried.has(next) || hi - lo <= minGap) break;
    pace = next;
  }
  return best ?? fastest;
}

/**
 * Onde ficam os dados de áudio no WAV. O `afconvert` às vezes põe blocos extras (FLLR) antes
 * do bloco "data", então procura em vez de supor um cabeçalho de 44 bytes.
 */
function wavLayout(buf) {
  let off = 12;
  let channels = 1;
  let bits = 16;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10) || 1;
      byteRate = buf.readUInt32LE(off + 16);
      bits = buf.readUInt16LE(off + 22) || 16;
    } else if (id === 'data') {
      const frameBytes = Math.max(1, channels * (bits / 8));
      const start = off + 8;
      const end = Math.min(buf.length, start + size);
      return { start, end: end - ((end - start) % frameBytes), frameBytes, byteRate, dataSizeAt: off + 4 };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('Não foi possível ler o áudio gerado pela voz.');
}

/** Duração (s) do áudio de um WAV. */
function wavSeconds(buf) {
  const { start, end, byteRate } = wavLayout(buf);
  return byteRate > 0 ? Math.max(0, (end - start) / byteRate) : 0;
}

/**
 * Tira o silêncio do começo e do fim. A voz tem de começar JUSTO onde o clipe começa (na linha da
 * grade, junto com o click): antes do primeiro som fica só 2 ms, com uma entrada suave de 2 ms
 * para não estalar. No fim fica 60 ms de respiro. O limiar acompanha o volume da fala (36 dB
 * abaixo do pico), para não confundir o começo baixinho de um "s" ou de um "m" com silêncio.
 * O silêncio precisa chegar aqui no zero: veja `removeDcOffset`.
 *
 * `dropTrailingBlips` (voz de IA): o modelo às vezes solta uma respiração ou um ruído fraquinho
 * depois de uma pausa no fim ("Um!" ... "hh"). Isso esticava a fala e obrigava a acelerar à toa.
 * Sai o pedaço do fim que vem depois de uma pausa e é:
 *  - fraco e curto: pausa de 180 ms, abaixo de 1/4 do pico e menos de 350 ms; ou
 *  - um estalo isolado: pausa de 300 ms, abaixo da metade do pico e menos de 250 ms.
 * Uma frase de verdade depois da pausa ("... ponte. Segura!") é forte e longa, e fica.
 * Devolve um WAV com cabeçalho simples de 44 bytes.
 */
function trimSilence(buf, { dropTrailingBlips = false } = {}) {
  const { start, end, frameBytes, byteRate } = wavLayout(buf);
  const frames = Math.floor((end - start) / frameBytes);
  if (frames <= 0) return buf;
  const rate = byteRate / frameBytes;
  const sample = (i, c) => buf.readInt16LE(start + i * frameBytes + c) / 32768;
  let peak = 0;
  for (let i = 0; i < frames; i++) for (let c = 0; c < frameBytes; c += 2) peak = Math.max(peak, Math.abs(sample(i, c)));
  if (peak <= 0) return buf; // silêncio puro: devolve como veio
  const THRESHOLD = Math.max(0.0015, peak * 0.015);
  const loud = (i) => {
    for (let c = 0; c < frameBytes; c += 2) if (Math.abs(sample(i, c)) > THRESHOLD) return true;
    return false;
  };
  let first = 0;
  while (first < frames && !loud(first)) first++;
  let last = frames - 1;
  while (last > first && !loud(last)) last--;
  if (dropTrailingBlips) last = withoutTrailingBlips(first, last, rate, peak, THRESHOLD, (i) => {
    let m = 0;
    for (let c = 0; c < frameBytes; c += 2) m = Math.max(m, Math.abs(sample(i, c)));
    return m;
  });
  const from = Math.max(0, first - Math.round(0.002 * rate));
  const to = Math.min(frames, last + 1 + Math.round(0.06 * rate));
  const body = Buffer.from(buf.subarray(start + from * frameBytes, start + to * frameBytes));
  // entrada suave de 2 ms: cortar no meio de uma onda faz um estalo
  const fade = Math.min(Math.round(0.002 * rate), to - from);
  for (let i = 0; i < fade; i++) {
    for (let c = 0; c < frameBytes; c += 2) {
      const o = i * frameBytes + c;
      body.writeInt16LE(Math.round(body.readInt16LE(o) * (i / fade)), o);
    }
  }
  return wavFile(body, { channels: frameBytes / 2, byteRate });
}

/** Onde a fala termina sem os ruídos fracos e curtos que vêm depois de uma pausa (ver trimSilence). */
function withoutTrailingBlips(first, last, rate, peak, threshold, level) {
  const win = Math.max(1, Math.round(0.01 * rate));
  const segments = [];
  let cur = null;
  let quiet = 0;
  for (let w = first; w <= last; w += win) {
    let m = 0;
    for (let i = w; i < Math.min(last + 1, w + win); i++) m = Math.max(m, level(i));
    if (m > threshold) {
      if (cur && quiet * win < 0.18 * rate) { cur.end = Math.min(last, w + win - 1); cur.peak = Math.max(cur.peak, m); }
      else { cur = { start: w, end: Math.min(last, w + win - 1), peak: m, gap: cur ? quiet * win : 0 }; segments.push(cur); }
      quiet = 0;
    } else {
      quiet++;
    }
  }
  while (segments.length > 1) {
    const tail = segments[segments.length - 1];
    const len = tail.end - tail.start;
    const faint = tail.peak < peak * 0.25 && len < 0.35 * rate;
    const click = tail.gap >= 0.3 * rate && tail.peak < peak * 0.5 && len < 0.25 * rate;
    if (!faint && !click) break;
    segments.pop();
  }
  return segments.length ? segments[segments.length - 1].end : last;
}

/**
 * Corta uma contagem falada de uma vez ("Um, dois, três, quatro.") em `n` palavras. Falada assim,
 * como uma pessoa contando, todas saem no mesmo tom e no mesmo ritmo, o que não acontece gerando
 * cada número sozinho.
 *
 * Os cortes caem nas pausas entre as palavras (cada trecho quieto conta como UM ponto de corte, no
 * meio dele; vales fundos da energia entram como pontos fracos). Entre todas as combinações, vale
 * a de pausas mais longas E pedaços do tamanho esperado de cada palavra (`weights`, ex.: letras):
 * assim o silêncio do "t" no meio de "qua-tro" não vira corte, porque deixaria "quatro" curto
 * demais e o número anterior comprido demais.
 * Devolve [[início, fim], ...] em amostras, ou null se não der para separar com segurança (aí cada
 * número é gerado sozinho).
 */
function splitWords(samples, rate, n, weights = null) {
  if (n < 2) return null;
  const win = Math.max(1, Math.round(rate * 0.01));
  const raw = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    raw.push(Math.sqrt(s / win));
  }
  const env = raw.map((_, i) => (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(raw.length - 1, i + 1)]) / 3);
  const peak = Math.max(0, ...env);
  if (peak <= 0) return null;
  const a = env.findIndex((v) => v > peak * 0.05);
  let z = env.length - 1;
  while (z > a && env[z] <= peak * 0.05) z--;
  if (a < 0 || z - a < n * 10) return null;
  const EDGE = 8; // 80 ms: nada de corte colado no começo ou no fim
  const MIN_LEN = 10; // pedaço de 100 ms a 1,5 s
  const MAX_LEN = 150;

  // pontos de corte possíveis: pausas (força = duração) e vales fundos (força pequena)
  const cands = [];
  for (let i = a + EDGE; i <= z - EDGE; i++) {
    if (env[i] < peak * 0.08) {
      let j = i;
      while (j + 1 <= z - EDGE && env[j + 1] < peak * 0.08) j++;
      cands.push({ at: Math.round((i + j) / 2), strength: j - i + 1 });
      i = j;
    } else if (env[i] < peak * 0.3 && env[i] <= env[i - 1] && env[i] <= env[i + 1]) {
      cands.push({ at: i, strength: 1 });
    }
  }
  if (cands.length < n - 1) return null;

  // tamanho esperado de cada palavra (proporcional ao peso, ex.: número de letras)
  const w = Array.from({ length: n }, (_, k) => Math.max(1, Number(weights?.[k]) || 1));
  const wSum = w.reduce((x, y) => x + y, 0);
  const total = z + 1 - a;
  const expected = w.map((x) => (total * x) / wSum);
  const LEN_COST = 0.6; // cada 10 ms fora do esperado custa 0,6 de "pausa"
  const pieceCost = (k, from, to) => {
    const len = to - from;
    if (len < MIN_LEN || len > MAX_LEN) return -Infinity;
    let segPeak = 0;
    for (let i = from; i < to; i++) segPeak = Math.max(segPeak, env[i]);
    if (segPeak < peak * 0.2) return -Infinity; // cada pedaço precisa de uma palavra de verdade
    return -LEN_COST * Math.abs(len - expected[k]);
  };

  // melhor escolha de n-1 cortes (programação dinâmica): best[j][c] = melhor nota com j+1 cortes,
  // o último no candidato c
  const m = cands.length;
  const best = Array.from({ length: n - 1 }, () => new Array(m).fill(-Infinity));
  const from = Array.from({ length: n - 1 }, () => new Array(m).fill(-1));
  for (let c = 0; c < m; c++) {
    const v = pieceCost(0, a, cands[c].at);
    if (v > -Infinity) best[0][c] = v + cands[c].strength;
  }
  for (let j = 1; j < n - 1; j++) {
    for (let c = 0; c < m; c++) {
      for (let p = 0; p < c; p++) {
        if (best[j - 1][p] === -Infinity) continue;
        const v = pieceCost(j, cands[p].at, cands[c].at);
        if (v === -Infinity) continue;
        const score = best[j - 1][p] + v + cands[c].strength;
        if (score > best[j][c]) { best[j][c] = score; from[j][c] = p; }
      }
    }
  }
  let bestScore = -Infinity;
  let last = -1;
  for (let c = 0; c < m; c++) {
    if (best[n - 2][c] === -Infinity) continue;
    const v = pieceCost(n - 1, cands[c].at, z + 1);
    if (v === -Infinity) continue;
    if (best[n - 2][c] + v > bestScore) { bestScore = best[n - 2][c] + v; last = c; }
  }
  if (last < 0) return null;
  const cuts = [];
  for (let j = n - 2, c = last; j >= 0; c = from[j][c], j--) cuts.unshift(cands[c].at);
  const bounds = [a, ...cuts, z + 1];
  return bounds.slice(0, -1).map((s, k) => [s * win, Math.min(samples.length, bounds[k + 1] * win)]);
}

/** WAV PCM 16 bits com cabeçalho padrão de 44 bytes. */
function wavFile(pcm, { channels, byteRate }) {
  const header = Buffer.alloc(44);
  const blockAlign = channels * 2;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(byteRate / blockAlign, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Tira o deslocamento de corrente contínua (a fala do modelo sai 2% a 3% fora do zero). Sem isso
 * a voz soa "suja" e com estalo no começo e no fim: o alto-falante não reproduz o zero, então a
 * onda fica meia fase para cima e perde metade do espaço de escala.
 *
 * Usa um filtro que corta só abaixo de 20 Hz, e não "subtrair a média": o silêncio do modelo já é
 * zero e só a fala sai deslocada. Subtrair a média tiraria o silêncio do zero, e aí o corte do
 * silêncio deixaria ~150 ms de espaço antes da voz. O filtro olha só para trás, então nada vaza
 * para antes do primeiro som. Devolve uma cópia centrada.
 */
function removeDcOffset(samples, sampleRate = 24000) {
  const out = new Float32Array(samples.length);
  const r = 1 - (2 * Math.PI * 20) / sampleRate;
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    prevOut = x - prevIn + r * prevOut;
    prevIn = x;
    out[i] = prevOut;
  }
  return out;
}

/** Amostras em ponto flutuante (-1..1, mono) → WAV 16 bits (já sem o deslocamento de corrente). */
function floatToWav(samples, sampleRate) {
  const clean = removeDcOffset(samples, sampleRate);
  const pcm = Buffer.alloc(clean.length * 2);
  for (let i = 0; i < clean.length; i++) {
    const s = Math.max(-1, Math.min(1, clean[i]));
    pcm.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return wavFile(pcm, { channels: 1, byteRate: sampleRate * 2 });
}

module.exports = { fitPace, wavLayout, wavSeconds, trimSilence, wavFile, floatToWav, removeDcOffset, splitWords };
