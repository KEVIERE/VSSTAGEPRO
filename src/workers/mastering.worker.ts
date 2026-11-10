/// <reference lib="webworker" />

// Masterização fora da thread da tela: numa música de 4 min ela leva alguns segundos de
// cálculo, que na thread principal travariam a tela e o som. Os canais chegam transferidos
// (sem cópia), são processados no lugar e voltam do mesmo jeito.
// O cálculo está em src/lib/mastering.ts; o cliente em src/lib/masteringClient.ts.
import { masterChannels, type MasterOptions, type MasterReport } from '@/lib/mastering';

export interface MasterRequest { id: number; channels: Float32Array[]; sampleRate: number; options: MasterOptions }
export type MasterResponse =
  | { id: number; ok: true; channels: Float32Array[]; report: MasterReport }
  | { id: number; ok: false; error: string };

self.onmessage = (ev: MessageEvent<MasterRequest>) => {
  const { id, channels, sampleRate, options } = ev.data;
  try {
    const res = masterChannels(channels, sampleRate, { ...options, inPlace: true });
    const msg: MasterResponse = { id, ok: true, channels: res.channels, report: res.report };
    (self as unknown as Worker).postMessage(msg, res.channels.map((c) => c.buffer));
  } catch (err) {
    const msg: MasterResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};
