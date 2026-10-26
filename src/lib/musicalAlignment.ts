/**
 * Motor Avançado de Alinhamento Musical e Sincronização de Grade (VS Stage Pro).
 *
 * Resolve cirurgicamente o problema de "música entrar cruzada" / descompassada após a contagem:
 * 1. Detecta o BPM com máxima precisão física através de autocorrelação de transientes (comb filter).
 * 2. Detecta o início real do som audível no arquivo original (eliminando silêncio pré-música).
 * 3. Isola Bumbos (Kick: filtro passa-baixa ~125Hz) e Caixas (Snare: filtro passa-faixa 300Hz-2500Hz).
 * 4. Trava a fase métrica exata na grade de tempo através de correlação de transientes.
 * 5. Identifica qual tempo da grade é o VERDADEIRO tempo 1 (Downbeat/Cabeça de Compasso) através
 *    do padrão clássico de backbeat (Caixas nos tempos 2 e 4, Bumbos nos tempos 1 e 3).
 * 6. Calcula o lead-in milimétrico com amarração de compasso inteiro N * barDuration, garantindo
 *    que o click, a grade da timeline e a música fiquem 100% sincados em fase de ponta a ponta.
 */

import type { TempoSegment } from '@/lib/beatDetector';

export interface MusicalAlignmentResult {
  /** Deslocamento do clipe de áudio (em segundos) para que o tempo 1 caia exatamente na cabeça de um compasso inteiro */
  leadIn: number;
  /** Posição em segundos (dentro do arquivo de áudio original) do primeiro tempo forte da música */
  firstDownbeatInAudio: number;
  /** Início real do som audível no arquivo original (segundos) */
  firstAudibleTime: number;
  /** Duração de 1 compasso completo em segundos */
  barDuration: number;
  /** Duração de 1 batida (tempo) em segundos */
  secondsPerBeat: number;
  /** Fórmula de compasso utilizada (ex: 4) */
  beatsPerBar: number;
  /** BPM preciso e validado */
  bpm: number;
}

// Biquad IIR simples de alto desempenho (Lowpass)
function makeLowpass(fc: number, q: number, sr: number) {
  const w0 = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Biquad IIR simples de alto desempenho (Bandpass)
function makeBandpass(fc: number, q: number, sr: number) {
  const w0 = (2 * Math.PI * fc) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(input: Float32Array, f: { b0: number; b1: number; b2: number; a1: number; a2: number }, maxSamples?: number): Float32Array {
  const n = maxSamples ? Math.min(input.length, maxSamples) : input.length;
  const out = new Float32Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const x = input[i];
    const y = f.b0 * x + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    out[i] = y;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
  }
  return out;
}

/**
 * Detecta quando o som realmente começa no arquivo, ignorando silêncio digital absoluto ou ruído de fundo residual.
 */
export function detectFirstAudibleTime(buffer: AudioBuffer, thresholdDb = -45): number {
  const sr = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const chData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chData.push(buffer.getChannelData(c));

  const linearThreshold = Math.pow(10, thresholdDb / 20); // ex: -45 dB ~= 0.0056
  const windowSize = Math.floor(sr * 0.01); // janelas de 10ms
  const maxScanSamples = Math.min(buffer.length, sr * 30); // varre até 30s iniciais

  for (let i = 0; i < maxScanSamples; i += windowSize) {
    let sumSquares = 0;
    const end = Math.min(maxScanSamples, i + windowSize);
    for (let s = i; s < end; s++) {
      let maxSample = 0;
      for (let c = 0; c < channels; c++) {
        const v = Math.abs(chData[c][s]);
        if (v > maxSample) maxSample = v;
      }
      sumSquares += maxSample * maxSample;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - i));
    if (rms > linearThreshold) {
      return Math.max(0, (i / sr) - 0.015); // recua 15ms para não cortar o ataque suave
    }
  }

  return 0;
}

/**
 * Detecta o BPM com máxima robustez física através de autocorrelação de transientes (comb filter).
 * Nunca falha ou "chuta" 120 BPM: varre a faixa musical real de 50 a 220 BPM e valida contra a caixa/bumbo.
 */
