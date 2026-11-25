// Área do Assinante (vsstagepro.com.br/area-do-assinante): a lista de bônus e quem pode usar.
// Sem imports: os testes (node --test) carregam este arquivo direto.
//
// Para criar um bônus novo:
//   1. Acrescente um item em BONUSES (id só com letras minúsculas, números e hífen).
//   2. Se for um arquivo para baixar: kind 'download' e envie o arquivo para o bucket
//      privado "bonus" do Supabase, dentro de uma pasta com o mesmo nome do id
//      (ex.: bonus/pack-de-loops/Pack de Loops.zip). O servidor só entrega o link para
//      quem é assinante em dia (função bonus-download).
//   3. Enquanto não estiver pronto, use kind 'soon': aparece na lista como "Em breve".

export type BonusKind = 'download' | 'soon';

export type BonusItem = {
  id: string;
  title: string;
  description: string;
  kind: BonusKind;
  /** Texto curto no canto do cartão (ex.: "Mac", "ZIP · 1,2 GB") */
  tag?: string;
};

export const BONUSES: BonusItem[] = [
  {
    id: 'stage-download',
    title: 'Stage Download',
    description: 'Cole um link e baixe o áudio ou o vídeo na qualidade original, em MP3, WAV, FLAC ou M4A.',
    kind: 'soon',
    tag: 'Mac',
  },
];

/** Situação da conta para os bônus (vem da função bonus_access do banco). */
export type BonusAccess = 'anonymous' | 'none' | 'trial' | 'expired' | 'blocked' | 'subscriber';

const ACCESS: readonly BonusAccess[] = ['anonymous', 'none', 'trial', 'expired', 'blocked', 'subscriber'];

export function accessOf(raw: unknown): BonusAccess {
  const s = (raw as { status?: unknown } | null)?.status;
  return typeof s === 'string' && (ACCESS as readonly string[]).includes(s) ? (s as BonusAccess) : 'none';
}

/** Só assinante em dia (e parceiro, que vem como 'subscriber') usa os bônus. Teste grátis, vencido e bloqueado ficam de fora. */
export function canUseBonus(access: BonusAccess): boolean {
  return access === 'subscriber';
}

/** Aviso mostrado no lugar dos bônus quando a conta não pode usar. */
export function lockedNotice(access: BonusAccess): { title: string; text: string; cta: string } | null {
  switch (access) {
    case 'subscriber':
      return null;
    case 'expired':
      return {
        title: 'Sua assinatura venceu',
        text: 'Os bônus voltam a ficar liberados assim que você renovar o seu plano.',
        cta: 'Renovar assinatura',
      };
    case 'trial':
      return {
        title: 'Bônus exclusivos para assinantes',
        text: 'Você está no teste grátis. Assine o VS Stage Pro para liberar todos os bônus.',
        cta: 'Assinar agora',
      };
    case 'blocked':
      return {
        title: 'Conta bloqueada',
        text: 'Fale com o suporte do VS Stage Pro para entender o motivo e liberar a conta.',
        cta: 'Falar com o suporte',
      };
    default:
      return {
        title: 'Bônus exclusivos para assinantes',
        text: 'Assine o VS Stage Pro para liberar todos os bônus desta área.',
        cta: 'Assinar agora',
      };
  }
}

/** Mensagem para o erro que a função bonus-download devolve. */
export function bonusDownloadError(code: unknown): string {
  switch (code) {
    case 'not_subscriber':
      return 'Esse bônus é só para assinantes em dia. Confira sua assinatura e tente de novo.';
    case 'not_found':
      return 'Esse arquivo ainda não está disponível. Tente de novo mais tarde.';
    case 'login':
      return 'Sua sessão terminou. Entre de novo na sua conta.';
    default:
      return 'Não foi possível liberar o download agora. Tente de novo em instantes.';
  }
}

/** Data no formato do Brasil (ex.: 25/12/2026), ou null se não der para ler. */
export function untilLabel(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
