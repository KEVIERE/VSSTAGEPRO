// Regras do programa de afiliados usadas pelas funções do servidor (pix-checkout e
// telegram-alert), sem dependências externas. Testes em tests/affiliate.test.mjs (npm test).

/** Resposta de discount_check_for_user (ver a migração 20261110230000_afiliados.sql). */
export type DiscountCheck = {
  valid?: boolean;
  error?: string;
  percent?: number | null;
  affiliate?: boolean;
  first_payment_only?: boolean;
} | null | undefined;

/**
 * Por que o cupom não vale para esta conta, no código que a tela entende, ou null se vale.
 * Os dois casos do afiliado têm mensagem própria; o resto é "cupom inválido".
 */
export function couponRefusal(check: DiscountCheck): string | null {
  if (check?.valid && Number(check.percent) > 0) return null;
  if (check?.error === 'coupon_first_payment_only') return 'coupon_first_payment_only';
  if (check?.error === 'coupon_own') return 'coupon_own';
  return 'invalid_coupon';
}

/** Pedido de saque como volta de affiliate_payout_alert_claim. */
export type PayoutAlert = {
  amount_cents: number;
  code: string;
  email: string | null;
  payout_name: string;
  pix_key_type: string;
  pix_key: string;
};

const PIX_TYPE_LABEL: Record<string, string> = {
  cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', phone: 'Telefone', random: 'Chave aleatória',
};

/** O Telegram usa Markdown simples: tira os caracteres que quebrariam a formatação. */
export function escapeTelegram(text: string): string {
  return String(text ?? '').replace(/[_*`[\]]/g, '');
}

export function brl(cents: number): string {
  const n = Math.round(Number(cents) || 0);
  const reais = Math.floor(n / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${String(n % 100).padStart(2, '0')}`;
}

/** Texto do aviso no Telegram quando um afiliado pede saque. */
export function payoutAlertText(p: PayoutAlert): string {
  const tipo = PIX_TYPE_LABEL[p.pix_key_type] ?? p.pix_key_type;
  return [
    '*Saque de afiliado pedido*',
    `Afiliado: ${escapeTelegram(p.payout_name)} (${escapeTelegram(p.code)})`,
    p.email ? `Conta: ${escapeTelegram(p.email)}` : null,
    `Valor: *${brl(p.amount_cents)}*`,
    `PIX (${tipo}): \`${escapeTelegram(p.pix_key)}\``,
    'Pague e marque como pago em Admin > Afiliados.',
  ].filter(Boolean).join('\n');
}
