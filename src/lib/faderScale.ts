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

/**
 * Master desligado: o fader dele vira o volume geral dos canais com saída própria. Só abaixa até
 * 0 dB: essas saídas não passam pelo limitador do Master, e subir poderia estourar o PA.
 */
export function directOutFaderGain(masterOff: boolean, volume: number): number {
  return masterOff ? Math.min(1, faderToGain(volume)) : 1;
}

