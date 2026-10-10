import { useEffect, useState } from 'react';
import { Check, CreditCard, ExternalLink, Loader2, Tag, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/friendlyError';
import VsLogo from '@/components/VsLogo';
import { refreshLicense } from '@/lib/licenseEvents';

export type Plan = 'monthly' | 'yearly';


const PLANS: Array<{ id: Plan; title: string; price: string; period: string; note: string; badge?: string }> = [
  { id: 'monthly', title: 'Mensal', price: 'R$ 55,00', period: '/mês', note: 'Cobrança recorrente todo mês. Cancele quando quiser.' },
  { id: 'yearly', title: 'Anual', price: 'R$ 599,00', period: '/ano', note: 'Pagamento único por ano — sai por R$ 49,92/mês.', badge: 'ECONOMIZE R$ 61' },
];

const FEATURES = [
  'Editor de multitracks e mixer com Timecode LTC',
  'Modo Show, teleprompter e área do músico',
  'Sem limite de shows e músicas',
];

async function checkDiscount(code: string): Promise<{ valid: boolean; percent?: number }> {
  const { data, error } = await supabase.rpc('discount_check', { p_code: code });
  if (error) throw new Error(error.message);
  return data as { valid: boolean; percent?: number };
}

async function startCheckout(plan: Plan, couponCode?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { plan, couponCode } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'checkout_failed');
  }
  if (!data?.url) throw new Error('checkout_failed');
  return data.url as string;
}

const ERRORS: Record<string, string> = {
  already_active: 'Sua assinatura já está ativa.',
  checkout_failed: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.',
  invalid_coupon: 'Esse cupom não é mais válido.',
};

