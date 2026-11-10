// Regras do pagamento (InfinitePay e o antigo Asaas) sem dependências externas.
// Usadas pelas funções pix-checkout e asaas-webhook e pelos testes (tests/pix.test.mjs, npm test).

export type Plan = 'monthly' | 'yearly';

// Mesmos preços do stripe-checkout e da página de planos (em centavos).
export const PIX_PLANS: Record<Plan, { cents: number; description: string }> = {
  monthly: { cents: 5500, description: 'VS Stage Pro — Plano Mensal (PIX, 1 mês de acesso)' },
  yearly: { cents: 34900, description: 'VS Stage Pro — Plano Anual (PIX, 1 ano de acesso)' },
};

// O Asaas não aceita cobrança abaixo de R$ 5,00.
export const MIN_PIX_CENTS = 500;

export const ASAAS_PRODUCTION_URL = 'https://api.asaas.com/v3';
export const ASAAS_SANDBOX_URL = 'https://api-sandbox.asaas.com/v3';

/** Chave de produção começa com $aact_prod_ e a de testes com $aact_hmlg_. Chave antiga sem
 *  esse prefixo usa o ASAAS_ENV ('production'); sem ele, fica no ambiente de testes. */
export function asaasBaseUrl(apiKey: string, env?: string | null): string {
  if (apiKey.startsWith('$aact_prod_')) return ASAAS_PRODUCTION_URL;
  if (apiKey.startsWith('$aact_hmlg_')) return ASAAS_SANDBOX_URL;
  return env === 'production' ? ASAAS_PRODUCTION_URL : ASAAS_SANDBOX_URL;
}

export const onlyDigits = (s: unknown): string => String(s ?? '').replace(/\D+/g, '');

function cpfOk(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const dv = (sum * 10) % 11 % 10;
    if (dv !== Number(d[len])) return false;
  }
  return true;
}

function cnpjOk(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const len of [12, 13]) {
    const w = weights.slice(weights.length - len);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * w[i];
    const rest = sum % 11;
    const dv = rest < 2 ? 0 : 11 - rest;
    if (dv !== Number(d[len])) return false;
  }
  return true;
}

/** CPF (11 dígitos) ou CNPJ (14 dígitos), com os dígitos verificadores certos. */
export function isValidCpfCnpj(value: unknown): boolean {
  const d = onlyDigits(value);
  return d.length === 11 ? cpfOk(d) : d.length === 14 ? cnpjOk(d) : false;
}

/** Valor com o cupom de desconto aplicado (porcentagem inteira de 0 a 100). */
export function discountedCents(baseCents: number, percent?: number | null): number {
  const p = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return Math.round((baseCents * (100 - p)) / 100);
}

/** Reais do Asaas (55 ou 55.5) para centavos. */
export function centsFromReais(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : -1;
}

// ─── Prazo do link de pagamento (InfinitePay) ────────────────────────────────

/** O link de pagamento vale 30 minutos a partir de quando é gerado. */
export const PIX_LINK_TTL_MS = 30 * 60_000;

/** Um link aberto só é reaproveitado se ainda faltar pelo menos isso: dá tempo de pagar com calma. */
export const PIX_REUSE_MARGIN_MS = 10 * 60_000;

/** Depois de vencido ou trocado, o pedido ainda é conferido na InfinitePay por este tempo.
 *  Pega o PIX pago no último segundo quando o aviso automático se perde. */
export const PIX_LATE_CHECK_MS = 2 * 3600_000;

/** Quando o link gerado agora deixa de valer. O prazo é contado em minutos, então não depende do fuso:
 *  23:50 de Brasília vira 00:20 do dia seguinte. */
export function pixLinkExpiresAt(now: Date): Date {
  return new Date(now.getTime() + PIX_LINK_TTL_MS);
}

type OpenLink = { plan: string; amount_cents: number; checkout_url: string | null; expires_at: string };

/** Link aberto (mesmo plano e valor) que ainda pode ser mostrado em vez de gerar outro.
 *  Links do prazo antigo (até o fim do dia seguinte) não entram: todo link mostrado vale no máximo 30 min. */
export function reusableLink<T extends OpenLink>(open: T[], plan: string, amountCents: number, nowMs: number): T | undefined {
  return open.find((r) => {
    const left = Date.parse(r.expires_at) - nowMs;
    return r.plan === plan && r.amount_cents === amountCents && !!r.checkout_url &&
      left > PIX_REUSE_MARGIN_MS && left <= PIX_LINK_TTL_MS;
  });
}

type CheckableRow = { status: string; expires_at: string; checked_at: string | null; order_nsu: string | null };

/** Quando a consulta de status precisa perguntar à InfinitePay.
 *  `check`: pergunta agora. `expire`: se ela não disser que foi pago, o pedido passa a vencido. */
export function statusCheckPlan(row: CheckableRow, nowMs: number, recheckMs: number): { check: boolean; expire: boolean } {
  if (!row.order_nsu) return { check: false, expire: false };
  const expiresMs = Date.parse(row.expires_at);
  const stale = !row.checked_at || nowMs - Date.parse(row.checked_at) > recheckMs;
  if (row.status === 'pending') {
    const expire = expiresMs <= nowMs;
    return { check: expire || stale, expire };
  }
  // Já fechado (vencido ou trocado por outro), mas pago no limite: ainda confere por um tempo.
  if (row.status === 'expired' || row.status === 'canceled') {
    return { check: stale && nowMs - expiresMs < PIX_LATE_CHECK_MS, expire: false };
  }
  return { check: false, expire: false };
}

export type AsaasPaymentKind = 'paid' | 'pending' | 'overdue' | 'deleted' | 'refunded' | 'other';

/** Situação da cobrança no Asaas, do jeito que o VS Stage precisa. */
export function asaasPaymentKind(p: { status?: string | null; deleted?: boolean | null }): AsaasPaymentKind {
  if (p.deleted) return 'deleted';
  switch (p.status) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'paid';
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
      return 'pending';
    case 'OVERDUE':
      return 'overdue';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'refunded';
    default:
      return 'other';
  }
}

/** Compara o token do aviso sem vazar, pelo tempo de resposta, quantas letras acertou. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
