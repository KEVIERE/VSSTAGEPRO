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
    <div className="min-h-screen bg-[#000000] text-[#f5f5f7] font-sans flex flex-col relative overflow-x-hidden selection:bg-[#0071e3] selection:text-white antialiased">
      {/* Glow atmosférico suave estilo Apple */}
      <div className="hidden sm:block fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-gradient-to-b from-[#0071e3]/10 via-emerald-500/5 to-transparent blur-[140px]" />
      </div>

      {/* Header Superior Fixo Estilo Apple */}
      <header className="sticky top-0 z-50 bg-[#000000]/80 backdrop-blur-xl border-b border-white/[0.12]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5 group">
            <VsLogo size={24} />
            <span className="text-white font-semibold text-sm tracking-tight">VS Stage Pro</span>
          </a>

          <div className="flex items-center gap-4">
            <a
              href="/"
              className="text-xs font-medium text-[#86868b] hover:text-white transition-colors hidden sm:inline-flex"
            >
              ← Voltar ao Início
            </a>

            <div className="flex items-center gap-2 pl-3 border-l border-white/10">
              <div className="text-right hidden md:block">
                <div className="text-2xs font-bold text-white truncate max-w-[160px]">{session.user.email}</div>
                <div className="text-[10px] text-emerald-400 font-medium">Conta Liberada</div>
              </div>

              <button
                onClick={() => supabase.auth.signOut()}
                title="Sair da conta"
                className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-[#86868b] hover:text-white border border-white/10 transition flex items-center gap-1.5 text-xs"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Sair</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="relative z-10 flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 w-full">
        {/* Hero do Download - Estilo Apple */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <div className="mx-auto w-16 h-16 mb-6 drop-shadow-[0_12px_24px_rgba(255,159,10,0.25)]">
            <VsLogo size={64} />
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold tracking-wide text-[#86868b] uppercase">
              Instalador Oficial para macOS
            </span>
            {manifest?.version && (
              <span className="px-2 py-0.5 rounded-full bg-[#0071e3]/15 text-[#2997ff] text-[10px] font-bold">
                v{manifest.version}
              </span>
            )}
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-[1.08]">
            Baixe e teste grátis <br className="hidden sm:block" />
            por 48 horas.
          </h1>

          <p className="text-[#86868b] text-base sm:text-lg max-w-2xl mx-auto mt-5 leading-relaxed">
            Escolha o tipo de processador do seu Mac abaixo. O tempo do teste grátis só começa a ser contado a partir do momento em que você abre o aplicativo instalado no seu computador.
          </p>

          {/* Badges de Confiança */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5 mt-8 text-xs text-[#86868b]">
            {TRUST_BADGES.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2">
                <Icon size={14} className="text-emerald-400 shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cards de Download (Apple Silicon vs Intel) */}
        <div className="max-w-4xl mx-auto mb-16">
          {!manifest && !loadError && (
            <div className="p-12 rounded-2xl border border-white/10 bg-[#161618] text-center flex flex-col items-center justify-center">
              <Loader2 size={32} className="text-[#2997ff] animate-spin mb-3" />
              <p className="text-sm font-semibold text-white">Carregando instaladores oficiais...</p>
              <p className="text-xs text-[#86868b] mt-1">Conectando aos servidores de alta velocidade</p>
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
                        ? 'bg-gradient-to-b from-[#1a1c24] via-[#161618] to-[#101116] border-[#0071e3]/60 shadow-[0_0_40px_rgba(0,113,227,0.2)]'
                        : 'bg-[#161618] border-white/10 hover:border-white/20'
                    }`}
                  >
                    {/* Badge Recomendado */}
                    {isSuggested && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3.5 py-0.5 rounded-full bg-[#0071e3] text-white text-2xs font-bold tracking-wide uppercase shadow-md flex items-center gap-1.5">
                        <span>Recomendado para o seu Mac</span>
                      </div>
                    )}

                    <div>
                      {/* Topo do Card com Ícone e Especificação */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-white shadow-inner">
                          {build.arch === 'arm64' ? <Apple size={24} /> : <Cpu size={24} />}
                        </div>

                        <span className="px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 text-2xs font-bold text-[#86868b] uppercase tracking-wider">
                          {mb(build.size)}
                        </span>
                      </div>

                      <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                        {chip.title}
                      </h3>
                      <p className="text-xs font-semibold text-[#2997ff] mt-1">
                        {chip.subtitle}
                      </p>
                      <p className="text-xs text-[#86868b] mt-2.5 leading-relaxed">
                        {chip.hint}
                      </p>

                      {/* Informações da Build */}
                      <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-1.5 text-2xs text-[#6e6e73]">
                        <div className="flex items-center justify-between">
                          <span>Arquivo:</span>
                          <span className="font-mono text-[#86868b]">{build.file}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Segurança:</span>
                          <span className="text-emerald-400 font-semibold">Assinado & Verificado</span>
                        </div>
                      </div>
                    </div>

                    {/* Botão de Download */}
                    <div className="mt-8 pt-4">
                      {isDownloading ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-white">
                            <span className="flex items-center gap-1.5 text-[#2997ff]">
                              <Loader2 size={14} className="animate-spin" />
                              Baixando...
                            </span>
                            <span>{pct.toFixed(0)}%</span>
                          </div>
                          {/* Barra de Progresso */}
                          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden relative">
                            <div
                              className="h-full bg-[#0071e3] rounded-full transition-all duration-200"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-2xs text-[#6e6e73] text-center mt-1">
                            {mb(status.received)} de {mb(build.size)} baixados
                          </p>
                        </div>
                      ) : isDone ? (
                        <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-center space-y-1">
                          <p className="text-xs font-bold text-emerald-400 flex items-center justify-center gap-1.5">
                            <CheckCircle2 size={16} /> Download concluído com sucesso!
                          </p>
                          <p className="text-2xs text-[#86868b]">
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
                            className="w-full h-12 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white font-semibold text-xs flex items-center justify-center gap-2 transition"
                          >
                            <RotateCcw size={16} /> Tentar novamente
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => start(build)}
                          disabled={busy}
                          className={`relative overflow-hidden w-full h-13 rounded-full font-bold text-sm tracking-tight flex items-center justify-center gap-2.5 transition-all duration-300 active:scale-[0.98] ${
                            isSuggested
                              ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-lg shadow-[#0071e3]/30'
                              : 'bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/15'
                          }`}
                        >
                          <Download size={18} />
                          <span>Baixar para {chip.title} (.dmg)</span>
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
        <div className="max-w-4xl mx-auto rounded-3xl border border-white/10 bg-[#161618] p-6 sm:p-10">
          <div className="flex items-center gap-2.5 mb-2">
            <FolderOpen size={20} className="text-[#ff9f0a]" />
            <h2 className="text-lg sm:text-xl font-extrabold text-white">
              Como instalar no seu Mac (Passo a Passo)
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-[#86868b] mb-8">
            Siga os passos abaixo na primeira vez que for abrir o programa.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STEPS.map((s) => (
              <div
                key={s.num}
                className="p-5 rounded-2xl bg-[#1d1d1f] border border-white/[0.08] flex flex-col justify-between"
              >
                <div>
                  <div className="w-8 h-8 rounded-xl bg-[#0071e3]/15 text-[#2997ff] font-bold text-sm flex items-center justify-center mb-3">
                    {s.num}
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1.5">{s.title}</h3>
                  <p className="text-xs text-[#86868b] leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Ajuda do macOS Gatekeeper / Terminal */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-[#0a0a0c] overflow-hidden">
            {/* Barra superior estilo Terminal Mac */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block" />
                <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block" />
                <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block" />
                <span className="ml-2 text-2xs font-mono text-[#86868b] flex items-center gap-1.5">
                  <Terminal size={12} />
                  Terminal — Ajuda de Instalação macOS
                </span>
              </div>
              <span className="text-2xs text-[#ff9f0a] font-semibold">Gatekeeper Fix</span>
            </div>

            <div className="p-5 sm:p-6">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <HelpCircle size={16} className="text-[#ff9f0a]" />
                Apareceu o aviso "O aplicativo está danificado e não pode ser aberto"?
              </h4>
              <p className="text-xs text-[#86868b] mt-2 leading-relaxed">
                Isso é uma proteção comum do macOS chamada Gatekeeper para programas profissionais distribuídos fora da Mac App Store. Basta abrir o aplicativo <strong>Terminal</strong> do Mac, colar o comando abaixo e apertar Enter:
              </p>

              <div className="mt-4 flex flex-col sm:flex-row items-stretch gap-2.5">
                <div className="flex-1 min-w-0 bg-black/60 rounded-xl border border-white/10 px-4 py-3 flex items-center overflow-x-auto">
                  <code className="text-xs font-mono text-emerald-400 whitespace-nowrap">
                    {FIX_COMMAND}
                  </code>
                </div>

                <button
                  type="button"
                  onClick={copyFix}
                  className="px-5 h-12 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-white border border-white/15 text-xs font-bold flex items-center justify-center gap-2 transition shrink-0 active:scale-95"
                >
                  {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                  <span>{copied ? 'Copiado!' : 'Copiar Comando'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Rodapé */}
      <footer className="relative z-10 border-t border-white/[0.1] bg-[#000000] py-8 text-xs text-[#86868b] mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <VsLogo size={24} />
            <span className="font-bold text-white">VS Stage Pro</span>
            <span className="text-[#6e6e73]">© 2026 Todos os direitos reservados.</span>
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
