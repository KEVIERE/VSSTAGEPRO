// Aba de Avisos da área do produtor, com estado simulado e sem servidor. Serve para ver o
// layout e conferir que mandar um aviso pronto coloca o texto "NA TV AGORA" na hora.
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import NoticeControl from '../../src/components/prompter/NoticeControl';
import QuickNotices from '../../src/components/prompter/QuickNotices';
import { DEFAULT_PROMPTER } from '../../src/lib/prompterTypes';
import type { PrompterState } from '../../src/lib/prompterTypes';
import type { SetlistSong } from '../../src/lib/musicianTypes';

const songs: SetlistSong[] = [
  { id: 's1', name: 'Canção do Teste' },
  { id: 's2', name: 'Segunda Música' },
  { id: 's3', name: 'Medley Louvor' },
] as SetlistSong[];

function App() {
  const [state, setState] = useState<PrompterState>({
    ...DEFAULT_PROMPTER,
    history: [
      { id: 'h1', text: 'Agradecer a produção', at: Date.now() - 60_000 },
      { id: 'h2', text: 'Últimas 2 músicas', at: Date.now() - 180_000 },
    ],
    scheduled: [{ id: 'sc1', songId: 's2', text: 'Chamar o público para cantar', level: 'warn', layout: 'bar', durationSec: 15 }],
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(id); }, []);

  const update = (fn: (s: PrompterState) => PrompterState) => setState((s) => fn(s));

  return (
    <div className="min-h-screen bg-logic-bg-deep text-logic-text p-4 space-y-6">
      <div className="max-w-[1600px] mx-auto">
        <p className="text-xs text-logic-text-muted mb-3">Aba Avisos</p>
        <NoticeControl state={state} update={update} songs={songs} now={now} />
      </div>
      <div className="max-w-md mx-auto border-t border-logic-border pt-4">
        <p className="text-xs text-logic-text-muted mb-2">Atalho da aba Tela (QuickNotices)</p>
        <QuickNotices state={state} update={update} now={now} onManage={() => {}} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
