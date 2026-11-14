let _lastPingTime = 0;
import { supabase } from '@/lib/supabaseClient';

export type UserState = 'trial' | 'expired' | 'active' | 'promo' | 'blocked';

/** Forma de pagamento que a InfinitePay confirmou (capture_method do payment_check). */
export type PaymentMethod = 'pix' | 'credit_card';

/**
 * De onde vem o acesso pago da conta. 'legacy' é a assinatura antiga com renovação
 * automática no cartão, que não é mais vendida.
 */
export type PaymentSource = 'infinitepay' | 'manual' | 'promo' | 'partner' | 'legacy';

export type Overview = {
  total_users: number;
  trial: number;
  expired: number;
  active: number;
  monthly: number;
  yearly: number;
  manual: number;
  promo: number;
  blocked: number;
  mrr_cents: number;
  signups_period: number;
  subs_period: number;
  cancels_period: number;
  revenue_period_cents: number;
  active_users_period: number;
  days: number;
  series: Array<{ day: string; signups: number; subs: number; active_users: number }>;
  // Link de pagamento aberto na InfinitePay: mostrou interesse, pode não ter pago.
  recent_intentions: Array<{ created_at: string; plan: 'monthly' | 'yearly'; coupon_code: string | null; email: string; name: string | null }>;
  // Só pagamento confirmado pela InfinitePay (webhook mais payment_check), ou venda antiga.
  // provider e method chegam junto com a migração nova; vendas antigas podem vir sem eles.
  recent_sales: Array<{
    created_at: string; plan: 'monthly' | 'yearly'; amount_cents: number; email: string; name: string | null;
    provider?: string | null; method?: PaymentMethod | null;
  }>;
  recent_cancellations: Array<{ created_at: string; plan: string | null; email: string; name: string | null }>;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  /** Telefone do cadastro (formato +55DDDNÚMERO). Vem do admin_users e é o que o WhatsApp usa. */
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  last_seen_at: string | null;
  uses_30d: number;
  trial_started_at: string | null;
  trial_hours: number | null;
  trial_ends_at: string | null;
  subscription: string | null;
  plan: 'monthly' | 'yearly' | null;
  current_period_end: string | null;
  comp_until: string | null;
  blocked: boolean | null;
  blocked_reason: string | null;
  /** Até quando o último pagamento (InfinitePay ou manual) libera o acesso. */
  pix_paid_until?: string | null;
  partner?: boolean | null;
  payment_source?: PaymentSource | null;
  last_payment_method?: PaymentMethod | null;
  last_receipt_url?: string | null;
  subscribed_at: string | null;
  state: UserState;
  is_admin: boolean;
};

export type PromoCode = {
  code: string;
  kind: 'trial_hours' | 'free_days' | 'discount';
  value: number;
  discount_percent?: number | null;
  /** Cupom de afiliado (só no primeiro pagamento): é ajustado pela aba Afiliados. */
  affiliate_id?: string | null;
  first_payment_only?: boolean;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
  /** Bônus: quem resgatou. Cupom de desconto: pagamentos confirmados com o cupom (amount_cents = valor pago). */
  redemptions: Array<{ email: string | null; redeemed_at: string; amount_cents?: number | null }>;
};

/** Um pagamento da conta pela InfinitePay (admin_user_payments). */
export type UserPayment = {
  id: string;
  plan: 'monthly' | 'yearly';
  amount_cents: number;
  paid_amount_cents: number | null;
  status: 'pending' | 'paid' | 'expired' | 'canceled' | 'amount_mismatch' | 'refunded' | string;
  capture_method: PaymentMethod | null;
  installments: number | null;
  coupon_code: string | null;
  paid_at: string | null;
  access_until: string | null;
  receipt_url?: string | null;
};