export default function SubscribeDialog({
  onClose, embedded = false, label = 'ASSINATURA', title = 'Assine o VS Stage Pro',
  subtitle = 'Escolha o plano e continue usando sem limite.', footer,
}: {
  onClose?: () => void;
  embedded?: boolean;
  label?: React.ReactNode;
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
}) {
  const [plan, setPlan] = useState<Plan>('yearly');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [couponChecking, setCouponChecking] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; percent: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  const applyCoupon = async () => {
    const code = coupon.trim().toUpperCase();
    if (!code) return;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const res = await checkDiscount(code);
      if (!res.valid || !res.percent) { setCouponError('Código inválido ou expirado.'); setAppliedCoupon(null); return; }
      setAppliedCoupon({ code, percent: res.percent });
    } catch {
      setCouponError('Não foi possível validar agora. Tente de novo.');
      setAppliedCoupon(null);
    } finally {
      setCouponChecking(false);
    }
  };

  // Enquanto o pagamento está aberto no navegador, confere a licença de tempos em tempos.
  useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(refreshLicense, 5000);
    const stop = window.setTimeout(() => window.clearInterval(t), 20 * 60 * 1000);
    return () => { window.clearInterval(t); window.clearTimeout(stop); };
  }, [waiting]);

  const subscribe = async () => {
    setBusy(true);
    setError(null);
    try {
      const url = await startCheckout(plan, appliedCoupon?.code);
      if (window.vsDesktop) {
        window.open(url, '_blank');
        setWaiting(true);
      } else {
        window.location.href = url;
      }
    } catch (e) {
      const code = (e as Error).message;
      setError(ERRORS[code] ?? friendlyError(code));
      if (code === 'already_active') refreshLicense();
    } finally {
      setBusy(false);
    }
  };

  const card = (
    <div
      role="dialog" aria-modal="true" aria-labelledby="subscribe-title"
      className="relative w-[480px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
        <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">{label}</span>
        {onClose && (
          <button className="p-1 hover:bg-logic-bg-panel-light rounded" onClick={onClose} aria-label="Fechar">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="px-6 pt-6 pb-5">
        <div className="text-center mb-5">
          <div className="mx-auto w-20 h-20 mb-3 flex items-center justify-center">
            <VsLogo size={80} />
          </div>
          <h2 id="subscribe-title" className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed max-w-sm mx-auto">{subtitle}</p>
        </div>

        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Plano">
          {PLANS.map((p) => {
            const on = plan === p.id;
            return (
              <button
                key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPlan(p.id)}
                className={`relative text-left p-3.5 rounded-lg border transition-colors ${on
                  ? 'border-logic-lcd-green bg-logic-lcd-green/10'
                  : 'border-logic-border-light bg-logic-bg-deep hover:border-logic-text-muted'}`}
              >
                {p.badge && (
                  <span className="absolute -top-2 right-2 px-1.5 h-4 rounded bg-logic-lcd-green text-black text-[9px] font-bold flex items-center">
                    {p.badge}
                  </span>
                )}
                <span className="text-xs font-semibold text-logic-text-dim">{p.title}</span>
                <span className="block mt-1">
                  <span className={`text-xl font-bold tabular-nums ${on ? 'text-logic-lcd-green' : 'text-logic-text'}`}>{p.price}</span>
                  <span className="text-xs text-logic-text-muted">{p.period}</span>
                </span>
                <span className="block text-2xs text-logic-text-muted mt-1.5 leading-snug">{p.note}</span>
              </button>
            );
          })}
        </div>

        <ul className="mt-4 space-y-1.5 text-xs text-logic-text-dim">
          {FEATURES.map((t) => (
            <li key={t} className="flex items-center gap-2"><Check size={13} className="text-logic-lcd-green shrink-0" /> {t}</li>
          ))}
        </ul>

        <div className="mt-4">
          {appliedCoupon ? (
            <div className="px-3 py-2 rounded-lg border border-logic-lcd-green/40 bg-logic-lcd-green/10 text-xs flex items-center gap-2">
              <Tag size={13} className="text-logic-lcd-green shrink-0" />
              <span className="flex-1 text-logic-lcd-green font-semibold">
                Cupom {appliedCoupon.code} aplicado — {appliedCoupon.percent}% de desconto.
              </span>
              <button
                type="button" onClick={() => { setAppliedCoupon(null); setCoupon(''); }}
                className="text-logic-text-muted hover:text-logic-text transition"
              >
                <X size={13} />
              </button>
            </div>
          ) : couponOpen ? (
            <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); applyCoupon(); }}>
              <input
                className="flex-1 bg-logic-bg-deep text-sm text-logic-text px-3 h-9 rounded-md border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted uppercase"
                value={coupon} onChange={(e) => { setCoupon(e.target.value); setCouponError(null); }}
                placeholder="Código do cupom" maxLength={32}
              />
              <button
                type="submit" disabled={couponChecking || !coupon.trim()}
                className="px-3 h-9 rounded-md bg-logic-bg-elevated text-xs font-semibold text-logic-text hover:bg-logic-bg-panel-light transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {couponChecking ? <Loader2 size={13} className="animate-spin" /> : 'Aplicar'}
              </button>
            </form>
          ) : (
            <button
              type="button" onClick={() => setCouponOpen(true)}
              className="text-xs text-logic-text-dim hover:text-logic-text transition flex items-center gap-1.5"
            >
              <Tag size={12} /> Tenho um cupom de desconto
            </button>
          )}
          {couponError && <p className="mt-1.5 text-2xs text-logic-lcd-red">{couponError}</p>}
        </div>

        {error && (
          <div className="mt-4 px-3 py-2 rounded-lg border bg-logic-lcd-red/15 border-logic-lcd-red/40 text-logic-lcd-red text-xs text-center">
            {error}
          </div>
        )}

        {waiting ? (
          <div className="mt-5 px-3 py-3 rounded-lg bg-logic-bg-deep border border-logic-border text-xs text-logic-text-dim flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-logic-lcd-green shrink-0" />
            Conclua o pagamento no navegador. O programa libera sozinho assim que o Stripe confirmar.
          </div>
        ) : null}

        <button
          type="button" onClick={subscribe} disabled={busy}
          className="mt-5 w-full py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
          {waiting ? 'Abrir o pagamento de novo' : `Assinar ${plan === 'yearly' ? 'plano anual' : 'plano mensal'}`}
        </button>
        <p className="mt-2.5 text-2xs text-logic-text-muted text-center flex items-center justify-center gap-1">
          <ExternalLink size={10} /> Pagamento seguro pelo Stripe, com cartão de crédito.
        </p>
      </div>
      {footer}
    </div>
  );

  if (embedded) return card;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      {card}
    </div>
  );
}
