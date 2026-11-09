// Análises pesadas de áudio, puras (sem navegador): o loudness e o pico real do "volume igual"
// e a IA de tom. Rodam no worker de análise (src/workers/analysis.worker.ts); este módulo também
// serve de reserva na própria thread quando o worker não abre.
// caminhos relativos com extensão, como em mastering.ts: os testes rodam este módulo direto no Node
import { integratedLoudness, truePeak } from './loudness.ts';
import { detectKey } from './musicKey.ts';

export type AnalysisRequest =
  | { id: number; kind: 'loudness'; channels: Float32Array[]; sampleRate: number }
  | { id: number; kind: 'key'; channels: Float32Array[]; sampleRate: number };

export type AnalysisResponse =
  | { id: number; ok: true; kind: 'loudness'; lufs: number; peak: number }
  | { id: number; ok: true; kind: 'key'; key: { key: string; confident: boolean } | null }
  | { id: number; ok: false; error: string };

/** Mono como a IA de tom ouve: a média dos canais. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  const k = channels.length || 1;
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / k;
  return mono;
}

export function analyze(req: AnalysisRequest): AnalysisResponse {
  try {
    if (req.kind === 'loudness') {
      return { id: req.id, ok: true, kind: 'loudness', lufs: integratedLoudness(req.channels, req.sampleRate), peak: truePeak(req.channels) };
    }
    return { id: req.id, ok: true, kind: 'key', key: detectKey(mixToMono(req.channels), req.sampleRate) };
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
