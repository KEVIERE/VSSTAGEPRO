import { useEffect, useState } from 'react';
import { Clapperboard, MonitorPlay, Megaphone, FileText, LogOut, WifiOff, Loader2 } from 'lucide-react';
import PrompterAccess, { feedErrorText } from '@/components/prompter/PrompterAccess';
import ScreenControlPanel from '@/components/prompter/ScreenControlPanel';
import NoticeControl from '@/components/prompter/NoticeControl';
import LyricsEditor from '@/components/prompter/LyricsEditor';
import { producerState } from '@/lib/prompterApi';
import { usePrompterFeed } from '@/lib/usePrompterFeed';
import { usePrompterControl } from '@/lib/usePrompterControl';
import { useShowLogo } from '@/lib/useShowLogo';
import { isLocalClient } from '@/lib/localNetwork';
import { localForget } from '@/lib/localClientApi';

// Só nesta aba: abrir de novo o link sempre pede o código.
const PRODUCER_SS = 'vs_producer_code';

type Tab = 'screen' | 'notices' | 'lyrics';

const TABS: { id: Tab; label: string; icon: typeof MonitorPlay }[] = [
  { id: 'screen', label: 'Tela', icon: MonitorPlay },
  { id: 'notices', label: 'Avisos', icon: Megaphone },
  { id: 'lyrics', label: 'Letras', icon: FileText },
];

export default function ProducerArea() {
  const [code, setCode] = useState<string | null>(() => sessionStorage.getItem(PRODUCER_SS));
  const [tab, setTab] = useState<Tab>('screen');
  const feed = usePrompterFeed(code, producerState);
  const ctl = usePrompterControl(code, feed.snap?.prompter ?? null);
  const logoUrl = useShowLogo(feed.snap ? code : null);

  useEffect(() => {
    localStorage.removeItem('vs_producer_code');
    if (feed.snap && code) sessionStorage.setItem(PRODUCER_SS, code);
  }, [feed.snap, code]);

  useEffect(() => {
    if (feed.error === 'invalid_code') sessionStorage.removeItem(PRODUCER_SS);
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
        error={feedErrorText(feed.error)}
        onSubmit={(c) => { window.location.hash = '#produtor'; setCode(c); }}
      />
    );
  }

  if (!feed.snap || !ctl.state) {
    return (
      <div className="min-h-screen bg-logic-bg-deep flex items-center justify-center">
        {feed.error === 'offline'
          ? <p className="flex items-center gap-2 text-logic-text-dim"><WifiOff size={18} /> {isLocalClient() ? 'Sem conexão com o Mac do diretor. Tentando de novo...' : 'Sem internet. Tentando de novo...'}</p>
          : <Loader2 size={28} className="text-logic-accent animate-spin" />}
      </div>
    );
  }

  const snap = feed.snap;
  const state = ctl.state;
  const problem = ctl.error ?? (feed.error === 'offline' ? 'Sem conexão' : null);

  return (
    <div className="h-screen flex flex-col bg-logic-bg-deep text-logic-text">
      <header className="shrink-0 z-30 bg-logic-bg/95 backdrop-blur border-b border-logic-border">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-logic-accent/15 text-logic-accent flex items-center justify-center flex-shrink-0">
            <Clapperboard size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{snap.show.name || 'Show'}</p>
            <p className="text-[11px] text-logic-text-dim">Produtor · Teleprompter</p>
          </div>
          <nav className="hidden sm:flex items-center gap-1 bg-logic-bg-deep rounded-lg p-1 border border-logic-border">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === id ? 'bg-logic-bg-elevated text-logic-text' : 'text-logic-text-dim hover:text-logic-text'}`}
              >
                <Icon size={15} /> {label}
                {id === 'notices' && state.notice && <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-amber" />}
              </button>
            ))}
          </nav>
          {problem && (
            <span className="flex items-center gap-1.5 text-xs text-logic-lcd-amber" title={problem}>
              <WifiOff size={14} /> <span className="hidden md:inline">{problem}</span>
            </span>
          )}
          <button onClick={leave} className="p-2 rounded-lg text-logic-text-muted hover:text-logic-text hover:bg-logic-bg-elevated transition-colors" title="Sair">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto logic-scroll">
        <div className="max-w-7xl mx-auto px-4 py-4 pb-24 sm:pb-6">
        {tab === 'screen' && <ScreenControlPanel snap={snap} sync={feed.sync} now={feed.now} state={state} update={ctl.update} logoUrl={logoUrl} onManageNotices={() => setTab('notices')} />}
        {tab === 'notices' && <NoticeControl state={state} update={ctl.update} songs={snap.show.setlist.songs} now={feed.now} />}
        {tab === 'lyrics' && <LyricsEditor code={code} snap={snap} sync={feed.sync} now={feed.now} state={state} update={ctl.update} />}
        </div>
      </main>

      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-logic-bg/95 backdrop-blur border-t border-logic-border grid grid-cols-3">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors ${tab === id ? 'text-logic-accent' : 'text-logic-text-dim'}`}
          >
            <Icon size={20} />
            {label}
            {id === 'notices' && state.notice && <span className="absolute top-2 right-[calc(50%-16px)] w-2 h-2 rounded-full bg-logic-lcd-amber" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
