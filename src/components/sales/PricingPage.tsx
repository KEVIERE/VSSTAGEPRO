import { useEffect, useState } from 'react';
import {
  Apple,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  HelpCircle,
  Laptop,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  Mic2,
  MonitorPlay,
  Radio,
  ShieldCheck,
  Sparkles,
  Timer,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import VsLogo from '@/components/VsLogo';
import { supabase } from '@/lib/supabaseClient';
import { friendlyError } from '@/lib/friendlyError';

export type Plan = 'monthly' | 'yearly';

const MONTHLY_PRICE = 'R$ 55,00';
const YEARLY_PRICE = 'R$ 599,00';
const YEARLY_MONTH_EQUIV = 'R$ 49,92';

const COMPARISON_FEATURES = [
  {
    category: 'Motor de Áudio & Estabilidade no Palco',
    items: [
      { name: 'Timeline independente por música (sem travamentos)', monthly: true, yearly: true },
      { name: 'Roteamento inteligente pelo nome dos clipes de áudio', monthly: true, yearly: true },
      { name: 'Detecção de BPM com IA & Afinador (Tuner) de tom', monthly: true, yearly: true },
      { name: 'Mixer com canal Timecode LTC blindado (−6dB)', monthly: true, yearly: true },
      { name: 'Botão Split Master L/R de emergência instantâneo', monthly: true, yearly: true },
      { name: 'Modo Show à prova de acidentes e cliques errados', monthly: true, yearly: true },
      { name: 'Live Loop Pads no teclado (teclas 1-9, L, P)', monthly: true, yearly: true },
      { name: 'Projetos, repertórios e músicas sem limite', monthly: true, yearly: true },
    ],
  },
  {
    category: 'Comunicação & Rede no Palco',
    items: [
      { name: '100% Offline no palco (não depende de internet)', monthly: true, yearly: true },
      { name: 'Rede local Wi-Fi direta para a banda', monthly: true, yearly: true },
      { name: 'Área do Músico no celular/tablet com cifras', monthly: true, yearly: true },
      { name: 'Teleprompter em tela cheia na TV de palco', monthly: true, yearly: true },
    ],
  },
  {
    category: 'Vantagens do Plano & Licenciamento',
    items: [
      { name: 'Suporte a Apple Silicon (M1 a M4) & Intel', monthly: true, yearly: true },
      { name: 'Cancelamento a qualquer momento sem taxas', monthly: true, yearly: true },
      { name: 'Economia garantida de R$ 61,00 por ano', monthly: false, yearly: true, note: 'R$ 49,92/mês no anual' },
      { name: 'Acesso prioritário a novas atualizações da temporada', monthly: false, yearly: true, note: 'Incluso no anual' },
      { name: 'Canal de suporte técnico prioritário', monthly: false, yearly: true, note: 'Prioritário' },
    ],
  },
];

const PRICING_FAQS = [
  {
    q: 'O programa precisa de internet para funcionar no show?',
    a: 'Não! O VS Stage Pro roda 100% offline no seu Mac durante o show. A internet só é necessária na hora de baixar o app e ativar sua conta ou renovação. No palco, você pode inclusive desligar a internet e usar roteador Wi-Fi local sem fio para conectar os celulares da banda.',
  },
  {
    q: 'Posso cancelar a assinatura quando eu quiser?',
    a: 'Sim, com total liberdade! Não há fidelidade, multa ou contrato de permanência mínima. No plano mensal, você pode cancelar a qualquer momento diretamente pelo painel e o acesso continua liberado até o fim do período já pago.',
  },
  {
    q: 'Qual é a vantagem do Plano Anual?',
    a: 'No Plano Anual você paga R$ 599 uma única vez por 12 meses de acesso, economizando R$ 61 em relação ao mensal (sai por R$ 49,92/mês). Além da economia, você garante acesso ininterrupto durante toda a temporada de shows e recebe atualizações e suporte prioritário.',
  },
  {
    q: 'Como funciona o teste grátis de 48 horas?',
    a: 'O teste de 48 horas é real e transparente: não exige cartão de crédito no momento do cadastro e o cronômetro só começa a ser contado a partir do momento em que você abre o aplicativo instalado no seu Mac. Você pode testar todos os recursos antes de assinar.',
  },
  {
    q: 'Quais são as formas de pagamento aceitas?',
    a: 'O processamento é feito pela Stripe com padrão bancário internacional de segurança. São aceitos cartões de crédito das principais bandeiras nacionais e internacionais com ativação imediata.',
  },
  {
    q: 'Se eu trocar de Mac ou formatar, perco minha assinatura?',
    a: 'De forma alguma! Sua assinatura está vinculada ao seu e-mail de login. Se trocar de Mac ou formatar sua máquina, basta baixar o instalador no site e fazer login com seu e-mail e senha para reativar seu acesso.',
  },
];

export default function PricingPage() {
  const [selectedPlan, setSelectedPlan] = useState<Plan>('yearly');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccessMsg, setAuthSuccessMsg] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    const root = document.getElementById('root');
    if (root) root.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      if (root) root.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setCurrentUserEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setCurrentUserEmail(s?.user?.email ?? null);
    });
    return () => sub?.subscription?.unsubscribe();
  }, []);

  const handleStartCheckout = async (plan: Plan) => {
    setSelectedPlan(plan);
    setCheckoutBusy(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.user) {
        // Usuário não está logado: abre modal para cadastrar/entrar e depois ir ao checkout
        setAuthModalOpen(true);
        setCheckoutBusy(false);
        return;
      }

      // Usuário logado: chama Edge Function stripe-checkout
      const { data, error } = await supabase.functions.invoke('stripe-checkout', {
        body: { plan },
      });

      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'checkout_failed');
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('checkout_failed');
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'already_active') {
        alert('Sua assinatura do VS Stage Pro já está ativa!');
      } else {
        alert(friendlyError(msg));
      }
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    setAuthSuccessMsg(null);

    const email = authEmail.trim();
    const password = authPassword;

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/planos` },
        });
        if (error) throw error;

        // Se precisa confirmar e-mail
        if (data.user && !data.session) {
          setAuthSuccessMsg(
            'Conta criada com sucesso! Enviamos um link de confirmação para o seu e-mail. Por favor, confirme seu e-mail para concluir a assinatura.'
          );
          setAuthBusy(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }

      // Sessão pronta: inicia checkout imediatamente
      const { data: chData, error: chErr } = await supabase.functions.invoke('stripe-checkout', {
        body: { plan: selectedPlan },
      });

      if (chErr) {
        const body = await (chErr as { context?: Response }).context?.json?.().catch(() => null);
        throw new Error(body?.error ?? 'checkout_failed');
      }

      if (chData?.url) {
        window.location.href = chData.url;
      } else {
        throw new Error('checkout_failed');
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'already_active') {
        setAuthSuccessMsg('Sua assinatura já está ativa!');
      } else {
        setAuthError(friendlyError(msg));
      }
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090b] text-[#e8e8e8] font-sans antialiased selection:bg-logic-lcd-green selection:text-black relative overflow-x-hidden">
      {/* Luzes neon de fundo estilo DAW */}
      <div className="hidden sm:block fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[550px] bg-gradient-to-b from-logic-lcd-green/12 via-emerald-500/5 to-transparent blur-[140px]" />
        <div className="absolute top-1/3 right-[-10%] w-[550px] h-[550px] bg-logic-lcd-amber/7 blur-[150px]" />
        <div className="absolute bottom-1/4 left-[-10%] w-[500px] h-[500px] bg-logic-lcd-green/6 blur-[130px]" />
      </div>

      {/* Topo / Barra de Navegação */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#08090b]/80 border-b border-white/[0.08]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 group">
            <VsLogo size={28} />
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm tracking-wider text-white">VS STAGE</span>
                <span className="px-1.5 py-0.2 rounded bg-logic-lcd-green/20 text-logic-lcd-green text-[10px] font-extrabold tracking-widest border border-logic-lcd-green/40">
                  PRO
                </span>
              </div>
              <span className="text-[9px] font-medium tracking-widest text-logic-text-muted">
                LIVE PERFORMANCE ENGINE
              </span>
            </div>
          </a>

          <div className="flex items-center gap-3 sm:gap-4">
            <a
              href="/"
              className="text-xs font-semibold text-logic-text-dim hover:text-white transition-colors hidden sm:inline-flex"
            >
              ← Voltar ao Início
            </a>
            <a
              href="#baixar"
              className="relative group overflow-hidden px-4 h-9.5 rounded-xl btn-neon-green text-black text-xs font-black tracking-wide flex items-center justify-center gap-1.5 transition-all hover:scale-[1.02]"
            >
              <Apple size={15} />
              <span>Baixar para Mac</span>
            </a>
          </div>
        </div>
      </header>

      {/* Hero dos Planos */}
      <section className="relative z-10 pt-14 sm:pt-20 pb-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md mb-6 animate-[fadeIn_400ms_ease-out]">
            <Sparkles size={14} className="text-logic-lcd-amber" />
            <span className="text-2xs sm:text-xs font-bold tracking-wider text-logic-text-dim uppercase">
              Planos e Assinatura Oficial
            </span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.12] max-w-3xl mx-auto">
            A potência máxima do palco <br />
            <span className="bg-gradient-to-r from-logic-lcd-green via-emerald-300 to-logic-lcd-amber bg-clip-text text-transparent">
              ao alcance da sua banda.
            </span>
          </h1>

          <p className="text-logic-text-dim text-base sm:text-lg max-w-2xl mx-auto mt-5 leading-relaxed">
            Sem pegadinhas, sem taxas escondidas e 100% livre de travamentos. Escolha a flexibilidade mês a mês ou economize com o plano anual definitivo.
          </p>

          {currentUserEmail && (
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-logic-lcd-green/10 border border-logic-lcd-green/30 text-xs text-logic-lcd-green font-medium">
              <span className="w-2 h-2 rounded-full bg-logic-lcd-green animate-pulse" />
              Conectado como <strong className="text-white">{currentUserEmail}</strong>
            </div>
          )}
        </div>

        {/* Cards de Preço: Mensal vs Anual */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
            
            {/* CARD 1: PLANO MENSAL */}
            <div className="relative rounded-3xl p-7 sm:p-9 bg-[#111218]/90 border border-white/10 backdrop-blur-xl flex flex-col justify-between transition-all duration-300 hover:border-white/20 shadow-xl">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black tracking-widest text-logic-text-muted uppercase">
                    FLEXIBILIDADE TOTAL
                  </span>
                  <span className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-2xs font-bold text-logic-text-dim">
                    Mês a Mês
                  </span>
                </div>

                <h3 className="text-2xl font-black text-white mt-3">Plano Mensal</h3>
                <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
                  Ideal para bandas e músicos que preferem assinar sem fidelidade de longo prazo.
                </p>

                {/* Bloco de Preço */}
                <div className="mt-6 pb-6 border-b border-white/[0.08]">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                      {MONTHLY_PRICE}
                    </span>
                    <span className="text-sm font-semibold text-logic-text-muted">/mês</span>
                  </div>
                  <p className="text-2xs text-logic-text-muted mt-2">
                    Cobrança recorrente mensal no cartão. Cancele quando quiser com 1 clique.
                  </p>
                </div>

                {/* Lista de Recursos Inclusos */}
                <div className="mt-6 space-y-3">
                  <div className="text-2xs font-extrabold uppercase tracking-wider text-logic-text-muted">
                    Recursos inclusos no mensal:
                  </div>
                  {[
                    'Todas as funções do motor VS Stage Pro desbloqueadas',
                    'Timeline independente por música (sem travamentos)',
                    'Mixer com canal Timecode LTC blindado (−6dB)',
                    'Split Master L/R de emergência em caso de falha de cabo',
                    'Modo Show à prova de acidentes e cliques errados',
                    'Rede local Wi-Fi sem internet (Área do Músico no celular)',
                    'Teleprompter em tela cheia na TV de palco',
                    'Suporte a Apple Silicon (M1 a M4) e Intel',
                    'Cancelamento a qualquer momento sem multa',
                  ].map((feat) => (
                    <div key={feat} className="flex items-start gap-2.5 text-xs text-logic-text">
                      <div className="w-4 h-4 rounded-full bg-white/10 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <Check size={11} />
                      </div>
                      <span className="leading-snug">{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Botão de Ação Mensal */}
              <div className="mt-8 pt-6 border-t border-white/[0.08]">
                <button
                  type="button"
                  disabled={checkoutBusy}
                  onClick={() => handleStartCheckout('monthly')}
                  className="w-full h-14 rounded-2xl bg-white/[0.08] hover:bg-white/[0.15] text-white font-extrabold text-sm border border-white/15 backdrop-blur-md transition-all duration-200 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  {checkoutBusy && selectedPlan === 'monthly' ? (
                    <Loader2 size={18} className="animate-spin text-white" />
                  ) : (
                    <CreditCard size={18} />
                  )}
                  <span>Assinar Plano Mensal ({MONTHLY_PRICE}/mês)</span>
                </button>
              </div>
            </div>

            {/* CARD 2: PLANO ANUAL (DESTAQUE MÁXIMO) */}
            <div className="relative rounded-3xl p-7 sm:p-9 bg-gradient-to-b from-[#131b15] via-[#101318] to-[#0c0e12] border-2 border-logic-lcd-green/60 shadow-[0_0_50px_rgba(48,209,88,0.18)] flex flex-col justify-between transition-all duration-300 hover:border-logic-lcd-green hover:shadow-[0_0_70px_rgba(48,209,88,0.28)]">
              {/* Badge de Destaque Flutuante */}
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-logic-lcd-green to-emerald-400 text-black text-2xs font-black tracking-wider uppercase shadow-lg shadow-logic-lcd-green/30 flex items-center gap-1.5">
                <Sparkles size={12} />
                <span>MAIS POPULAR • ECONOMIZE R$ 61/ANO</span>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black tracking-widest text-logic-lcd-green uppercase">
                    MELHOR CUSTO-BENEFÍCIO
                  </span>
                  <span className="px-3 py-1 rounded-full bg-logic-lcd-green/15 border border-logic-lcd-green/40 text-2xs font-extrabold text-logic-lcd-green">
                    12 Meses de Acesso
                  </span>
                </div>

                <h3 className="text-2xl font-black text-white mt-3 flex items-center gap-2">
                  <span>Plano Anual</span>
                  <span className="text-xs font-bold text-logic-lcd-amber bg-logic-lcd-amber/10 border border-logic-lcd-amber/30 px-2 py-0.5 rounded-full">
                    Recomendado
                  </span>
                </h3>
                <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
                  A escolha definitiva para diretores musicais, produtores e bandas com agenda de shows ativa.
                </p>

                {/* Bloco de Preço */}
                <div className="mt-6 pb-6 border-b border-logic-lcd-green/20">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                      {YEARLY_PRICE}
                    </span>
                    <span className="text-sm font-semibold text-logic-text-muted">/ano</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs font-extrabold text-logic-lcd-green bg-logic-lcd-green/15 px-2 py-0.5 rounded">
                      Equivalente a apenas {YEARLY_MONTH_EQUIV}/mês
                    </span>
                    <span className="text-2xs text-logic-text-dim line-through">
                      (R$ 660,00)
                    </span>
                  </div>
                  <p className="text-2xs text-logic-text-muted mt-2">
                    Pagamento único por 1 ano completo. Estabilidade ininterrupta para seus shows.
                  </p>
                </div>

                {/* Lista de Recursos Inclusos */}
                <div className="mt-6 space-y-3">
                  <div className="text-2xs font-extrabold uppercase tracking-wider text-logic-lcd-green flex items-center gap-1.5">
                    <Sparkles size={12} />
                    <span>Tudo do Plano Mensal, com benefícios exclusivos:</span>
                  </div>
                  {[
                    'Tudo o que o Plano Mensal oferece (sem exceção)',
                    'Economia garantida de R$ 61,00 no bolso todo ano',
                    'Sai por apenas R$ 49,92 por mês',
                    '365 dias de tranquilidade sem se preocupar com fatura mensal',
                    'Acesso prioritário a todas as novas funções e atualizações da temporada',
                    'Canal de suporte técnico humanizado e prioritário',
                    'Garantia de estabilidade ininterrupta para suas turnês',
                  ].map((feat, idx) => (
                    <div key={feat} className="flex items-start gap-2.5 text-xs text-white">
                      <div className="w-4 h-4 rounded-full bg-logic-lcd-green/20 border border-logic-lcd-green/50 text-logic-lcd-green flex items-center justify-center shrink-0 mt-0.5">
                        <Check size={11} />
                      </div>
                      <span className={`leading-snug ${idx <= 2 ? 'font-bold text-logic-lcd-green' : 'text-white'}`}>
                        {feat}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Botão de Ação Anual com Neon Glow */}
              <div className="mt-8 pt-6 border-t border-logic-lcd-green/20">
                <div className="relative group">
                  <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-logic-lcd-green via-emerald-400 to-teal-300 opacity-70 blur-lg group-hover:opacity-100 group-hover:blur-xl transition duration-500 animate-pulse pointer-events-none" />

                  <button
                    type="button"
                    disabled={checkoutBusy}
                    onClick={() => handleStartCheckout('yearly')}
                    className="relative overflow-hidden w-full h-14 rounded-2xl btn-neon-green text-black font-black text-sm flex items-center justify-center gap-2.5 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  >
                    <span className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/55 to-transparent -skew-x-12 animate-btn-sheen pointer-events-none" />
                    {checkoutBusy && selectedPlan === 'yearly' ? (
                      <Loader2 size={18} className="animate-spin text-black" />
                    ) : (
                      <Zap size={18} />
                    )}
                    <span>ASSINAR PLANO ANUAL ({YEARLY_MONTH_EQUIV}/MÊS)</span>
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Selos de Garantia e Confiança */}
      <section className="relative z-10 py-10 border-y border-white/[0.08] bg-[#0c0d12]/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
            <div className="flex flex-col items-center">
              <ShieldCheck size={26} className="text-logic-lcd-green mb-2" />
              <div className="text-xs font-bold text-white">Pagamento Seguro</div>
              <div className="text-2xs text-logic-text-dim mt-0.5">Criptografia bancária Stripe</div>
            </div>
            <div className="flex flex-col items-center">
              <Timer size={26} className="text-logic-lcd-amber mb-2" />
              <div className="text-xs font-bold text-white">Liberação Imediata</div>
              <div className="text-2xs text-logic-text-dim mt-0.5">Acesso desbloqueado na hora</div>
            </div>
            <div className="flex flex-col items-center">
              <Laptop size={26} className="text-logic-lcd-green mb-2" />
              <div className="text-xs font-bold text-white">Apple Silicon & Intel</div>
              <div className="text-2xs text-logic-text-dim mt-0.5">M1, M2, M3, M4 nativo</div>
            </div>
            <div className="flex flex-col items-center">
              <MessageCircle size={26} className="text-logic-lcd-amber mb-2" />
              <div className="text-xs font-bold text-white">Suporte ao Vivo</div>
              <div className="text-2xs text-logic-text-dim mt-0.5">Canal direto via WhatsApp</div>
            </div>
          </div>
        </div>
      </section>

      {/* Tabela Comparativa Detalhada */}
      <section className="relative z-10 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="text-2xs font-bold uppercase tracking-widest text-logic-lcd-green">
              DETALHAMENTO TÉCNICO
            </span>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-white mt-2">
              Comparativo completo dos planos
            </h2>
            <p className="text-xs sm:text-sm text-logic-text-dim mt-2">
              Veja exatamente o que você recebe em cada opção de assinatura.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#101117] overflow-hidden shadow-2xl">
            {/* Header da Tabela */}
            <div className="grid grid-cols-12 bg-white/[0.04] p-4 text-xs font-black uppercase tracking-wider text-logic-text-muted border-b border-white/10">
              <div className="col-span-6 sm:col-span-8 text-white">Recursos e Ferramentas</div>
              <div className="col-span-3 sm:col-span-2 text-center text-white/90">Mensal</div>
              <div className="col-span-3 sm:col-span-2 text-center text-logic-lcd-green">Anual</div>
            </div>

            {/* Conteúdo por Categoria */}
            {COMPARISON_FEATURES.map((cat) => (
              <div key={cat.category} className="border-b border-white/[0.06] last:border-b-0">
                <div className="px-4 py-2.5 bg-white/[0.02] text-2xs font-extrabold text-logic-text-dim tracking-wider uppercase border-b border-white/[0.04]">
                  {cat.category}
                </div>
                {cat.items.map((item) => (
                  <div
                    key={item.name}
                    className="grid grid-cols-12 px-4 py-3.5 text-xs text-logic-text border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors items-center"
                  >
                    <div className="col-span-6 sm:col-span-8 font-medium">
                      {item.name}
                      {item.note && (
                        <span className="block text-2xs text-logic-lcd-amber font-semibold mt-0.5">
                          {item.note}
                        </span>
                      )}
                    </div>
                    <div className="col-span-3 sm:col-span-2 flex justify-center">
                      {item.monthly ? (
                        <Check size={16} className="text-logic-lcd-green" />
                      ) : (
                        <span className="text-logic-text-muted text-xs">—</span>
                      )}
                    </div>
                    <div className="col-span-3 sm:col-span-2 flex justify-center">
                      {item.yearly ? (
                        <Check size={16} className="text-logic-lcd-green" />
                      ) : (
                        <span className="text-logic-text-muted text-xs">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Seção FAQ de Assinatura */}
      <section className="relative z-10 py-16 bg-[#0c0d12] border-t border-white/[0.08]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <span className="text-2xs font-bold uppercase tracking-widest text-logic-lcd-amber">
              DÚVIDAS FREQUENTES
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-2">
              Perguntas sobre a Assinatura
            </h2>
          </div>

          <div className="space-y-3">
            {PRICING_FAQS.map((faq, idx) => (
              <div
                key={faq.q}
                className="rounded-xl border border-white/10 bg-[#121319] overflow-hidden transition"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="w-full p-4.5 text-left font-bold text-sm text-white flex items-center justify-between gap-4 hover:text-logic-lcd-green transition"
                >
                  <span>{faq.q}</span>
                  <span className={`text-logic-text-muted transition-transform duration-300 ${openFaq === idx ? 'rotate-180 text-logic-lcd-green' : ''}`}>
                    ▼
                  </span>
                </button>
                {openFaq === idx && (
                  <div className="px-4.5 pb-4.5 pt-1 text-xs text-logic-text-dim leading-relaxed border-t border-white/[0.06] animate-[fadeIn_200ms_ease-out]">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* CTA Final */}
          <div className="mt-14 text-center p-8 rounded-2xl bg-gradient-to-b from-[#151a1e] to-[#0e1014] border border-white/10">
            <h3 className="text-xl font-bold text-white">Ainda tem dúvidas sobre os planos?</h3>
            <p className="text-xs text-logic-text-dim mt-1.5 max-w-md mx-auto">
              Fale diretamente com nossa equipe técnica pelo WhatsApp e tire suas dúvidas sobre seu setup.
            </p>
            <a
              href="https://wa.me/5579998144026?text=Ol%C3%A1!%20Tenho%20d%C3%BAvidas%20sobre%20os%20planos%20do%20VS%20Stage%20Pro."
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 px-5 h-10 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-bold border border-white/15 transition"
            >
              <MessageCircle size={15} className="text-logic-lcd-green" />
              <span>Chamar Suporte no WhatsApp</span>
            </a>
          </div>
        </div>
      </section>

      {/* Rodapé */}
      <footer className="relative z-10 border-t border-white/[0.08] bg-[#08090b] py-8 text-xs text-logic-text-muted">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <VsLogo size={20} />
            <span>© 2026 VS Stage Pro • Live Performance Engine</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="/" className="hover:text-white transition">Início</a>
            <a href="#baixar" className="hover:text-white transition">Download Mac</a>
            <a
              href="https://wa.me/5579998144026"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition flex items-center gap-1"
            >
              <MessageCircle size={13} /> Suporte
            </a>
          </div>
        </div>
      </footer>

      {/* MODAL DE AUTENTICAÇÃO PARA CHECKOUT */}
      {authModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-[fadeIn_200ms_ease-out]"
          onClick={() => setAuthModalOpen(false)}
        >
          <div
            className="relative w-full max-w-md bg-[#13141a] border border-white/15 rounded-2xl shadow-2xl overflow-hidden p-6 sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Fechar */}
            <button
              onClick={() => setAuthModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-logic-text-muted hover:text-white hover:bg-white/10 transition"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>

            {/* Topo do Modal */}
            <div className="text-center mb-6">
              <div className="mx-auto w-12 h-12 mb-3 rounded-2xl bg-logic-lcd-green/15 border border-logic-lcd-green/30 flex items-center justify-center text-logic-lcd-green">
                <CreditCard size={24} />
              </div>
              <h2 className="text-xl font-black text-white">
                {authMode === 'signup' ? 'Crie sua conta para assinar' : 'Entre na sua conta para assinar'}
              </h2>
              <p className="text-xs text-logic-text-dim mt-1.5">
                {selectedPlan === 'yearly'
                  ? `Você escolheu o Plano Anual (${YEARLY_PRICE}/ano)`
                  : `Você escolheu o Plano Mensal (${MONTHLY_PRICE}/mês)`}
              </p>
            </div>

            {/* Alternador Criar Conta / Entrar */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-black/40 rounded-xl mb-5 border border-white/10">
              <button
                type="button"
                onClick={() => { setAuthMode('signup'); setAuthError(null); }}
                className={`py-2 text-xs font-bold rounded-lg transition ${authMode === 'signup' ? 'bg-logic-lcd-green text-black' : 'text-logic-text-dim hover:text-white'}`}
              >
                Criar Nova Conta
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode('login'); setAuthError(null); }}
                className={`py-2 text-xs font-bold rounded-lg transition ${authMode === 'login' ? 'bg-logic-lcd-green text-black' : 'text-logic-text-dim hover:text-white'}`}
              >
                Já Tenho Conta
              </button>
            </div>

            {authError && (
              <div className="mb-4 p-3 rounded-xl bg-logic-lcd-red/15 border border-logic-lcd-red/30 text-logic-lcd-red text-xs text-center">
                {authError}
              </div>
            )}

            {authSuccessMsg ? (
              <div className="p-4 rounded-xl bg-logic-lcd-green/15 border border-logic-lcd-green/40 text-center space-y-2">
                <p className="text-xs text-logic-lcd-green font-bold">✓ {authSuccessMsg}</p>
                <p className="text-2xs text-logic-text-dim">
                  Após confirmar seu e-mail, volte aqui para prosseguir com a ativação da sua assinatura.
                </p>
              </div>
            ) : (
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-logic-text-muted mb-1.5">
                    Seu E-mail
                  </label>
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="seuemail@exemplo.com"
                    required
                    autoFocus
                    className="w-full bg-[#0a0b0f] text-sm text-white px-3.5 py-2.5 rounded-xl border border-white/15 outline-none focus:border-logic-lcd-green transition-colors placeholder:text-logic-text-muted"
                  />
                </div>

                <div>
                  <label className="block text-2xs font-bold uppercase tracking-wider text-logic-text-muted mb-1.5">
                    Sua Senha
                  </label>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    required
                    minLength={6}
                    className="w-full bg-[#0a0b0f] text-sm text-white px-3.5 py-2.5 rounded-xl border border-white/15 outline-none focus:border-logic-lcd-green transition-colors placeholder:text-logic-text-muted"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authBusy || !authEmail.trim() || authPassword.length < 6}
                  className="w-full h-12 rounded-xl btn-neon-green text-black font-black text-sm flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 mt-2"
                >
                  {authBusy ? (
                    <Loader2 size={18} className="animate-spin text-black" />
                  ) : (
                    <CreditCard size={18} />
                  )}
                  <span>
                    {authMode === 'signup'
                      ? 'Criar Conta e Prosseguir para Pagamento'
                      : 'Entrar e Prosseguir para Pagamento'}
                  </span>
                </button>
              </form>
            )}

            <div className="mt-5 text-center text-2xs text-logic-text-muted">
              Pagamento 100% criptografado e seguro processado pela Stripe.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
