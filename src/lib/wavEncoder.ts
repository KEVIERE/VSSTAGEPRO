import type { ClipAudio } from '@/lib/audioLibrary';

export function encodeWavFloat32(buffer: AudioBuffer): ArrayBuffer {
  const numCh = Math.max(1, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 4;
  const blockAlign = numCh * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const total = 44 + dataSize;
  const ab = new ArrayBuffer(total);
  const view = new DataView(ab);
  let o = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
  };
  writeStr('RIFF');
  view.setUint32(o, total - 8, true); o += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  view.setUint32(o, 16, true); o += 4;
  view.setUint16(o, 3, true); o += 2;
  view.setUint16(o, numCh, true); o += 2;
  view.setUint32(o, sampleRate, true); o += 4;
  view.setUint32(o, byteRate, true); o += 4;
  view.setUint16(o, blockAlign, true); o += 2;
  view.setUint16(o, 32, true); o += 2;
  writeStr('data');
  view.setUint32(o, dataSize, true); o += 4;

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numCh; c++) {
      view.setFloat32(o, channels[c][i], true);
      o += 4;
    }
  }
  return ab;
}

export function encodeWavInt16(audio: ClipAudio): ArrayBuffer {
  const numCh = Math.max(1, audio.channels.length);
  const blockAlign = numCh * 2;
  const dataSize = audio.length * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);
  let o = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
  };
  writeStr('RIFF');
  view.setUint32(o, 36 + dataSize, true); o += 4;
  writeStr('WAVE');
  writeStr('fmt ');
  view.setUint32(o, 16, true); o += 4;
  view.setUint16(o, 1, true); o += 2;
  view.setUint16(o, numCh, true); o += 2;
  view.setUint32(o, audio.sampleRate, true); o += 4;
  view.setUint32(o, audio.sampleRate * blockAlign, true); o += 4;
  view.setUint16(o, blockAlign, true); o += 2;
  view.setUint16(o, 16, true); o += 2;
  writeStr('data');
  view.setUint32(o, dataSize, true); o += 4;
  for (let i = 0; i < audio.length; i++) {
    for (let c = 0; c < numCh; c++) {
      view.setInt16(o, audio.channels[c][i], true);
      o += 2;
    }
  }
  return ab;
}
