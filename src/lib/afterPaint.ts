/**
 * Roda `fn` depois que a tela já foi pintada: na folga da thread principal (requestIdleCallback)
 * ou, no máximo, depois de `timeoutMs`. Serve para tirar trabalho pesado do quadro de um clique
 * (ex.: abrir a saída dos pads ao abrir o Modo Show). Devolve a função que cancela.
 */
export function afterPaint(fn: () => void, timeoutMs = 300): () => void {
  const g = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const id = g.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => g.cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, Math.min(timeoutMs, 50));
  return () => clearTimeout(id);
}
