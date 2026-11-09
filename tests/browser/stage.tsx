// Página do músico com um show simulado (sem servidor nem PIN): duas músicas, cifra na que
// está tocando e o relógio andando, para ver o Modo Palco.
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import MusicianWorkspace from '../../src/components/musician/MusicianWorkspace';
import { emptyDoc, newLine } from '../../src/lib/notebook';
import type { MusicianState, SheetBackend, SheetInfo } from '../../src/lib/musicianTypes';

const doc = emptyDoc();
const verses = ['Eu vou cantar pra você', 'Uma canção de amor', 'Que fala do nosso tempo', 'E de tudo que passou'];
for (let r = 0; r < 6; r++) {
  doc.lines.push({ ...newLine('section'), label: r % 2 ? 'Refrão' : `Verso ${r / 2 + 1}` } as never);
  for (const v of verses) doc.lines.push({ ...newLine('chords'), lyric: v, chords: [{ at: 0, chord: 'G' }, { at: 10, chord: 'D' }, { at: 18, chord: 'Em' }] } as never);
}
const MEDLEY = location.search.includes('medley');
const partDoc = emptyDoc();
partDoc.lines.push({ ...newLine('section'), label: 'Aclame' } as never, { ...newLine('chords'), lyric: 'Aclame ao Senhor toda a terra', chords: [{ at: 0, chord: 'D' }, { at: 7, chord: 'A' }, { at: 14, chord: 'Bm' }] } as never);
const sheets: SheetInfo[] = [
  { id: 'sh2', song_id: 's3~b', title: 'Aclame', content: JSON.stringify(partDoc), shared_from: null, updated_at: new Date().toISOString() },{ id: 'sh1', song_id: 's1', title: 'Canção', content: JSON.stringify(doc), shared_from: null, updated_at: new Date().toISOString() }];
const backend: SheetBackend = {
  key: 'teste', storedIn: 'neste teste',
  save: async () => 'sh1', remove: async () => {}, songLyrics: async () => [], colleagues: async () => [], share: async () => 0,
};

function App() {
  const [t, setT] = useState(MEDLEY ? 55 : 30);
  useEffect(() => { const id = setInterval(() => setT((x) => (x + 1) % 200), 1000); return () => clearInterval(id); }, []);
  const now = new Date().toISOString();
  const state: MusicianState = {
    musician: { id: 'm1', name: 'João', instrument: 'Violão' },
    show: {
      name: 'Show de teste',
      setlist: {
        songs: [
          { id: 's1', name: 'Canção do Teste', duration: 200, bpm: 92, baseBpm: 90, bpmAdjust: 3, tuner: 2, musicKey: 'G', blockId: null },
          { id: 's2', name: 'Segunda Música', duration: 180, bpm: 120, baseBpm: 120, bpmAdjust: 0, tuner: 0, musicKey: 'Em', blockId: null },
          { id: 's3', name: 'Medley Louvor', duration: 200, bpm: 100, baseBpm: 100, bpmAdjust: 0, tuner: 0, musicKey: 'D', blockId: null,
            parts: [
              { id: 'a', name: 'Grande é o Senhor', start: 0, end: 60 },
              { id: 'b', name: 'Aclame ao Senhor', start: 60, end: 130 },
              { id: 'c', name: 'Te Louvarei', start: 130, end: 200, enabled: false },
            ] },
        ],
        blocks: [], order: ['s1', 's3', 's2'],
      },
      live: { isPlaying: true, isPaused: false, currentTime: t, songProgress: t / 200, nextSongCountdown: 200 - t, currentSongId: MEDLEY ? 's3' : 's1', nextSongId: 's2', sliceId: MEDLEY ? (t < 60 ? 'a' : t < 130 ? 'b' : 'c') : null, sliceName: MEDLEY ? (t < 60 ? 'Grande é o Senhor' : t < 130 ? 'Aclame ao Senhor' : 'Te Louvarei') : null, bpm: 92, playFlow: 'continuo', onAir: true, publishedAt: Date.now() },
      live_at: now,
    },
    server_now: now,
  };
  return <MusicianWorkspace state={state} sync={{ lagMs: 0, receivedAt: Date.now() }} sheets={sheets} backend={backend} onSheetsChanged={async () => {}} onCreateAccount={null} status={<span className="text-2xs text-logic-text-muted">Rede local · teste</span>} logoutLabel="Sair" onLogout={() => {}} />;
}
createRoot(document.getElementById('root')!).render(<App />);
