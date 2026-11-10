// Tela Rede Local do diretor com músicos do projeto: dois online, um offline, um esperando
// aprovação, e o produtor conectado. "Desconectar" e "Excluir" mexem no livro de contas do store.
import '../../src/index.css';
import { createRoot } from 'react-dom/client';
import LocalNetworkDialog from '../../src/components/network/LocalNetworkDialog';
import { useStore } from '../../src/store';
import type { LocalBroadcast } from '../../src/lib/useLocalBroadcast';
import type { MusicianAccount } from '../../src/types';

const at = new Date().toISOString();
const account = (id: string, name: string, instrument: string, status: MusicianAccount['status']): MusicianAccount => ({
  id, username: name.toLowerCase(), name, instrument, avatar: null, passwordHash: '$2a$10$x', status,
  remember: ['h1'], createdAt: at, updatedAt: at, sheets: {},
});
useStore.setState({
  musicianBook: {
    id: 'livro', removed: [],
    accounts: [
      account('a1', 'Ana', 'Voz', 'approved'),
      account('a2', 'Bruno', 'Baixo', 'approved'),
      account('a3', 'Caio', 'Guitarra', 'approved'),
      account('a4', 'Duda', 'Teclado', 'pending'),
    ],
  },
});
(window as unknown as { __book: () => unknown }).__book = () => useStore.getState().musicianBook;

const now = Date.now();
const local: LocalBroadcast = {
  available: true,
  mode: 'local',
  error: null,
  lyricsReceived: null,
  dismissLyrics: () => {},
  setMode: () => {},
  regeneratePin: async () => {},
  kick: async () => {},
  info: {
    running: true, port: 8080, hostName: 'vsstage.local', addresses: ['192.168.0.10'],
    pins: { musician: '111111', producer: '222222', remote: '333333' },
    qr: { musician: null, producer: null, screen: null, remote: null },
    urls: { musician: 'http://192.168.0.10:8080/musico', producer: 'http://192.168.0.10:8080/produtor', screen: 'http://192.168.0.10:8080/tela', remote: 'http://192.168.0.10:8080/show' },
    clients: [
      { id: 'c1', role: 'musician', name: 'Ana', address: '192.168.0.21', lastSeen: now, accountId: 'a1' },
      { id: 'c2', role: 'musician', name: 'Bruno', address: '192.168.0.22', lastSeen: now, accountId: 'a2' },
      { id: 'c3', role: 'producer', name: 'Produtor', address: '192.168.0.30', lastSeen: now },
    ],
    lyrics: {}, lyricsSaveRequestedAt: null, error: null,
  } as LocalBroadcast['info'],
};

createRoot(document.getElementById('root')!).render(<LocalNetworkDialog local={local} onClose={() => {}} />);
