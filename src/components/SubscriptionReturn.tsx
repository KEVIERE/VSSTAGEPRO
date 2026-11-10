// Página de volta da InfinitePay (/#assinatura). A pessoa chega aqui depois de
// pagar; a página confere o pagamento sozinha e mostra "Pagamento confirmado"
// ou "Aguardando confirmação" até a InfinitePay confirmar.
import { useEffect, useMemo, useState } from 'react';
import {
  Apple,
  ArrowRight,
  CheckCircle2,
  Download,
  Laptop,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import VsLogo from '@/components/VsLogo';
import { supportWhatsAppUrl } from '@/lib/support';
import { supabase } from '@/lib/supabaseClient';
import { getLatestPix, getPixStatus, type PixCharge } from '@/lib/pixCheckout';
import { formatBrasiliaDate } from '@/lib/pixFormat';
import { readPixReturn } from '@/lib/pixReturn';

// Confere a cada 4 s por até 5 min; depois mostra "ainda aguardando" com o botão de conferir de novo.
const RETURN_POLL_MS = 4000;
const RETURN_WAIT_MS = 5 * 60_000;

type ReturnState = 'checking' | 'waiting' | 'late' | 'paid' | 'mismatch' | 'signed_out' | 'unknown';

/** Situação do pagamento que trouxe a pessoa de volta da InfinitePay. */
function usePaymentReturn(active: boolean) {
  const [state, setState] = useState<ReturnState>('checking');
  const [charge, setCharge] = useState<PixCharge | null>(null);
  const [round, setRound] = useState(0);
  const info = useMemo(
    () => (typeof window === 'undefined' ? null : readPixReturn(window.location.search, window.location.hash)),
    [],
  );

  useEffect(() => {
    if (!active || !info) return;
    let stopped = false;
    let timer: number | undefined;
    const started = Date.now();

    const ask = async () => {
      const { data } = await supabase.auth.getSession();
      if (stopped) return;
      // Sem login neste navegador (ex.: pagou pelo app do Mac): a confirmação aparece no programa.
      if (!data.session) { setState('signed_out'); return; }
      try {
        const c = info.id ? await getPixStatus(info.id, info.codes) : await getLatestPix(info.codes);
        if (stopped) return;
        setCharge(c);
        if (c.status === 'paid') { setState('paid'); return; }
        if (c.status === 'amount_mismatch') { setState('mismatch'); return; }
      } catch (e) {
        if (stopped) return;
        const code = (e as Error).message;
        if (code === 'not_found' || code === 'unauthorized') { setState('unknown'); return; }
        // Erro passageiro (rede): tenta de novo na próxima volta.
      }
      if (Date.now() - started > RETURN_WAIT_MS) { setState('late'); return; }
      setState('waiting');
      timer = window.setTimeout(ask, RETURN_POLL_MS);
    };

    setState('checking');
    ask();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [active, info, round]);

  // Confirmado: também no título da aba.
  useEffect(() => {
    if (state !== 'paid') return;
    const before = document.title;
    document.title = 'Pagamento confirmado · VS Stage Pro';
    return () => { document.title = before; };
  }, [state]);

  return { state, charge, retry: () => setRound((r) => r + 1) };
}

/** Visor da mesa de som com a situação do pagamento. */
function PaymentStatusPanel({ state, charge, onRetry }: { state: ReturnState; charge: PixCharge | null; onRetry: () => void }) {
  if (state === 'paid') {
    return (
      <div className="console-bezel max-w-md mx-auto" role="status" aria-live="assertive">
        <div className="console-display px-5 py-5 flex flex-col items-center gap-2.5">
          <span className="console-legend uppercase tracking-[0.14em] flex items-center gap-1.5">
            <span className="console-led is-on-green" /> Pagamento
          </span>
          <span className="flex items-center gap-2.5 font-stage text-[1.9rem] font-bold leading-none text-logic-lcd-green console-glow">
            <CheckCircle2 size={26} /> Pagamento confirmado
          </span>
          {charge?.access_until && (
            <span className="text-xs text-logic-text-dim">Assinatura liberada até {formatBrasiliaDate(charge.access_until)}.</span>
          )}
        </div>
      </div>
    );
  }

  if (state === 'mismatch') {
    return (
      <div className="max-w-md mx-auto text-left">
        <div className="console-bezel" role="alert">
          <div className="console-display px-4 py-3.5 text-xs leading-relaxed flex items-start gap-2.5">
            <span className="console-lamp is-on mt-[3px] shrink-0" />
            <div className="flex-1 space-y-1.5 text-[#ff7a70]">
              <p>O valor pago é diferente do valor cobrado, então a assinatura não foi liberada automaticamente.</p>
              <p>Fale com o suporte que resolvemos.</p>
            </div>
          </div>
        </div>
        <a
          href={supportWhatsAppUrl(`Olá! Paguei a assinatura do VS Stage Pro com valor diferente. Código do pagamento: ${charge?.id ?? '-'}`)}
          target="_blank" rel="noreferrer" className="access-key mt-4"
        >
          <MessageCircle size={16} /> Falar com o suporte
        </a>
      </div>
    );
  }

  const title = state === 'checking' ? 'Conferindo o pagamento'
    : state === 'late' ? 'Ainda aguardando a confirmação'
    : state === 'unknown' ? 'Obrigado!'
    : 'Aguardando confirmação';
  const text = state === 'checking' ? 'Só um instante.'
    : state === 'waiting' ? 'A InfinitePay está confirmando o seu pagamento. Esta página atualiza sozinha, não precisa recarregar.'
    : state === 'late' ? 'Alguns pagamentos levam alguns minutos. Quando a InfinitePay confirmar, o acesso é liberado sozinho: não precisa pagar de novo.'
    : state === 'signed_out' ? 'Volte para o VS Stage Pro: a confirmação aparece lá sozinha, em alguns segundos. Não precisa pagar de novo.'
    : 'Se você concluiu o pagamento, a liberação é automática em alguns segundos.';
  const spinning = state === 'checking' || state === 'waiting';

  return (
    <div className="max-w-md mx-auto">
      <div className="console-bezel" role="status" aria-live="polite">
        <div className="console-display px-5 py-5 flex flex-col items-center gap-2.5">
          <span className="console-legend uppercase tracking-[0.14em] flex items-center gap-1.5">
            <span className="console-led is-on-amber" /> Pagamento
          </span>
          <span className="flex items-center gap-2.5 font-stage text-[1.6rem] font-bold leading-none text-logic-lcd-amber console-glow">
            {spinning && <Loader2 size={20} className="animate-spin" />} {title}
          </span>
          <span className="text-xs text-logic-text-dim leading-relaxed">{text}</span>
        </div>
      </div>
      {state === 'late' && (
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={onRetry} className="access-key">
            <RefreshCw size={16} /> Conferir de novo
          </button>
          <a
            href={supportWhatsAppUrl(`Olá! Paguei a assinatura do VS Stage Pro e ainda não foi confirmada. Código do pagamento: ${charge?.id ?? '-'}`)}
            target="_blank" rel="noreferrer" className="access-link mx-auto flex items-center gap-1.5"
          >
            <MessageCircle size={12} /> Falar com o suporte
          </a>
        </div>
      )}
    </div>
  );
}

export default function SubscriptionReturn() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const ok = typeof window !== 'undefined' && !window.location.hash.includes('cancelada');
  const { state, charge, retry } = usePaymentReturn(ok);
  const paid = state === 'paid';

  useEffect(() => {
    window.scrollTo(0, 0);
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) {
        setUserEmail(data.session.user.email);
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#08090b] text-[#e8e8e8] font-sans antialiased selection:bg-logic-lcd-green selection:text-black relative overflow-x-hidden">
      {/* Luzes neon de fundo estilo DAW */}
      <div className="hidden sm:block fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[850px] h-[500px] bg-gradient-to-b from-logic-lcd-green/12 via-emerald-500/5 to-transparent blur-[140px]" />
        <div className="absolute top-1/3 right-[-10%] w-[500px] h-[500px] bg-logic-lcd-amber/7 blur-[150px]" />
        <div className="absolute bottom-1/4 left-[-10%] w-[500px] h-[500px] bg-logic-lcd-green/6 blur-[130px]" />
      </div>

      {/* Topo / Barra de Navegação */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#08090b]/80 border-b border-white/[0.08]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 group">
            <VsLogo size={28} />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="vs-brand text-sm text-white">VS Stage</span>
                <span className="px-1.5 py-0.2 rounded bg-logic-lcd-green/20 text-logic-lcd-green text-[10px] font-extrabold tracking-widest border border-logic-lcd-green/40">
                  PRO
                </span>
              </div>
              <span className="text-[9px] font-medium tracking-widest text-logic-text-muted">
                LIVE PERFORMANCE ENGINE
              </span>
            </div>
          </a>

          <div className="flex items-center gap-3">
            <a
              href="/"
              className="text-xs font-semibold text-logic-text-dim hover:text-white transition-colors"
            >
              ← Ir para o Início
            </a>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {ok ? (
          <div className="space-y-10 animate-[fadeIn_300ms_ease-out]">
            {/* Bloco Hero de Boas-Vindas */}
            <div className="text-center max-w-2xl mx-auto">
              {/* Ícone de Sucesso Animado (só com o pagamento confirmado) */}
              {paid && (
                <div className="relative mx-auto w-20 h-20 mb-6 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-logic-lcd-green/25 blur-xl animate-pulse" />
                  <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-b from-[#182a1d] to-[#0e1610] border-2 border-logic-lcd-green/60 shadow-[0_0_40px_rgba(48,209,88,0.3)] flex items-center justify-center text-logic-lcd-green">
                    <CheckCircle2 size={42} strokeWidth={2.5} />
                  </div>
                </div>
              )}

              {/* Situação do pagamento: confirmado, aguardando ou conferindo */}
              <div className="mb-7">
                <PaymentStatusPanel state={state} charge={charge} onRetry={retry} />
              </div>

              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
                {paid ? 'Seja muito bem-vindo ao' : 'Obrigado por escolher o'} <br />
                <span className="bg-gradient-to-r from-logic-lcd-green via-emerald-300 to-logic-lcd-amber bg-clip-text text-transparent">
                  VS Stage Pro!
                </span>
              </h1>

              <p className="text-sm sm:text-base text-logic-text-dim mt-4 leading-relaxed">
                {paid
                  ? 'Seu pagamento foi confirmado pela InfinitePay. Toda a potência do motor profissional de áudio, timelines independentes, Timecode LTC blindado e rede de palco já estão liberados para você.'
                  : 'Assim que a InfinitePay confirmar o pagamento, tudo é liberado sozinho na sua conta. Enquanto isso, siga os passos abaixo para instalar o programa.'}
              </p>

              {userEmail && (
                <div className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-logic-text-dim">
                  <span>Conta vinculada:</span>
                  <strong className="text-white">{userEmail}</strong>
                </div>
              )}
            </div>

            {/* Guia Passo a Passo: Como entrar no programa */}
            <div className="rounded-3xl bg-gradient-to-b from-[#13151c] to-[#0d0e13] border border-white/15 p-6 sm:p-10 shadow-2xl relative overflow-hidden">
              <div className="flex items-center gap-3 mb-8 pb-5 border-b border-white/[0.08]">
                <div className="w-10 h-10 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green flex items-center justify-center font-black">
                  <Laptop size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">Como começar a usar no seu Mac</h2>
                  <p className="text-xs text-logic-text-dim">Siga os 3 passos simples abaixo para abrir o programa.</p>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6 relative">
                {/* Passo 1 */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between hover:border-logic-lcd-green/40 transition group">
                  <div>
                    <div className="w-9 h-9 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green font-black text-sm flex items-center justify-center mb-4 group-hover:scale-110 transition">
                      1
                    </div>
                    <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                      <span>Baixe o Aplicativo</span>
                    </h3>
                    <p className="text-xs text-logic-text-dim leading-relaxed">
                      Se você ainda não instalou, baixe o instalador oficial para macOS (.dmg) compatível com Apple Silicon (M1 a M4) e processadores Intel.
                    </p>
                  </div>

                  <a
                    href="#baixar"
                    className="mt-6 w-full h-11 rounded-xl btn-neon-green text-black font-extrabold text-xs flex items-center justify-center gap-2 shadow-lg shadow-logic-lcd-green/20 hover:scale-[1.02] transition"
                  >
                    <Download size={15} />
                    <span>Baixar para Mac</span>
                  </a>
                </div>

                {/* Passo 2 */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between hover:border-logic-lcd-green/40 transition group">
                  <div>
                    <div className="w-9 h-9 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green font-black text-sm flex items-center justify-center mb-4 group-hover:scale-110 transition">
                      2
                    </div>
                    <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                      <span>Instale no seu Mac</span>
                    </h3>
                    <p className="text-xs text-logic-text-dim leading-relaxed">
                      Dê dois cliques no arquivo <strong className="text-white">.dmg</strong> baixado e arraste o ícone do <strong className="text-white">VS Stage Pro</strong> para dentro da sua pasta <strong className="text-white">Aplicativos</strong>.
                    </p>
                  </div>

                  <div className="mt-6 p-3 rounded-xl bg-black/40 border border-white/10 text-2xs text-logic-text-dim flex items-center gap-2">
                    <Apple size={16} className="text-white shrink-0" />
                    <span>Arraste para Aplicativos</span>
                  </div>
                </div>

                {/* Passo 3 */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col justify-between hover:border-logic-lcd-green/40 transition group">
                  <div>
                    <div className="w-9 h-9 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green font-black text-sm flex items-center justify-center mb-4 group-hover:scale-110 transition">
                      3
                    </div>
                    <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                      <span>Faça Login no App</span>
                    </h3>
                    <p className="text-xs text-logic-text-dim leading-relaxed">
                      Abra o VS Stage Pro no Mac e entre com o <strong className="text-white">mesmo e-mail e senha</strong> que você acabou de usar. O programa reconhece sua assinatura pelo servidor e libera tudo na hora!
                    </p>
                  </div>

                  <div className="mt-6 p-3 rounded-xl bg-logic-lcd-green/10 border border-logic-lcd-green/20 text-2xs text-logic-lcd-green flex items-center gap-2">
                    <ShieldCheck size={16} className="shrink-0" />
                    <span>Liberação automática em segundos</span>
                  </div>
                </div>
              </div>

              {/* Dica de Segurança e Estabilidade */}
              <div className="mt-8 pt-6 border-t border-white/[0.08] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-logic-text-dim">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-logic-lcd-green shrink-0" />
                  <span>Você pode usar 100% offline no palco sem precisar de internet ativa nos shows.</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={16} className="text-logic-lcd-green shrink-0" />
                  <span>Projetos, repertórios e timelines ilimitadas liberadas.</span>
                </div>
              </div>
            </div>

            {/* Suporte Humanizado */}
            <div className="rounded-2xl p-6 bg-white/[0.02] border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 text-left">
                <div className="w-11 h-11 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green flex items-center justify-center shrink-0">
                  <MessageCircle size={22} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Precisa de ajuda ou suporte técnico?</h4>
                  <p className="text-xs text-logic-text-dim mt-0.5">Nosso time está disponível para tirar dúvidas sobre configuração e roteamento de áudio.</p>
                </div>
              </div>

              <a
                href={supportWhatsAppUrl('Olá! Acabei de assinar o VS Stage Pro e gostaria de tirar uma dúvida.')}
                target="_blank"
                rel="noreferrer"
                className="w-full sm:w-auto px-5 h-11 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-white font-bold text-xs flex items-center justify-center gap-2 transition"
              >
                <span>Falar no WhatsApp</span>
                <ArrowRight size={14} />
              </a>
            </div>
          </div>
        ) : (
          /* Tela de Pagamento Cancelado / Não Concluído */
          <div className="max-w-md mx-auto text-center p-8 rounded-3xl bg-[#13141a] border border-white/15 shadow-2xl animate-[fadeIn_300ms_ease-out]">
            <div className="w-16 h-16 rounded-2xl bg-logic-lcd-red/15 border border-logic-lcd-red/30 flex items-center justify-center text-logic-lcd-red mx-auto mb-5">
              <XCircle size={36} />
            </div>

            <h1 className="text-2xl font-black text-white">Pagamento não concluído</h1>
            <p className="text-xs text-logic-text-dim mt-2 leading-relaxed">
              O processo de pagamento foi cancelado ou não foi finalizado. Nenhuma cobrança foi realizada no seu cartão.
            </p>

            <div className="mt-8 space-y-3">
              <a
                href="#planos"
                className="w-full h-12 rounded-xl btn-neon-green text-black font-black text-sm flex items-center justify-center gap-2 shadow-lg hover:scale-[1.02] transition"
              >
                <span>Tentar Novamente nos Planos</span>
                <ArrowRight size={16} />
              </a>

              <a
                href="/"
                className="w-full h-10 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-logic-text-dim hover:text-white text-xs font-bold flex items-center justify-center transition"
              >
                Voltar à Página Principal
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
