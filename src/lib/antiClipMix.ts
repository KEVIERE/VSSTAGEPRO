// Exportação com anti-clip: o limitador age na soma do canal inteiro, como na reprodução. A
// exportação renderiza um clipe por vez, então os clipes dos canais com anti-clip são separados
// por canal (somados à parte e limitados juntos); os outros seguem na ordem de sempre.
// Sem dependências: roda igual no app e nos testes do Node.

export interface AntiClipSplit<T> {
  /** Itens de canais sem anti-clip, na ordem original. */
  plain: T[];
  /** Itens de cada canal com anti-clip, um grupo por canal (na ordem em que o canal aparece). */
  groups: T[][];
}

/** `limitedChannel` diz o canal com anti-clip do item, ou null se o canal sai livre. */
export function splitByAntiClip<T>(items: T[], limitedChannel: (item: T) => string | null): AntiClipSplit<T> {
  const plain: T[] = [];
  const byChannel = new Map<string, T[]>();
  for (const item of items) {
    const channel = limitedChannel(item);
    if (channel === null) { plain.push(item); continue; }
    const group = byChannel.get(channel);
    if (group) group.push(item);
    else byChannel.set(channel, [item]);
  }
  return { plain, groups: Array.from(byChannel.values()) };
}
