// Fotos do site: Área do Músico no celular com o mesmo show de exemplo das outras fotos
// (Música 01 a 08 em dois blocos, Música 02 tocando com a cifra do violão).
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import MusicianWorkspace from '../../src/components/musician/MusicianWorkspace';
import { emptyDoc, newLine } from '../../src/lib/notebook';
import type { MusicianState, SheetBackend, SheetInfo } from '../../src/lib/musicianTypes';

const doc = emptyDoc();
const parts: Array<[string, Array<[string, Array<[number, string]>]>]> = [
  ['Intro', [['', [[0, 'D'], [6, 'A'], [12, 'Bm'], [18, 'G']]]]],
  ['Verso', [
    ['A cidade acende as luzes devagar', [[0, 'D'], [14, 'A']]],
    ['E a gente chega junto pra cantar', [[0, 'Bm'], [16, 'G']]],
    ['Cada voz que sobe faz o chão tremer', [[0, 'D'], [18, 'A']]],
    ['Hoje a noite é nossa, pode crer', [[0, 'G'], [14, 'A']]],
  ]],
  ['Pré-refrão', [
    ['Levanta a mão e canta comigo', [[0, 'Em'], [16, 'G']]],
    ['Que o melhor ainda vai chegar', [[0, 'A'], [14, 'A7']]],
  ]],
  ['Refrão', [
    ['É agora, é a nossa hora', [[0, 'D'], [12, 'A']]],
    ['Todo mundo no mesmo compasso', [[0, 'Bm'], [16, 'G']]],
    ['É agora, ninguém vai embora', [[0, 'D'], [12, 'A/C#']]],
    ['Enquanto a música tocar', [[0, 'G'], [10, 'A'], [18, 'D']]],
  ]],
];
for (const [label, lines] of parts) {
  doc.lines.push({ ...newLine('section'), label } as never);
  for (const [lyric, chords] of lines) doc.lines.push({ ...newLine('chords'), lyric, chords: chords.map(([at, chord]) => ({ at, chord })) } as never);
}
const sheets: SheetInfo[] = [{ id: 'sh1', song_id: 's2', title: 'Música 02', content: JSON.stringify(doc), shared_from: null, updated_at: new Date().toISOString() }];
const backend: SheetBackend = {
  key: 'fotos', storedIn: 'nas fotos',
  save: async () => 'sh1', remove: async () => {}, songLyrics: async () => [], colleagues: async () => [], share: async () => 0,
};

const SONGS: Array<[string, number, string, number, string | null]> = [
  ['Música 01', 128, 'G', 131, 'b1'], ['Música 02', 75, 'D', 142, 'b1'], ['Música 03', 68, 'A', 152, 'b1'], ['Música 04', 140, 'E', 163, 'b1'],
  ['Música 05', 82, 'C', 174, 'b1'], ['Música 06', 90, 'Bm', 138, 'b2'], ['Música 07', 76, 'F', 149, 'b2'], ['Música 08', 120, 'Em', 160, 'b2'],
];

function App() {
  const [t, setT] = useState(78);
  useEffect(() => { const id = setInterval(() => setT((x) => (x + 1) % 140), 1000); return () => clearInterval(id); }, []);
  const now = new Date().toISOString();
  const state: MusicianState = {
    musician: { id: 'm1', name: 'João', instrument: 'Violão' },
    show: {
      name: 'Show Prefeitura',
      setlist: {
        songs: SONGS.map(([name, bpm, key, duration, blockId], i) => ({ id: `s${i + 1}`, name, duration, bpm, baseBpm: bpm, bpmAdjust: 0, tuner: 0, musicKey: key, blockId })),
        blocks: [{ id: 'b1', name: 'Bloco 01', color: '#0a84ff' }, { id: 'b2', name: 'Bloco 02', color: '#ff9f0a' }],
        order: SONGS.map((_, i) => `s${i + 1}`),
      } as never,
      live: { isPlaying: true, isPaused: false, currentTime: t, songProgress: t / 142, nextSongCountdown: 142 - t, currentSongId: 's2', nextSongId: 's3', sliceId: null, sliceName: null, bpm: 75, playFlow: 'continuo', onAir: true, publishedAt: Date.now() },
      live_at: now,
    },
    server_now: now,
  };
  return <MusicianWorkspace state={state} sync={{ lagMs: 0, receivedAt: Date.now() }} sheets={sheets} backend={backend} onSheetsChanged={async () => {}} onCreateAccount={null} status={<span className="text-2xs text-logic-text-muted">Rede local</span>} logoutLabel="Sair" onLogout={() => {}} />;
}
createRoot(document.getElementById('root')!).render(<App />);
