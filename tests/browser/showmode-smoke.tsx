// Modo Show e mixer sem precisar entrar no programa: o cronômetro "Falta no show" e o
// Anti-Clip do master. Abrir com o servidor de desenvolvimento: /tests/browser/showmode-smoke.html
import { createRoot } from 'react-dom/client';
import ShowModePanel from '../../src/components/ShowModePanel';
import MixerPanel from '../../src/components/MixerPanel';
import { useStore } from '../../src/store';
import type { PlaylistEntry, Song } from '../../src/types';
import '/src/index.css';

// show sintético de 1:05:35 (14 músicas)
const durs = [316, 306, 143, 469, 410, 113, 296, 301, 320, 280, 270, 260, 241, 210];
const songs: Song[] = durs.map((d, i) => ({
  id: `s${i}`, name: `Música ${i + 1}`, clips: [], bpm: 98, bpmAdjust: 0, tuner: 0, duration: d, timelineStart: 0, blockId: null,
}));
const playlist: PlaylistEntry[] = songs.map((s, i) => ({ id: `p${i}`, songId: s.id, name: s.name, order: i, bpm: 98, blockId: null, duration: s.duration }));
useStore.setState({ songs, playlist, playlistOrder: songs.map((s) => s.id), activeShowId: 'show-fazenda', mixerVisible: true });

createRoot(document.getElementById('root')!).render(
  <div className="flex flex-col h-screen bg-logic-bg-deep text-logic-text">
    <div className="flex flex-1 min-h-0">
      <div className="flex-1 grid place-items-center text-logic-text-muted text-sm">(playlist)</div>
      <ShowModePanel showName="A FAZENDA" />
    </div>
    <MixerPanel />
  </div>,
);