export function detectRobustBpm(
  audioBuffer: AudioBuffer,
  drumsBuffer?: AudioBuffer | null,
  hintBpm?: number
): number {
  const sr = audioBuffer.sampleRate;
  const analysisBuffer = drumsBuffer || audioBuffer;
  // Analisa até 90s para cobrir com abundância a seção completa da banda
  const analysisLength = Math.min(analysisBuffer.length, Math.floor(sr * 90));
  const mono = new Float32Array(analysisLength);

  const nCh = analysisBuffer.numberOfChannels;
  for (let c = 0; c < nCh; c++) {
    const ch = analysisBuffer.getChannelData(c);
    for (let i = 0; i < analysisLength; i++) mono[i] += ch[i] / nCh;
  }

  // Filtros Biquad acústicos cirúrgicos:
  // Isola Bumbos (Kick < 125Hz) e Caixas (Snare snap 1200Hz) para eliminar ruído de voz, pratos e guitarras
  const lp = makeLowpass(125, 0.707, sr);
  const bp = makeBandpass(1200, 1.0, sr);

  const kickFiltered = applyBiquad(mono, lp, analysisLength);
  const snareFiltered = applyBiquad(mono, bp, analysisLength);

  // Envelope em blocos de 5ms (200 fps)
  const hop = Math.floor(sr * 0.005);
  const numFrames = Math.floor(analysisLength / hop);
  const drumEnv = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const base = f * hop;
    let mK = 0, mS = 0;
    for (let i = 0; i < hop; i++) {
      const kv = Math.abs(kickFiltered[base + i]);
      const sv = Math.abs(snareFiltered[base + i]);
      if (kv > mK) mK = kv;
      if (sv > mS) mS = sv;
    }
    drumEnv[f] = mK * 1.6 + mS * 1.4;
  }

  // Transientes (diferença positiva de energia dos tambores)
  const diff = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const d = drumEnv[f] - drumEnv[f - 1];
    if (d > 0) diff[f] = d;
  }

  const fps = sr / hop; // 200 fps
  let bestCoarseBpm = 0;
  let maxScore = -1;

  // Etapa 1: Varredura ampla de 50 a 220 BPM com resolução de 0.5 BPM
  for (let bpmCand = 50; bpmCand <= 220; bpmCand += 0.5) {
    const periodFrames = (60 / bpmCand) * fps;
    let score = 0;
    let count = 0;

    for (let k = 1; k <= 8; k++) {
      const lag = Math.round(k * periodFrames);
      if (lag >= numFrames) break;
      let lagSum = 0;
      for (let f = 0; f < numFrames - lag; f += 2) {
        lagSum += diff[f] * diff[f + lag];
      }
      score += lagSum / Math.sqrt(k);
      count++;
    }

    if (hintBpm && Math.abs(bpmCand - hintBpm) < 0.6) {
      score *= 1.25;
    }

    if (count > 0 && score > maxScore) {
      maxScore = score;
      bestCoarseBpm = bpmCand;
    }
  }

  // Normalização de oitava métrica para andamento padrão de show [70, 160]
  let targetCenter = bestCoarseBpm;
  while (targetCenter < 70) targetCenter *= 2;
  while (targetCenter > 160) targetCenter /= 2;

  // Etapa 2: Refinamento cirúrgico de alta precisão (resolução de 0.01 BPM)
  let bestFineBpm = targetCenter;
  let maxFineScore = -1;
  const fineMin = targetCenter - 2.0;
  const fineMax = targetCenter + 2.0;

  for (let bpmCand = fineMin; bpmCand <= fineMax; bpmCand += 0.01) {
    const periodFrames = (60 / bpmCand) * fps;
    let score = 0;
    let count = 0;

    for (let k = 1; k <= 10; k++) {
      const lag = Math.round(k * periodFrames);
      if (lag >= numFrames) break;
      let lagSum = 0;
      for (let f = 0; f < numFrames - lag; f += 2) {
        lagSum += diff[f] * diff[f + lag];
      }
      score += lagSum / Math.sqrt(k);
      count++;
    }

    if (count > 0 && score > maxFineScore) {
      maxFineScore = score;
      bestFineBpm = bpmCand;
    }
  }

  // Se o andamento estiver a menos de 0.04 de um número inteiro (ex: 120.01 ou 119.98),
  // ajusta para o inteiro. Caso contrário, mantém a fração precisa (ex: 121.70).
  const roundedInt = Math.round(bestFineBpm);
  if (Math.abs(bestFineBpm - roundedInt) < 0.04) {
    return roundedInt;
  }

  return Math.round(bestFineBpm * 100) / 100;
}

