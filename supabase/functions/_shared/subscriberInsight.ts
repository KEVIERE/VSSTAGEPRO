// Quem conta como assinante no painel do admin (função admin-insights) e de onde vem o
// acesso. Contas puras, sem rede (testadas em tests/infinitepay-admin.test.mjs, npm test).
//
// Hoje o acesso pago vem de um pagamento único pela InfinitePay (PIX ou cartão), gravado em
// director_licenses.pix_paid_until, ou de tempo manual dado pelo admin no mesmo campo.
// Nenhum dos dois renova sozinho. 'legacy' é a assinatura antiga com renovação automática no
// cartão (subscription = 'active' com id de assinatura antiga), que não é mais vendida.
import { brl } from './affiliate.ts';
import { normalizeCaptureMethod, type CaptureMethod } from './infinitepay.ts';

export type PaymentSource = 'infinitepay' | 'manual' | 'promo' | 'partner' | 'legacy';

export type InsightLicense = {
  subscription?: string | null;
  plan?: string | null;
  current_period_end?: string | null;
  comp_until?: string | null;
  pix_paid_until?: string | null;
  /** 'infinitepay' ou 'manual': quem deu o último tempo em pix_paid_until. */
  pix_paid_source?: string | null;
  partner?: boolean | null;
  blocked?: boolean | null;
  stripe_subscription_id?: string | null;
};

/** Último pagamento confirmado da conta (pix_payments com status 'paid'). */
export type InsightPayment = {
  plan?: string | null;
  amount_cents?: number | null;
  paid_amount_cents?: number | null;
  capture_method?: string | null;
  installments?: number | null;
  receipt_url?: string | null;
};

export type SubscriberAccess = {
  paymentSource: PaymentSource;
  /** Nome antigo do mesmo dado, mantido para a tela que ainda lê paymentProvider. */
  paymentProvider: 'infinitepay' | 'legacy' | 'manual' | null;
  plan: 'monthly' | 'yearly' | 'manual' | 'promo' | 'partner' | 'legacy';
  priceFormatted: string;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  renewalText: string;
  paymentMethod: CaptureMethod | null;
  installments: number | null;
  receiptUrl: string | null;
};

const DAY_MS = 86_400_000;
const TZ = 'America/Sao_Paulo';

const future = (iso: string | null | undefined, now: Date): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) && d.getTime() > now.getTime() ? d : null;
};
const daysLeft = (end: Date, now: Date) => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
const diasTexto = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** dd/mm no horário de Brasília. */
export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(d);
}

const planOf = (p: string | null | undefined): 'monthly' | 'yearly' | null =>
  p === 'monthly' || p === 'yearly' ? p : null;

const LIST_PRICE = { monthly: 'R$ 55,00/mês', yearly: 'R$ 349,00/ano' } as const;

/**
 * O acesso pago (ou de cortesia) que a conta tem agora, ou null se ela não é assinante.
 * Conta bloqueada nunca entra.
 */
export function subscriberAccess(
  l: InsightLicense | null | undefined, last: InsightPayment | null | undefined, now: Date,
): SubscriberAccess | null {
  if (!l || l.blocked) return null;
  const comp = future(l.comp_until, now);
  const base = { paymentMethod: null, installments: null, receiptUrl: null };

  if (l.partner && comp) {
    return {
      ...base, paymentSource: 'partner', paymentProvider: null, plan: 'partner',
      priceFormatted: 'Parceiro (sem cobrança)', currentPeriodEnd: null, daysRemaining: null,
      renewalText: 'Parceiro: acesso sem prazo',
    };
  }

  if (l.subscription === 'active') {
    const plan = planOf(l.plan);
    if (l.stripe_subscription_id) {
      const end = l.current_period_end ? new Date(l.current_period_end) : null;
      const valid = end && Number.isFinite(end.getTime()) ? end : null;
      const ahead = valid && valid.getTime() > now.getTime();
      return {
        ...base, paymentSource: 'legacy', paymentProvider: 'legacy', plan: plan ?? 'legacy',
        priceFormatted: plan ? LIST_PRICE[plan] : 'Assinatura antiga',
        currentPeriodEnd: valid ? valid.toISOString() : null,
        daysRemaining: ahead ? daysLeft(valid!, now) : null,
        renewalText: ahead
          ? `Assinatura antiga: renova em ${diasTexto(daysLeft(valid!, now))} (${shortDate(valid!)})`
          : valid
          ? `Assinatura antiga: período venceu em ${shortDate(valid)}, conferir`
          : 'Assinatura antiga sem data de renovação',
      };
    }
    return {
      ...base, paymentSource: 'manual', paymentProvider: 'manual', plan: plan ?? 'manual',
      priceFormatted: 'Manual', currentPeriodEnd: null, daysRemaining: null,
      renewalText: 'Assinatura manual sem prazo',
    };
  }

  const paidUntil = future(l.pix_paid_until, now);
  if (paidUntil) {
    const manual = l.pix_paid_source === 'manual' || (!l.pix_paid_source && !last);
    const plan = planOf(l.plan) ?? planOf(last?.plan) ?? 'monthly';
    const days = daysLeft(paidUntil, now);
    const cents = last ? Number(last.paid_amount_cents ?? last.amount_cents) : NaN;
    return {
      paymentSource: manual ? 'manual' : 'infinitepay',
      paymentProvider: manual ? 'manual' : 'infinitepay',
      plan,
      priceFormatted: manual
        ? 'Manual'
        : Number.isFinite(cents) && cents > 0
        ? `${brl(cents)}${plan === 'yearly' ? '/ano' : '/mês'}`
        : LIST_PRICE[plan],
      currentPeriodEnd: paidUntil.toISOString(),
      daysRemaining: days,
      renewalText: `Vence em ${diasTexto(days)} (${shortDate(paidUntil)}), não renova sozinho`,
      paymentMethod: manual ? null : normalizeCaptureMethod(last?.capture_method),
      installments: manual ? null : (last?.installments ?? null),
      receiptUrl: manual ? null : (last?.receipt_url ?? null),
    };
  }

  if (comp) {
    const days = daysLeft(comp, now);
    return {
      ...base, paymentSource: 'promo', paymentProvider: null, plan: 'promo',
      priceFormatted: 'Bônus', currentPeriodEnd: comp.toISOString(), daysRemaining: days,
      renewalText: `Bônus válido por mais ${diasTexto(days)}`,
    };
  }

  return null;
}

/** Último pagamento confirmado de cada conta, a partir de uma lista já em ordem do mais novo. */
export function latestPaymentByUser<T extends { user_id: string }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.user_id)) m.set(r.user_id, r);
  return m;
}
