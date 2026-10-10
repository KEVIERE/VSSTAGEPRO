import { supabase } from '@/lib/supabaseClient';

export type UserState = 'trial' | 'expired' | 'active' | 'promo' | 'blocked';

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
  // Checkout aberto no Stripe: demonstrou interesse, pode não ter concluído o pagamento.
  recent_intentions: Array<{ created_at: string; plan: 'monthly' | 'yearly'; coupon_code: string | null; email: string; name: string | null }>;
  // Só pagamento de fato confirmado pelo Stripe (webhook checkout.session.completed, payment_status=paid).
  recent_sales: Array<{ created_at: string; plan: 'monthly' | 'yearly'; amount_cents: number; email: string; name: string | null }>;
  recent_cancellations: Array<{ created_at: string; plan: string | null; email: string; name: string | null }>;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
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
  stripe_customer_id: string | null;
  subscribed_at: string | null;
  state: UserState;
  is_admin: boolean;
};

export type PromoCode = {
  code: string;
  kind: 'trial_hours' | 'free_days' | 'discount';
  value: number;
  discount_percent?: number | null;
  stripe_coupon_id?: string | null;
  stripe_promotion_code_id?: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
  redemptions: Array<{ email: string; redeemed_at: string }>;
};

export type FeatureUse = { feature: string; uses: number; users: number };

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

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const adminApi = {
  isAdmin: () => call<boolean>('is_admin'),
  overview: (days: number) => call<Overview>('admin_overview', { p_days: days }),
  users: (search: string, state: string, limit: number, offset: number) =>
    call<{ total: number; rows: AdminUser[] }>('admin_users', { p_search: search, p_state: state, p_limit: limit, p_offset: offset }),
  extendTrial: (user: string, hours: number) => call<void>('admin_extend_trial', { p_user: user, p_hours: hours }),
  setComp: (user: string, days: number) => call<void>('admin_set_comp', { p_user: user, p_days: days }),
  setSubscription: (user: string, subscription: 'active' | 'canceled' | 'trial', plan: 'monthly' | 'yearly' | null = null) =>
    call<void>('admin_set_subscription', { p_user: user, p_subscription: subscription, p_plan: plan }),
  block: (user: string, blocked: boolean, reason?: string) =>
    call<void>('admin_block', { p_user: user, p_blocked: blocked, p_reason: reason ?? null }),
  deleteUser: (user: string) => call<void>('admin_delete_user', { p_user: user }),
  promoList: () => call<PromoCode[]>('admin_promo_list'),
  promoCreate: (p: {
    code: string; kind: PromoCode['kind']; value: number; maxUses: number | null; expiresAt: string | null; note: string;
    discountPercent?: number | null; stripeCouponId?: string | null; stripePromotionCodeId?: string | null;
  }) =>
    call<void>('admin_promo_create', {
      p_code: p.code, p_kind: p.kind, p_value: p.value, p_max_uses: p.maxUses, p_expires_at: p.expiresAt, p_note: p.note,
      p_discount_percent: p.discountPercent ?? null, p_stripe_coupon_id: p.stripeCouponId ?? null, p_stripe_promotion_code_id: p.stripePromotionCodeId ?? null,
    }),
  // Cria o cupom % no Stripe (coupon + promotion code com o mesmo texto que o cliente digita)
  // e devolve os IDs para gravar junto do registro local em promo_codes.
  createStripeCoupon: (code: string, percent: number, maxUses: number | null, expiresAt: string | null) =>
    callCouponsFn<{ ok: true; stripeCouponId: string; stripePromotionCodeId: string }>({
      action: 'create', code, percent, maxUses, expiresAt,
    }),
  deactivateStripeCoupon: (stripePromotionCodeId: string) =>
    callCouponsFn({ action: 'deactivate', stripePromotionCodeId }),
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
};

async function callReleasesFn<T = { ok: true }>(payload: Record<string, unknown>): Promise<T> {
  return callEdgeFn('admin-releases', payload);
}

async function callCouponsFn<T = { ok: true }>(payload: Record<string, unknown>): Promise<T> {
  return callEdgeFn('admin-coupons', payload);
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
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
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
