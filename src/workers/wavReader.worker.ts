// Lê WAV direto do arquivo, fora da tela e do som: sem a conversão lenta do navegador.
// Se a taxa do arquivo for outra, converte aqui mesmo. A conversão de cada amostra só depende
// do arquivo, então ler só o começo dá exatamente o começo da leitura inteira.

type Req = { id: number; blob: Blob; targetRate: number; maxFrames: number; probeOnly: boolean };

type Res =
  | { id: number; ok: true; sampleRate: number; sourceRate: number; totalFrames: number; channels: Int16Array[] }
  | { id: number; ok: false };

interface WavInfo {
  rate: number;
  channels: number;
  bits: number;
  float: boolean;
  dataStart: number;
  frames: number;
}

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

async function parseHeader(blob: Blob): Promise<WavInfo | null> {
  const probe = new DataView(await blob.slice(0, 1 << 16).arrayBuffer());
  if (probe.byteLength < 44 || tag(probe, 0) !== 'RIFF' || tag(probe, 8) !== 'WAVE') return null;
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number; blockAlign: number } | null = null;
  while (o + 8 <= probe.byteLength) {
    const id = tag(probe, o);
    const size = probe.getUint32(o + 4, true);
    if (id === 'fmt ') {
      if (o + 24 > probe.byteLength) return null;
      let format = probe.getUint16(o + 8, true);
      if (format === 0xfffe && o + 34 <= probe.byteLength) format = probe.getUint16(o + 32, true);
      fmt = {
        format,
        channels: probe.getUint16(o + 10, true),
        rate: probe.getUint32(o + 12, true),
        blockAlign: probe.getUint16(o + 20, true),
        bits: probe.getUint16(o + 22, true),
      };
    } else if (id === 'data') {
      if (!fmt) return null;
      const float = fmt.format === 3;
      if (fmt.format !== 1 && !float) return null;
      if (float ? fmt.bits !== 32 && fmt.bits !== 64 : ![8, 16, 24, 32].includes(fmt.bits)) return null;
      if (!fmt.channels || fmt.blockAlign !== fmt.channels * (fmt.bits / 8)) return null;
      const dataStart = o + 8;
      const available = blob.size - dataStart;
      const dataSize = !size || size > available ? available : size;
      return { rate: fmt.rate, channels: fmt.channels, bits: fmt.bits, float, dataStart, frames: Math.floor(dataSize / fmt.blockAlign) };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

function clamp16(v: number): number {
  const s = Math.round(v * 32767);
  return s > 32767 ? 32767 : s < -32768 ? -32768 : s;
}

// Mesmo resultado do caminho antigo (áudio do navegador convertido para 16 bits).
function convert(bytes: ArrayBuffer, info: WavInfo, frames: number): Int16Array[] {
  const view = new DataView(bytes);
  const outCount = Math.min(2, info.channels);
  const out = Array.from({ length: outCount }, () => new Int16Array(frames));
  const step = info.bits / 8;
  const block = step * info.channels;
  for (let c = 0; c < outCount; c++) {
    const dst = out[c];
    let p = c * step;
    if (info.float && info.bits === 32) {
      for (let i = 0; i < frames; i++, p += block) dst[i] = clamp16(view.getFloat32(p, true));
    } else if (info.float) {
      for (let i = 0; i < frames; i++, p += block) dst[i] = clamp16(view.getFloat64(p, true));
    } else if (info.bits === 16) {
      for (let i = 0; i < frames; i++, p += block) dst[i] = view.getInt16(p, true);
    } else if (info.bits === 24) {
      for (let i = 0; i < frames; i++, p += block) {
        const v = (view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) / 8388608;
        dst[i] = clamp16(v);
      }
    } else if (info.bits === 32) {
      for (let i = 0; i < frames; i++, p += block) dst[i] = clamp16(view.getInt32(p, true) / 2147483648);
    } else {
      for (let i = 0; i < frames; i++, p += block) dst[i] = clamp16((view.getUint8(p) - 128) / 128);
    }
  }
  return out;
}

function toFloat(bytes: ArrayBuffer, info: WavInfo, frames: number, c: number): Float32Array {
  const view = new DataView(bytes);
  const dst = new Float32Array(frames);
  const step = info.bits / 8;
  const block = step * info.channels;
  let p = c * step;
  if (info.float && info.bits === 32) {
    for (let i = 0; i < frames; i++, p += block) dst[i] = view.getFloat32(p, true);
  } else if (info.float) {
    for (let i = 0; i < frames; i++, p += block) dst[i] = view.getFloat64(p, true);
  } else if (info.bits === 16) {
    for (let i = 0; i < frames; i++, p += block) dst[i] = view.getInt16(p, true) / 32768;
  } else if (info.bits === 24) {
    for (let i = 0; i < frames; i++, p += block) dst[i] = (view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) / 8388608;
  } else if (info.bits === 32) {
    for (let i = 0; i < frames; i++, p += block) dst[i] = view.getInt32(p, true) / 2147483648;
  } else {
    for (let i = 0; i < frames; i++, p += block) dst[i] = (view.getUint8(p) - 128) / 128;
  }
  return dst;
}

// Conversão de taxa por sinc com janela de Blackman, em tabela de fases.
const HALF_TAPS = 12;
const TAPS = HALF_TAPS * 2;
const PHASES = 512;
const kernels = new Map<string, Float32Array>();

function kernelFor(srcRate: number, dstRate: number): Float32Array {
  const key = `${srcRate}>${dstRate}`;
  let table = kernels.get(key);
  if (table) return table;
  const cutoff = Math.min(1, dstRate / srcRate) * 0.97;
  table = new Float32Array((PHASES + 1) * TAPS);
  for (let ph = 0; ph <= PHASES; ph++) {
    const frac = ph / PHASES;
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      const x = k - HALF_TAPS + 1 - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const n = (x + HALF_TAPS) / TAPS;
      const win = n <= 0 || n >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
      const v = sinc * win;
      table[ph * TAPS + k] = v;
      sum += v;
    }
    if (sum !== 0) for (let k = 0; k < TAPS; k++) table[ph * TAPS + k] /= sum;
  }
  kernels.set(key, table);
  return table;
}

function resample(src: Float32Array, srcTotal: number, srcRate: number, dstRate: number, outFrames: number): Int16Array {
  const table = kernelFor(srcRate, dstRate);
  const out = new Int16Array(outFrames);
  const ratio = srcRate / dstRate;
  const have = src.length;
  for (let i = 0; i < outFrames; i++) {
    const t = i * ratio;
    const base = Math.floor(t);
    const ph = Math.round((t - base) * PHASES);
    const row = ph * TAPS;
    const first = base - HALF_TAPS + 1;
    let acc = 0;
    if (first >= 0 && first + TAPS <= have) {
      for (let k = 0; k < TAPS; k++) acc += src[first + k] * table[row + k];
    } else {
      for (let k = 0; k < TAPS; k++) {
        const j = first + k;
        if (j >= 0 && j < have && j < srcTotal) acc += src[j] * table[row + k];
      }
    }
    out[i] = clamp16(acc);
  }
  return out;
}

function outFramesOf(info: WavInfo, targetRate: number): number {
  return info.rate === targetRate ? info.frames : Math.floor((info.frames * targetRate) / info.rate);
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { id, blob, targetRate, maxFrames, probeOnly } = ev.data;
  const reply = (res: Res, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(res, transfer);
  try {
    const info = await parseHeader(blob);
    if (!info || info.frames <= 0 || info.rate < 8000 || info.rate > 384000) return reply({ id, ok: false });
    const total = outFramesOf(info, targetRate);
    if (total <= 0) return reply({ id, ok: false });
    if (probeOnly) return reply({ id, ok: true, sampleRate: targetRate, sourceRate: info.rate, totalFrames: total, channels: [] });
    const frames = maxFrames > 0 ? Math.min(maxFrames, total) : total;
    const blockBytes = (info.bits / 8) * info.channels;
    let channels: Int16Array[];
    if (info.rate === targetRate) {
      const bytes = await blob.slice(info.dataStart, info.dataStart + frames * blockBytes).arrayBuffer();
      channels = convert(bytes, info, Math.floor(bytes.byteLength / blockBytes));
    } else {
      const srcFrames = Math.min(info.frames, Math.ceil((frames * info.rate) / targetRate) + HALF_TAPS + 1);
      const bytes = await blob.slice(info.dataStart, info.dataStart + srcFrames * blockBytes).arrayBuffer();
      const got = Math.floor(bytes.byteLength / blockBytes);
      channels = [];
      for (let c = 0; c < Math.min(2, info.channels); c++) {
        channels.push(resample(toFloat(bytes, info, got, c), info.frames, info.rate, targetRate, frames));
      }
    }
    reply({ id, ok: true, sampleRate: targetRate, sourceRate: info.rate, totalFrames: total, channels }, channels.map((c) => c.buffer));
  } catch {
    reply({ id, ok: false });
  }
};
