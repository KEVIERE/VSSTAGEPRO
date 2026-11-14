// Fotos do site: Área do Produtor (aba Tela) e a TV do palco (?tv), com o mesmo show de exemplo
// das outras fotos. Sem servidor: o estado é montado aqui e o relógio anda sozinho.
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { Check, Clapperboard, FileText, LogOut, Megaphone, MonitorPlay } from 'lucide-react';
import ScreenControlPanel from '../../src/components/prompter/ScreenControlPanel';
import StageScreen from '../../src/components/prompter/StageScreen';
import { DEFAULT_PROMPTER } from '../../src/lib/prompterTypes';
import type { LyricPage, PrompterSnapshot, PrompterState } from '../../src/lib/prompterTypes';

const TV = location.search.includes('tv');
const SONGS: Array<[string, number, string, number, string]> = [
  ['Música 01', 128, 'G', 131, 'b1'], ['Música 02', 75, 'D', 142, 'b1'], ['Música 03', 68, 'A', 152, 'b1'], ['Música 04', 140, 'E', 163, 'b1'],
  ['Música 05', 82, 'C', 174, 'b1'], ['Música 06', 90, 'Bm', 138, 'b2'], ['Música 07', 76, 'F', 149, 'b2'], ['Música 08', 120, 'Em', 160, 'b2'],
];
const PAGES: LyricPage[] = [
  { id: 'p1', time: 6, text: 'A cidade acende as luzes devagar\nE a gente chega junto pra cantar', kind: 'verso' },
  { id: 'p2', time: 22, text: 'Cada voz que sobe faz o chão tremer\nHoje a noite é nossa, pode crer', kind: 'verso' },
  { id: 'p3', time: 38, text: 'Levanta a mão e canta comigo\nQue o melhor ainda vai chegar', kind: 'prerefrao' },
  { id: 'p4', time: 52, text: 'É agora, é a nossa hora\nTodo mundo no mesmo compasso', kind: 'refrao' },
  { id: 'p5', time: 66, text: 'É agora, ninguém vai embora\nEnquanto a música tocar', kind: 'refrao' },
  { id: 'p6', time: 90, text: 'Mais uma vez, bem alto\nPra cidade inteira escutar', kind: 'ponte' },
];

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);
  return now;
}

const start = Date.now();
function snapshot(now: number, state: PrompterState): PrompterSnapshot {
  const t = 70 + (now - start) / 1000;
  const iso = new Date(now).toISOString();
  return {
    show: {
      name: 'Show Prefeitura',
      setlist: {
        songs: SONGS.map(([name, bpm, key, duration, blockId], i) => ({ id: `s${i + 1}`, name, duration, bpm, baseBpm: bpm, bpmAdjust: 0, tuner: 0, musicKey: key, blockId })),
        blocks: [{ id: 'b1', name: 'Bloco 01', color: '#0a84ff' }, { id: 'b2', name: 'Bloco 02', color: '#ff9f0a' }],
        order: SONGS.map((_, i) => `s${i + 1}`),
      } as never,
      live: { isPlaying: true, isPaused: false, currentTime: t, songProgress: t / 142, nextSongCountdown: 142 - t, currentSongId: 's2', nextSongId: 's3', sliceId: null, sliceName: null, bpm: 75, playFlow: 'continuo', onAir: true, publishedAt: now } as never,
      live_at: iso,
    },
    prompter: state,
    lyrics: [{ song_id: 's2', pages: PAGES, updated_at: iso }],
    lyricsSave: { requestedAt: null, savedAt: iso },
    server_now: iso,
  };
}

function initialState(): PrompterState {
  const showStart = new Date(Date.now() - 38 * 60000);
  return {
    ...DEFAULT_PROMPTER,
    showStartAt: showStart.toISOString(),
    showDurationMin: 120,
    notice: { id: 'n1', text: 'Mais uma vez o refrão', level: 'warn', layout: 'bar', sentAt: Date.now(), durationSec: 0 },
  };
}

function Producer() {
  const now = useClock();
  const [state, setState] = useState<PrompterState>(initialState);
  const snap = snapshot(now, state);
  const sync = { lagMs: 0, receivedAt: now, clockOffsetMs: 0 };
  const update = (patch: Partial<PrompterState>) => setState((s) => ({ ...s, ...patch }));
  const tabs = [
    { id: 'screen', label: 'Tela', icon: MonitorPlay },
    { id: 'notices', label: 'Avisos', icon: Megaphone },
    { id: 'lyrics', label: 'Letras', icon: FileText },
  ];
  return (
    <div className="h-screen flex flex-col bg-logic-bg-deep text-logic-text">
      <header className="console-rail shrink-0 z-30 border-b-2 border-black">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-black/40 border border-black text-logic-lcd-amber flex items-center justify-center flex-shrink-0 shadow-inner">
            <Clapperboard size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-stage text-sm font-semibold tracking-wide truncate">{snap.show.name}</p>
            <p className="console-legend">Produtor · Teleprompter</p>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} aria-pressed={id === 'screen'} className={`console-key flex items-center gap-1.5 px-3.5 h-8 text-[12px] ${id === 'screen' ? 'is-lit-blue' : ''}`}>
                <Icon size={14} /> {label}
                {id === 'notices' && <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-amber" />}
              </button>
            ))}
          </nav>
          <button className="console-key flex items-center justify-center w-8 h-8" title="Sair"><LogOut size={15} /></button>
        </div>
      </header>
      <div className="shrink-0 border-b border-black/60 bg-black/30">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 h-9 flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-logic-lcd-green"><Check size={13} /> Na TV · enviado agora</span>
          <span className="ml-auto flex items-center gap-1.5 min-w-0 text-logic-text-dim">
            <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-amber animate-pulse flex-shrink-0" />
            <span className="hidden sm:inline">No ar:</span>
            <span className="truncate max-w-[40ch] text-logic-text">{state.notice?.text}</span>
          </span>
        </div>
      </div>
      <main className="flex-1 min-h-0 overflow-y-auto logic-scroll">
        <div className="mx-auto px-3 sm:px-4 py-4 pb-6 max-w-7xl">
          <ScreenControlPanel code="fotos" snap={snap} sync={sync} now={now} state={state} update={update as never} logoUrl={null} onManageNotices={() => {}} />
        </div>
      </main>
    </div>
  );
}

function Tv() {
  const now = useClock();
  // Sem aviso: a seção da TV no site desenha o aviso animado por cima da foto.
  const [state] = useState<PrompterState>(() => ({ ...initialState(), notice: null }));
  return <div style={{ height: '100vh' }}><StageScreen snap={snapshot(now, state)} sync={{ lagMs: 0, receivedAt: now, clockOffsetMs: 0 }} now={now} logoUrl={null} /></div>;
}

createRoot(document.getElementById('root')!).render(TV ? <Tv /> : <Producer />);
