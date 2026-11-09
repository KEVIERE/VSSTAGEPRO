import { useEffect, useState } from 'react';
import { CreditCard, ExternalLink, Loader2, QrCode, ShieldCheck, Tag, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/friendlyError';
import { AccessCard, AccessNotice, AccessTitle } from '@/components/access/AccessChrome';
import PixCheckout from '@/components/PixCheckout';
import { refreshLicense } from '@/lib/licenseEvents';
import { formatBRL } from '@/lib/pixFormat';

export type Plan = 'monthly' | 'yearly';
type Method = 'pix' | 'card';

const PLANS: Array<{ id: Plan; title: string; price: string; cents: number; period: string; note: string; pixNote: string; badge?: string }> = [
  {
    id: 'monthly', title: 'Mensal', price: 'R$ 55,00', cents: 5500, period: '/mês',
    note: 'Cobrança recorrente todo mês. Cancele quando quiser.',
    pixNote: '1 mês de acesso. Renove com outro PIX quando quiser.',
  },
  {
    id: 'yearly', title: 'Anual', price: 'R$ 349,00', cents: 34900, period: '/ano',
    note: 'Pagamento único por ano — sai por R$ 29,08/mês.',
    pixNote: '1 ano de acesso — sai por R$ 29,08/mês.',
    badge: 'ECONOMIZE R$ 311',
  },
];

const METHODS: Array<{ id: Method; label: string; icon: typeof QrCode }> = [
  { id: 'pix', label: 'PIX', icon: QrCode },
  { id: 'card', label: 'Cartão', icon: CreditCard },
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
  onClose, embedded = false, label = 'Assinatura', status, title = 'Assine o VS Stage Pro',
  subtitle = 'Escolha o plano e continue usando sem limite.', footer,
}: {
  onClose?: () => void;
  embedded?: boolean;
  label?: React.ReactNode;
  /** Canto direito do trilho de cima (ex.: LED com "0:00" quando o teste acabou) */
  status?: React.ReactNode;
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
}) {
  const [plan, setPlan] = useState<Plan>('yearly');
  const [method, setMethod] = useState<Method>('pix');
  // PIX aberto: o cartão mostra o QR Code no lugar da escolha do plano
  const [pixOpen, setPixOpen] = useState(false);
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

  const selected = PLANS.find((p) => p.id === plan)!;
  // Só para o texto da tecla: o valor que vale é o que o servidor calcula com o cupom
  const pixCents = Math.round((selected.cents * (100 - (appliedCoupon?.percent ?? 0))) / 100);

  const closeKey = onClose ? (
    <button className="console-key w-7 h-6 flex items-center justify-center" onClick={onClose} aria-label="Fechar">
      <X size={13} />
    </button>
  ) : status;

  if (pixOpen) {
    const pixCard = (
      <AccessCard
        role="dialog" aria-modal="true" aria-labelledby="subscribe-title" width={420}
        onClick={(e) => e.stopPropagation()}
        label="Pagamento PIX"
        status={closeKey}
      >
        <div className="px-6 pt-6 pb-6">
          <h1 id="subscribe-title" className="font-stage font-bold text-[1.6rem] leading-none text-logic-text text-center mb-5">
            Pague com PIX
          </h1>
          <PixCheckout
            key={`${plan}-${appliedCoupon?.code ?? ''}`}
            plan={plan}
            couponCode={appliedCoupon?.code}
            onBack={() => setPixOpen(false)}
          />
        </div>
        {footer}
      </AccessCard>
    );
    if (embedded) return pixCard;
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-6 overflow-y-auto" onClick={onClose}>
        {pixCard}
      </div>
    );
  }

  const card = (
    <AccessCard
      role="dialog" aria-modal="true" aria-labelledby="subscribe-title" width={480}
      onClick={(e) => e.stopPropagation()}
      label={label}
      status={closeKey}
    >
      <div className="px-6 pt-7 pb-6">
        <AccessTitle id="subscribe-title" title={title} subtitle={subtitle} />

        {/* Planos como pads da mesa: o escolhido acende âmbar */}
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Plano">
          {PLANS.map((p) => {
            const on = plan === p.id;
            return (
              <button
                key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPlan(p.id)}
                className={`console-pad relative text-left p-3.5 ${on ? 'is-active' : ''}`}
                style={{ '--pad-color': '#ffab1f' } as React.CSSProperties}
              >
                {p.badge && (
                  <span className="console-tape absolute -top-2 right-2 px-2 py-[3px] rotate-[-2deg] tracking-[0.04em]">
                    {p.badge}
                  </span>
                )}
                <span className="console-legend uppercase tracking-[0.12em] flex items-center gap-1.5">
                  <span className={`console-led ${on ? 'is-on-amber' : ''}`} /> {p.title}
                </span>
                <span className="block mt-2">
                  <span className={`font-stage text-[1.65rem] font-bold leading-none tabular-nums ${on ? 'text-logic-lcd-amber console-glow' : 'text-logic-text'}`}>{p.price}</span>
                  <span className="text-xs text-logic-text-muted ml-0.5">{p.period}</span>
                </span>
                <span className="block text-2xs text-logic-text-dim mt-2 leading-snug">{method === 'pix' ? p.pixNote : p.note}</span>
              </button>
            );
          })}
        </div>

        <ul className="mt-5 space-y-2 text-xs text-logic-text-dim">
          {FEATURES.map((t) => (
            <li key={t} className="flex items-center gap-2.5"><span className="console-led is-on-green shrink-0" /> {t}</li>
          ))}
        </ul>

        <div className="mt-4">
          {appliedCoupon ? (
            <AccessNotice tone="green">
              <div className="flex items-center gap-2">
                <span className="flex-1 font-semibold">Cupom {appliedCoupon.code} aplicado — {appliedCoupon.percent}% de desconto.</span>
                <button
                  type="button" aria-label="Tirar cupom" onClick={() => { setAppliedCoupon(null); setCoupon(''); }}
                  className="text-logic-text-muted hover:text-logic-text transition"
                >
                  <X size={13} />
                </button>
              </div>
            </AccessNotice>
          ) : couponOpen ? (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); applyCoupon(); }}>
              <input
                className="access-field is-plain flex-1 h-10 uppercase"
                value={coupon} onChange={(e) => { setCoupon(e.target.value); setCouponError(null); }}
                placeholder="Código do cupom" maxLength={32} autoFocus
              />
              <button
                type="submit" disabled={couponChecking || !coupon.trim()}
                className="console-key px-4 text-[0.95rem] flex items-center gap-1.5"
              >
                {couponChecking ? <Loader2 size={13} className="animate-spin" /> : 'Aplicar'}
              </button>
            </form>
          ) : (
            <button
              type="button" onClick={() => setCouponOpen(true)}
              className="access-link flex items-center gap-1.5"
            >
              <Tag size={12} /> Tenho um cupom de desconto
            </button>
          )}
          {couponError && <p className="mt-1.5 text-2xs text-[#ff7a70]">{couponError}</p>}
        </div>

        {/* Forma de pagamento: teclas da mesa, a escolhida acende */}
        <div className="mt-5">
          <p className="console-legend uppercase tracking-[0.12em] mb-2">Forma de pagamento</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pagamento">
            {METHODS.map((m) => {
              const on = method === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id} type="button" role="radio" aria-checked={on} onClick={() => { setMethod(m.id); setError(null); }}
                  className={`console-key h-10 px-3 text-[0.95rem] flex items-center justify-center gap-2 ${on ? 'is-lit-amber' : ''}`}
                >
                  <span className={`console-led ${on ? 'is-on-amber' : ''}`} /> <Icon size={14} /> {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {error && <div className="mt-4"><AccessNotice tone="red"><p>{error}</p></AccessNotice></div>}

        {method === 'card' && waiting ? (
          <div className="mt-5 console-display px-3 py-3 text-xs text-logic-text-dim flex items-center gap-2.5">
            <Loader2 size={14} className="animate-spin text-logic-lcd-amber shrink-0" />
            Conclua o pagamento no navegador. O programa libera sozinho assim que o Stripe confirmar.
          </div>
        ) : null}

        {method === 'pix' ? (
          <>
            <button type="button" onClick={() => { setError(null); setPixOpen(true); }} className="access-key mt-5">
              <QrCode size={16} /> Pagar {formatBRL(pixCents)} com PIX
            </button>
            <p className="mt-3 text-2xs text-logic-text-muted text-center flex items-center justify-center gap-1">
              <ShieldCheck size={10} /> PIX pelo Asaas. O programa libera sozinho assim que o pagamento cai.
            </p>
          </>
        ) : (
          <>
            <button type="button" onClick={subscribe} disabled={busy} className="access-key mt-5">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
              {waiting ? 'Abrir o pagamento de novo' : `Assinar ${plan === 'yearly' ? 'plano anual' : 'plano mensal'}`}
            </button>
            <p className="mt-3 text-2xs text-logic-text-muted text-center flex items-center justify-center gap-1">
              <ExternalLink size={10} /> Pagamento seguro pelo Stripe, com cartão de crédito.
            </p>
          </>
        )}
      </div>
      {footer}
    </AccessCard>
  );

  if (embedded) return card;
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-[2px] p-6 overflow-y-auto" onClick={onClose}>
      {card}
    </div>
  );
}
