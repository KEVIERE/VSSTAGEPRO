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

export interface MasterOutput {
  /** Primeira saída física (1 em diante). */
  channel: number;
  /** Par estéreo N/N+1 em vez de uma saída mono. */
  stereo: boolean;
}

/** Onde o Master sempre saiu, e onde sai em projeto antigo. */
export const DEFAULT_MASTER_OUTPUT: MasterOutput = { channel: 1, stereo: true };

/** Saída salva no projeto: valor estranho ou par que não começa em ímpar volta para 1/2. */
export function normalizeMasterOutput(channel: unknown, stereo: unknown): MasterOutput {
  if (typeof channel !== 'number' || !Number.isInteger(channel) || channel < 1) return { ...DEFAULT_MASTER_OUTPUT };
  const pair = stereo !== false;
  if (pair && channel % 2 === 0) return { ...DEFAULT_MASTER_OUTPUT };
  return { channel, stereo: pair };
}

/**
 * Para onde o Master vai agora. A placa não tem a saída ou está desconectada: volta para 1/2, para
 * o show nunca ficar mudo. LR mágico precisa de L e R: saída mono usa o par em que ela está.
 */
export function resolveMasterOutput(m: MasterOutput & { magic: boolean; outputCount: number; interfaceMissing: boolean }): MasterOutput {
  const { channel, stereo } = normalizeMasterOutput(m.channel, m.stereo);
  const first = m.magic && !stereo ? channel - ((channel - 1) % 2) : channel;
  const pair = stereo || m.magic;
  if (m.interfaceMissing || first + (pair ? 1 : 0) > m.outputCount) return { ...DEFAULT_MASTER_OUTPUT };
  return { channel: first, stereo: pair };
}

/**
 * Saídas que o timecode não pode usar: onde o Master está agora, onde foi escolhido (a placa pode
 * voltar) e o par inteiro de um Master mono (ligar o LR mágico abre o Master nesse par).
 */
export function masterReservedOutputs(m: MasterOutput & { magic: boolean; outputCount: number; interfaceMissing: boolean }): number[] {
  const real = resolveMasterOutput(m);
  const saved = normalizeMasterOutput(m.channel, m.stereo);
  const pairStart = saved.channel - ((saved.channel - 1) % 2);
  const outs = new Set([pairStart, pairStart + 1, real.channel]);
  if (real.stereo) outs.add(real.channel + 1);
  return [...outs].sort((a, b) => a - b);
}

/** A placa escolhida no projeto está fora do ar (o programa voltou para a saída padrão do Mac). */
export function interfaceMissing(audioInterface: string | null | undefined, connected: boolean): boolean {
  return !!audioInterface && audioInterface !== 'default' && !connected;
}
