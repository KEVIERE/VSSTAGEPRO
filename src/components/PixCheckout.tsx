// Pagamento da assinatura pela InfinitePay: abre o link de checkout e confere
// sozinho até o pagamento ser confirmado. O PIX e o cartão são escolhidos na
// página dela, e o pagamento é único (não renova sozinho). O link vale 30 minutos, com
// contagem regressiva; ao vencer, a tela oferece gerar outro. Visual da mesa de
// som (console-*, access-*), igual ao SubscribeDialog.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, CreditCard, ExternalLink, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { AccessNotice, FootKey } from '@/components/access/AccessChrome';
import { createPix, getPixStatus, PIX_ERRORS, type PixCharge, type PixPlan } from '@/lib/pixCheckout';
import {
  cpfCnpjDigits, formatBRL, formatBrasiliaDate, formatBrasiliaDateTime, formatCountdown, maskCpfCnpj,
} from '@/lib/pixFormat';
import { refreshLicense } from '@/lib/licenseEvents';
import { supportWhatsAppUrl } from '@/lib/support';

// Enquanto o link vale, confere o pagamento a cada 4 s, e na hora quando a
// pessoa volta para esta janela (ela paga em outra aba ou no navegador).
const POLL_MS = 4000;
// Depois de vencido, ainda confere por 5 min, a cada 10 s: pega o pagamento
// feito no último segundo, que a InfinitePay confirma um pouco depois.
const LATE_POLL_MS = 10_000;
const LATE_WATCH_MS = 5 * 60_000;
// Faltando menos que isso, a contagem fica vermelha.
const HURRY_MS = 5 * 60_000;
// Tempo mostrando "Pagamento confirmado" antes de liberar o programa.
const PAID_HOLD_MS = 4000;

/** "no PIX", "no cartão" ou "no cartão em 3x", pelo que a InfinitePay confirmou. */
function methodText(c: PixCharge): string | null {
  if (c.capture_method === 'pix') return 'no PIX';
  if (c.capture_method === 'credit_card') return c.installments && c.installments > 1 ? `no cartão em ${c.installments}x` : 'no cartão';
  return null;
}

type Phase = 'loading' | 'cpf' | 'waiting' | 'paid' | 'closed' | 'mismatch' | 'error';

