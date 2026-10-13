import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Apple,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  HelpCircle,
  Laptop,
  Loader2,
  LogOut,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  Wifi,
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { downloadMacBuild, fetchMacManifest, guessMacArch, saveBlob, type MacBuild, type MacManifest } from '@/lib/macDownload';
import VsLogo from '@/components/VsLogo';
import DownloadAccess from '@/components/DownloadAccess';
import { supabase } from '@/lib/supabaseClient';

const TRUST_BADGES = [
  { icon: ShieldCheck, text: 'Download verificado com hash SHA-256' },
  { icon: Timer, text: '48h de teste grátis sem cartão de crédito' },
  { icon: Wifi, text: 'Motor 100% offline no palco via rede local' },
  { icon: Laptop, text: 'Compatível com macOS 11 (Big Sur) até macOS 15 (Sequoia)' },
];

type Status =
  | { kind: 'idle' }
  | { kind: 'downloading'; arch: MacBuild['arch']; received: number }
  | { kind: 'done'; arch: MacBuild['arch'] }
  | { kind: 'error'; arch: MacBuild['arch'] };

const CHIP_HINT: Record<MacBuild['arch'], { title: string; subtitle: string; hint: string }> = {
  arm64: {
    title: 'Apple Silicon (M1 a M4)',
    subtitle: 'Nativo ARM64 • Desempenho Máximo',
    hint: 'Para MacBook, Mac mini, Mac Studio ou iMac com processador Apple M1, M2, M3 ou M4.',
  },
  x64: {
    title: 'Processador Intel',
    subtitle: 'Compatível x86_64 • Macs 2013-2020',
    hint: 'Para computadores Apple equipados com processador Intel Core i5, i7, i9 ou Xeon.',
  },
};

const FIX_COMMAND = 'xattr -cr "/Applications/VS Stage.app" && codesign --force --deep --sign - "/Applications/VS Stage.app"';

const STEPS = [
  {
    num: '1',
    title: 'Arraste para Aplicativos',
    desc: 'Dê dois cliques no arquivo .dmg baixado. Na janela que abrir, arraste o ícone do VS Stage para dentro da pasta Aplicativos.',
  },
  {
    num: '2',
    title: 'Primeira Abertura',
    desc: 'Ejete o instalador e abra o VS Stage pelo Launchpad ou pela pasta Aplicativos. Se o Mac avisar que não pode verificar o desenvolvedor, clique em Concluído.',
  },
  {
    num: '3',
    title: 'Permissões do Sistema',
    desc: 'Vá em Ajustes do Sistema > Privacidade e Segurança, role até o aviso do VS Stage e clique em "Abrir Mesmo Assim". Quando pedir, permita Rede Local e Microfone.',
  },
];

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

export default function MacDownloadPage() {
  return <DownloadAccess>{(session) => <MacDownloadPageContent session={session} />}</DownloadAccess>;
}

