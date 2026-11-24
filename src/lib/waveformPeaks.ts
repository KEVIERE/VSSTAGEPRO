/** Picos da onda: em cada coluna, a maior amplitude entre os dois primeiros canais. */
function peakRange(channels: Float32Array[], numPeaks: number, peaks: number[], from: number, to: number) {
  const dataLen = channels[0].length;
  for (let i = from; i < to; i++) {
    let max = 0;
    const start = Math.floor((i / numPeaks) * dataLen);
    const end = Math.min(Math.ceil(((i + 1) / numPeaks) * dataLen), dataLen);
    for (let j = start; j < end; j++) {
      for (const ch of channels) {
        const abs = Math.abs(ch[j]);
        if (abs > max) max = abs;
      }
    }
    peaks[i] = max;
  }
}

function peakChannels(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(buffer.numberOfChannels, 2); c++) channels.push(buffer.getChannelData(c));
  return channels;
}

export function waveformPeaks(buffer: AudioBuffer, numPeaks = 4000): number[] {
  const peaks: number[] = new Array(numPeaks);
  peakRange(peakChannels(buffer), numPeaks, peaks, 0, numPeaks);
  return peaks;
}

/** Colunas calculadas por vez na versão em pedaços. */
const PEAK_SLICE = 2000;

/** Igual a waveformPeaks, em pedaços, cedendo a vez à tela entre eles. */
export async function waveformPeaksAsync(buffer: AudioBuffer, numPeaks = 4000): Promise<number[]> {
  const channels = peakChannels(buffer);
  const peaks: number[] = new Array(numPeaks);
  for (let i = 0; i < numPeaks; i += PEAK_SLICE) {
    peakRange(channels, numPeaks, peaks, i, Math.min(numPeaks, i + PEAK_SLICE));
    if (i + PEAK_SLICE < numPeaks) await new Promise((r) => setTimeout(r, 0));
  }
  return peaks;
}
