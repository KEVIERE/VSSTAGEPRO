import { useEffect, useState } from 'react';
import {
  Apple,
  ArrowRight,
  CheckCircle2,
  Download,
  HelpCircle,
  Laptop,
  Layers,
  Lock,
  MessageCircle,
  MonitorPlay,
  Music,
  Radio,
  ShieldCheck,
  Sparkles,
  Wifi,
  XCircle,
} from 'lucide-react';
import VsLogo from '@/components/VsLogo';
import { supabase } from '@/lib/supabaseClient';

export default function SubscriptionReturn() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const ok = typeof window !== 'undefined' && !window.location.hash.includes('cancelada');

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
              {/* Ícone de Sucesso Animado */}
              <div className="relative mx-auto w-20 h-20 mb-6 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-logic-lcd-green/25 blur-xl animate-pulse" />
                <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-b from-[#182a1d] to-[#0e1610] border-2 border-logic-lcd-green/60 shadow-[0_0_40px_rgba(48,209,88,0.3)] flex items-center justify-center text-logic-lcd-green">
                  <CheckCircle2 size={42} strokeWidth={2.5} />
                </div>
              </div>

              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-logic-lcd-green/10 border border-logic-lcd-green/30 text-logic-lcd-green text-xs font-extrabold uppercase tracking-wider mb-4">
                <Sparkles size={14} />
                <span>Assinatura Confirmada & Ativa</span>
              </div>

              <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
                Seja muito bem-vindo ao <br />
                <span className="bg-gradient-to-r from-logic-lcd-green via-emerald-300 to-logic-lcd-amber bg-clip-text text-transparent">
                  VS Stage Pro!
                </span>
              </h1>

              <p className="text-sm sm:text-base text-logic-text-dim mt-4 leading-relaxed">
                Seu pagamento foi confirmado com sucesso pelo Stripe. Toda a potência do motor profissional de áudio, timelines independentes, Timecode LTC blindado e rede de palco já estão liberados para você.
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
                href="https://wa.me/5511932498250?text=Ol%C3%A1!%20Acabei%20de%20assinar%20o%20VS%20Stage%20Pro%20e%20gostaria%20de%20tirar%20uma%20d%C3%BAvida."
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
