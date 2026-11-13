// Medidor de loudness (LUFS) do master: filtro K (o da norma ITU-R BS.1770) na saída do master,
// momentâneo (400 ms) e curto (3 s).

/** LUFS a partir da soma das médias quadráticas (já com o filtro K) de cada canal. */
export function lufsFromMeanSquare(sum: number): number {
  return sum > 1e-12 ? -0.691 + 10 * Math.log10(sum) : -Infinity;
}

/**
 * Janela de loudness: guarda as medidas (instante e soma das médias quadráticas dos canais) e
 * devolve o momentâneo (400 ms) e o curto (3 s), como manda a norma.
 */
export class LoudnessWindow {
  private items: { t: number; ms: number }[] = [];

  push(t: number, meanSquareSum: number): void {
    this.items.push({ t, ms: meanSquareSum });
    while (this.items.length && this.items[0].t < t - 3) this.items.shift();
  }

  private avg(since: number): number {
    let s = 0;
    let n = 0;
    for (const it of this.items) if (it.t >= since) { s += it.ms; n++; }
    return n ? s / n : 0;
  }

  read(now: number): { momentary: number; shortTerm: number } {
    return { momentary: lufsFromMeanSquare(this.avg(now - 0.4)), shortTerm: lufsFromMeanSquare(this.avg(now - 3)) };
  }

  clear(): void {
    this.items = [];
  }
}

/** Filtro K aproximado com dois biquads do navegador: prateleira de agudos +4 dB e passa-alta. */
export function kWeightingNodes(ctx: BaseAudioContext): [BiquadFilterNode, BiquadFilterNode] {
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1500;
  shelf.gain.value = 4;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  shelf.connect(hp);
  return [shelf, hp];
}
