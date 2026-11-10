// VS Stage Remote: o Modo Show do programa no celular, em pé. Abre igual pela Rede Local (página
// servida pelo Mac, com o PIN do Remote) e pelo Show Online (link com a chave do Mac).
import { useEffect, useRef, useState } from 'react';
import { KeyRound, ListMusic, MonitorPlay, Play, SlidersVertical, Square } from 'lucide-react';
import SegmentDisplay from '@/components/SegmentDisplay';
import VsLogo from '@/components/VsLogo';
import { AccessCard, AccessNotice, AccessStage, AccessTitle } from '@/components/access/AccessChrome';
import RemoteShowTab from '@/components/remote/RemoteShowTab';
import RemoteSetlist from '@/components/remote/RemoteSetlist';
import RemoteMixer from '@/components/remote/RemoteMixer';
import { useRemoteLink, type RemoteLink } from '@/components/remote/useRemoteLink';
import type { RemoteState } from '@/lib/remoteProtocol';

type Tab = 'show' | 'lista' | 'mixer';
const TAB_LS = 'vs_remote_tab';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Tela sempre acesa durante o show. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const ask = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl) lock = await wl.request('screen');
      } catch { /* navegador sem suporte */ }
    };
    ask();
    const onVis = () => { if (document.visibilityState === 'visible') ask(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, []);
}

function PinScreen({ link }: { link: RemoteLink }) {
  const [pin, setPin] = useState('');
  return (
    <AccessStage>
      <div className="w-full max-w-[380px] flex flex-col items-stretch">
      <AccessTitle title="VS Stage Remote" brand subtitle="Digite o PIN do VS Stage Remote que aparece no Mac, em Rede Local." />
      <AccessCard label={<><KeyRound size={12} /> PIN do Remote</>} width={380}>
        <form
          className="p-5 space-y-4"
          onSubmit={(e) => { e.preventDefault(); link.submitPin(pin); }}
        >
          {link.pinError && <AccessNotice tone="red"><p>{link.pinError}</p></AccessNotice>}
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-label="PIN de 6 números"
            className="access-field is-plain text-center font-stage text-[1.6rem] tracking-[0.4em] !h-14"
          />
          <button type="submit" className="access-key" disabled={pin.length !== 6}>Entrar</button>
        </form>
      </AccessCard>
      </div>
    </AccessStage>
  );
}

function WaitScreen({ title, text }: { title: string; text: string }) {
  return (
    <AccessStage>
      <div className="w-full max-w-[380px] flex flex-col items-stretch">
        <AccessTitle title="VS Stage Remote" brand />
        <AccessCard label={title} status={<span className="console-led is-on-amber animate-pulse" />} width={380}>
          <p className="p-5 text-sm text-logic-text-dim leading-relaxed">{text}</p>
        </AccessCard>
      </div>
    </AccessStage>
  );
}

function Rail({ state, link }: { state: RemoteState; link: RemoteLink }) {
  const clock = useClock();
  const live = link.status === 'live';
  return (
    <div className="console-rail flex items-center gap-2 px-3 h-12 shrink-0">
      <span className={`console-lamp shrink-0 ${state.playing ? 'is-on' : ''}`} title={state.playing ? 'No ar' : 'Parado'} />
      <VsLogo size={20} className="shrink-0" />
      <span className="font-stage text-[15px] font-semibold tracking-wide text-logic-text truncate">VS Stage Remote</span>
      <span className="ml-auto flex items-center gap-1.5 shrink-0 console-legend" title={live ? 'Ligado ao Mac' : 'Sem sinal do Mac'}>
        <span className={`console-led ${live ? 'is-on-green' : 'is-on-amber animate-pulse'}`} />
        {link.via === 'local' ? 'Rede local' : 'Online'}
      </span>
      <span className="console-display flex items-center h-7 px-2 shrink-0" title="Hora certa">
        <SegmentDisplay text={clock} label={`Hora: ${clock}`} className="h-4 text-logic-lcd-amber" />
      </span>
    </div>
  );
}

function Transport({ state, link }: { state: RemoteState; link: RemoteLink }) {
  const bigKey = 'console-key is-big flex items-center justify-center gap-2 h-14 text-[16px]';
  return (
    <div className="grid grid-cols-2 gap-2.5 px-4 py-3 border-b border-black bg-black/10">
      <button
        className={`${bigKey} ${state.playing ? 'is-lit-green' : '!text-logic-lcd-green'}`}
        onClick={() => link.send({ action: 'play' })}
        disabled={state.playing}
        aria-label="Tocar"
      >
        <Play size={22} fill="currentColor" /> Tocar
      </button>
      <button className={`${bigKey} !text-logic-text`} onClick={() => link.send({ action: 'stop' })} aria-label="Parar">
        <Square size={18} fill="currentColor" /> Parar
      </button>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: typeof Play }[] = [
  { id: 'show', label: 'Show', icon: MonitorPlay },
  { id: 'lista', label: 'Lista', icon: ListMusic },
  { id: 'mixer', label: 'Mixer', icon: SlidersVertical },
];

export default function MobileShowRemote() {
  const link = useRemoteLink();
  useWakeLock();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem(TAB_LS);
      return saved === 'lista' || saved === 'mixer' ? saved : 'show';
    } catch { return 'show'; }
  });
  const mainRef = useRef<HTMLElement>(null);
  const pick = (t: Tab) => {
    setTab(t);
    mainRef.current?.scrollTo({ top: 0 });
    try { localStorage.setItem(TAB_LS, t); } catch { /* sem armazenamento */ }
  };

  if (link.status === 'pin') return <PinScreen link={link} />;
  if (link.status === 'nolink') {
    return <WaitScreen title="Falta o link do Mac" text="Abra o VS Stage Remote pelo QR ou pelo link que aparece no programa do Mac (Show Online ou Rede Local)." />;
  }
  const state = link.state;
  if (!state) {
    return (
      <WaitScreen
        title="Procurando o Mac"
        text={link.via === 'local'
          ? 'Esperando o programa do Mac. Ele precisa estar aberto, com a Rede Local ligada e no mesmo Wi-Fi deste celular.'
          : 'Esperando o programa do Mac. Ele precisa estar aberto, com internet e no modo Show Online.'}
      />
    );
  }

  return (
    <div className="console-face flex flex-col h-[100dvh] w-full text-logic-text select-none overflow-hidden">
      <Rail state={state} link={link} />
      {link.status === 'lost' && (
        <div role="alert" className="flex items-center gap-2 px-4 py-2 bg-logic-lcd-amber/10 border-b border-logic-lcd-amber/40 text-sm text-logic-lcd-amber">
          <span className="console-led is-on-amber animate-pulse shrink-0" />
          Sem sinal do Mac. Mostrando o último estado recebido.
        </div>
      )}
      <Transport state={state} link={link} />
      <main ref={mainRef} className="flex-1 min-h-0 overflow-y-auto logic-scroll overscroll-contain">
        {tab === 'show' && <RemoteShowTab state={state} macNow={link.macNow} send={link.send} />}
        {tab === 'lista' && <RemoteSetlist state={state} send={link.send} />}
        {tab === 'mixer' && <RemoteMixer state={state} send={link.send} watchMeters={link.watchMeters} />}
      </main>
      <nav className="console-rail grid grid-cols-3 gap-1.5 px-3 pt-2 shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            aria-pressed={tab === t.id}
            className={`console-key flex items-center justify-center gap-1.5 h-12 text-[14px] ${tab === t.id ? 'is-lit-blue' : ''}`}
          >
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
