import { useState } from 'react';
import {
  Clapperboard, Copy, Globe, KeyRound, Laptop, Loader2, MonitorPlay, Music, RefreshCw, Router, Smartphone, UserX, Wifi, WifiOff, X,
} from 'lucide-react';
import type { LocalBroadcast } from '@/lib/useLocalBroadcast';
import { ROLE_LABEL, type LocalRole, type PinRole } from '@/lib/localNetwork';
import NetworkAssistant from '@/components/network/NetworkAssistant';

const ROLE_ICON: Record<LocalRole, typeof Music> = { musician: Music, producer: Clapperboard, screen: MonitorPlay };
const ROLE_TONE: Record<LocalRole, string> = {
  musician: 'text-logic-lcd-green bg-logic-lcd-green/15',
  producer: 'text-logic-accent-hover bg-logic-accent/15',
  screen: 'text-logic-lcd-amber bg-logic-lcd-amber/15',
};

export default function LocalNetworkDialog({ local, onClose }: { local: LocalBroadcast; onClose: () => void }) {
  const [view, setView] = useState<'main' | 'assistant'>('main');

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 animate-[fadeIn_150ms_ease-out]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-xl overflow-hidden">
        <header className="flex items-center gap-3 px-5 h-14 border-b border-logic-border-dark shrink-0">
          <div className="w-8 h-8 rounded-lg bg-logic-accent/15 text-logic-accent-hover flex items-center justify-center">
            {view === 'assistant' ? <Router size={16} /> : <Wifi size={16} />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-logic-text">{view === 'assistant' ? 'Configurar Rede' : 'Rede Local do palco'}</h2>
            <p className="text-2xs text-logic-text-dim">Músicos, produtor e tela do palco sem precisar de internet</p>
          </div>
          {view === 'assistant' && (
            <button className="px-2.5 h-7 rounded text-xs text-logic-text-dim hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors" onClick={() => setView('main')}>
              Voltar
            </button>
          )}
          <button className="p-1.5 rounded text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto logic-scroll">
          {!local.available ? <MacOnly /> : view === 'assistant' ? <NetworkAssistant /> : <MainView local={local} onAssistant={() => setView('assistant')} />}
        </div>
      </div>
    </div>
  );
}