export type FeatureUse = { feature: string; uses: number; users: number };
export type SubscriberInsight = {
  userId: string;
  email: string;
  name: string | null;
  phone: string | null;
  plan: 'monthly' | 'yearly' | 'manual' | 'promo' | 'partner' | 'legacy';
  priceFormatted: string;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  renewalText: string;
  subscribedAt: string;
  emailConfirmedAt: string | null;
  lastIp: string | null;
  lastAppVersion: string;
  lastSeenAt: string | null;
  /** Origem do acesso. paymentProvider é o nome antigo do mesmo dado. */
  paymentSource?: PaymentSource | null;
  paymentProvider?: 'infinitepay' | 'legacy' | 'manual' | null;
  paymentMethod?: PaymentMethod | null;
  installments?: number | null;
  receiptUrl?: string | null;
};

export type TrialInsight = {
  userId: string;
  email: string;
  name: string | null;
  phone: string | null;
  trialStartedAt: string;
  trialEndsAt: string;
  emailConfirmedAt: string | null;
  hoursRemaining: number;
  timeLeftText: string;
  percentUsed: number;
  lastIp: string | null;
  lastAppVersion: string;
  lastSeenAt: string | null;
  totalHours: number;
};

export type SuspiciousInsight = {
  userId: string;
  email: string;
  name: string | null;
  phone: string | null;
  reason: string;
  riskLevel: 'alto' | 'medio';
  createdAt: string;
  emailConfirmedAt: string | null;
  lastIp: string | null;
  blocked: boolean;
};

export type InsightsData = {
  subscribers: SubscriberInsight[];
  trials: TrialInsight[];
  suspicious: SuspiciousInsight[];
  stats: {
    totalUsers: number;
    subscribersCount: number;
    trialsCount: number;
    suspiciousCount: number;
  };
};


export type AuditEntry = {
  created_at: string;
  action: string;
  details: Record<string, unknown> | null;
  admin_email: string | null;
  target_email: string | null;
};

export type AppReleaseBuild = { arch: 'arm64' | 'x64'; label: string; file: string; size: number; sha256: string; parts: string[] };

export type AppRelease = {
  version: string;
  build: number;
  manifest: { version: string; build: number; published: string; required?: boolean; builds: AppReleaseBuild[] };
  published_at: string;
  published_by_email: string | null;
};

export type ServiceHealthEntry = {
  service: string;
  status: 'up' | 'down' | 'degraded';
  latency_ms: number;
  detail: string;
  checked_at: string;
};

export type TamperAlert = {
  id: string;
  hw_id: string;
  ip: string | null;
  app_version: string;
  asar_sha: string | null;
  has_session: boolean;
  tampered: boolean;
  reason: string;
  is_blacklisted: boolean;
  created_at: string;
};

export type FunnelData = {
  days: number;
  signups: number;
  confirmed: number;
  app_opened: number;
  stage_used: number;
  subscribed: number;
};

export type TimelineEvent = {
  event_type: 'admin_action' | 'sale' | 'cancel' | 'tamper' | 'service_down';
  title: string;
  subtitle: string;
  detail: string | null;
  severity: 'positive' | 'negative' | 'warning' | 'critical' | 'neutral';
  created_at: string;
};

// ─── Aba Acessos ─────────────────────────────────────────────────────────────

export type AccessStats = {
  days: number;
  program: {
    online_now: number;
    online_logged: number;
    users_today: number;
    users_7d: number;
    users_30d: number;
    users_period: number;
    opens_today: number;
    opens_7d: number;
    opens_30d: number;
    series: Array<{ day: string; users: number; opens: number }>;
    hours: Array<{ hour: number; users: number }>;
    weekdays: Array<{ dow: number; users: number }>;
    versions: Array<{ version: string; macs: number }>;
    archs: Array<{ arch: string; macs: number }>;
    top_users: Array<{ email: string; days_active: number; opens: number; last_at: string }>;
  };
  site: {
    since: string | null;
    visitors_today: number;
    visitors_7d: number;
    visitors_30d: number;
    visitors_period: number;
    views_today: number;
    views_7d: number;
    views_30d: number;
    signups_period: number;
    series: Array<{ day: string; visitors: number; views: number }>;
    pages: Array<{ page: string; visitors: number; views: number }>;
    referrers: Array<{ referrer: string; visitors: number }>;
    devices: Array<{ device: string; visitors: number }>;
  };
};

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// ─── Tipos da Comunicação ────────────────────────────────────────────────────

