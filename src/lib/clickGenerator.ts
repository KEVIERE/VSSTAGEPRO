/**
 * Sintetizador de Click / Metrônomo de Estúdio.
 * Gera áudio de metrônomo perfeito e matematicamente travado na grade métrica da música.
 */
export function generateClickTrack(
  durationSeconds: number,
  bpm: number,
  sampleRate = 44100,
  downbeatOffset = 0,
  beatsPerBar = 4
): AudioBuffer {
  const safeDuration = Math.max(1, durationSeconds);
  const length = Math.ceil(safeDuration * sampleRate);
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
  const data = buffer.getChannelData(0);

  const secondsPerBeat = 60 / Math.max(30, Math.min(300, bpm));
  const clickSamples = Math.round(sampleRate * 0.025); // 25ms de duração do pulso

  // Determina o índice k do primeiro clique >= 0
  // t(k) = downbeatOffset + k * secondsPerBeat
  const kMin = Math.ceil(-downbeatOffset / secondsPerBeat);
  const kMax = Math.floor((safeDuration - downbeatOffset) / secondsPerBeat);

  for (let k = kMin; k <= kMax; k++) {
    const beatTime = downbeatOffset + k * secondsPerBeat;
    const startSample = Math.round(beatTime * sampleRate);
    if (startSample < 0 || startSample >= length) continue;

    // Compassos fechados: k = 0 é exatamente o Downbeat (tempo 1 forte)
    const beatInBar = ((k % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const isDownbeat = beatInBar === 0;

    const freq = isDownbeat ? 2500 : 1600; // Tempo 1 forte agudo, tempos fracos médios
    const vol = isDownbeat ? 0.95 : 0.65;

    for (let i = 0; i < clickSamples && startSample + i < length; i++) {
      const t = i / sampleRate;
      // Envelope percussivo exponencial rápido (ataque limpo sem cliques DC)
      const env = Math.exp(-t * 220);
      data[startSample + i] += Math.sin(2 * Math.PI * freq * t) * env * vol;
    }
  }

  return buffer;
}
