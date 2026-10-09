/// <reference lib="webworker" />

import * as tf from '@tensorflow/tfjs';
import { YAMNET_MODEL_URL, YAMNET_SAMPLE_RATE, routeByYamnetCategory } from '@/lib/yamnetCategories';
import type { RoutingTarget } from '@/types';

export interface WorkerRequest {
  clipId: string;
  audioData: Float32Array;
  sampleRate: number;
}

export interface WorkerResponse {
  clipId: string;
  targetTrackId: RoutingTarget;
  confidence: number;
  yamnetClass: string;
  error?: string;
}

let model: tf.GraphModel | null = null;

async function loadModel(): Promise<tf.GraphModel> {
  if (model) return model;
  await tf.setBackend('cpu');
  await tf.ready();
  model = await tf.loadGraphModel(YAMNET_MODEL_URL);
  return model;
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
    const yamnet = await loadModel();
    const resampled = resampleTo16k(audioData, sampleRate);

    const segmentLength = Math.floor(YAMNET_SAMPLE_RATE * 0.96);
    const numSegments = Math.floor(resampled.length / segmentLength);

    if (numSegments === 0) {
      const padded = new Float32Array(segmentLength);
      padded.set(resampled.subarray(0, Math.min(resampled.length, segmentLength)));
      const scores = classifySegment(yamnet, padded);
      const best = findBestClass(scores);
      const route = routeByYamnetCategory(best.className);
      self.postMessage({
        clipId,
        targetTrackId: route?.target ?? 'track-outros',
        confidence: route?.confidence ?? 0.3,
        yamnetClass: best.className,
      } as WorkerResponse);
      return;
    }

    // Aggregate scores across all segments
    const aggregateScores: Record<string, { score: number; count: number }> = {};
    for (let seg = 0; seg < numSegments; seg++) {
      const segment = resampled.subarray(seg * segmentLength, (seg + 1) * segmentLength);
      const scores = classifySegment(yamnet, segment);
      for (const { className, probability } of scores) {
        if (!aggregateScores[className]) {
          aggregateScores[className] = { score: 0, count: 0 };
        }
        aggregateScores[className].score += probability;
        aggregateScores[className].count += 1;
      }
    }

    // Find best averaged class
    let bestClass = '';
    let bestAvg = -1;
    for (const [className, { score, count }] of Object.entries(aggregateScores)) {
      const avg = score / count;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestClass = className;
      }
    }

    const route = routeByYamnetCategory(bestClass);
    self.postMessage({
      clipId,
      targetTrackId: route?.target ?? 'track-outros',
      confidence: route?.confidence ?? 0.3,
      yamnetClass: bestClass,
    } as WorkerResponse);
  } catch (err) {
    self.postMessage({
      clipId,
      targetTrackId: 'track-outros',
      confidence: 0,
      yamnetClass: '',
      error: err instanceof Error ? err.message : 'Erro desconhecido',
    } as WorkerResponse);
  }
});

function classifySegment(
  model: tf.GraphModel,
  segment: Float32Array
): { className: string; probability: number }[] {
  const input = tf.tensor(segment, [1, segment.length]);
  const output = model.predict(input) as tf.Tensor;
  const scores = output.dataSync();
  input.dispose();
  output.dispose();

  // YAMNet output is [1, 521] — 521 AudioSet classes
  const results: { className: string; probability: number }[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > 0.1) {
      results.push({ className: YAMNET_CLASS_NAMES[i] ?? `Class_${i}`, probability: scores[i] });
    }
  }
  results.sort((a, b) => b.probability - a.probability);
  return results.slice(0, 5);
}

function findBestClass(scores: { className: string; probability: number }[]): { className: string; probability: number } {
  return scores.length > 0 ? scores[0] : { className: 'Unknown', probability: 0 };
}

// Minimal YAMNet class names subset (full list is 521 entries)
const YAMNET_CLASS_NAMES: Record<number, string> = {
  0: 'Speech', 1: 'Male speech, man speaking', 2: 'Female speech, woman speaking',
  3: 'Child speech, kid speaking', 4: 'Conversation', 5: 'Narration, monologue',
  // ... many more, but we map by the most relevant ones
  64: 'Laughter', 65: 'Giggle', 66: 'Snicker', 67: 'Belly laugh',
  // Music categories
  137: 'Music', 138: 'Musical instrument', 139: 'Drum kit', 140: 'Drum machine',
  141: 'Drum', 142: 'Snare drum', 143: 'Bass drum', 144: 'Tambourine',
  145: 'Cymbal', 146: 'Hi-hat', 147: 'Gong', 148: 'Percussion',
  149: 'Marimba, xylophone', 150: 'Bass guitar', 151: 'Bass', 152: 'Double bass',
  153: 'Electric guitar', 154: 'Guitar', 155: 'Acoustic guitar',
  156: 'Steel guitar, slide guitar', 157: 'Piano', 158: 'Keyboard',
  159: 'Synthesizer', 160: 'Organ', 161: 'Accordion', 162: 'Brass instrument',
  163: 'Trumpet', 164: 'Trombone', 165: 'Saxophone', 166: 'Strings',
  167: 'Violin', 168: 'Cello', 169: 'Orchestral music',
  170: 'Electronic music', 171: 'Distortion', 172: 'Cap gun',
};
