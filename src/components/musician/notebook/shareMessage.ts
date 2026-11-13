// Texto do resultado do "Enviar para outro músico". Fica fora do SharePane para dar para testar.

/** Nomes em português: "Ana", "Ana e Bia", "Ana, Bia e Caio". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * `count`: quantos receberam. `skippedIds`: quem já tinha caderno desta música e ficou com o dele
 * (o nome vem da lista de colegas; id que não está na lista vira "colega").
 * ok false quando ninguém recebeu: o aviso não pode sair verde dizendo "Enviado".
 */
export function shareMessage(
  count: number, skippedIds: string[], colleagues: { id: string; name: string }[],
): { ok: boolean; text: string } {
  const byId = new Map(colleagues.map((c) => [c.id, c.name]));
  const known = skippedIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
  const unknown = skippedIds.length - known.length;
  const names = unknown > 0 ? [...known, `${unknown} ${unknown === 1 ? 'colega' : 'colegas'}`] : known;
  const skippedText = skippedIds.length === 0 ? ''
    : skippedIds.length === 1
      ? `${joinNames(names)} já tem caderno desta música; o caderno não foi trocado.`
      : `${joinNames(names)} já têm caderno desta música; os cadernos não foram trocados.`;
  if (count > 0) {
    const sent = count === 1
      ? 'Enviado: 1 músico recebeu a partitura desta música.'
      : `Enviado: ${count} músicos receberam a partitura desta música.`;
    return { ok: true, text: skippedText ? `${sent} ${skippedText}` : sent };
  }
  if (skippedText) return { ok: false, text: skippedText };
  return { ok: false, text: 'Ninguém recebeu a partitura. Confira com o diretor se os colegas ainda estão aprovados no show.' };
}
