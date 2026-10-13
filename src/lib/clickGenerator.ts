/**
 * Sintetizador de Click / Metrônomo de Estúdio.
 * Gera áudio de metrônomo perfeito e matematicamente alinhado com o BPM e o Downbeat da música.
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
  const beatSamples = Math.round(secondsPerBeat * sampleRate);

  // Calcula o primeiro clique
  let startSample = Math.round(downbeatOffset * sampleRate);
  while (startSample < 0) startSample += beatSamples;
  while (startSample > beatSamples) startSample -= beatSamples;

  const clickSamples = Math.round(sampleRate * 0.025); // 25ms de duração do clique

  let beatIndex = 0;
  for (let start = startSample; start < length; start += beatSamples) {
    const isDownbeat = (beatIndex % beatsPerBar) === 0;
    const freq = isDownbeat ? 2500 : 1600; // Tempo forte agudo, tempos fracos médios
    const vol = isDownbeat ? 0.95 : 0.65;

    for (let i = 0; i < clickSamples && start + i < length; i++) {
      const t = i / sampleRate;
      // Envelope percussivo exponencial rápido (ataque imediato, decaimento rápido)
      const env = Math.exp(-t * 220);
      data[start + i] += Math.sin(2 * Math.PI * freq * t) * env * vol;
    }
    beatIndex++;
  }

  return buffer;
}