export type DirectRecipientRow = {
  address: string;
  status: 'sent' | 'failed';
  error?: string | null;
  providerId?: string | null;
};

export type DirectSendResult = {
  ok: true;
  id: string | null;
  total: number;
  sent: number;
  failed: number;
  results: DirectRecipientRow[];
};

export type DirectEmailRecord = {
  id: string;
  from_address: string | null;
  subject: string;
  body: string;
  reply_to: string | null;
  total: number;
  sent: number;
  failed: number;
  recipients: DirectRecipientRow[];
  created_at: string;
  sent_by_email: string | null;
};

export type OutreachChannel = 'email' | 'whatsapp';

export type OutreachPerson = { user_id: string; address: string; name: string | null; state: UserState };

export type OutreachAudience = {
  channel: OutreachChannel;
  eligible: number;
  sem_contato: number;
  email_invalido: number;
  descadastrado: number;
  by_state: Partial<Record<UserState, number>>;
  sample: OutreachPerson[];
};

export type OutreachCampaign = {
  id: string;
  channel: OutreachChannel;
  title: string | null;
  subject: string | null;
  status: 'draft' | 'running' | 'paused' | 'done' | 'canceled';
  total: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  created_by_email: string | null;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  /** A execução morreu sem soltar o lease: o histórico mostra "interrompida". */
  stalled: boolean;
};

export type OutreachRecipientRow = {
  id: number;
  address: string;
  name: string | null;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  provider_id: string | null;
  error: string | null;
  attempts: number;
  sent_at: string | null;
};

export type OutreachDetail = {
  campaign: OutreachCampaign & { body: string; variables: string[]; content_sid: string | null; reply_to: string | null };
  counts: { sent: number; failed: number; skipped: number; pending: number };
  recipients: OutreachRecipientRow[];
};

export type OutreachTemplate = {
  id: string;
  name: string;
  channel: OutreachChannel;
  subject: string | null;
  body: string;
  variables: string[];
  twilio_content_sid: string | null;
  approval_status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused' | 'unknown';
  approval_category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION' | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type OutreachChannelState = {
  last_sent_at: string | null;
  sender_sid: string | null;
  sender_status: string | null;
  sender_display_name: string | null;
  sender_checked_at: string | null;
};

export type OutreachSenderInfo = {
  ok: true;
  phone: string | null;
  online: boolean;
  sender: {
    sid: string | null;
    status: string | null;
    displayName: string | null;
    displayNameStatus: string | null;
    pendingDisplayName: string | null;
    offlineReasons: string[];
  } | null;
};

export type OutreachRunResult = {
  ok?: boolean;
  paused?: boolean;
  done?: boolean;
  canceled?: boolean;
  sent?: number;
  failed?: number;
  left?: number;
  eta?: string | null;
  runToken?: string;
  error?: string;
};

/** Estado da mensagem pronta de WhatsApp, em português, para a tela. */
export const APPROVAL_LABEL: Record<OutreachTemplate['approval_status'], string> = {
  draft: 'Não enviada ao WhatsApp',
  pending: 'Em análise pelo WhatsApp',
  approved: 'Aprovada',
  rejected: 'Recusada',
  paused: 'Pausada',
  unknown: 'Estado desconhecido',
};

export const APPROVAL_CLS: Record<OutreachTemplate['approval_status'], string> = {
  draft: 'bg-logic-text-muted/15 text-logic-text-muted',
  pending: 'bg-logic-lcd-amber/15 text-logic-lcd-amber',
  approved: 'bg-logic-lcd-green/15 text-logic-lcd-green',
  rejected: 'bg-logic-lcd-red/15 text-logic-lcd-red',
  paused: 'bg-logic-lcd-amber/15 text-logic-lcd-amber',
  unknown: 'bg-logic-text-muted/15 text-logic-text-muted',
};

