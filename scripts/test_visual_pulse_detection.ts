const numPeaks = 16000;
const duration = 160;
const peaks = new Float32Array(numPeaks);

let t = 0.0;
const trueBeats: number[] = [];
while (t < duration) {
  trueBeats.push(t);
  const centerIdx = Math.round((t / duration) * (numPeaks - 1));
  const radius = 3;
  for (let r = -radius; r <= radius; r++) {
    const idx = centerIdx + r;
    if (idx >= 0 && idx < numPeaks) {
      const amp = (1 - Math.abs(r) / (radius + 1)) * 0.9;
      peaks[idx] = Math.max(peaks[idx], amp);
    }
  }
  t += 0.4918 + (Math.sin(t * 0.2) * 0.005);
}

function extractBeatTimesFromPeaks(peaks: Float32Array | number[], duration: number, minDistanceSec = 0.2): number[] {
  const n = peaks.length;
  if (n < 10 || duration <= 0) return [];
  const peaksPerSec = n / duration;
  const minDistanceSamples = Math.max(1, Math.round(minDistanceSec * peaksPerSec));

  const detectedBeats: number[] = [];
  let lastIdx = -minDistanceSamples;

  for (let i = 0; i < n; i++) {
    const v = peaks[i];
    const prev = i > 0 ? peaks[i - 1] : 0;
    const next = i < n - 1 ? peaks[i + 1] : 0;
    if (v > 0.15 && v >= prev && v >= next && (i - lastIdx) >= minDistanceSamples) {
      const time = (i / (n - 1)) * duration;
      detectedBeats.push(time);
      lastIdx = i;
    }
  }
  return detectedBeats;
}

const detected = extractBeatTimesFromPeaks(peaks, duration);
console.log(`True beats: ${trueBeats.length}, Detected beats: ${detected.length}`);

let maxErr = 0;
for (let i = 0; i < Math.min(trueBeats.length, detected.length); i++) {
  const err = Math.abs(trueBeats[i] - detected[i]);
  if (err > maxErr) maxErr = err;
}
console.log(`Max error between true beat and detected peak time: ${(maxErr * 1000).toFixed(2)} ms!`);
console.log(`Sample comparison at beat 12: True=${trueBeats[11].toFixed(4)}s, Detected=${detected[11].toFixed(4)}s`);