/**
 * Calcula o alinhamento musical milimétrico entre a contagem de compasso e o áudio da música.
 */
export function calculateMusicalAlignment(
  audioBuffer: AudioBuffer,
  drumsBuffer: AudioBuffer | null,
  bpm: number,
  beatsPerBar = 4
): MusicalAlignmentResult {
  const sr = audioBuffer.sampleRate;
  // Refina e garante que o BPM é estritamente válido
  const verifiedBpm = bpm > 0 ? bpm : detectRobustBpm(audioBuffer, drumsBuffer);
  const safeBpm = Math.max(40, Math.min(260, verifiedBpm));
  const secondsPerBeat = 60 / safeBpm;
  const barDuration = beatsPerBar * secondsPerBeat;

  // 1. Início audível
  const firstAudibleTime = detectFirstAudibleTime(audioBuffer);

  // 2. Extração de energia dos Bumbos (Kick) e Caixas (Snare)
  // Analisa os primeiros 45 segundos da faixa de bateria (ou do mix se não houver bateria)
  const analysisBuffer = drumsBuffer || audioBuffer;
  const analysisLength = Math.min(analysisBuffer.length, Math.floor(sr * 45));
  const monoChannel = new Float32Array(analysisLength);

  // Combina canais em mono
  const nCh = analysisBuffer.numberOfChannels;
  for (let c = 0; c < nCh; c++) {
    const ch = analysisBuffer.getChannelData(c);
    for (let i = 0; i < analysisLength; i++) {
      monoChannel[i] += ch[i] / nCh;
    }
  }

  // Filtros Biquad
  const lp = makeLowpass(125, 0.707, sr); // Sub-bass e Kick (<125Hz)
  const bp = makeBandpass(1200, 1.0, sr); // Snare snap (corpo e esteira 300-2500Hz)

  const kickFiltered = applyBiquad(monoChannel, lp, analysisLength);
  const snareFiltered = applyBiquad(monoChannel, bp, analysisLength);

  // Envelopes de energia em blocos de 5ms
  const hopSize = Math.floor(sr * 0.005); // 5ms
  const numFrames = Math.floor(analysisLength / hopSize);
  const kickEnv = new Float32Array(numFrames);
  const snareEnv = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const base = f * hopSize;
    let kSum = 0, sSum = 0;
    for (let i = 0; i < hopSize; i++) {
      const kv = Math.abs(kickFiltered[base + i]);
      const sv = Math.abs(snareFiltered[base + i]);
      if (kv > kSum) kSum = kv;
      if (sv > sSum) sSum = sv;
    }
    kickEnv[f] = kSum;
    snareEnv[f] = sSum;
  }

  const frameTime = hopSize / sr; // 0.005s

  function getEnergyAt(env: Float32Array, timeSeconds: number): number {
    const centerFrame = Math.round(timeSeconds / frameTime);
    if (centerFrame < 0 || centerFrame >= env.length) return 0;
    // Kernel ponderado estrito: o pico real no centro recebe peso 1.0,
    // com decaimento gaussiano rápido para não puxar a fase para trás ou para frente
    let score = env[centerFrame] * 1.0;
    if (centerFrame > 0) score += env[centerFrame - 1] * 0.55;
    if (centerFrame < env.length - 1) score += env[centerFrame + 1] * 0.55;
    if (centerFrame > 1) score += env[centerFrame - 2] * 0.2;
    if (centerFrame < env.length - 2) score += env[centerFrame + 2] * 0.2;
    return score;
  }

  // 2b. Identifica quando a seção rítmica real (bateria/baixo) entra de verdade
  let rhythmStartTime = firstAudibleTime;
  if (drumsBuffer) {
    for (let f = 0; f < kickEnv.length; f++) {
      if (kickEnv[f] > 0.06 || snareEnv[f] > 0.06) {
        const t = f * frameTime;
        if (t >= firstAudibleTime) {
          rhythmStartTime = t;
          break;
        }
      }
    }
  }

  // 3. Ajuste fino da fase do tempo (Sub-beat grid offset t0)
  // Varre em resolução fina de 2ms para cravar exatamente no topo do transiente da bateria
  let bestOffset = 0;
  let maxBeatCorrelation = -1;

  const numBeatsToScan = Math.min(64, Math.floor((analysisLength / sr) / secondsPerBeat));
  const stepResolution = 0.002; // 2ms
  const offsetSteps = Math.floor(secondsPerBeat / stepResolution);

  for (let step = 0; step < offsetSteps; step++) {
    const candOffset = step * stepResolution;
    let corr = 0;
    for (let k = 0; k < numBeatsToScan; k++) {
      const beatTime = candOffset + k * secondsPerBeat;
      if (beatTime < firstAudibleTime - 0.02) continue; // ignora silêncio pré-música
      const kE = getEnergyAt(kickEnv, beatTime);
      const sE = getEnergyAt(snareEnv, beatTime);
      // Ancoragem prioritária estrita no groove real da bateria e da banda
      // (evita que introduções acústicas rubato/livres puxem a fase da grade)
      const isEstablishedGroove = beatTime >= rhythmStartTime;
      const weight = isEstablishedGroove ? 10.0 : 0.1;
      corr += (kE * 1.6 + sE * 1.3) * weight;
    }
    if (corr > maxBeatCorrelation) {
      maxBeatCorrelation = corr;
      bestOffset = candOffset;
    }
  }

  // 4. Identificação do VERDADEIRO Downbeat (Tempo 1)
  // Em 4/4: Caixas predominam nos tempos 2 e 4 (backbeat). Bumbos predominam no 1 e 3.
  let bestPhase = 0;
  let maxMeasureScore = -Infinity;

  for (let phase = 0; phase < beatsPerBar; phase++) {
    let score = 0;
    let countedBars = 0;

    for (let bar = 0; bar < Math.floor(numBeatsToScan / beatsPerBar); bar++) {
      const barStartTime = bestOffset + (bar * beatsPerBar + phase) * secondsPerBeat;
      // Avalia onde a bateria e a banda já estão tocando de verdade para evitar ruído de introduções lentas
      if (barStartTime < rhythmStartTime - 0.1) continue;
      countedBars++;

      if (beatsPerBar === 4) {
        const beat1 = barStartTime;
        const beat2 = barStartTime + secondsPerBeat;
        const beat3 = barStartTime + 2 * secondsPerBeat;
        const beat4 = barStartTime + 3 * secondsPerBeat;

        const k1 = getEnergyAt(kickEnv, beat1);
        const s1 = getEnergyAt(snareEnv, beat1);
        const k2 = getEnergyAt(kickEnv, beat2);
        const s2 = getEnergyAt(snareEnv, beat2);
        const k3 = getEnergyAt(kickEnv, beat3);
        const s3 = getEnergyAt(snareEnv, beat3);
        const k4 = getEnergyAt(kickEnv, beat4);
        const s4 = getEnergyAt(snareEnv, beat4);

        // Pontuação de estúdio:
        // Bumbo forte no 1 (+2.0)
        // Caixa forte no 2 (+2.5) e no 4 (+2.5)
        // Bumbo no 3 (+1.0)
        // Penalidade severa se houver caixa no 1 (-3.0) ou no 3 (-2.0)
        score += (k1 * 2.0) + (s2 * 2.5) + (k3 * 1.0) + (s4 * 2.5) - (s1 * 3.0) - (s3 * 2.0);
      } else {
        // 3/4 ou outras fórmulas: tempo 1 tem a maior energia de bumbo/baixo
        const beat1 = barStartTime;
        const k1 = getEnergyAt(kickEnv, beat1);
        score += k1 * 2.0;
      }
    }

    if (countedBars > 0 && score > maxMeasureScore) {
      maxMeasureScore = score;
      bestPhase = phase;
    }
  }

  // 5. Localiza o PRIMEIRO Downbeat (tempo 1) onde a música realmente entra
  // Gera todos os downbeats absolutos da grade
  let firstDownbeatInAudio = bestOffset + bestPhase * secondsPerBeat;

  // Se o primeiro downbeat calculado caiu muito antes de qualquer som começar,
  // avança de compasso em compasso até o primeiro compasso com áudio real
  while (firstDownbeatInAudio + (secondsPerBeat * 0.4) < firstAudibleTime) {
    firstDownbeatInAudio += barDuration;
  }

  // 6. Alinhamento de Fase Estrito com o Compasso
  // O tempo 1 da música (firstDownbeatInAudio) deve soar EXATAMENTE na cabeça de um compasso inteiro:
  // timelineTime = leadIn + firstDownbeatInAudio = N * barDuration.
  // Logo: leadIn = N * barDuration - firstDownbeatInAudio.
  const nBars = Math.max(1, Math.ceil(firstDownbeatInAudio / barDuration));
  const leadIn = nBars * barDuration - firstDownbeatInAudio;

  return {
    leadIn,
    firstDownbeatInAudio,
    firstAudibleTime,
    barDuration,
    secondsPerBeat,
    beatsPerBar,
    bpm: safeBpm,
  };
}

