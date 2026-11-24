// Ceder a vez à tela entre os pedaços de um trabalho longo feito na thread da tela.
// Parado: MessageChannel, o mesmo recurso do audioStreamer (defaultYield), que não sofre o atraso
// mínimo de 4 ms dos timers aninhados. Tocando: uma espera de verdade de alguns ms, para não tomar
// a vez de quem alimenta o som (o disco entrega o áudio das faixas por esta mesma thread).
// scheduler.yield não serve: chegou no Chrome 129, e o Electron 32 do Catalina usa o Chromium 128.
// Sem import nenhum de propósito: pode ser usado por arquivos testados direto no node.

/** Espera entre os pedaços com música tocando (o mesmo espaçamento explícito do motor). */
export const PLAYING_GAP_MS = 4;

let playing: () => boolean = () => false;

/**
 * Quem sabe se há música tocando. O portão de fundo (backgroundGate.ts) registra ao carregar,
 * e ele carrega junto com a tela principal (App.tsx usa os vigias de tom e de volume).
 */
export function setPlayingCheck(fn: () => boolean): void {
  playing = fn;
}

function somethingPlaying(): boolean {
  try {
    return playing();
  } catch {
    return false;
  }
}

function channelYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/** Devolve a vez à tela e continua logo depois (parado) ou após PLAYING_GAP_MS (tocando). */
export function yieldToUi(): Promise<void> {
  if (somethingPlaying()) return new Promise<void>((resolve) => { setTimeout(resolve, PLAYING_GAP_MS); });
  return channelYield();
}