function MacDownloadPageContent({ session }: { session: Session }) {
  const [manifest, setManifest] = useState<MacManifest | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [suggested] = useState(guessMacArch);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    fetchMacManifest()
      .then(setManifest)
      .catch(() => setLoadError(true));
    return () => abortRef.current?.abort();
  }, []);

  const start = async (build: MacBuild) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: 'downloading', arch: build.arch, received: 0 });
    try {
      const blob = await downloadMacBuild(
        build,
        (received) => setStatus({ kind: 'downloading', arch: build.arch, received }),
        ctrl.signal
      );
      saveBlob(blob, build.file);
      setStatus({ kind: 'done', arch: build.arch });
    } catch {
      if (!ctrl.signal.aborted) setStatus({ kind: 'error', arch: build.arch });
    }
  };

  const copyFix = async () => {
    try {
      await navigator.clipboard.writeText(FIX_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
    }
  };

  const busy = status.kind === 'downloading';

  return (
    <div
      className="min-h-screen bg-logic-bg-deep text-logic-text flex flex-col relative overflow-x-hidden selection:bg-logic-lcd-green selection:text-black"
      style={{ background: 'radial-gradient(ellipse at top, #14161f 0%, #08090c 70%)' }}
    >
      {/* Luzes neon de fundo estilo DAW */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="absolute top-0 left-1/4 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-logic-lcd-green/8 blur-[160px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-1/3 right-1/4 translate-x-1/2 w-[650px] h-[650px] rounded-full bg-logic-lcd-amber/7 blur-[180px] animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-emerald-500/5 blur-[200px]" />
      </div>

      {/* Header Superior Fixo Estilo DAW */}
      <header className="sticky top-0 z-50 bg-[#0c0d12]/85 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 group">
            <div className="transition-transform group-hover:scale-105">
              <VsLogo size={36} />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-wider text-white flex items-center gap-2">
                VS STAGE <span className="text-2xs font-black px-1.5 py-0.5 rounded bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30">PRO</span>
              </span>
              <span className="text-[9px] tracking-widest text-logic-text-muted font-semibold uppercase">
                Live Performance Engine
              </span>
            </div>
          </a>

          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-xs font-semibold text-logic-text-dim hover:text-white transition-colors hidden sm:inline-flex"
            >
              ← Voltar ao Início
            </a>

            <div className="flex items-center gap-2 pl-3 border-l border-white/10">
              <div className="text-right hidden md:block">
                <div className="text-2xs font-bold text-white truncate max-w-[160px]">{session.user.email}</div>
                <div className="text-[10px] text-logic-lcd-green font-medium">Conta Liberada</div>
              </div>

              <button
                onClick={() => supabase.auth.signOut()}
                title="Sair da conta"
                className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-logic-text-dim hover:text-white border border-white/10 transition flex items-center gap-1.5 text-xs"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="relative z-10 flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14 w-full">
        {/* Hero do Download */}
        <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md mb-6 animate-[fadeIn_400ms_ease-out]">
            <span className="w-2 h-2 rounded-full bg-logic-lcd-green animate-ping" />
            <span className="text-2xs sm:text-xs font-bold tracking-wider text-logic-text-dim uppercase">
              INSTALADOR OFICIAL PARA MACOS
            </span>
            {manifest?.version && (
              <span className="px-2 py-0.5 rounded-full bg-logic-lcd-green/15 text-logic-lcd-green text-[11px] font-black border border-logic-lcd-green/30">
                v{manifest.version}
              </span>
            )}
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.12]">
            Baixe o instalador oficial <br />
            <span className="bg-gradient-to-r from-logic-lcd-green via-emerald-300 to-logic-lcd-amber bg-clip-text text-transparent">
              e teste grátis por 48 horas.
            </span>
          </h1>

          <p className="text-logic-text-dim text-sm sm:text-base max-w-2xl mx-auto mt-4 leading-relaxed font-normal">
            Escolha o tipo de processador do seu Mac abaixo. O tempo do teste grátis só começa a ser contado a partir do momento em que você abre o aplicativo instalado no seu computador.
          </p>

          {/* Badges de Confiança */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 mt-6 text-xs text-logic-text-dim">
            {TRUST_BADGES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2">
                <Icon size={14} className="text-logic-lcd-green shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cards de Download (Apple Silicon vs Intel) */}
        <div className="max-w-4xl mx-auto mb-16">
          {!manifest && !loadError && (
            <div className="p-12 rounded-2xl border border-white/10 bg-[#121318]/90 text-center flex flex-col items-center justify-center">
              <Loader2 size={32} className="text-logic-lcd-green animate-spin mb-3" />
              <p className="text-sm font-semibold text-white">Carregando instaladores oficiais...</p>
              <p className="text-xs text-logic-text-muted mt-1">Conectando aos servidores de alta velocidade</p>
            </div>
          )}

          {loadError && (
            <div className="p-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-center flex items-center justify-center gap-3">
              <AlertTriangle size={24} className="text-rose-400 shrink-0" />
              <div className="text-left">
                <h4 className="text-sm font-bold text-white">Instalador indisponível momentaneamente</h4>
                <p className="text-xs text-logic-text-dim mt-0.5">Recarregue a página ou tente novamente em alguns instantes.</p>
              </div>
            </div>
          )}

          {manifest && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {manifest.builds.map((build) => {
                const chip = CHIP_HINT[build.arch];
                const isSuggested = suggested === build.arch;
                const mine = status.kind !== 'idle' && status.arch === build.arch;
                const isDownloading = mine && status.kind === 'downloading';
                const isDone = mine && status.kind === 'done';
                const isError = mine && status.kind === 'error';
                const pct = isDownloading ? Math.min(100, (status.received / build.size) * 100) : 0;

                return (
                  <div
                    key={build.arch}
                    className={`relative rounded-3xl p-6 sm:p-8 flex flex-col justify-between transition-all duration-300 border ${
                      isSuggested
                        ? 'bg-gradient-to-b from-[#141b16] via-[#101318] to-[#0c0e12] border-logic-lcd-green/50 shadow-[0_0_40px_rgba(48,209,88,0.14)]'
                        : 'bg-[#111218]/90 border-white/10 hover:border-white/20'
                    }`}
                  >
                    {/* Badge Recomendado */}
                    {isSuggested && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-0.5 rounded-full bg-gradient-to-r from-logic-lcd-green to-emerald-400 text-black text-2xs font-black tracking-wider uppercase shadow-md flex items-center gap-1.5">
                        <Sparkles size={11} />
                        <span>RECOMENDADO PARA O SEU MAC</span>
                      </div>
                    )}

                    <div>
                      {/* Topo do Card com Ícone e Especificação */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white shadow-inner">
                          {build.arch === 'arm64' ? <Apple size={24} /> : <Cpu size={24} />}
                        </div>

                        <span className="px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 text-2xs font-extrabold text-logic-text-dim uppercase tracking-wider">
                          {mb(build.size)}
                        </span>
                      </div>

                      <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                        {chip.title}
                      </h3>
                      <p className="text-xs font-semibold text-logic-lcd-green mt-1">
                        {chip.subtitle}
                      </p>
                      <p className="text-xs text-logic-text-dim mt-2.5 leading-relaxed">
                        {chip.hint}
                      </p>

                      {/* Informações da Build */}
                      <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-1.5 text-2xs text-logic-text-muted">
                        <div className="flex items-center justify-between">
                          <span>Arquivo:</span>
                          <span className="font-mono text-logic-text-dim">{build.file}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Segurança:</span>
                          <span className="text-logic-lcd-green font-semibold">Assinado & Verificado</span>
                        </div>
                      </div>
                    </div>

                    {/* Botão de Download */}
                    <div className="mt-8 pt-4">
                      {isDownloading ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-white">
                            <span className="flex items-center gap-1.5 text-logic-lcd-green">
                              <Loader2 size={14} className="animate-spin" />
                              Baixando...
                            </span>
                            <span>{pct.toFixed(0)}%</span>
                          </div>
                          {/* Barra de Progresso */}
                          <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden relative">
                            <div
                              className="h-full bg-gradient-to-r from-logic-lcd-green to-emerald-400 rounded-full transition-all duration-200"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-2xs text-logic-text-muted text-center mt-1">
                            {mb(status.received)} de {mb(build.size)} baixados
                          </p>
                        </div>
                      ) : isDone ? (
                        <div className="p-3.5 rounded-2xl bg-logic-lcd-green/15 border border-logic-lcd-green/30 text-center space-y-1">
                          <p className="text-xs font-bold text-logic-lcd-green flex items-center justify-center gap-1.5">
                            <CheckCircle2 size={16} /> Download concluído com sucesso!
                          </p>
                          <p className="text-2xs text-logic-text-dim">
                            Abra a pasta <strong>Downloads</strong> e dê dois cliques no arquivo .dmg.
                          </p>
                        </div>
                      ) : isError ? (
                        <div className="space-y-2">
                          <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-400 text-center">
                            Falha ao baixar. Verifique a conexão e tente novamente.
                          </div>
                          <button
                            onClick={() => start(build)}
                            className="w-full h-12 rounded-2xl bg-logic-lcd-green hover:brightness-110 text-black font-extrabold text-xs flex items-center justify-center gap-2 transition"
                          >
                            <RotateCcw size={16} /> Tentar novamente
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => start(build)}
                          disabled={busy}
                          className={`relative overflow-hidden w-full h-14 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
                            isSuggested
                              ? 'btn-neon-green text-black'
                              : 'bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/15'
                          }`}
                        >
                          {isSuggested && (
                            <span className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/55 to-transparent -skew-x-12 animate-btn-sheen pointer-events-none" />
                          )}
                          <Download size={18} />
                          <span>BAIXAR PARA {chip.title.toUpperCase()}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Guia de Instalação Passo a Passo */}
        <div className="max-w-4xl mx-auto rounded-3xl border border-white/10 bg-[#0f1015]/90 backdrop-blur-xl p-6 sm:p-10 shadow-2xl">
          <div className="flex items-center gap-2.5 mb-2">
            <FolderOpen size={20} className="text-logic-lcd-amber" />
            <h2 className="text-lg sm:text-xl font-extrabold text-white">
              Como instalar no seu Mac (Passo a Passo)
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-logic-text-dim mb-8">
            Siga os passos abaixo na primeira vez que for abrir o programa.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div
                key={s.num}
                className="p-5 rounded-2xl bg-[#14151c] border border-white/[0.08] flex flex-col justify-between"
              >
                <div>
                  <div className="w-8 h-8 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green font-black text-sm flex items-center justify-center mb-3">
                    {s.num}
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1.5">{s.title}</h3>
                  <p className="text-xs text-logic-text-dim leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Ajuda do macOS Gatekeeper / Terminal */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-[#090a0d] overflow-hidden shadow-xl">
            {/* Barra superior estilo Terminal Mac */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block" />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block" />
                <span className="ml-2 text-2xs font-mono text-logic-text-muted flex items-center gap-1.5">
                  <Terminal size={12} />
                  Terminal — Ajuda de Instalação macOS
                </span>
              </div>
              <span className="text-2xs text-logic-lcd-amber font-semibold">Gatekeeper Fix</span>
            </div>

            <div className="p-5 sm:p-6">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <HelpCircle size={16} className="text-logic-lcd-amber" />
                Apareceu o aviso "O aplicativo está danificado e não pode ser aberto"?
              </h4>
              <p className="text-xs text-logic-text-dim mt-2 leading-relaxed">
                Isso é uma proteção comum do macOS chamada Gatekeeper para programas profissionais distribuídos fora da Mac App Store. Basta abrir o aplicativo <strong>Terminal</strong> do Mac, colar o comando abaixo e apertar Enter:
              </p>

              <div className="mt-4 flex flex-col sm:flex-row items-stretch gap-2.5">
                <div className="flex-1 min-w-0 bg-black/60 rounded-xl border border-white/10 px-4 py-3 flex items-center overflow-x-auto">
                  <code className="text-xs font-mono text-logic-lcd-green whitespace-nowrap">
                    {FIX_COMMAND}
                  </code>
                </div>

                <button
                  type="button"
                  onClick={copyFix}
                  className="px-5 h-12 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-white border border-white/15 text-xs font-bold flex items-center justify-center gap-2 transition shrink-0 active:scale-95"
                >
                  {copied ? <Check size={16} className="text-logic-lcd-green" /> : <Copy size={16} />}
                  <span>{copied ? 'Copiado!' : 'Copiar Comando'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Rodapé */}
      <footer className="relative z-10 border-t border-white/[0.08] bg-[#08090b] py-8 text-xs text-logic-text-muted mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <VsLogo size={24} />
            <span className="font-bold text-white">VS STAGE PRO</span>
            <span className="text-logic-text-dim">© 2026 Todos os direitos reservados.</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="/" className="hover:text-white transition">Página Inicial</a>
            <a href="#planos" className="hover:text-white transition">Planos & Preços</a>
            <button onClick={() => supabase.auth.signOut()} className="hover:text-white transition">Sair da Conta</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
