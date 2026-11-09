// Pagamento da assinatura pela InfinitePay: abre o link de checkout e confere
// sozinho até o pagamento ser confirmado. A InfinitePay não devolve QR Code —
// o PIX e o cartão são escolhidos na página dela. Visual da mesa de som
// (console-*, access-*), igual ao SubscribeDialog.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CheckCircle2, CreditCard, ExternalLink, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { AccessNotice, FootKey } from '@/components/access/AccessChrome';
import { createPix, getPixStatus, PIX_ERRORS, type PixCharge, type PixPlan } from '@/lib/pixCheckout';
import { cpfCnpjDigits, formatBRL, maskCpfCnpj } from '@/lib/pixFormat';
import { refreshLicense } from '@/lib/licenseEvents';
import { supportWhatsAppUrl } from '@/lib/support';

// Confere o pagamento a cada 4 s; depois de 30 min para e deixa o botão "Já paguei".
const POLL_MS = 4000;
const POLL_LIMIT_MS = 30 * 60 * 1000;
// Tempo mostrando "Pagamento confirmado" antes de liberar o programa.
const PAID_HOLD_MS = 2500;

type Phase = 'loading' | 'cpf' | 'waiting' | 'paid' | 'closed' | 'mismatch' | 'error';

const BRASILIA = 'America/Sao_Paulo';
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: BRASILIA });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: BRASILIA });

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
  const [pollStopped, setPollStopped] = useState(false);
  const [checking, setChecking] = useState(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const startedRef = useRef(false);

  const show = (c: PixCharge) => {
    setCharge(c);
    setPhase(c.status === 'pending' ? 'waiting' : c.status === 'paid' ? 'paid' : c.status === 'amount_mismatch' ? 'mismatch' : 'closed');
  };

  const generate = useCallback(async (cpfCnpj?: string) => {
    setPhase('loading');
    setError(null);
    setPollStopped(false);
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

  // Enquanto aguarda, confere o pagamento de tempos em tempos
  const chargeId = charge?.id;
  useEffect(() => {
    if (phase !== 'waiting' || !chargeId || pollStopped) return;
    const started = Date.now();
    let busy = false;
    const t = window.setInterval(async () => {
      if (Date.now() - started > POLL_LIMIT_MS) { setPollStopped(true); return; }
      if (busy) return;
      busy = true;
      try { show(await getPixStatus(chargeId)); } catch { /* tenta de novo na próxima volta */ } finally { busy = false; }
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [phase, chargeId, pollStopped]);

  // Pago: mostra a confirmação e depois pede ao programa para conferir a licença
  useEffect(() => {
    if (phase !== 'paid') return;
    const t = window.setTimeout(() => { refreshLicense(); onPaidRef.current?.(); }, PAID_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  const checkNow = async () => {
    if (!charge) return;
    setChecking(true);
    try {
      show(await getPixStatus(charge.id));
      setPollStopped(false);
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
      <div className="text-center" role="status">
        <div className="console-bezel">
          <div className="console-display px-4 py-5 flex flex-col items-center gap-2">
            <span className="flex items-center gap-2 font-stage text-[1.5rem] font-bold leading-none text-logic-lcd-green console-glow">
              <CheckCircle2 size={22} /> Pagamento confirmado
            </span>
            {charge.access_until && (
              <span className="text-xs text-logic-text-dim">Assinatura liberada até {fmtDate(charge.access_until)}.</span>
            )}
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
          href={supportWhatsAppUrl(`Olá! Paguei o PIX da assinatura do VS Stage Pro com valor diferente. Código do PIX: ${charge.id}`)}
          target="_blank" rel="noreferrer" className="access-key mt-4"
        >
          <MessageCircle size={16} /> Falar com o suporte
        </a>
      </div>
    );
  }

  if (phase === 'closed' && charge) {
    return (
      <div>
        <AccessNotice tone="red">
          <p>{charge.status === 'expired' ? 'Este PIX venceu e não pode mais ser pago.' : 'Este PIX foi trocado por outro e não vale mais.'}</p>
          <p>Gere um novo para continuar.</p>
        </AccessNotice>
        <button type="button" onClick={() => generate()} className="access-key mt-4">
          <RefreshCw size={16} /> Gerar novo PIX
        </button>
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

  // Aguardando pagamento
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <span className="console-legend uppercase tracking-[0.12em] flex items-center gap-1.5">
          <span className="console-led is-on-amber" /> {charge.plan === 'yearly' ? 'Anual · 1 ano' : 'Mensal · 1 mês'}
        </span>
        <span className="font-stage text-[1.65rem] font-bold leading-none tabular-nums text-logic-lcd-amber console-glow">
          {formatBRL(charge.amount_cents)}
        </span>
      </div>

      <p className="mt-4 text-xs text-logic-text-dim text-center leading-snug">
        O pagamento abre na página segura da InfinitePay, onde você escolhe PIX, cartão ou Apple Pay.
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

      <div className="mt-4 console-display px-3 py-2.5 text-xs flex items-center gap-2.5" role="status">
        {pollStopped
          ? <span className="console-led is-on-amber shrink-0" />
          : <Loader2 size={13} className="animate-spin text-logic-lcd-amber shrink-0" />}
        <span className="flex-1 text-logic-text-dim">
          {pollStopped ? 'Paramos de conferir sozinhos. Se já pagou, toque em "Já paguei".' : 'Aguardando o pagamento. A tela confirma sozinha.'}
        </span>
      </div>
      <p className="mt-2 text-2xs text-logic-text-muted text-center">
        Vale até {fmtDateTime(charge.expires_at)} (horário de Brasília).
      </p>

      <div className={`mt-4 grid gap-2 ${onBack ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {onBack && <FootKey onClick={onBack}><ArrowLeft size={14} /> Voltar</FootKey>}
        <FootKey onClick={checkNow} disabled={checking}>
          {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Já paguei
        </FootKey>
      </div>
    </div>
  );
}
