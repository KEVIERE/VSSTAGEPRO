// IA de tom: descobre em segundo plano o tom de cada música do show (uma por vez, a do ar e a
// próxima primeiro) e guarda no projeto. Só refaz se o áudio da música mudar. O tom corrigido
// à mão (song.musicKey) sempre vale por cima do detectado.
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { renderMelodicMono } from '@/lib/bounceEngine';
import { detectKey } from '@/lib/musicKey';
import { loudnessSignature } from '@/lib/songLevel';

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
        // o Play e a exportação têm a vez
        while (audioEngine.isStarting()) await new Promise((r) => setTimeout(r, 300));
        const st = useStore.getState();
        const song = st.songs.find((s) => s.id === id);
        if (!song || song.musicKey) continue;
        const sig = loudnessSignature(id, st.clips);
        try {
          const { mono, sampleRate } = await renderMelodicMono(song, st);
          const r = detectKey(mono, sampleRate);
          if (r) useStore.getState().setSongDetectedKey(id, { key: r.key, sig });
          else failed.set(id, sig);
        } catch (err) {
          console.warn('[tom] não consegui analisar', song.name, err);
          failed.set(id, sig);
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
