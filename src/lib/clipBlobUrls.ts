// O áudio de um clipe é lido pela biblioteca (audioLibrary), nunca pelo endereço blob: gravado em
// clip.filePath. Só que o endereço, enquanto existe, prende o áudio inteiro na memória até fechar
// o programa. Aqui ele é liberado quando nem o projeto nem o Desfazer usam mais aquele clipe.

/** Guarda os endereços vistos e devolve uma função que libera os que saíram de uso. */
export function createClipUrlReleaser(revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {
  const known = new Set<string>();
  return (inUse: ReadonlySet<string>): number => {
    for (const url of inUse) known.add(url);
    let released = 0;
    for (const url of known) {
      if (inUse.has(url)) continue;
      known.delete(url);
      try { revoke(url); released++; } catch { /* já liberado */ }
    }
    return released;
  };
}

export function isBlobUrl(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith('blob:');
}
