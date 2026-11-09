export const ANTI_CLIP_CEILING: number;
export const ANTI_CLIP_CEILING_DB: number;
export const LIMITER_LOOKAHEAD: number;
export const LIMITER_RELEASE: number;

export interface PeakLimiterOptions {
  /** Teto linear (padrão: -0,1 dBFS). */
  ceiling?: number;
  /** Antecipação em segundos (é também o atraso). */
  lookahead?: number;
  /** Volta do ganho depois do pico, em segundos. */
  release?: number;
  channels?: number;
}

export class PeakLimiter {
  constructor(sampleRate: number, options?: PeakLimiterOptions);
  readonly ceiling: number;
  /** Atraso em amostras. */
  readonly delay: number;
  /** Menor ganho aplicado até agora (1 = nunca precisou agir). */
  readonly minGain: number;
  process(inputs: ArrayLike<Float32Array>, outputs: ArrayLike<Float32Array>, frames: number): void;
}

export function limitInPlace(channels: Float32Array[], sampleRate: number, options?: Omit<PeakLimiterOptions, 'channels'>): number;
