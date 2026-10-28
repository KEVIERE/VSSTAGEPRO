import type { ClipAudio } from '@/lib/audioLibrary';

/** PCM inteiro de 24 bits para compatibilidade com reprodutores WAV. */
export function wavHeaderPcm24(totalFrames: number, numberOfChannels: number, sampleRate: number): ArrayBuffer {
  const dataSize = totalFrames * numberOfChannels * 3;
  if (!Number.isSafeInteger(dataSize) || dataSize < 0 || dataSize > 0xffffffff - 36) {
    throw new Error('O áudio excede o limite de 4 GB do formato WAV. Exporte músicas separadamente.');
  }
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const str = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) v.setUint8(offset + i, value.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numberOfChannels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * numberOfChannels * 3, true);
  v.setUint16(32, numberOfChannels * 3, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, dataSize, true);
  return header;
}

export function encodePcm24(buffer: AudioBuffer): ArrayBuffer {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const out = new Uint8Array(buffer.length * channels.length * 3);
  let pos = 0;
  for (let i = 0; i < buffer.length; i++) {
    for (const channel of channels) {
      const sample = channel[i];
      if (!Number.isFinite(sample)) throw new Error('A exportação contém amostras de áudio inválidas.');
      const value = Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 8388608 : 8388607));
      out[pos++] = value & 255; out[pos++] = (value >> 8) & 255; out[pos++] = (value >> 16) & 255;
    }
  }
  return out.buffer;
}

export function encodeWavPcm24(buffer: AudioBuffer): ArrayBuffer {
  const header = wavHeaderPcm24(buffer.length, buffer.numberOfChannels, buffer.sampleRate);
  const pcm = encodePcm24(buffer);
  const out = new Uint8Array(header.byteLength + pcm.byteLength);
  out.set(new Uint8Array(header)); out.set(new Uint8Array(pcm), header.byteLength);
  return out.buffer;
}


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

// Cabeçalho WAV (44 bytes) sozinho, com o tamanho final já calculado de antemão: permite
// gravar os dados em pedaços (um por música) direto no disco, sem nunca juntar o show inteiro
// num único buffer gigante na memória (é isso que estourava a memória em shows longos).
export function wavHeaderFloat32(totalFrames: number, numberOfChannels: number, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 4;
  const blockAlign = numberOfChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = totalFrames * blockAlign;
  const total = 44 + dataSize;
  const ab = new ArrayBuffer(44);
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
  view.setUint16(o, numberOfChannels, true); o += 2;
  view.setUint32(o, sampleRate, true); o += 4;
  view.setUint32(o, byteRate, true); o += 4;
  view.setUint16(o, blockAlign, true); o += 2;
  view.setUint16(o, 32, true); o += 2;
  writeStr('data');
  view.setUint32(o, dataSize, true); o += 4;
  return ab;
}

// Só os dados PCM de um trecho (sem cabeçalho), prontos para gravar em sequência logo após o
// cabeçalho ou o pedaço anterior — é a peça que permite transmitir o áudio direto pro disco.
export function encodePcmFloat32(buffer: AudioBuffer): ArrayBuffer {
  const numCh = Math.max(1, buffer.numberOfChannels);
  const length = buffer.length;
  const ab = new ArrayBuffer(length * numCh * 4);
  const view = new DataView(ab);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let o = 0;
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
