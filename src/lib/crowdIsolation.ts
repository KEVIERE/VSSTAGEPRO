/**
 * Isolador Inteligente de Ambiência e Gritos de Show ao Vivo (VS Stage Pro).
 *
 * Em gravações ao vivo ("AO VIVO"), o público grita, assobia e aplaude.
 * O modelo de separação vocal frequentemente joga esses gritos na faixa de voz (Guia).
 * Ao tocar o VS no palco, esses gritos do show atrapalham a banda e o público.
 *
 * Este algoritmo:
 * 1. Analisa a imagem estereofônica (Mid/Side decorrelation) entre a voz central e a plateia difusa.
 * 2. A voz do cantor principal é predominantemente central (Mid = (L+R)/2) e focalizada.
 * 3. Gritos da plateia e assobios são difusos no campo estéreo (Side = (L-R)/2 alto) E ricos em
 *    conteúdo de alta frequência genuinamente novo (acima de 4kHz no canal Side).
 * 4. A cauda de reverberação/eco da própria voz do cantor também aparece difusa no campo estéreo,
 *    mas é predominantemente grave/médio (ressonância da sala, não o timbre agudo de gritos/assobios) —
 *    por isso a mera difusão estéreo (sRms alto) NÃO basta: filtra-se o Side em passa-alta (4kHz) e só
 *    confirma "plateia" quando essa energia aguda lateral é proporcionalmente relevante.
 * 5. Isola a "Ambiência e Gritos da Plateia" em um buffer estéreo separado.
 * 6. Limpa a faixa de voz principal atenuando esses gritos difusos da plateia.
 * 7. Roteia a ambiência isolada para a pasta "Outros" MUTADA por padrão,
 *    garantindo que não atrapalhe a banda ao tocar o VS ao vivo no palco!
 */

export interface CrowdIsolationResult {
  cleanedVocals: AudioBuffer;
  crowdAmbience: AudioBuffer | null;
  hasCrowd: boolean;
}

// Biquad IIR passa-alta: isola o conteúdo agudo (gritos/assobios) do componente lateral Side,
// descartando a cauda de reverb grave/médio que também é difusa mas não é plateia.
function makeHighpass(fc: number, q: number, sr: number) {
  const w0 = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const b0 = (1 + cosw0) / 2;
  const b1 = -(1 + cosw0);
  const b2 = (1 + cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(input: Float32Array, f: { b0: number; b1: number; b2: number; a1: number; a2: number }): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }
  return out;
}

export function isolateLiveCrowdAmbience(vocalsBuffer: AudioBuffer): CrowdIsolationResult {
  const sr = vocalsBuffer.sampleRate;
  const len = vocalsBuffer.length;
  const numChannels = vocalsBuffer.numberOfChannels;

  // Se for mono, não há campo estéreo decorrelacionado
  if (numChannels < 2) {
    return { cleanedVocals: vocalsBuffer, crowdAmbience: null, hasCrowd: false };
  }

  const inL = vocalsBuffer.getChannelData(0);
  const inR = vocalsBuffer.getChannelData(1);

  // Canal lateral (Side) inteiro, filtrado em passa-alta de 4kHz para isolar
  // o timbre agudo característico de gritos/assobios da plateia.
  const sideFull = new Float32Array(len);
  for (let i = 0; i < len; i++) sideFull[i] = (inL[i] - inR[i]) * 0.5;
  const hpSide = applyBiquad(sideFull, makeHighpass(4000, 0.707, sr));

  const cleanL = new Float32Array(len);
  const cleanR = new Float32Array(len);
  const ambL = new Float32Array(len);
  const ambR = new Float32Array(len);

  // Janelas de análise de 10ms (100 fps)
  const hop = Math.floor(sr * 0.01);
  const numBlocks = Math.floor(len / hop);

  let totalAmbiencePower = 0;
  let totalVocalPower = 0;

  for (let b = 0; b < numBlocks; b++) {
    const start = b * hop;
    const end = Math.min(start + hop, len);

    let mSum = 0;
    let sSum = 0;
    let hpSum = 0;

    for (let i = start; i < end; i++) {
      const l = inL[i];
      const r = inR[i];
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;
      mSum += m * m;
      sSum += s * s;
      hpSum += hpSide[i] * hpSide[i];
    }

    const mRms = Math.sqrt(mSum / (end - start));
    const sRms = Math.sqrt(sSum / (end - start));
    const hpRms = Math.sqrt(hpSum / (end - start));

    // Razão de difusão estéreo: quanto maior sRms em relação a mRms,
    // mais o áudio provém de gritos laterais da plateia e ambiência do ambiente.
    // Voz do cantor principal: sRms é mínimo (mRms / sRms > 4).
    // Gritos do público: sRms é elevado (sRms / (mRms + 0.001) > 0.4).
    const diffuseRatio = sRms / (mRms + sRms + 0.001);

    // Proporção de agudo genuíno dentro do componente lateral: separa gritos/assobios reais
    // (ricos em agudo) da cauda de reverb grave/médio da própria voz do cantor (que também é
    // difusa, mas não deve ser confundida com plateia).
    const noiseRatio = hpRms / (sRms + 1e-6);

    // Máscara suave de extração de plateia/gritos: só ativa quando AMBOS os critérios
    // confirmam — difusão estéreo alta E conteúdo agudo lateral genuíno.
    let crowdMask = 0;
    if (diffuseRatio > 0.32 && sRms > 0.004 && noiseRatio > 0.12) {
      crowdMask = Math.min(1.0, (diffuseRatio - 0.32) * 2.8);
    }

    for (let i = start; i < end; i++) {
      const l = inL[i];
      const r = inR[i];
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;

      // Ambiência de gritos: o componente lateral Side integral mais uma fração da cauda de reverberação difusa
      const crowdSampleL = (s + m * (crowdMask * 0.25)) * crowdMask;
      const crowdSampleR = (-s + m * (crowdMask * 0.25)) * crowdMask;

      ambL[i] = crowdSampleL;
      ambR[i] = crowdSampleR;

      // Voz limpa: preserva o centro (Mid) do cantor principal e remove os gritos laterais difusos
      cleanL[i] = l - crowdSampleL * 0.85;
      cleanR[i] = r - crowdSampleR * 0.85;

      totalAmbiencePower += crowdSampleL * crowdSampleL + crowdSampleR * crowdSampleR;
      totalVocalPower += l * l + r * r;
    }
  }

  // Preenche amostras restantes da última janela
  for (let i = numBlocks * hop; i < len; i++) {
    cleanL[i] = inL[i];
    cleanR[i] = inR[i];
  }

  const ambRms = Math.sqrt(totalAmbiencePower / (len * 2 || 1));
  const vocRms = Math.sqrt(totalVocalPower / (len * 2 || 1));

  // Detecta se há ambiência de gritos substancial (pelo menos 3% da energia da faixa de voz)
  const hasCrowd = ambRms > 0.004 && (ambRms / Math.max(0.001, vocRms)) > 0.03;

  const ctx = new AudioContext();
  const cleanedVocals = ctx.createBuffer(2, len, sr);
  cleanedVocals.getChannelData(0).set(cleanL);
  cleanedVocals.getChannelData(1).set(cleanR);

  let crowdAmbience: AudioBuffer | null = null;
  if (hasCrowd) {
    crowdAmbience = ctx.createBuffer(2, len, sr);
    crowdAmbience.getChannelData(0).set(ambL);
    crowdAmbience.getChannelData(1).set(ambR);
  }
  ctx.close();

  return {
    cleanedVocals,
    crowdAmbience,
    hasCrowd,
  };
}
