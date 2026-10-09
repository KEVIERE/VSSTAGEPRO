export class SoundTouch {
  constructor(sampleRate?: number);
  tempo: number;
  pitch: number;
  stretch: {
    setParameters(sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number): void;
    quickSeek: boolean;
  };
}

export class SimpleFilter {
  constructor(source: unknown, pipe: SoundTouch);
  extract(target: Float32Array, numFrames: number): number;
}