export default function PixCheckout({
  plan, couponCode, onBack, onPaid, paidNote,
}: {
  plan: PixPlan;
  couponCode?: string;
  /** Volta para a escolha do plano */
  onBack?: () => void;
  /** Chamado depois de mostrar a confirmação (a licença já foi conferida de novo) */
  onPaid?: () => void;
  /** Texto embaixo do "Pagamento confirmado" (ex.: no site, "abra o programa no Mac") */
  paidNote?: ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [charge, setCharge] = useState<PixCharge | null>(null);
  const [cpf, setCpf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [, setTick] = useState(0);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const startedRef = useRef(false);
  // Diferença entre o relógio do servidor e o do computador: a contagem usa a hora do servidor.
  const skewRef = useRef(0);
  // Pagamento mostrado agora: uma resposta atrasada de um link trocado não volta para a tela.
  const currentIdRef = useRef<string | null>(null);
  const serverNow = () => Date.now() + skewRef.current;

  const show = (c: PixCharge) => {
    if (c.now) skewRef.current = Date.parse(c.now) - Date.now();
    currentIdRef.current = c.id;
    setCharge(c);
    setPhase(c.status === 'pending' ? 'waiting' : c.status === 'paid' ? 'paid' : c.status === 'amount_mismatch' ? 'mismatch' : 'closed');
  };
  const showIfCurrent = (c: PixCharge) => {
    if (c.id === currentIdRef.current) show(c);
  };

  const generate = useCallback(async (cpfCnpj?: string) => {
    setPhase('loading');
    setError(null);
    currentIdRef.current = null;
    try {
      show(await createPix(plan, { cpfCnpj, couponCode }));
    } catch (e) {
      const code = (e as Error).message;
      // A InfinitePay coleta os dados do pagador na página dela, então o CPF
      // não é mais pedido aqui. A tela continua existindo como reserva, para o
      // dia em que o servidor voltar a exigir.
      if (code === 'cpf_required' || code === 'invalid_cpf') {
        setPhase('cpf');
        if (code === 'invalid_cpf') setError(PIX_ERRORS.invalid_cpf);
        return;
      }
      setError(PIX_ERRORS[code] ?? PIX_ERRORS.pix_failed);
      setPhase('error');
      if (code === 'already_active') refreshLicense();
    }
  }, [plan, couponCode]);

  // Gera o PIX ao abrir (uma vez só, mesmo com o StrictMode montando duas vezes)
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generate();
  }, [generate]);

  const chargeId = charge?.id;
  const expiresMs = charge ? Date.parse(charge.expires_at) : 0;
  // Confere enquanto o link vale e, depois de vencido, por mais alguns minutos.
  const watching = !!chargeId && (phase === 'waiting' || (phase === 'closed' && charge?.status === 'expired'));

  // Contagem regressiva: atualiza a tela a cada segundo enquanto aguarda.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (!watching || !chargeId) return;
    let busy = false;
    const poll = async () => {
      if (busy || serverNow() - expiresMs > LATE_WATCH_MS) return;
      busy = true;
      try {
        const c = await getPixStatus(chargeId);
        if (c.id === currentIdRef.current) show(c);
      } catch { /* tenta de novo na próxima volta */ } finally { busy = false; }
    };
    const t = window.setInterval(poll, phase === 'waiting' ? POLL_MS : LATE_POLL_MS);
    // Voltou para esta janela (pagou na outra aba ou no navegador): confere na hora.
    const onReturn = () => { if (document.visibilityState === 'visible') poll(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [watching, chargeId, phase, expiresMs]);

  // Pago: mostra a confirmação (também no título da aba, visível de outra aba) e
  // depois pede ao programa para conferir a licença.
  useEffect(() => {
    if (phase !== 'paid') return;
    const before = document.title;
    document.title = 'Pagamento confirmado · VS Stage Pro';
    const t = window.setTimeout(() => { refreshLicense(); onPaidRef.current?.(); }, PAID_HOLD_MS);
    return () => { window.clearTimeout(t); document.title = before; };
  }, [phase]);

  const checkNow = async () => {
    if (!charge) return;
    setChecking(true);
    try {
      showIfCurrent(await getPixStatus(charge.id));
    } catch { /* o aviso automático continua valendo */ } finally {
      setChecking(false);
    }
  };

  const back = onBack && (
    <button type="button" onClick={onBack} className="access-link mt-3 mx-auto flex items-center gap-1.5">
      <ArrowLeft size={12} /> Voltar para os planos
    </button>
  );

  if (phase === 'loading') {
    return (
      <div className="console-display px-4 py-6 flex items-center justify-center gap-2.5 text-[0.82rem] text-logic-text-dim" role="status">
        <Loader2 size={15} className="animate-spin text-logic-lcd-amber" /> Abrindo o pagamento…
      </div>
    );
  }

  if (phase === 'cpf') {
    const digits = cpfCnpjDigits(cpf);
    return (
      <form onSubmit={(e) => { e.preventDefault(); generate(cpf); }}>
        <label htmlFor="pix-cpf" className="console-legend uppercase tracking-[0.12em] block mb-2">CPF ou CNPJ de quem paga</label>
        <input
          id="pix-cpf" className="access-field is-plain tabular-nums" inputMode="numeric" autoComplete="off" autoFocus
          value={cpf} onChange={(e) => { setCpf(maskCpfCnpj(e.target.value)); setError(null); }}
          placeholder="000.000.000-00"
        />
        <p className="mt-2 text-2xs text-logic-text-muted leading-snug">
          Os dados de pagamento são preenchidos na página da InfinitePay, no momento de pagar.
        </p>
        {error && <div className="mt-3"><AccessNotice tone="red"><p>{error}</p></AccessNotice></div>}
        <button type="submit" disabled={digits !== 11 && digits !== 14} className="access-key mt-4">
          <CreditCard size={16} /> Ir para o pagamento
        </button>
        {back}
      </form>
    );
  }

  if (phase === 'paid' && charge) {
    return (
      <div className="text-center" role="status" aria-live="assertive">
        <div className="console-bezel">
          <div className="console-display px-4 py-6 flex flex-col items-center gap-3">
            <span className="w-14 h-14 rounded-full flex items-center justify-center border-2 border-logic-lcd-green/70 text-logic-lcd-green shadow-[0_0_26px_rgba(62,226,110,0.35)]">
              <CheckCircle2 size={30} />
            </span>
            <span className="font-stage text-[1.8rem] font-bold leading-none text-logic-lcd-green console-glow">
              Pagamento confirmado
            </span>
            {charge.access_until && (
              <span className="text-xs text-logic-text-dim">Assinatura liberada até {formatBrasiliaDate(charge.access_until)}.</span>
            )}
            {methodText(charge) && <span className="text-2xs text-logic-text-muted">Pago {methodText(charge)}.</span>}
          </div>
        </div>
        <div className="mt-3 text-xs text-logic-text-dim">
          {paidNote ?? (
            <span className="inline-flex items-center gap-2"><Loader2 size={12} className="animate-spin text-logic-lcd-green" /> Liberando o VS Stage Pro…</span>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'mismatch' && charge) {
    return (
      <div>
        <AccessNotice tone="red">
          <p>O valor pago é diferente do valor cobrado, então a assinatura não foi liberada automaticamente.</p>
          <p>Fale com o suporte que resolvemos.</p>
        </AccessNotice>
        <a
          href={supportWhatsAppUrl(`Olá! Paguei a assinatura do VS Stage Pro com valor diferente. Código do pagamento: ${charge.id}`)}
          target="_blank" rel="noreferrer" className="access-key mt-4"
        >
          <MessageCircle size={16} /> Falar com o suporte
        </a>
      </div>
    );
  }

  // Venceu: vale o que o servidor disse ou, antes da resposta, a própria contagem.
  const remaining = charge ? expiresMs - serverNow() : 0;
  const expiredHere = phase === 'waiting' && remaining <= 0;
  const expired = !!charge && ((phase === 'closed' && charge.status === 'expired') || expiredHere);

  if (charge && (phase === 'closed' || expiredHere)) {
    return (
      <div>
        <AccessNotice tone="red">
          <p>
            {expired
              ? 'Este link de pagamento venceu e não pode mais ser pago. Cada link vale 30 minutos.'
              : charge.status === 'refunded'
                ? 'Este pagamento foi estornado e não libera mais o acesso.'
                : 'Este link foi trocado por outro e não vale mais.'}
          </p>
          <p>Gere outro para continuar.</p>
        </AccessNotice>
        <button type="button" onClick={() => generate()} className="access-key mt-4">
          <RefreshCw size={16} /> Gerar outro link
        </button>
        {expired && (
          <button
            type="button" onClick={checkNow} disabled={checking}
            className="mt-2 w-full access-link justify-center flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> Paguei no último minuto, conferir
          </button>
        )}
        {back}
      </div>
    );
  }

  if (phase === 'error' || !charge) {
    return (
      <div>
        <AccessNotice tone="red"><p>{error ?? PIX_ERRORS.pix_failed}</p></AccessNotice>
        <button type="button" onClick={() => generate()} className="access-key mt-4">
          <RefreshCw size={16} /> Tentar de novo
        </button>
        {back}
      </div>
    );
  }

  // Aguardando pagamento. O valor cheio só aparece riscado quando o servidor
  // informa o desconto (full_cents e discount_percent).
  const hasDiscount = !!charge.discount_percent && charge.discount_percent > 0
    && typeof charge.full_cents === 'number' && charge.full_cents > charge.amount_cents;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <span className="console-legend uppercase tracking-[0.12em] flex items-center gap-1.5">
          <span className="console-led is-on-amber" /> {charge.plan === 'yearly' ? 'Anual · 1 ano' : 'Mensal · 1 mês'}
        </span>
        <span className="flex flex-col items-end gap-1">
          {hasDiscount && (
            <span className="text-2xs text-logic-text-muted tabular-nums line-through">{formatBRL(charge.full_cents!)}</span>
          )}
          <span className="font-stage text-[1.65rem] font-bold leading-none tabular-nums text-logic-lcd-amber console-glow">
            {formatBRL(charge.amount_cents)}
          </span>
        </span>
      </div>
      {hasDiscount && (
        <p className="mt-1.5 text-2xs text-logic-lcd-green text-right">
          {charge.coupon_code ? `Cupom ${charge.coupon_code}, ` : 'Desconto de '}{charge.discount_percent}%
        </p>
      )}

      <p className="mt-4 text-xs text-logic-text-dim text-center leading-snug">
        O pagamento abre na página segura da InfinitePay, onde você escolhe PIX ou cartão.
        Depois de pagar, volte para cá: a liberação é automática.
      </p>

      <a
        href={charge.checkout_url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-3 access-key w-full justify-center flex items-center gap-2 ${charge.checkout_url ? '' : 'pointer-events-none opacity-50'}`}
      >
        <ExternalLink size={15} /> Ir para o pagamento
      </a>

      <button
        type="button" onClick={checkNow} disabled={checking}
        className="mt-2 w-full access-link justify-center flex items-center gap-1.5 disabled:opacity-50"
      >
        <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> Já paguei, conferir agora
      </button>

      <div className="mt-4 console-bezel">
        <div className="console-display px-3 py-2.5 flex items-center justify-between gap-3">
          <span className="console-legend uppercase tracking-[0.12em] flex items-center gap-1.5">
            <span className="console-led is-on-amber" /> Link vale por
          </span>
          <span
            role="timer" aria-label={`Faltam ${formatCountdown(remaining)} para o link vencer`}
            className={`font-stage text-[1.45rem] font-bold leading-none tabular-nums console-glow ${remaining <= HURRY_MS ? 'text-logic-lcd-red' : 'text-logic-lcd-amber'}`}
          >
            {formatCountdown(remaining)}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-2xs text-logic-text-muted text-center">
        Até {formatBrasiliaDateTime(charge.expires_at)} (horário de Brasília). Depois disso, é só gerar outro.
      </p>

      <div className="mt-3 console-display px-3 py-2.5 text-xs flex items-center gap-2.5" role="status">
        <Loader2 size={13} className="animate-spin text-logic-lcd-amber shrink-0" />
        <span className="flex-1 text-logic-text-dim">Aguardando o pagamento. A tela confirma sozinha.</span>
      </div>

      <div className={`mt-4 grid gap-2 ${onBack ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {onBack && <FootKey onClick={onBack}><ArrowLeft size={14} /> Voltar</FootKey>}
        <FootKey onClick={checkNow} disabled={checking}>
          {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Já paguei
        </FootKey>
      </div>
    </div>
  );
}
