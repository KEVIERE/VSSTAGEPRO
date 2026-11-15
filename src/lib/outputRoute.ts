// Para onde vai o som de uma faixa: Master (LR), uma saída física da placa, um par estéreo
// ou lugar nenhum. Sem dependência do programa, para rodar também nos testes.

export interface RouteInput {
  /** Saída escolhida na faixa: 0 = Master, N = saída física N. */
  out: number;
  /** "Desligado": a faixa não toca em lugar nenhum. */
  off: boolean;
  /** Par estéreo N/N+1 em vez de saída mono. */
  stereo: boolean;
  /** Faixa de timecode (LTC): sempre mono e nunca no Master. */
  timecode: boolean;
  /** LR mágico ligado: tudo da música vai para o Master. */
  magic: boolean;
  /** Quantas saídas a placa atual tem. */
  outputCount: number;
  /**
   * A placa salva no projeto está desconectada e o som voltou para o LR do Mac. As saídas
   * diretas (1, 2, 3...) voltam para o Master; senão uma Guia na "Saída 1" tocava só no L.
   */
  interfaceMissing: boolean;
}

export interface Route {
  /** Saída física (1 em diante) ou 0 quando vai para o Master ou para lugar nenhum. */
  physical: number;
  key: string;
}

export function resolveRoute(r: RouteInput): Route {
  const fits = r.out > 0 && r.out + (r.stereo && !r.timecode ? 1 : 0) <= r.outputCount;
  // sem a placa, o timecode fica mudo: o chiado do LTC não pode sair no alto-falante do Mac
  const physical = fits && !r.interfaceMissing && (r.timecode || !r.magic) ? r.out : 0;
  if (physical) return { physical, key: `${r.stereo && !r.timecode ? 'pair' : 'out'}-${physical}` };
  return { physical: 0, key: r.timecode || r.off ? 'none' : 'master' };
}

/** A placa escolhida no projeto está fora do ar (o programa voltou para a saída padrão do Mac). */
export function interfaceMissing(audioInterface: string | null | undefined, connected: boolean): boolean {
  return !!audioInterface && audioInterface !== 'default' && !connected;
}
