import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import { logMel } from '@/lib/beatMel';
import { buildTempoSegments, clickTrackMap } from '@/lib/tempoFollow';

const SR = 22050;
const CHUNK = 1500;
const BORDER = 6;
const MELS = 128;

/** `step` avisa cada etapa pronta: quem espera sabe que a conta anda, mesmo num medley longo. */
async function activations(x: Float32Array, modelUrl: string, step: () => void = () => undefined) {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error('modelo de batidas indisponível');
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'] });
  step();
  const { data, frames } = logMel(x);
  step();
  const starts: number[] = [];
  for (let i = -BORDER; i < frames - BORDER; i += CHUNK - 2 * BORDER) starts.push(i);
  if (frames > CHUNK - 2 * BORDER) starts[starts.length - 1] = frames - (CHUNK - BORDER);
  const beat = new Float32Array(frames);
  const downbeat = new Float32Array(frames);
  for (const st of [...starts].reverse()) {
    const a = Math.max(st, 0);
    const b = Math.min(st + CHUNK, frames);
    const left = Math.max(0, -st);
    const right = Math.max(0, Math.min(BORDER, st + CHUNK - frames));
    const n = b - a + left + right;
    const c = new Float32Array(n * MELS);
    c.set(data.subarray(a * MELS, b * MELS), left * MELS);
    const o = await session.run({ spectrogram: new ort.Tensor('float32', c, [1, n, MELS]) });
    const rb = o.beat.data as Float32Array;
    const rd = o.downbeat.data as Float32Array;
    for (let k = BORDER; k < n - BORDER && st + k < frames; k++) {
      beat[st + k] = 1 / (1 + Math.exp(-rb[k]));
      downbeat[st + k] = 1 / (1 + Math.exp(-rd[k]));
    }
    step();
  }
  await session.release();
  return { beat, downbeat, fps: 50 };
}

self.onmessage = async (ev: MessageEvent<{ mono: Float32Array; beatsPerBar: number; modelUrl: string; isClick?: boolean; downbeatOnly?: boolean }>) => {
  try {
    const { mono, beatsPerBar, modelUrl, isClick, downbeatOnly } = ev.data;
    if (isClick) {
      self.postMessage({ ok: true, ...clickTrackMap(mono, SR, beatsPerBar) });
      return;
    }
    // conferência do tempo 1: só a ativação de downbeat, sem refazer o mapa
    if (downbeatOnly) {
      const { downbeat, fps } = await activations(mono, modelUrl, () => self.postMessage({ progress: true }));
      (self as unknown as Worker).postMessage({ ok: true, downbeat, fps }, [downbeat.buffer]);
      return;
    }
    const model = await activations(mono, modelUrl);
    self.postMessage({ ok: true, ...buildTempoSegments(mono, SR, model, beatsPerBar) });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
