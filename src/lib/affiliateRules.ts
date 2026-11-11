// Regras de tela do programa de afiliados, sem dependências (testadas em tests/affiliate.test.mjs).
// As mesmas regras são conferidas de novo no banco (migração 20261110230000_afiliados.sql).

/** Saque mínimo: R$ 100,00. */
export const MIN_PAYOUT_CENTS = 10_000;
/** Dias de espera até a comissão ficar disponível (prazo de estorno do cartão). */
export const HOLD_DAYS = 7;

export type CommissionStatus = 'pending' | 'available' | 'reserved' | 'paid' | 'canceled';
export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export const PIX_KEY_LABEL: Record<PixKeyType, string> = {
  cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', phone: 'Telefone', random: 'Chave aleatória',
};

export const COMMISSION_LABEL: Record<CommissionStatus, string> = {
  pending: 'A liberar',
  available: 'Disponível',
  reserved: 'Em saque',
  paid: 'Pago',
  canceled: 'Cancelado',
};

/** Comissão de um pagamento: arredonda para o centavo mais próximo (igual ao banco). */
export function commissionCents(baseCents: number, percent: number): number {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  const p = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return Math.round((base * p) / 100);
}

/** Situação vista agora: 'pending' que já passou da data de liberação é 'available'. */
export function commissionState(status: CommissionStatus, availableAt: string | number | Date, now = Date.now()): CommissionStatus {
  if (status === 'pending' && new Date(availableAt).getTime() <= now) return 'available';
  return status;
}

export type PayoutBlock = 'ended' | 'request_open' | 'no_pix_key' | 'below_minimum';

/** A tecla "Solicitar saque" pode ser apertada? Mesma ordem de recusa do banco. */
export function payoutBlock(p: {
  status: 'active' | 'paused' | 'ended';
  availableCents: number;
  hasPixKey: boolean;
  hasOpenRequest: boolean;
}): { block: PayoutBlock | null; missingCents: number } {
  const missingCents = Math.max(0, MIN_PAYOUT_CENTS - Math.max(0, p.availableCents));
  if (p.status === 'ended') return { block: 'ended', missingCents };
  if (p.hasOpenRequest) return { block: 'request_open', missingCents };
  if (!p.hasPixKey) return { block: 'no_pix_key', missingCents };
  if (missingCents > 0) return { block: 'below_minimum', missingCents };
  return { block: null, missingCents: 0 };
}

/** Confere e limpa a chave PIX como o banco faz. Devolve a chave pronta ou null. */
export function normalizePixKey(type: PixKeyType, raw: string): string | null {
  const key = String(raw ?? '').trim();
  const digits = key.replace(/\D+/g, '');
  switch (type) {
    case 'cpf': return digits.length === 11 ? digits : null;
    case 'cnpj': return digits.length === 14 ? digits : null;
    case 'phone': return digits.length >= 10 && digits.length <= 13 ? digits : null;
    case 'email': {
      const e = key.toLowerCase();
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 120 ? e : null;
    }
    case 'random': {
      const r = key.toLowerCase();
      return /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/.test(r) ? r : null;
    }
    default: return null;
  }
}

/** Link de indicação. Funciona em qualquer página do site. */
export function affiliateLink(code: string, origin = 'https://vsstagepro.com.br'): string {
  return `${origin.replace(/\/+$/, '')}/?ref=${encodeURIComponent(code)}`;
}

/** Texto pronto para o afiliado mandar no WhatsApp. */
export function affiliateShareText(code: string, discountPercent: number, link: string): string {
  return `Conheça o VS Stage Pro, o programa de multitracks para shows e cultos no Mac. `
    + `Usando o cupom ${code} você ganha ${discountPercent}% de desconto no primeiro pagamento: ${link}`;
}

/** "2026-11" do banco para "nov/26". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const names = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${names[(m || 1) - 1]}/${String(y).slice(-2)}`;
}

/** Últimos 12 meses (o atual por último), com zero onde não houve ganho. */
export function last12Months(rows: Array<{ month: string; cents: number }>, now = new Date()): Array<{ month: string; cents: number }> {
  const byMonth = new Map(rows.map((r) => [r.month, Number(r.cents) || 0]));
  const out: Array<{ month: string; cents: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, cents: byMonth.get(key) ?? 0 });
  }
  return out;
}

/** Mensagens dos códigos que as funções do afiliado devolvem. */
export const AFFILIATE_ERRORS: Record<string, string> = {
  below_minimum: 'O saque mínimo é de R$ 100,00 disponível.',
  no_pix_key: 'Cadastre sua chave PIX antes de pedir o saque.',
  request_open: 'Você já tem um saque pedido, aguardando pagamento.',
  affiliate_ended: 'Sua participação no programa foi encerrada.',
  pix_key_invalid: 'Chave PIX inválida. Confira o tipo e os números.',
  pix_name_invalid: 'Informe o nome completo do titular da chave.',
  not_allowed: 'Esta conta não está no programa de afiliados.',
  user_not_found: 'Não existe conta com esse e-mail. A pessoa precisa criar a conta antes.',
  affiliate_exists: 'Essa conta já é afiliada.',
  promo_exists: 'Já existe um cupom com esse código. Escolha outro.',
  promo_bad_code: 'Use de 3 a 32 letras, números, - ou _.',
  invalid_commission: 'Comissão deve ficar entre 0% e 100%.',
  invalid_discount: 'Desconto deve ficar entre 1% e 90%.',
  reference_required: 'Cole o código do PIX enviado.',
  reason_required: 'Escreva o motivo.',
  payout_not_open: 'Esse pedido já foi tratado.',
  commission_already_paid: 'Comissão já paga não pode ser cancelada.',
  commission_in_payout: 'Essa comissão está num saque pedido. Recuse o saque antes de cancelar.',
  promo_affiliate: 'Cupom de afiliado: ajuste pela aba Afiliados.',
  coupon_first_payment_only: 'Esse cupom vale só no primeiro pagamento.',
  coupon_own: 'Você não pode usar o seu próprio cupom.',
};

export function affiliateError(message: string | null | undefined): string {
  const m = String(message ?? '');
  for (const [code, text] of Object.entries(AFFILIATE_ERRORS)) if (m.includes(code)) return text;
  return 'Não foi possível concluir. Tente de novo.';
}
