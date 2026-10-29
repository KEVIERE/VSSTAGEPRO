// Escala dos faders: 0,8 = 0 dB (unidade), 1,5 = +12 dB, 0 = silêncio. Abaixo da unidade a
// posição é proporcional ao ganho; acima, proporcional aos dB.
export function faderToGain(volume: number): number {
  if (volume >= 0.8) return Math.pow(10, ((volume - 0.8) / 0.7) * 0.6);
  return volume / 0.8;
}

/** Inverso exato de faderToGain. */
export function gainToFader(gain: number): number {
  if (!(gain > 0)) return 0;
  if (gain >= 1) return Math.min(1.5, 0.8 + (0.7 * Math.log10(gain)) / 0.6);
  return gain * 0.8;
}

// Teto do anti-clip: o pico mais alto medido fica 0,3 dB abaixo do clipping (folga para o pico
// entre amostras), baixando o fader só o necessário para isso.
export const ANTICLIP_CEILING = Math.pow(10, -0.3 / 20);

/** Nova posição do fader para o pico `peak` (linear, medido com o fader em `volume`) caber no teto. */
export function antiClipFader(volume: number, peak: number, ceiling = ANTICLIP_CEILING): number {
  if (!(peak > ceiling)) return volume;
  return gainToFader(faderToGain(volume) * (ceiling / peak));
}
