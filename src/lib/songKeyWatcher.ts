// IA de tom: descobre em segundo plano o tom de cada música do show (uma por vez, a do ar e a
// próxima primeiro) e guarda no projeto. Só refaz se o áudio da música mudar. O tom corrigido
// à mão (song.musicKey) sempre vale por cima do detectado.
// A análise mixa a música inteira na thread da tela: só roda pelo portão de fundo, com a música
// parada e nada abrindo (antes bastava passar 5 s do Play, e ela rodava no meio do show).
import { useStore } from '@/store';
import { detectSongKey } from '@/lib/bounceEngine';
import { loudnessSignature } from '@/lib/songLevel';
import { acquireBackgroundTurn } from '@/lib/backgroundGate';

let running = false;
let again = false;
const failed = new Map<string, string>();

function pending(): string[] {
  const st = useStore.getState();
  const order: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !order.includes(id)) order.push(id); };
  add(st.transport.currentSongId);
  add(st.transport.nextSongId);
  add(st.selectedSongId);
  st.playlist.forEach((p) => add(p.songId));
  return order.filter((id) => {
    const song = st.songs.find((s) => s.id === id);
    if (!song || song.musicKey) return false;
    const sig = loudnessSignature(id, st.clips);
    if (!sig || failed.get(id) === sig) return false;
    return st.songKeys?.[id]?.sig !== sig;
  });
}

async function run() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      for (const id of pending()) {
        // o show tem a vez: música tocando, abrindo, o começo da música no ar, clique recente
        const turn = await acquireBackgroundTurn();
        try {
          // o estado é lido depois da espera: durante o show a música pode ter mudado
          const st = useStore.getState();
          const song = st.songs.find((s) => s.id === id);
          if (!song || song.musicKey) continue;
          const sig = loudnessSignature(id, st.clips);
          if (!sig || failed.get(id) === sig || st.songKeys?.[id]?.sig === sig) continue;
          try {
            const r = await detectSongKey(song, st);
            // projeto trocado no meio: o resultado é de outro projeto
            if (turn.stale()) continue;
            if (r) useStore.getState().setSongDetectedKey(id, { key: r.key, sig });
            else failed.set(id, sig);
          } catch (err) {
            if (turn.stale()) continue;
            console.warn('[tom] não consegui analisar', song.name, err);
            failed.set(id, sig);
          }
        } finally {
          turn.release();
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } while (again);
  } finally {
    running = false;
  }
}

export function startSongKeyWatcher(): () => void {
  const kick = () => { window.setTimeout(() => void run(), 1500); };
  kick();
  return useStore.subscribe((s, prev) => {
    if (s.clips !== prev.clips || s.playlist !== prev.playlist || s.songs !== prev.songs) kick();
  });
}
