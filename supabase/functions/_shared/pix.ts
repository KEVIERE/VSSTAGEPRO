// Regras do PIX (Asaas) sem dependências externas.
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

/** O PIX vence no fim do dia seguinte, no horário de Brasília (o Brasil não tem mais horário de verão).
 *  Depois disso a cobrança é apagada no Asaas para o QR Code não poder mais ser pago. */
export function pixDueDate(now: Date): { dueDate: string; expiresAt: Date } {
  const brasilia = new Date(now.getTime() - 3 * 3600_000);
  brasilia.setUTCDate(brasilia.getUTCDate() + 1);
  const dueDate = brasilia.toISOString().slice(0, 10);
  return { dueDate, expiresAt: new Date(`${dueDate}T23:59:59-03:00`) };
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
