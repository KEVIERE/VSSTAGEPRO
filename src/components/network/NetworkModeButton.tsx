import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Wifi } from 'lucide-react';
import type { LiveBroadcast } from '@/lib/useLiveBroadcast';
import type { LocalBroadcast } from '@/lib/useLocalBroadcast';
import type { NetworkMode } from '@/lib/localNetwork';

interface Confirm { title: string; text: string; run: () => void }

export function useModeSwitch(broadcast: LiveBroadcast, local: LocalBroadcast, onOpenLocal: () => void) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const choose = (m: NetworkMode) => {
    if (m === local.mode) {
      if (m === 'local') onOpenLocal();
      return;
    }
    if (m === 'local') {
      if (!local.available) { onOpenLocal(); return; }
      const go = async () => {
        if (broadcast.onAir) await broadcast.stop();
        local.setMode('local');
        onOpenLocal();
      };
      if (broadcast.onAir) {
        setConfirm({
          title: 'Mudar para Rede Local?',
          text: 'O Show Online vai sair do ar e os músicos conectados pela internet deixam de receber o show. Eles vão precisar entrar pelo Wi-Fi do palco.',
          run: go,
        });
      } else void go();
      return;
    }
    const devices = local.info?.clients.length ?? 0;
    if (devices > 0) {
      setConfirm({
        title: 'Voltar para Show Online?',
        text: `A rede local vai ser desligada e ${devices} ${devices === 1 ? 'aparelho conectado vai' : 'aparelhos conectados vão'} perder a conexão.`,
        run: () => local.setMode('online'),
      });
    } else local.setMode('online');
  };

  const dialog = confirm && (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 animate-[fadeIn_150ms_ease-out]">
      <div className="w-96 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-lg">
        <div className="px-4 pt-4 pb-3">
          <div className="text-sm font-semibold text-logic-text mb-1.5">{confirm.title}</div>
          <p className="text-xs text-logic-text-dim leading-relaxed">{confirm.text}</p>
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-bg-deep text-logic-text-dim border border-logic-border-dark hover:bg-logic-bg-panel-light hover:text-logic-text transition-colors"
            onClick={() => setConfirm(null)}
          >
            Cancelar
          </button>
          <button
            className="px-3 py-1.5 text-xs rounded bg-logic-accent text-white font-medium hover:brightness-110 transition-all"
            onClick={() => { const run = confirm.run; setConfirm(null); run(); }}
          >
            Mudar
          </button>
        </div>
      </div>
    </div>
  );

  return { choose, dialog };
}

export default function NetworkModeButton({ broadcast, local, pendingRequests, onOpenShowManager, onOpenLocal, onChoose }: {
  broadcast: LiveBroadcast;
  local: LocalBroadcast;
  pendingRequests: number;
  onOpenShowManager: () => void;
  onOpenLocal: () => void;
  onChoose: (m: NetworkMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isLocal = local.mode === 'local';
  const devices = local.info?.clients.length ?? 0;
  const localUp = isLocal && !!local.info?.running && !local.error;
  const lit = isLocal ? localUp : broadcast.onAir;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const dot = isLocal ? 'bg-logic-accent' : 'bg-logic-lcd-green';
  const status = isLocal
    ? (local.error ? 'Problema' : localUp ? `${devices} ${devices === 1 ? 'aparelho' : 'aparelhos'}` : 'Iniciando...')
    : (broadcast.onAir ? 'No ar' : 'Fora do ar');
  const address = local.info?.hostName ?? local.info?.addresses[0] ?? null;

  return (
    <div ref={ref} className="relative flex items-stretch h-7 border-l border-logic-border-dark">
      <button
        className="px-2.5 flex items-center gap-1.5 hover:bg-logic-bg-panel-light transition-colors duration-100 font-medium text-2xs"
        style={{ color: lit ? (isLocal ? '#3d9bff' : '#30d158') : '#e8e8e8' }}
        onClick={() => { setOpen(false); if (isLocal) onOpenLocal(); else onOpenShowManager(); }}
        title={isLocal
          ? (address ? `Rede local ativa em ${address}` : 'Rede local do palco, sem internet')
          : (broadcast.onAir ? 'Os músicos estão recebendo o show ao vivo' : 'Os músicos não estão recebendo nada')}
      >
        <span className="relative flex h-1.5 w-1.5">
          {lit && <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping ${dot}`} />}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${lit ? dot : local.error && isLocal ? 'bg-logic-lcd-red' : 'bg-logic-text-muted'}`} />
        </span>
        {isLocal ? <Wifi size={11} /> : null}
        {isLocal ? 'Rede Local' : 'Show Online'}
        <span className={`text-2xs font-normal ${lit ? '' : local.error && isLocal ? 'text-logic-lcd-red' : 'text-logic-text-muted'}`}>{status}</span>
        {!isLocal && pendingRequests > 0 && (
          <span
            className="ml-0.5 px-1 h-3.5 min-w-3.5 flex items-center justify-center rounded-full bg-logic-lcd-amber text-black text-[9px] font-semibold animate-pulse"
            title={`${pendingRequests} pedido(s) de músicos aguardando aprovação`}
          >
            {pendingRequests}
          </span>
        )}
      </button>
      <button
        className={`w-5 flex items-center justify-center border-l border-logic-border-dark text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-panel-light transition-colors ${open ? 'bg-logic-bg-panel-light text-logic-text' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Trocar entre Show Online e Rede Local"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-7 z-50 w-72 py-1 bg-logic-bg-panel border border-logic-border-light shadow-logic-raised rounded-b animate-[fadeIn_120ms_ease-out]">
          <ModeOption
            icon={<Globe size={14} />} title="Show Online" hint="Pela internet. Músicos entram de qualquer lugar."
            active={!isLocal} onClick={() => { setOpen(false); onChoose('online'); }}
          />
          <ModeOption
            icon={<Wifi size={14} />} title="Rede Local" hint={local.available ? 'Sem internet. Todos no mesmo Wi-Fi do palco.' : 'Sem internet. Disponível no app de Mac.'}
            active={isLocal} onClick={() => { setOpen(false); onChoose('local'); }}
          />
        </div>
      )}
    </div>
  );
}

function ModeOption({ icon, title, hint, active, onClick }: {
  icon: React.ReactNode; title: string; hint: string; active: boolean; onClick: () => void;
}) {
  return (
    <button role="menuitem" onClick={onClick} className="group w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-logic-accent hover:text-white transition-colors duration-75">
      <span className={`mt-0.5 ${active ? 'text-logic-accent group-hover:text-white' : 'text-logic-text-muted group-hover:text-white'}`}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-medium">{title}</span>
        <span className="block text-2xs text-logic-text-muted group-hover:text-white/80 leading-snug mt-0.5">{hint}</span>
      </span>
      {active && <Check size={13} className="mt-0.5 text-logic-accent group-hover:text-white" />}
    </button>
  );
}