export const CAMPAIGN_LABEL: Record<OutreachCampaign['status'], string> = {
  draft: 'Rascunho',
  running: 'Enviando',
  paused: 'Pausada',
  done: 'Concluída',
  canceled: 'Cancelada',
};

// ─── Afiliados ───────────────────────────────────────────────────────────────

export type AdminAffiliate = {
  user_id: string;
  code: string;
  status: 'active' | 'paused' | 'ended';
  commission_percent: number;
  discount_percent: number;
  note: string | null;
  created_at: string;
  pix_key_type: string | null;
  pix_key: string | null;
  payout_name: string | null;
  email: string;
  name: string | null;
  signups: number;
  paying: number;
  revenue_cents: number;
  to_pay_cents: number;
  pending_cents: number;
  paid_cents: number;
};

export type AdminPayoutRequest = {
  id: string;
  affiliate_id: string;
  amount_cents: number;
  requested_at: string;
  pix_key_type: string;
  pix_key: string;
  payout_name: string;
  code: string;
  email: string;
  name: string | null;
};

export type AdminAffiliateDetail = {
  customers: Array<{ user_id: string; email: string; name: string | null; source: 'link' | 'coupon'; created_at: string; state: UserState }>;
  commissions: Array<{
    id: string; created_at: string; plan: string | null; base_cents: number; percent: number; commission_cents: number;
    status: 'pending' | 'available' | 'reserved' | 'paid' | 'canceled'; available_at: string; payout_id: string | null;
    cancel_reason: string | null; customer_email: string | null;
  }>;
  payouts: Array<{
    id: string; amount_cents: number; status: 'requested' | 'paid' | 'rejected'; requested_at: string; paid_at: string | null;
    reference: string | null; reject_reason: string | null; pix_key_type: string; pix_key: string; payout_name: string;
  }>;
};