/**
 * Rastreia o andamento dinâmico da música de ponta a ponta na faixa de bateria.
 * Detecta se a banda acelerou após um solo, mudou de andamento no refrão ou se houve variação humana,
 * gerando um mapa contínuo de andamentos sem nunca deixar o click perder a cadência.
 */
export function detectContinuousTempoMap(
  audioBuffer: AudioBuffer,
  drumsBuffer: AudioBuffer | null,
  baseBpm: number
): { segments: TempoSegment[]; isMultiTempo: boolean; averageBpm: number } {
  const sr = audioBuffer.sampleRate;
  const analysisBuffer = drumsBuffer || audioBuffer;
  const totalDuration = analysisBuffer.duration;

  if (totalDuration < 30) {
    return {
      segments: [{ startTime: 0, endTime: totalDuration, bpm: baseBpm, downbeat: 0 }],
      isMultiTempo: false,
      averageBpm: baseBpm,
    };
  }

  // Extrai canal mono
  const nCh = analysisBuffer.numberOfChannels;
  const mono = new Float32Array(analysisBuffer.length);
  for (let c = 0; c < nCh; c++) {
    const ch = analysisBuffer.getChannelData(c);
    for (let i = 0; i < analysisBuffer.length; i++) mono[i] += ch[i] / nCh;
  }

  // Filtros Biquad acústicos cirúrgicos:
  // Isola Kick (<125Hz) e Snare (1200Hz) para rastrear o andamento verdadeiro da bateria
  const lp = makeLowpass(125, 0.707, sr);
  const bp = makeBandpass(1200, 1.0, sr);

  const kickFiltered = applyBiquad(mono, lp, analysisBuffer.length);
  const snareFiltered = applyBiquad(mono, bp, analysisBuffer.length);

  // Envelope em blocos de 5ms (200 fps)
  const hop = Math.floor(sr * 0.005);
  const numFrames = Math.floor(analysisBuffer.length / hop);
  const drumEnv = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const base = f * hop;
    let mK = 0, mS = 0;
    for (let i = 0; i < hop; i++) {
      const kv = Math.abs(kickFiltered[base + i]);
      const sv = Math.abs(snareFiltered[base + i]);
      if (kv > mK) mK = kv;
      if (sv > mS) mS = sv;
    }
    drumEnv[f] = mK * 1.6 + mS * 1.4;
  }

  const diff = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const d = drumEnv[f] - drumEnv[f - 1];
    if (d > 0) diff[f] = d;
  }

  const fps = sr / hop; // 200 fps
  // Janela ágil de 6 segundos com passo de 2 segundos para capturar transições imediatas
  const windowSec = 6;
  const stepSec = 2;
  const windowFrames = Math.floor(windowSec * fps);
  const stepFrames = Math.floor(stepSec * fps);

  const windowBpms: { time: number; bpm: number }[] = [];

  // Busca o andamento local em cada janela ao redor do baseBpm (+- 20 BPM) com resolução de 0.2 BPM
  const minScanBpm = Math.max(45, baseBpm - 20);
  const maxScanBpm = Math.min(240, baseBpm + 20);

  for (let startF = 0; startF + windowFrames <= numFrames; startF += stepFrames) {
    const timeSec = startF / fps;
    let bestLocalBpm = baseBpm;
    let maxScore = -1;

    for (let bpmCand = minScanBpm; bpmCand <= maxScanBpm; bpmCand += 0.2) {
      const periodFrames = (60 / bpmCand) * fps;
      let score = 0;
      let count = 0;

      for (let k = 1; k <= 6; k++) {
        const lag = Math.round(k * periodFrames);
        if (lag >= windowFrames) break;
        for (let f = startF; f < startF + windowFrames - lag; f += 2) {
          score += diff[f] * diff[f + lag];
        }
        score += lagSum(diff, startF, windowFrames, lag) / Math.sqrt(k);
        count++;
      }

      if (count > 0 && score > maxScore) {
        maxScore = score;
        bestLocalBpm = bpmCand;
      }
    }

    if (maxScore > 0) {
      windowBpms.push({ time: timeSec, bpm: Math.round(bestLocalBpm * 10) / 10 });
    }
  }

  function lagSum(arr: Float32Array, start: number, len: number, lag: number) {
    let s = 0;
    for (let f = start; f < start + len - lag; f += 2) {
      s += arr[f] * arr[f + lag];
    }
    return s;
  }

  if (windowBpms.length < 2) {
    return {
      segments: [{ startTime: 0, endTime: totalDuration, bpm: baseBpm, downbeat: 0 }],
      isMultiTempo: false,
      averageBpm: baseBpm,
    };
  }

  // Agrupa trechos com andamentos estáveis (seção mínima de 6 segundos)
  const minSectionDuration = 6.0;
  const rawSegments: { startTime: number; endTime: number; bpm: number }[] = [];
  let curStart = 0;
  let curBpmAccum: number[] = [windowBpms[0].bpm];

  for (let i = 1; i < windowBpms.length; i++) {
    const curMean = curBpmAccum.reduce((a, b) => a + b, 0) / curBpmAccum.length;
    const nextBpm = windowBpms[i].bpm;
    const elapsed = windowBpms[i].time - curStart;

    // Detecta mudança real de andamento sustentada (>= 2.0 BPM)
    if (elapsed >= minSectionDuration && Math.abs(nextBpm - curMean) >= 2.0) {
      const p1 = windowBpms[i + 1]?.bpm ?? nextBpm;
      const p2 = windowBpms[i + 2]?.bpm ?? nextBpm;
      if (Math.abs(p1 - curMean) >= 1.5 && Math.abs(p2 - curMean) >= 1.5) {
        const segBpm = Math.round(curMean);
        const splitTime = windowBpms[i].time;
        rawSegments.push({
          startTime: curStart,
          endTime: splitTime,
          bpm: segBpm,
        });
        curStart = splitTime;
        curBpmAccum = [nextBpm];
        continue;
      }
    }
    curBpmAccum.push(nextBpm);
  }

  if (curBpmAccum.length > 0) {
    const segBpm = Math.round(curBpmAccum.reduce((a, b) => a + b, 0) / curBpmAccum.length);
    rawSegments.push({
      startTime: curStart,
      endTime: totalDuration,
      bpm: segBpm,
    });
  }

  // Se houve mudança real entre seções (>= 2.0 BPM)
  const isMulti = rawSegments.length >= 2 && rawSegments.some((s) => Math.abs(s.bpm - rawSegments[0].bpm) >= 2.0);

  const allBpms = windowBpms.map((w) => w.bpm);
  const averageBpm = Math.round((allBpms.reduce((a, b) => a + b, 0) / allBpms.length) * 100) / 100;

  const finalSegments: TempoSegment[] = rawSegments.map((s) => ({
    startTime: s.startTime,
    endTime: s.endTime,
    bpm: s.bpm,
    downbeat: 0,
  }));

  return {
    segments: finalSegments,
    isMultiTempo: isMulti,
    averageBpm: isMulti ? finalSegments[0].bpm : averageBpm,
  };
}
