import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Cpu, Download, Laptop, Loader2, LogOut, MonitorPlay, RotateCcw } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { downloadMacBuild, fetchMacManifest, guessMacArch, saveBlob, type MacBuild, type MacManifest } from '@/lib/macDownload';
import VsLogo from '@/components/VsLogo';
import DownloadAccess from '@/components/DownloadAccess';
import { supabase } from '@/lib/supabaseClient';

type Status =
  | { kind: 'idle' }
  | { kind: 'downloading'; arch: MacBuild['arch']; received: number }
  | { kind: 'done'; arch: MacBuild['arch'] }
  | { kind: 'error'; arch: MacBuild['arch'] };

const CHIP_HINT: Record<MacBuild['arch'], { title: string; hint: string }> = {
  arm64: { title: 'Mac com chip Apple (M1 a M4)', hint: 'Aparece "Chip Apple M..." em Sobre Este Mac' },
  x64: { title: 'Mac com processador Intel', hint: 'Aparece "Processador Intel" em Sobre Este Mac' },
};

const FIX_COMMAND = 'xattr -cr "/Applications/VS Stage.app" && codesign --force --deep --sign - "/Applications/VS Stage.app"';

const STEPS = [
  'Abra o arquivo baixado. Vai aparecer uma janela com o VS Stage e a pasta Aplicativos: arraste o ícone do VS Stage para cima da pasta Aplicativos.',
  'Espere a cópia terminar e ejete o disco "VS Stage" (no Finder, clique na setinha ao lado dele).',
  'Abra o VS Stage pelo Launchpad ou pela pasta Aplicativos. Se o Mac avisar que não pode verificar o desenvolvedor, clique em OK ou Concluído.',
  'Vá em Ajustes do Sistema > Privacidade e Segurança, role até o aviso do VS Stage e clique em Abrir Mesmo Assim. Isso só acontece na primeira vez.',
  'Quando o Mac pedir, permita Rede Local e Microfone.',
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
    fetchMacManifest().then(setManifest).catch(() => setLoadError(true));
    return () => abortRef.current?.abort();
  }, []);

  const start = async (build: MacBuild) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: 'downloading', arch: build.arch, received: 0 });
    try {
      const blob = await downloadMacBuild(build, (received) => setStatus({ kind: 'downloading', arch: build.arch, received }), ctrl.signal);
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
    } catch { /* sem permissão de copiar: o comando continua visível */ }
  };

  const busy = status.kind === 'downloading';

  return (
    <div className="min-h-screen bg-logic-bg-deep text-logic-text flex items-center justify-center px-4 py-12"
      style={{ background: 'radial-gradient(ellipse at top, #1b1c20 0%, #0a0b0d 70%)' }}>
      <div className="w-full max-w-xl animate-[fadeIn_250ms_ease-out]">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 text-xs text-logic-text-dim">
            <VsLogo size={22} />
            <Laptop size={14} className="text-logic-lcd-green" /> VS Stage para Mac
            {manifest && <span className="text-logic-lcd-amber font-semibold">v{manifest.version}</span>}
            {manifest?.published && !Number.isNaN(Date.parse(manifest.published)) && (
              <span className="text-logic-text-muted">
                · publicado em {new Date(manifest.published).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            title="Sair da conta"
            className="flex items-center gap-1.5 text-2xs text-logic-text-muted hover:text-logic-text transition shrink-0"
          >
            <span className="truncate max-w-[140px]">{session.user.email}</span>
            <LogOut size={12} />
          </button>
        </div>
        <h1 className="text-3xl font-semibold leading-tight">Baixar o instalador</h1>
        <p className="text-sm text-logic-text-dim mt-2 leading-relaxed">
          Escolha o tipo do seu Mac. Para saber, clique no menu Apple e em <span className="text-logic-text">Sobre Este Mac</span>: aparece "Chip Apple M..." ou "Processador Intel". Funciona no macOS 11 (Big Sur) ou mais novo.
        </p>

        <div className="mt-8 space-y-3">
          {!manifest && !loadError && (
            <div className="flex items-center gap-2 text-sm text-logic-text-dim py-6"><Loader2 size={16} className="animate-spin" /> Buscando instaladores...</div>
          )}
          {loadError && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-logic-lcd-red/40 bg-logic-lcd-red/10 text-sm">
              <AlertTriangle size={18} className="text-logic-lcd-red shrink-0 mt-0.5" />
              Não foi possível carregar os instaladores agora. Verifique a internet e recarregue a página.
            </div>
          )}
          {manifest?.builds.map((build) => {
            const chip = CHIP_HINT[build.arch];
            const mine = status.kind !== 'idle' && status.arch === build.arch;
            const pct = mine && status.kind === 'downloading' ? Math.min(100, (status.received / build.size) * 100) : 0;
            return (
              <div key={build.arch}
                className={`relative overflow-hidden rounded-xl border bg-logic-bg-panel transition-colors ${suggested === build.arch ? 'border-logic-lcd-green/50' : 'border-logic-border'}`}>
                <div className="flex items-center gap-4 p-4">
                  <span className="w-11 h-11 rounded-lg flex items-center justify-center bg-logic-bg-elevated text-logic-lcd-green"><Cpu size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{chip.title}</span>
                      {suggested === build.arch && <span className="text-[10px] uppercase tracking-wider text-logic-lcd-green bg-logic-lcd-green/15 rounded px-1.5 py-0.5">para o seu Mac</span>}
                    </div>
                    <div className="text-xs text-logic-text-dim mt-0.5">{chip.hint} · {mb(build.size)}</div>
                    {mine && status.kind === 'downloading' && (
                      <div className="text-xs text-logic-text-dim mt-1">Baixando {mb(status.received)} de {mb(build.size)}...</div>
                    )}
                    {mine && status.kind === 'done' && (
                      <div className="flex items-center gap-1 text-xs text-logic-lcd-green mt-1"><CheckCircle2 size={12} /> Baixado e conferido. Veja na pasta Downloads.</div>
                    )}
                    {mine && status.kind === 'error' && (
                      <div className="flex items-center gap-1 text-xs text-logic-lcd-red mt-1"><AlertTriangle size={12} /> O download falhou. Tente de novo.</div>
                    )}
                  </div>
                  <button
                    onClick={() => start(build)}
                    disabled={busy}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-logic-lcd-green text-black hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {mine && busy ? <Loader2 size={15} className="animate-spin" /> : mine && status.kind === 'error' ? <RotateCcw size={15} /> : <Download size={15} />}
                    {mine && busy ? `${pct.toFixed(0)}%` : 'Baixar'}
                  </button>
                </div>
                {mine && busy && (
                  <div className="absolute bottom-0 left-0 h-0.5 bg-logic-lcd-green transition-[width] duration-200" style={{ width: `${pct}%` }} />
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-10">
          <div className="mt-8 p-4 rounded-xl border border-logic-lcd-green/30 bg-logic-lcd-green/5 text-xs text-logic-text-dim leading-relaxed flex gap-3">
          <MonitorPlay size={16} className="text-logic-lcd-green shrink-0 mt-0.5" />
          Depois de instalar, crie sua conta na tela de boas-vindas e comece seu <span className="font-semibold text-logic-text">teste grátis</span> na hora. <span className="font-semibold text-logic-text">Sem cartão.</span>
        </div>
        <h2 className="text-sm font-semibold mb-3">Primeira abertura</h2>
          <ol className="space-y-2">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-logic-text-dim leading-relaxed">
                <span className="w-5 h-5 shrink-0 rounded-full bg-logic-bg-elevated text-logic-text text-[11px] flex items-center justify-center mt-0.5">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-logic-border bg-logic-bg-panel p-4">
            <div className="text-sm font-semibold">Apareceu "está danificado"?</div>
            <p className="text-xs text-logic-text-dim mt-1 leading-relaxed">
              Clique em Cancelar (não mova para o Lixo). Depois abra o Terminal, cole o comando abaixo, aperte Enter e abra o VS Stage de novo.
            </p>
            <div className="mt-3 flex items-stretch gap-2">
              <code className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap rounded-lg bg-logic-bg-deep px-3 py-2 text-[11px] text-logic-text-dim">{FIX_COMMAND}</code>
              <button onClick={copyFix}
                className="flex items-center gap-1.5 shrink-0 px-3 rounded-lg text-xs font-semibold bg-logic-bg-elevated text-logic-text hover:brightness-125 active:scale-[0.98] transition-all">
                {copied ? <Check size={13} className="text-logic-lcd-green" /> : <Copy size={13} />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