export const adminApi = {
  isAdmin: () => call<boolean>('is_admin'),
  affiliates: () => call<AdminAffiliate[]>('admin_affiliates'),
  affiliateCreate: (email: string, code: string, commission: number, discount: number, note: string) =>
    call<{ user_id: string; code: string }>('admin_affiliate_create', {
      p_email: email, p_code: code, p_commission: commission, p_discount: discount, p_note: note || null,
    }),
  affiliateUpdate: (user: string, p: { commission?: number; discount?: number; status?: AdminAffiliate['status']; note?: string }) =>
    call<void>('admin_affiliate_update', {
      p_user: user, p_commission: p.commission ?? null, p_discount: p.discount ?? null,
      p_status: p.status ?? null, p_note: p.note ?? null,
    }),
  affiliateDetail: (user: string) => call<AdminAffiliateDetail>('admin_affiliate_detail', { p_user: user }),
  affiliatePayoutsOpen: () => call<AdminPayoutRequest[]>('admin_affiliate_payouts_open'),
  affiliatePayoutPaid: (id: string, reference: string, note?: string) =>
    call<void>('admin_affiliate_payout_mark_paid', { p_id: id, p_reference: reference, p_note: note ?? null }),
  affiliatePayoutReject: (id: string, reason: string) =>
    call<void>('admin_affiliate_payout_reject', { p_id: id, p_reason: reason }),
  affiliateCommissionCancel: (id: string, reason: string) =>
    call<void>('admin_affiliate_commission_cancel', { p_id: id, p_motivo: reason }),
  overview: (days: number) => call<Overview>('admin_overview', { p_days: days }),
  accessStats: (days: number) => call<AccessStats>('admin_access_stats', { p_days: days }),
  users: (search: string, state: string, limit: number, offset: number) =>
    call<{ total: number; rows: AdminUser[] }>('admin_users', { p_search: search, p_state: state, p_limit: limit, p_offset: offset }),
  extendTrial: (user: string, hours: number) => call<void>('admin_extend_trial', { p_user: user, p_hours: hours }),
  setComp: (user: string, days: number) => call<void>('admin_set_comp', { p_user: user, p_days: days }),
  // Parceiro / Endorse: acesso completo sem cobrança, fora da receita
  setPartner: (user: string, partner: boolean) => call<void>('admin_set_partner', { p_user: user, p_partner: partner }),
  partners: () => call<Array<{ user_id: string; partner_since: string | null }>>('admin_partners'),
  // Assinatura manual: soma 1 mês ou 1 ano ao período pago, igual a um pagamento.
  grantPlan: (user: string, plan: 'monthly' | 'yearly') => call<void>('admin_grant_plan', { p_user: user, p_plan: plan }),
  // Encerra o período pago agora (pix_paid_until = agora).
  revokePlan: (user: string) => call<void>('admin_revoke_plan', { p_user: user }),
  userPayments: (user: string) => call<UserPayment[]>('admin_user_payments', { p_user: user }),
  // Registra um estorno feito no app da InfinitePay: tira o período e cancela a comissão ainda não paga.
  refundPayment: (payment: string, reason: string) =>
    call<{ result?: string } | null>('admin_pix_refund', { p_payment: payment, p_reason: reason }),
  setSubscription: (user: string, subscription: 'active' | 'canceled' | 'trial', plan: 'monthly' | 'yearly' | null = null) =>
    call<void>('admin_set_subscription', { p_user: user, p_subscription: subscription, p_plan: plan }),
  block: (user: string, blocked: boolean, reason?: string) =>
    call<void>('admin_block', { p_user: user, p_blocked: blocked, p_reason: reason ?? null }),
  deleteUser: (user: string) => call<void>('admin_delete_user', { p_user: user }),
  promoList: () => call<PromoCode[]>('admin_promo_list'),
  // Bônus de teste ou de acesso (digitados na tela de entrada do programa).
  promoCreate: (p: {
    code: string; kind: 'trial_hours' | 'free_days'; value: number; maxUses: number | null; expiresAt: string | null; note: string;
  }) =>
    call<void>('admin_promo_create', {
      p_code: p.code, p_kind: p.kind, p_value: p.value, p_max_uses: p.maxUses, p_expires_at: p.expiresAt, p_note: p.note,
      p_discount_percent: null, p_stripe_coupon_id: null, p_stripe_promotion_code_id: null,
    }),
  // Cupom de desconto em %: fica só no nosso banco. O pix-checkout confere o cupom e já
  // gera o link da InfinitePay com o valor descontado, no PIX e no cartão.
  discountCreate: (p: {
    code: string; percent: number; maxUses: number | null; expiresAt: string | null; firstPaymentOnly: boolean; note: string;
  }) =>
    call<void>('admin_discount_create', {
      p_code: p.code, p_percent: p.percent, p_max_uses: p.maxUses, p_expires_at: p.expiresAt,
      p_first_payment_only: p.firstPaymentOnly, p_note: p.note || null,
    }),
  // Dispara o workflow "Upgrade de produção" no GitHub Actions (site + app Mac).
  promoteToProduction: () => callEdgeFn<{ ok: true }>('admin-promote', {}),
  promoSetActive: (code: string, active: boolean) => call<void>('admin_promo_set_active', { p_code: code, p_active: active }),
  promoDelete: (code: string) => call<void>('admin_promo_delete', { p_code: code }),
  featureUsage: (days: number) => call<FeatureUse[]>('admin_feature_usage', { p_days: days }),
  audit: (limit = 150) => call<AuditEntry[]>('admin_audit_list', { p_limit: limit }),
  releases: (limit = 50) => call<AppRelease[]>('admin_releases_list', { p_limit: limit }),
  rollbackRelease: async (version: string, build: number, required: boolean) => {
    await callReleasesFn({ action: 'rollback', version, build, required });
  },
  signUpload: (version: string, build: number, arch: 'arm64' | 'x64', partCount: number) =>
    callReleasesFn<{ ok: true; urls: Array<{ path: string; signedUrl: string; token: string }> }>({
      action: 'sign-upload', version, build, arch, partCount,
    }),
  publishRelease: (version: string, build: number, required: boolean, builds: Array<{ arch: 'arm64' | 'x64'; label: string; file: string; size: number; sha256: string; parts: string[] }>) =>
    callReleasesFn({ action: 'publish', version, build, required, builds }),
  // Insights do painel de administração (Assinantes, Testes e Antifraude)
  insights: () => callEdgeFn<InsightsData>('admin-insights', { action: 'overview' }),
  blockInsightUser: (userId: string, reason: string) =>
    callEdgeFn<{ ok: true }>('admin-insights', { action: 'block', userId, reason }),
  unblockInsightUser: (userId: string) =>
    callEdgeFn<{ ok: true }>('admin-insights', { action: 'unblock', userId }),
  extendInsightTrial: (userId: string, hours: number) =>
    callEdgeFn<{ ok: true; newHours: number }>('admin-insights', { action: 'extend-trial', userId, hours }),
  pingPresence: (version?: string) => {
    const now = Date.now();
    if (now - _lastPingTime < 10 * 60 * 1000) {
      return Promise.resolve({ ok: true });
    }
    _lastPingTime = now;
    return callEdgeFn<{ ok: true; ip?: string }>('admin-insights', { action: 'ping', version });
  },
  // Monitoramento de Serviços, Antifraude & Crack, Funil e Linha do Tempo
  serviceHealth: () => call<ServiceHealthEntry[]>('admin_service_health'),
  runHealthCheck: () => callEdgeFn<{ ok: true; results: Array<{ service: string; status: string; latencyMs: number; detail: string }> }>('health-check', {}),
  tamperAlerts: (limit = 50) => call<TamperAlert[]>('admin_tamper_alerts', { p_limit: limit }),
  blockHardware: (hwId: string, reason: string) => call<void>('admin_block_hardware', { p_hw_id: hwId, p_reason: reason }),
  unblockHardware: (hwId: string) => call<void>('admin_unblock_hardware', { p_hw_id: hwId }),
  funnel: (days = 30) => call<FunnelData>('admin_funnel', { p_days: days }),
  timeline: (limit = 100) => call<TimelineEvent[]>('admin_timeline', { p_limit: limit }),

  // ─── Comunicação (e-mail em massa e WhatsApp) ──────────────────────────────
  outreachAudience: (channel: OutreachChannel, state: string) =>
    call<OutreachAudience>('admin_outreach_audience', { p_channel: channel, p_state: state || null }),
  outreachAudienceList: (channel: OutreachChannel, state: string, limit = 1000) =>
    call<OutreachPerson[]>('admin_outreach_audience_list', { p_channel: channel, p_state: state || null, p_limit: limit }),
  outreachCreate: (p: {
    channel: OutreachChannel; template: string | null; subject?: string | null; body?: string | null;
    contentSid?: string | null; variables?: string[]; title?: string | null; state?: string | null;
    replyTo?: string | null; addresses?: string[] | null; audience?: Record<string, unknown>;
  }) =>
    call<{ id: string; total: number; skipped: Array<{ address: string; reason: string }> }>('admin_outreach_create', {
      p_channel: p.channel, p_template: p.template, p_subject: p.subject ?? null, p_body: p.body ?? null,
      p_content_sid: p.contentSid ?? null, p_variables: p.variables ?? [], p_title: p.title ?? null,
      p_state: p.state ?? null, p_reply_to: p.replyTo ?? null, p_addresses: p.addresses ?? null,
      p_audience: p.audience ?? {},
    }),
  outreachList: (limit = 30) => call<OutreachCampaign[]>('admin_outreach_list', { p_limit: limit }),
  outreachDetail: (campaign: string, onlyFailed = false) =>
    call<OutreachDetail>('admin_outreach_detail', { p_campaign: campaign, p_only_failed: onlyFailed }),
  outreachPause: (campaign: string) => callEdgeFn<{ ok: true }>('outreach-send', { action: 'pause', campaignId: campaign }),
  outreachCancel: (campaign: string) => callEdgeFn<{ ok: true }>('outreach-send', { action: 'cancel', campaignId: campaign }),
  outreachRun: (p: { campaignId: string; runToken?: string | null }) =>
    callEdgeFn<OutreachRunResult>('outreach-send', { action: 'run', ...p }),
  outreachTemplates: (channel?: OutreachChannel) =>
    call<OutreachTemplate[]>('admin_outreach_templates', { p_channel: channel ?? null }),
  outreachTemplateSave: (p: {
    id: string | null; name: string; channel: OutreachChannel; subject: string | null; body: string;
    variables: string[]; approvalCategory: string | null; active: boolean;
  }) =>
    call<string>('admin_outreach_template_save', {
      p_id: p.id, p_name: p.name, p_channel: p.channel, p_subject: p.subject, p_body: p.body,
      p_variables: p.variables, p_approval_category: p.approvalCategory, p_active: p.active,
    }),
  outreachTemplateDelete: (id: string) => call<void>('admin_outreach_template_delete', { p_id: id }),
  outreachTemplateCreate: (templateId: string) =>
    callEdgeFn<{ ok: true; contentSid: string }>('outreach-send', { action: 'template-create', templateId }),
  outreachTemplateApprove: (templateId: string) =>
    callEdgeFn<{ ok: true; status: string }>('outreach-send', { action: 'template-approve', templateId }),
  outreachTemplateStatus: (templateId: string) =>
    callEdgeFn<{ ok: true; status: string; raw: string }>('outreach-send', { action: 'template-status', templateId }),
  outreachChannelState: () => call<Record<string, OutreachChannelState>>('admin_outreach_channel_state'),
  outreachSenderStatus: () => callEdgeFn<OutreachSenderInfo>('outreach-send', { action: 'sender-status' }),
  outreachSenderRegister: (p: { phone: string; displayName: string; wabaId: string; method: 'sms' | 'voice' }) =>
    callEdgeFn<{ ok: true; sid: string; status: string }>('outreach-send', { action: 'sender-register', ...p }),
  outreachSenderVerify: (p: { sid: string; code: string }) =>
    callEdgeFn<OutreachSenderInfo>('outreach-send', { action: 'sender-verify', ...p }),
  outreachDirectSend: (p: {
    to: string[]; subject: string; body: string; replyTo?: string | null;
    fromName?: string | null; fromLocal?: string | null;
  }) =>
    callEdgeFn<DirectSendResult>('outreach-send', { action: 'direct-send', ...p }),
  outreachDirectList: (limit = 30) => call<DirectEmailRecord[]>('admin_direct_email_list', { p_limit: limit }),
  outreachOptouts: (channel?: OutreachChannel) =>
    call<Array<{ channel: OutreachChannel; address: string; reason: string | null; created_at: string }>>('admin_outreach_optout_list', { p_channel: channel ?? null }),
  outreachOptoutRemove: (channel: OutreachChannel, address: string) =>
    call<void>('admin_outreach_optout_remove', { p_channel: channel, p_address: address }),
};

