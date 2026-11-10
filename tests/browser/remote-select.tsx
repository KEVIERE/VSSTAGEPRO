// Lista do VS Stage Remote ligada a um Mac simulado com o código de verdade do programa (store,
// applyRemoteCommand e buildRemoteState). O comando chega ao "Mac" depois de `lat` ms e o estado
// volta depois de outros `lat` ms, como numa rede.
//   ?lat=800   rede lenta
//   ?dead      o Mac não responde (o destaque volta e o celular avisa)
// No console: window.__mac.drop('s3') tira a música da lista do Mac (o Mac recusa a seleção).
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import RemoteSetlist from '../../src/components/remote/RemoteSetlist';
import { useStore } from '../../src/store';
import { applyRemoteCommand, buildRemoteState, onRemoteReply } from '../../src/lib/remoteHost';
import type { RemoteCommand } from '../../src/lib/remoteProtocol';
import type { PlaylistEntry, Song } from '../../src/types';

const params = new URLSearchParams(location.search);
const LAT = Number(params.get('lat') ?? 250);
const DEAD = params.has('dead');

const names = ['Grande é o Senhor', 'Aclame ao Senhor', 'Te Louvarei', 'Oceanos', 'Bondade de Deus'];
const songs = names.map((name, i) => ({
  id: `s${i + 1}`, name, clips: [], bpm: 90 + i * 4, bpmDetected: true, bpmAdjust: 0, tuner: 0,
  duration: 180 + i * 20, timelineStart: 0, blockId: null, regions: [],
})) as Song[];
const playlist: PlaylistEntry[] = songs.map((s, i) => ({ id: `p${i}`, songId: s.id, name: s.name, order: i, blockId: null, duration: s.duration }));
useStore.setState({ songs, playlist, playlistOrder: playlist.map((p) => p.songId), selectedSongId: 's1' });

/** Comandos recebidos pelo "Mac" (para conferir no teste). */
const received: RemoteCommand[] = [];
(window as unknown as { __mac: unknown }).__mac = {
  received,
  selected: () => useStore.getState().selectedSongId,
  drop: (songId: string) => useStore.setState((s) => ({ playlist: s.playlist.filter((p) => p.songId !== songId) })),
};

function App() {
  const [state, setState] = useState(buildRemoteState);
  useEffect(() => {
    const push = () => { window.setTimeout(() => setState(buildRemoteState()), LAT); };
    const offStore = useStore.subscribe(push);
    const offReply = onRemoteReply(push);
    return () => { offStore(); offReply(); };
  }, []);
  const send = (cmd: RemoteCommand) => {
    if (DEAD) return;
    window.setTimeout(() => { received.push(cmd); applyRemoteCommand(cmd); }, LAT);
  };
  return (
    <div className="console-face h-full overflow-y-auto text-logic-text">
      <RemoteSetlist state={state} send={send} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
