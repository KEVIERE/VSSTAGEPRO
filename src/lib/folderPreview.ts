// Prévia da pasta recolhida: uma forma de onda só, com todos os áudios das trilhas de dentro.

export interface PreviewClip {
  startTime: number;
  /** Duração do arquivo inteiro, em segundos */
  duration: number;
  trimStart?: number;
  trimEnd?: number;
  gain?: number;
  mute?: boolean;
  waveformPeaks?: number[];
}

export interface FolderPreview {
  /** Onde a prévia começa na timeline, em segundos */
  start: number;
  /** Do começo do primeiro áudio ao fim do último, em segundos */
  duration: number;
  /** Picos de 0 a 1, cada um resumindo um trecho igual de `duration` */
  peaks: number[];
}

/**
 * Junta as formas de onda dos áudios: em cada trecho vale o pico mais alto entre os que tocam
 * ali (somar estouraria o desenho). Respeita o corte do começo e do fim e o ganho de cada áudio;
 * áudio mudo fica de fora. Sem nenhum áudio com onda, devolve null.
 */
export function mergeFolderPeaks(clips: PreviewClip[], maxPoints = 12000): FolderPreview | null {
  const live = clips.filter((c) => !c.mute && (c.waveformPeaks?.length ?? 0) > 0 && c.duration > 0
    && c.duration - (c.trimStart ?? 0) - (c.trimEnd ?? 0) > 0);
  if (live.length === 0) return null;

  let start = Infinity;
  let end = -Infinity;
  let step = Infinity;
  for (const c of live) {
    const len = c.duration - (c.trimStart ?? 0) - (c.trimEnd ?? 0);
    start = Math.min(start, c.startTime);
    end = Math.max(end, c.startTime + len);
    step = Math.min(step, c.duration / c.waveformPeaks!.length);
  }
  const span = end - start;
  if (!(span > 0)) return null;
  // a resolução é a do áudio mais detalhado, com um teto para não pesar
  const count = Math.max(1, Math.min(maxPoints, Math.ceil(span / step)));
  const bucket = span / count;
  const peaks = new Array<number>(count).fill(0);

  for (const c of live) {
    const p = c.waveformPeaks!;
    const n = p.length;
    const from = c.trimStart ?? 0;
    const to = c.duration - (c.trimEnd ?? 0);
    const gain = c.gain ?? 1;
    const b0 = Math.max(0, Math.floor((c.startTime - start) / bucket));
    const b1 = Math.min(count - 1, Math.ceil((c.startTime + (to - from) - start) / bucket) - 1);
    for (let b = b0; b <= b1; b++) {
      // trecho do arquivo que cai neste pedaço da prévia
      const t0 = Math.max(from, start + b * bucket - c.startTime + from);
      const t1 = Math.min(to, t0 + bucket);
      const i0 = Math.min(n - 1, Math.max(0, Math.floor((t0 / c.duration) * n)));
      const i1 = Math.min(n - 1, Math.max(i0, Math.ceil((t1 / c.duration) * n) - 1));
      let m = 0;
      for (let i = i0; i <= i1; i++) if (p[i] > m) m = p[i];
      const v = Math.min(1, m * gain);
      if (v > peaks[b]) peaks[b] = v;
    }
  }
  return { start, duration: span, peaks };
}