async function callReleasesFn<T = { ok: true }>(payload: Record<string, unknown>): Promise<T> {
  return callEdgeFn('admin-releases', payload);
}

async function callEdgeFn<T>(fnName: string, payload: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const url = `${(import.meta.env.VITE_SUPABASE_URL as string)}/functions/v1/${fnName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? 'request_failed');
  return body as T;
}

// ─── Formatação ──────────────────────────────────────────────────────────────

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents: number) => brl.format((cents ?? 0) / 100);
export const num = (n: number) => new Intl.NumberFormat('pt-BR').format(n ?? 0);

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} às ${timeStr}`;
}

export function relative(iso: string | null | undefined) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 86400e3), 'day');
}

export const STATE_LABEL: Record<UserState, string> = {
  trial: 'Em teste',
  expired: 'Teste encerrado',
  active: 'Assinante',
  promo: 'Bônus',
  blocked: 'Suspenso',
};

export const STATE_CLS: Record<UserState, string> = {
  trial: 'bg-logic-accent/15 text-logic-accent-hover',
  expired: 'bg-logic-lcd-amber/15 text-logic-lcd-amber',
  active: 'bg-logic-lcd-green/15 text-logic-lcd-green',
  promo: 'bg-logic-lcd-yellow/15 text-logic-lcd-yellow',
  blocked: 'bg-logic-lcd-red/15 text-logic-lcd-red',
};

