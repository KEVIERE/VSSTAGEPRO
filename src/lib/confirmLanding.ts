// Para onde vai quem clicou no link de confirmação do cadastro (e-mail "confirme sua conta").
// Conta do programa: direto para a página de downloads do Mac, qualquer que seja a rota do link.
// Conta da Área do Músico (o link volta com ?musico=1): o card próprio, que leva para a área.
export type ConfirmLanding = 'download' | 'musician';

export function confirmLanding(linkType: string | null | undefined, search: string): ConfirmLanding | null {
  if (linkType !== 'signup') return null;
  return new URLSearchParams(search).has('musico') ? 'musician' : 'download';
}
