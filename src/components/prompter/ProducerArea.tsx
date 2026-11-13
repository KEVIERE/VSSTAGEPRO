import { useEffect, useState } from 'react';
import { Clapperboard, MonitorPlay, Megaphone, FileText, LogOut, WifiOff, Loader2, Check, CloudOff, RefreshCw } from 'lucide-react';
import PrompterAccess, { feedErrorText } from '@/components/prompter/PrompterAccess';
import ScreenControlPanel from '@/components/prompter/ScreenControlPanel';
import NoticeControl from '@/components/prompter/NoticeControl';
import LyricsEditor from '@/components/prompter/LyricsEditor';
import { producerState } from '@/lib/prompterApi';
import { usePrompterFeed } from '@/lib/usePrompterFeed';
import { usePrompterControl } from '@/lib/usePrompterControl';
import { useShowLogo } from '@/lib/useShowLogo';
import { isLocalClient } from '@/lib/localNetwork';
import { LOCAL_NOTICE, localForget } from '@/lib/localClientApi';

// Só nesta aba: abrir de novo o link sempre pede o código.
const PRODUCER_SS = 'vs_producer_code';

type Tab = 'screen' | 'notices' | 'lyrics';

const TABS: { id: Tab; label: string; icon: typeof MonitorPlay }[] = [
  { id: 'screen', label: 'Tela', icon: MonitorPlay },
  { id: 'notices', label: 'Avisos', icon: Megaphone },
  { id: 'lyrics', label: 'Letras', icon: FileText },
];

/** "há 3 s", "agora": o painel mostra quando o último envio chegou ao servidor. */
function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 3) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  return m === 1 ? 'há 1 min' : `há ${m} min`;
}