export const FEATURE_LABELS: Record<string, string> = {
  app_open: 'Abriu o programa',
  play: 'Tocar (play)',
  show_mode: 'Modo Show',
  mixer: 'Mixer',
  bpm_tower: 'Torre de BPM',
  tuner: 'Afinador',
  lr_master: 'LR Master',
  import: 'Importar músicas',
  export_audio: 'Exportar áudio',
  save_project: 'Salvar projeto',
  open_project: 'Abrir projeto',
  show_manager: 'Gerenciar shows',
  teleprompter: 'Teleprompter',
  local_network: 'Rede local',
  broadcast: 'Transmitir ao vivo',
};

export const PROMO_KIND_LABEL: Record<PromoCode['kind'], string> = {
  trial_hours: 'Horas extras de teste',
  free_days: 'Dias de acesso completo',
  discount: 'Desconto na assinatura (%)',
};

export function promoValueText(kind: PromoCode['kind'], value: number) {
  if (kind === 'discount') return `${value}% de desconto`;
  if (kind === 'free_days') return `${value} ${value === 1 ? 'dia' : 'dias'} grátis`;
  return value % 24 === 0 ? `+${value / 24} ${value === 24 ? 'dia' : 'dias'} de teste` : `+${value}h de teste`;
}

/** "PIX", "Cartão" ou "Cartão em 3x". */
export function paymentMethodLabel(method: PaymentMethod | null | undefined, installments?: number | null): string | null {
  if (method === 'pix') return 'PIX';
  if (method === 'credit_card') return installments && installments > 1 ? `Cartão em ${installments}x` : 'Cartão';
  return null;
}