function MacOnly() {
  return (
    <div className="p-6 sm:p-8">
      <div className="flex items-start gap-4 p-4 rounded-lg bg-logic-accent/10 border border-logic-accent/30">
        <Laptop size={22} className="text-logic-accent-hover shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-logic-text">Disponível no app de Mac</p>
          <p className="text-xs text-logic-text-dim mt-1 leading-relaxed">
            A Rede Local precisa do programa instalado no Mac, que cria um pequeno servidor dentro dele.
            Aqui no navegador continue usando o Show Online, que funciona pela internet.
          </p>
        </div>
      </div>
      <h3 className="text-xs font-semibold text-logic-text mt-6 mb-3">Como vai funcionar no Mac</h3>
      <ol className="space-y-3">
        {[
          ['Ligue o roteador do palco', 'Não precisa ter internet. O Mac e os aparelhos só precisam estar no mesmo Wi-Fi.'],
          ['Escolha Rede Local', 'Pela setinha ao lado do botão Show Online ou pelo menu Arquivo.'],
          ['Mostre os QR codes', 'Músicos, produtor e a TV do palco escaneiam e entram na hora, cada um com seu PIN.'],
          ['Use Configurar Rede', 'O programa testa tudo e avisa com "Rede pronta" quando estiver funcionando.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-logic-bg-deep border border-logic-border text-2xs font-semibold text-logic-text-dim flex items-center justify-center">{i + 1}</span>
            <span>
              <span className="block text-xs font-medium text-logic-text">{t}</span>
              <span className="block text-2xs text-logic-text-dim leading-relaxed mt-0.5">{d}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MainView({ local, onAssistant }: { local: LocalBroadcast; onAssistant: () => void }) {
  const info = local.info;

  if (local.mode !== 'local') {
    return (
      <div className="p-8 text-center">
        <Globe size={28} className="mx-auto text-logic-text-muted" />
        <p className="text-sm text-logic-text mt-3">Você está no modo Show Online.</p>
        <button className="mt-4 px-4 h-8 rounded bg-logic-accent text-white text-xs font-medium hover:brightness-110 transition" onClick={() => local.setMode('local')}>
          Ligar a Rede Local
        </button>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="p-10 flex flex-col items-center gap-3 text-logic-text-dim text-xs">
        {local.error ? <WifiOff size={24} className="text-logic-lcd-red" /> : <Loader2 size={24} className="animate-spin text-logic-accent" />}
        {local.error ?? 'Ligando a rede local...'}
      </div>
    );
  }

  const address = info.hostName ? `${info.hostName}:${info.port}` : info.addresses[0] ? `${info.addresses[0]}:${info.port}` : null;

  return (
    <div className="p-5 space-y-5">
      <div className={`flex flex-wrap items-center gap-3 p-3 rounded-lg border ${info.running && !local.error ? 'bg-logic-lcd-green/10 border-logic-lcd-green/30' : 'bg-logic-lcd-red/10 border-logic-lcd-red/30'}`}>
        <span className="relative flex h-2 w-2">
          {info.running && !local.error && <span className="absolute inline-flex h-full w-full rounded-full bg-logic-lcd-green opacity-60 animate-ping" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${info.running && !local.error ? 'bg-logic-lcd-green' : 'bg-logic-lcd-red'}`} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-logic-text">{local.error ? 'A rede local está com problema' : info.running ? 'Rede local ligada' : 'Rede local desligada'}</p>
          <p className="text-2xs text-logic-text-dim mt-0.5 truncate">
            {local.error ?? (address ? <>Endereço: <span className="text-logic-text font-mono">{address}</span>{info.addresses.length > 0 && info.hostName && <> · IP {info.addresses.join(', ')}</>}</> : 'O Mac ainda não está em nenhuma rede.')}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 h-7 rounded bg-logic-bg-deep border border-logic-border text-xs text-logic-text hover:border-logic-accent/60 hover:bg-logic-bg-panel-light transition-colors"
          onClick={onAssistant}
        >
          <Router size={13} /> Configurar Rede
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(['musician', 'producer', 'screen'] as LocalRole[]).map((role) => (
          <AccessCard key={role} role={role} url={info.urls[role]} qr={info.qr[role]} pin={role === 'screen' ? null : info.pins[role]} onRegenerate={role === 'screen' ? null : () => local.regeneratePin(role as PinRole)} />
        ))}
      </div>

      <section>
        <h3 className="text-xs font-semibold text-logic-text mb-2">Conectados agora <span className="text-logic-text-muted font-normal">({info.clients.length})</span></h3>
        {info.clients.length === 0 ? (
          <p className="text-2xs text-logic-text-muted py-4 text-center border border-dashed border-logic-border rounded-lg">
            Ninguém conectado ainda. Peça para escanearem o QR code no mesmo Wi-Fi.
          </p>
        ) : (
          <ul className="divide-y divide-logic-border-dark border border-logic-border-dark rounded-lg overflow-hidden">
            {info.clients.map((c) => {
              const Icon = ROLE_ICON[c.role];
              return (
                <li key={c.id} className="group flex items-center gap-3 px-3 py-2 bg-logic-bg-deep/40">
                  <span className={`w-7 h-7 rounded-md flex items-center justify-center ${ROLE_TONE[c.role]}`}><Icon size={13} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-logic-text truncate">{c.name}</p>
                    <p className="text-2xs text-logic-text-muted">{ROLE_LABEL[c.role]} · {c.address}</p>
                  </div>
                  <button
                    className="flex items-center gap-1 px-2 h-6 rounded text-2xs text-logic-text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-logic-lcd-red hover:bg-logic-lcd-red/10 transition-all"
                    onClick={() => local.kick(c.id)}
                    title="Desconectar este aparelho"
                  >
                    <UserX size={12} /> Desconectar
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 pt-1">
        <p className="text-2xs text-logic-text-muted flex items-center gap-1.5"><Smartphone size={12} /> Todos precisam estar no mesmo Wi-Fi do Mac.</p>
        <button className="text-2xs text-logic-text-dim hover:text-logic-text underline-offset-2 hover:underline transition-colors" onClick={() => local.setMode('online')}>
          Voltar para Show Online
        </button>
      </div>
    </div>
  );
}

function AccessCard({ role, url, qr, pin, onRegenerate }: {
  role: LocalRole; url: string | null; qr: string | null; pin: string | null; onRegenerate: (() => Promise<void>) | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'access' | 'pin' | null>(null);
  const Icon = ROLE_ICON[role];

  const copy = async (what: 'access' | 'pin') => {
    if (what === 'access' && !url) return;
    const text = what === 'pin'
      ? pin ?? ''
      : pin ? `${ROLE_LABEL[role]} – Rede local\nLink: ${url}\nSenha: ${pin}` : url ?? '';
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    } catch { /* copiar é só um atalho */ }
  };

  const regenerate = async () => {
    if (!onRegenerate) return;
    setBusy(true);
    await onRegenerate();
    setBusy(false);
    setConfirming(false);
  };

  return (
    <div className="flex flex-col p-3 rounded-lg bg-logic-bg-deep border border-logic-border-dark hover:border-logic-border transition-colors">
      <div className="flex items-center gap-2">
        <span className={`w-6 h-6 rounded-md flex items-center justify-center ${ROLE_TONE[role]}`}><Icon size={12} /></span>
        <span className="text-xs font-semibold text-logic-text">{ROLE_LABEL[role]}</span>
      </div>
      <div className="mt-3 mx-auto w-32 h-32 rounded-md bg-white p-1.5 flex items-center justify-center">
        {qr ? <img src={qr} alt={`QR code para ${ROLE_LABEL[role]}`} className="w-full h-full [image-rendering:pixelated]" /> : <WifiOff size={20} className="text-neutral-400" />}
      </div>
      <p className="mt-2 text-center text-2xs text-logic-text-muted truncate">{url?.replace(/^https?:\/\//, '') ?? 'Sem rede'}</p>
      <button
        className="mt-1.5 flex items-center justify-center gap-1.5 h-7 rounded-md bg-logic-accent text-white text-2xs font-medium hover:bg-logic-accent-hover active:scale-[0.97] transition-all disabled:opacity-40"
        onClick={() => copy('access')} disabled={!url}
        title={pin ? 'Copia uma mensagem com o link e a senha escrita para a pessoa digitar' : 'Copiar o endereço'}
      >
        <Copy size={11} /> {copied === 'access' ? 'Copiado!' : pin ? 'Copiar link + senha' : 'Copiar link'}
      </button>
      <div className="mt-3 pt-3 border-t border-logic-border-dark text-center">
        {pin ? (
          <>
            <p className="text-2xs text-logic-text-muted">Senha (PIN)</p>
            <p className="font-mono text-lg font-semibold tracking-[0.25em] text-logic-text select-all">{pin}</p>
            {confirming ? (
              <div className="mt-1.5 space-y-1.5 animate-[fadeIn_120ms_ease-out]">
                <p className="text-2xs text-logic-lcd-amber leading-snug">Quem entrou com o PIN atual vai precisar do novo.</p>
                <div className="flex gap-1.5 justify-center">
                  <button className="px-2 h-6 rounded text-2xs text-logic-text-dim hover:bg-logic-bg-panel-light transition-colors" onClick={() => setConfirming(false)}>Cancelar</button>
                  <button className="flex items-center gap-1 px-2 h-6 rounded bg-logic-lcd-amber text-black text-2xs font-semibold hover:brightness-110 transition" onClick={regenerate} disabled={busy}>
                    {busy && <Loader2 size={10} className="animate-spin" />} Trocar PIN
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-center gap-3">
                <button className="inline-flex items-center gap-1 text-2xs text-logic-text-dim hover:text-logic-text transition-colors" onClick={() => copy('pin')}>
                  <KeyRound size={10} /> {copied === 'pin' ? <span className="text-logic-lcd-green">Copiado!</span> : 'Copiar senha'}
                </button>
                <button className="inline-flex items-center gap-1 text-2xs text-logic-text-dim hover:text-logic-lcd-amber transition-colors" onClick={() => setConfirming(true)}>
                  <RefreshCw size={10} /> Trocar PIN
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-2xs text-logic-text-muted">Sem PIN</p>
            <p className="text-2xs text-logic-text-dim mt-1 leading-snug">A TV só mostra letra e avisos, não controla nada.</p>
          </>
        )}
      </div>
    </div>
  );
}
