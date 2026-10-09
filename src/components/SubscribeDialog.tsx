import { useEffect, useState } from 'react';
import { Check, CreditCard, ExternalLink, Loader2, X } from 'lucide-react';
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

async function startCheckout(plan: Plan): Promise<string> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { plan } });
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
      const url = await startCheckout(plan);
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