/** Origem do acesso pago, para o selo do admin. Sem dado, devolve null. */
export function paymentSourceLabel(
  source: PaymentSource | null | undefined, method?: PaymentMethod | null, installments?: number | null,
): string | null {
  switch (source) {
    case 'infinitepay': {
      if (method === 'pix') return 'InfinitePay PIX';
      if (method === 'credit_card') return installments && installments > 1 ? `InfinitePay cartão em ${installments}x` : 'InfinitePay cartão';
      return 'InfinitePay';
    }
    case 'manual': return 'Manual';
    case 'promo': return 'Bônus';
    case 'partner': return 'Parceiro';
    case 'legacy': return 'Assinatura antiga';
    default: return null;
  }
}

export const SUB_PLAN_LABEL: Record<SubscriberInsight['plan'], string> = {
  monthly: 'Plano Mensal',
  yearly: 'Plano Anual',
  manual: 'Manual',
  promo: 'Bônus',
  partner: 'Parceiro',
  legacy: 'Assinatura antiga',
};

/** Origem do assinante: o campo novo, ou o deduzido do nome antigo e do plano. */
export function subscriberSource(sub: SubscriberInsight): PaymentSource | null {
  if (sub.paymentSource) return sub.paymentSource;
  if (sub.paymentProvider) return sub.paymentProvider;
  if (sub.plan === 'manual' || sub.plan === 'promo' || sub.plan === 'partner' || sub.plan === 'legacy') return sub.plan;
  return null;
}