export default function ProducerArea() {
  const [code, setCode] = useState<string | null>(() => sessionStorage.getItem(PRODUCER_SS));
  const [tab, setTab] = useState<Tab>('screen');
  const feed = usePrompterFeed(code, producerState);
  const ctl = usePrompterControl(code, feed.snap?.prompter ?? null);
  const logoUrl = useShowLogo(feed.snap ? code : null, feed.snap?.logo ?? null);

  useEffect(() => {
    localStorage.removeItem('vs_producer_code');
    if (feed.snap && code) sessionStorage.setItem(PRODUCER_SS, code);
  }, [feed.snap, code]);

  // Código recusado ou desconectado pelo diretor: a busca parou. Esquece o código e volta para a
  // tela do código com o motivo guardado aqui, porque trocar o código zera o erro do feed. Sem
  // zerar o código, digitar de novo o MESMO código não reiniciava a busca.
  const [rejected, setRejected] = useState<'invalid_code' | 'disconnected' | null>(null);

  useEffect(() => {
    if (feed.error !== 'invalid_code' && feed.error !== 'disconnected') return;
    sessionStorage.removeItem(PRODUCER_SS);
    setRejected(feed.error);
    setCode(null);
  }, [feed.error]);

  const leave = () => {
    if (code && isLocalClient()) localForget('producer', code);
    sessionStorage.removeItem(PRODUCER_SS);
    window.location.hash = '#produtor';
    setCode(null);
  };

  if (!code || feed.error === 'invalid_code' || (feed.error === 'too_many_attempts' && !feed.snap)) {
    return (
      <PrompterAccess
        icon={<Clapperboard size={22} />}
        title="Área do Produtor"
        subtitle="Escreva as letras do show, controle o que aparece na TV do palco e mande avisos para os artistas."
        error={feedErrorText(feed.error ?? rejected)}
        onSubmit={(c) => { window.location.hash = '#produtor'; setRejected(null); setCode(c); }}
      />
    );
  }

  if (!feed.snap || !ctl.state) {
    return (
      <div className="min-h-screen bg-logic-bg-deep flex items-center justify-center px-6 text-center">
        {feed.error === 'not_ready'
          ? <p className="flex items-center gap-2 text-logic-text-dim"><Loader2 size={18} className="animate-spin shrink-0" /> {LOCAL_NOTICE.notReady}</p>
          : feed.error === 'offline'
            ? <p className="flex items-center gap-2 text-logic-text-dim"><WifiOff size={18} /> {isLocalClient() ? 'Sem conexão com o Mac do diretor. Tentando de novo...' : 'Sem internet. Tentando de novo...'}</p>
            : <Loader2 size={28} className="text-logic-accent animate-spin" />}
      </div>
    );
  }

  const snap = feed.snap;
  const state = ctl.state;
  const problem = ctl.error ?? (feed.error === 'offline' ? 'Sem conexão' : feed.error === 'not_ready' ? 'Projeto sem músicas no Mac' : null);
  // Aviso já vencido (ou tirado) não é mais "no ar": a barra não pode dizer que está na TV. O aviso
  // é carimbado na hora do servidor, então a conta usa a hora do servidor, igual à TV.
  const serverNow = feed.now + feed.sync.clockOffsetMs;
  const n = state.notice;
  const live = n && (n.durationSec <= 0 || serverNow - n.sentAt < n.durationSec * 1000) ? n : null;

  return (
    <div className="h-screen flex flex-col bg-logic-bg-deep text-logic-text">
      <header className="console-rail shrink-0 z-30 border-b-2 border-black">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-black/40 border border-black text-logic-lcd-amber flex items-center justify-center flex-shrink-0 shadow-inner">
            <Clapperboard size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-stage text-sm font-semibold tracking-wide truncate">{snap.show.name || 'Show'}</p>
            <p className="console-legend">Produtor · Teleprompter</p>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className={`console-key flex items-center gap-1.5 px-3.5 h-8 text-[12px] ${tab === id ? 'is-lit-blue' : ''}`}
              >
                <Icon size={14} /> {label}
                {id === 'notices' && live && <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-amber" />}
              </button>
            ))}
          </nav>
          {problem && (
            <span className="flex items-center gap-1.5 text-xs text-logic-lcd-amber" title={problem}>
              <WifiOff size={14} /> <span className="hidden md:inline">{problem}</span>
            </span>
          )}
          <button onClick={leave} className="console-key flex items-center justify-center w-8 h-8" title="Sair">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Barra de estado do envio: o painel antes parecia funcionar mesmo quando o servidor
          recusava a gravação. Agora o que está na TV é o que aparece aqui. */}
      <div className="shrink-0 border-b border-black/60 bg-black/30">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 h-9 flex items-center gap-3 text-xs">
          {ctl.error ? (
            <>
              <span className="flex items-center gap-1.5 text-logic-lcd-red min-w-0 truncate" title={ctl.error}>
                <CloudOff size={13} className="flex-shrink-0" /> <span className="truncate">{ctl.error}</span>
              </span>
              <button onClick={() => void ctl.resync()} className="console-key ml-auto flex items-center gap-1.5 px-2.5 h-6 text-[11px]">
                <RefreshCw size={11} /> Recarregar
              </button>
            </>
          ) : ctl.saving ? (
            <span className="flex items-center gap-1.5 text-logic-text-dim"><Loader2 size={12} className="animate-spin" /> Enviando para a TV...</span>
          ) : ctl.savedAt ? (
            <span className="flex items-center gap-1.5 text-logic-lcd-green"><Check size={13} /> Na TV · enviado {ago(ctl.savedAt, feed.now)}</span>
          ) : (
            <span className="text-logic-text-muted">Tudo o que você muda aqui vai ao vivo para a TV do palco.</span>
          )}
          {live && !ctl.error && (
            <span className="ml-auto flex items-center gap-1.5 min-w-0 text-logic-text-dim">
              <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-amber animate-pulse flex-shrink-0" />
              <span className="hidden sm:inline">No ar:</span>
              <span className="truncate max-w-[40ch] text-logic-text">{live.text}</span>
            </span>
          )}
        </div>
      </div>

      <main className={`flex-1 min-h-0 overflow-y-auto logic-scroll ${tab === 'lyrics' ? 'lg:overflow-hidden' : ''}`}>
        <div className={`mx-auto px-3 sm:px-4 py-4 pb-24 sm:pb-6 ${tab === 'lyrics' ? 'max-w-[1800px] lg:h-full lg:py-3 lg:pb-3' : tab === 'notices' ? 'max-w-[1600px]' : 'max-w-7xl'}`}>
        {tab === 'screen' && <ScreenControlPanel code={code} snap={snap} sync={feed.sync} now={feed.now} state={state} update={ctl.update} logoUrl={logoUrl} onManageNotices={() => setTab('notices')} />}
        {tab === 'notices' && <NoticeControl state={state} update={ctl.update} songs={snap.show.setlist.songs} now={serverNow} clockOffsetMs={feed.sync.clockOffsetMs} />}
        {tab === 'lyrics' && <LyricsEditor code={code} snap={snap} sync={feed.sync} now={feed.now} state={state} update={ctl.update} />}
        </div>
      </main>

      {/* Barra de baixo em grafite (o alumínio fica só nos títulos), com as mesmas teclas do Remote. */}
      <nav
        className="console-rail vs-legend-bar sm:hidden fixed bottom-0 inset-x-0 z-30 border-t-2 border-black grid grid-cols-3 gap-1.5 px-3 pt-2"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`console-key relative flex items-center justify-center gap-1.5 h-12 text-[14px] ${tab === id ? 'is-lit-blue' : ''}`}
          >
            <Icon size={16} /> {label}
            {id === 'notices' && live && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-logic-lcd-amber" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
