/// <reference lib="webworker" />

// Classificação de instrumento por IA (YAMNet/TensorFlow.js) — usada como 2ª tentativa
// de roteamento, só quando o nome do arquivo não identificou o instrumento (ver
// src/lib/aiRouter.ts e src/lib/importManager.ts). Roda fora da thread da tela.
import * as tf from '@tensorflow/tfjs';
import { YAMNET_MODEL_URL, YAMNET_SAMPLE_RATE, YAMNET_CLASS_NAMES, routeByYamnetScores } from '@/lib/yamnetCategories';
import type { RoutingTarget } from '@/types';

export interface WorkerRequest {
  clipId: string;
  audioData: Float32Array;
  sampleRate: number;
}

export interface WorkerResponse {
  clipId: string;
  targetTrackId: RoutingTarget | null;
  childName: string | null;
  confidence: number;
  yamnetClass: string;
  error?: string;
}

let modelPromise: Promise<tf.GraphModel> | null = null;

function loadModel(): Promise<tf.GraphModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      return tf.loadGraphModel(YAMNET_MODEL_URL, { fromTFHub: true });
    })().catch((err) => {
      modelPromise = null; // permite tentar de novo numa próxima música se a 1ª falhou (ex: sem internet)
      throw err;
    });
  }
  return modelPromise;
}

function resampleTo16k(data: Float32Array, fromRate: number): Float32Array {
  if (fromRate === YAMNET_SAMPLE_RATE) return data;
  const ratio = YAMNET_SAMPLE_RATE / fromRate;
  const newLength = Math.floor(data.length * ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i / ratio;
    const idxLow = Math.floor(srcIdx);
    const idxHigh = Math.min(idxLow + 1, data.length - 1);
    const frac = srcIdx - idxLow;
    result[i] = data[idxLow] * (1 - frac) + data[idxHigh] * frac;
  }
  return result;
}

self.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const { clipId, audioData, sampleRate } = e.data;

  try {
    const model = await loadModel();
    const resampled = resampleTo16k(audioData, sampleRate);

    // O YAMNet pede um tensor 1-D [N] (não [1, N]) e já enquadra o áudio internamente
    // em janelas de ~0.96s — não é preciso fatiar manualmente.
    const input = tf.tensor1d(resampled);
    const [scoresTensor, embeddingsTensor, spectrogramTensor] = model.predict(input) as tf.Tensor[];

    // scoresTensor: [num_frames, 521] — média entre os frames dá o som predominante do clipe inteiro.
    const meanScores = scoresTensor.mean(0) as tf.Tensor1D;
    const top = await tf.topk(meanScores, 8, true);
    const topIndices = await top.indices.array() as number[];
    const topValues = await top.values.array() as number[];

    input.dispose();
    scoresTensor.dispose();
    embeddingsTensor.dispose();
    spectrogramTensor.dispose();
    meanScores.dispose();
    top.indices.dispose();
    top.values.dispose();

    const ranked = topIndices.map((idx, i) => ({
      className: YAMNET_CLASS_NAMES[idx] ?? `Classe_${idx}`,
      probability: topValues[i],
    }));

    const route = routeByYamnetScores(ranked);
    self.postMessage({
      clipId,
      targetTrackId: route?.target ?? null,
      childName: route?.childName ?? null,
      confidence: route?.confidence ?? 0,
      yamnetClass: route?.yamnetClass ?? ranked[0]?.className ?? '',
    } as WorkerResponse);
  } catch (err) {
    self.postMessage({
      clipId,
      targetTrackId: null,
      childName: null,
      confidence: 0,
      yamnetClass: '',
      error: err instanceof Error ? err.message : 'Erro desconhecido',
    } as WorkerResponse);
  }
});

export {};
