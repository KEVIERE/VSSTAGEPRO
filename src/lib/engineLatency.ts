/**
 * Tamanho de bloco que o motor das músicas pede à placa (ver audioEngine.getContext).
 * No Mac, o Chromium usa na placa o MENOR bloco pedido entre todas as saídas abertas: um
 * AudioContext extra (pads, prévia do click, teste de saída, medidor do Maestro) com bloco menor
 * que o do motor encurta a folga das músicas e vira estalo em qualquer pico de CPU. Toda saída
 * extra pede este mesmo valor, nunca menos.
 * Lê a mesma chave que o motor (vs_stable_audio, ligado por padrão); o motor só troca o modo
 * com o play parado e grava a chave junto.
 */
export function engineLatencyHint(): AudioContextLatencyCategory {
  try {
    return localStorage.getItem('vs_stable_audio') !== '0' ? 'playback' : 'interactive';
  } catch {
    // sem localStorage: o motor também cai no modo estável (padrão)
    return 'playback';
  }
}

/**
 * Bloco dos pads: o menor que a placa dá, porque pad é tocado na hora e atraso se sente.
 * Medido no Mac (Electron do app, 48 kHz): o bloco do motor no modo estável ('playback') dava
 * uns 55 a 70 ms entre o toque e o som; 'interactive' dá uns 21 ms. É a única saída extra com
 * bloco menor que o do motor. Ela só abre com o painel ou o Modo Show, e nunca é criada nem
 * trocada com música tocando.
 */
export function padLatencyHint(): AudioContextLatencyCategory {
  return 'interactive';
}
