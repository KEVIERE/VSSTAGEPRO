// Remonta o click fora da thread da tela: achar as batidas de uma música inteira leva tempo.
import { findClickBeats, remountClick } from '../lib/clickRemount.ts';

type Req = {
  id: number;
  left: Int16Array;
  right: Int16Array;
  sampleRate: number;
  tempo: number;
  /** Batidas já achadas numa remontagem anterior deste clipe. */
  hits: number[] | null;
};

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, left, right, sampleRate, tempo } = ev.data;
  try {
    const hits = ev.data.hits ?? findClickBeats(left, right, sampleRate);
    if (!hits) {
      (self as unknown as Worker).postMessage({ id, ok: true, hits: null });
      return;
    }
    const out = remountClick(left, right, hits, sampleRate, tempo);
    const transfer = out.left === out.right ? [out.left.buffer] : [out.left.buffer, out.right.buffer];
    (self as unknown as Worker).postMessage({ id, ok: true, hits, left: out.left, right: out.right }, transfer as Transferable[]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (e as Error).message });
  }
};

export {};
