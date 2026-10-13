import { useEffect, useState } from 'react';
import { Apple, CheckCircle2, ChevronRight, Download, ExternalLink, Loader2, Mic2, MonitorPlay, Radio, Sparkles, Timer } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import VsLogo from '@/components/VsLogo';

const BENEFITS = [
  { icon: Mic2, title: 'Multitracks & LTC', desc: 'Editor completo com timecode e roteamento de áudio' },
  { icon: Radio, title: 'Modo Show Protegido', desc: 'Troca instantânea de músicas e controle seguro no palco' },
  { icon: MonitorPlay, title: 'Rede Local & Letras', desc: 'Área do músico no celular e teleprompter em tela cheia' },
];

export default function EmailConfirmedPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setLoading(false);
    });
  }, []);

  return (
    <div
      className="min-h-screen bg-logic-bg-deep text-logic-text flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at top, #181920 0%, #08090b 75%)' }}
    >
      {/* Luzes de fundo em verde neon e âmbar */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[620px] h-[620px] rounded-full bg-logic-lcd-green/10 blur-[130px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-logic-lcd-amber/5 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-lg bg-logic-bg-panel/90 backdrop-blur-xl border border-logic-border-light rounded-2xl shadow-2xl overflow-hidden animate-[fadeIn_300ms_ease-out]">
        {/* Barra superior estilo DAW */}
        <div className="flex items-center justify-between px-5 h-11 border-b border-logic-border bg-logic-bg-elevated/70">
          <div className="flex items-center gap-2">
            <VsLogo size={20} />
            <span className="text-2xs font-extrabold tracking-wider text-logic-text">VS STAGE PRO</span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-logic-lcd-green/15 text-logic-lcd-green text-2xs font-bold tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-green animate-pulse" />
            CONTA ATIVADA
          </span>
        </div>

        <div className="p-6 sm:p-8 text-center">
          {/* Ícone de Sucesso */}
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-logic-lcd-green/15 border border-logic-lcd-green/30 flex items-center justify-center shadow-lg shadow-logic-lcd-green/10">
            <CheckCircle2 size={34} className="text-logic-lcd-green" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            E-mail confirmado com sucesso!
          </h1>

          <p className="text-sm text-logic-text-dim mt-2.5 max-w-md mx-auto leading-relaxed">
            {loading ? (
              <span className="inline-flex items-center gap-1.5 text-logic-text-muted">
                <Loader2 size={13} className="animate-spin" /> Carregando sua conta...
              </span>
            ) : email ? (
              <>Sua conta <span className="font-semibold text-logic-text underline decoration-logic-lcd-green/40 underline-offset-4">{email}</span> foi verificada e seu acesso está liberado.</>
            ) : (
              <>Sua conta foi verificada com sucesso e seu acesso está 100% liberado.</>
            )}
          </p>

          {/* Destaque do Teste Grátis */}
          <div className="mt-5 p-3.5 rounded-xl bg-logic-bg-elevated/80 border border-logic-border flex items-center justify-center gap-2.5 text-xs text-logic-text">
            <Timer size={16} className="text-logic-lcd-amber shrink-0" />
            <span>
              <strong className="text-logic-lcd-amber">Teste grátis</strong> liberado. O tempo só começa a contar quando você abrir o aplicativo no Mac!
            </span>
          </div>

          {/* Botões de Ação */}
          <div className="mt-6 space-y-2.5">
            <a
              href="/#baixar"
              className="w-full h-12 rounded-xl bg-gradient-to-r from-logic-lcd-green to-emerald-500 hover:from-emerald-400 hover:to-logic-lcd-green text-black font-bold text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-logic-lcd-green/20 group"
            >
              <Apple size={18} className="transition-transform group-hover:scale-110" />
              <span>Baixar o VS Stage para Mac</span>
              <ChevronRight size={16} className="ml-0.5 opacity-70 group-hover:translate-x-0.5 transition-transform" />
            </a>

            <a
              href="/"
              className="w-full h-10 rounded-xl bg-logic-bg-elevated hover:bg-logic-bg-panel-light text-logic-text-dim hover:text-logic-text text-xs font-semibold flex items-center justify-center gap-1.5 transition border border-logic-border"
            >
              <span>Conhecer todos os recursos no site</span>
              <ExternalLink size={12} className="opacity-60" />
            </a>
          </div>

          {/* Recursos Liberados */}
          <div className="mt-7 pt-6 border-t border-logic-border text-left">
            <div className="text-2xs font-bold uppercase tracking-wider text-logic-text-muted mb-3 flex items-center gap-1.5">
              <Sparkles size={11} className="text-logic-lcd-green" />
              Recursos inclusos no seu acesso:
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {BENEFITS.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3 p-2.5 rounded-lg bg-logic-bg-deep/50 border border-logic-border/50">
                  <div className="p-1.5 rounded-md bg-logic-lcd-green/10 text-logic-lcd-green shrink-0 mt-0.5">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-logic-text">{title}</div>
                    <div className="text-2xs text-logic-text-muted leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rodapé do Card */}
        <div className="px-6 py-3 bg-logic-bg-deep/80 border-t border-logic-border flex items-center justify-between text-2xs text-logic-text-muted">
          <span>© 2026 VS Stage</span>
          <span className="text-logic-text-dim">Live Performance Engine</span>
        </div>
      </div>
    </div>
  );
}
