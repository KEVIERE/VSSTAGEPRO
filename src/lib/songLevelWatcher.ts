// Mede em segundo plano o loudness das músicas do show quando o "volume igual" está ligado.
// Uma música por vez, a que está no ar e a próxima primeiro; cada medida fica guardada no
// projeto e só é refeita se o áudio da música mudar (clipes, cortes, ganho de clipe).
import { useStore } from '@/store';
import { audioEngine } from '@/lib/audioEngine';
import { measureSongLoudness } from '@/lib/bounceEngine';
import { loudnessSignature, validLoudness } from '@/lib/songLevel';

let running = false;
let again = false;
let progress: { done: number; total: number } | null = null;
const listeners = new Set<() => void>();
const failed = new Map<string, string>();

export function levelProgress() { return progress; }
export function onLevelProgress(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setProgress(p: typeof progress) { progress = p; listeners.forEach((l) => l()); }

function pending(): string[] {
  const st = useStore.getState();
  const order: string[] = [];
  const add = (id: string | null | undefined) => { if (id && !order.includes(id)) order.push(id); };
  add(st.transport.currentSongId);
  add(st.transport.nextSongId);
  add(st.selectedSongId);
  st.playlist.forEach((p) => add(p.songId));
  const sigOf = (id: string) => loudnessSignature(id, st.clips);
  return order.filter((id) => st.songs.some((s) => s.id === id) && !validLoudness(st, id) && failed.get(id) !== sigOf(id));
}

async function run() {
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      const todo = pending();
      const total = todo.length;
      let done = 0;
      if (total > 0) setProgress({ done, total });
      for (const id of todo) {
        const st = useStore.getState();
        if (!st.levelMatch) break;
        // o Play tem a vez
        while (audioEngine.isStarting()) await new Promise((r) => setTimeout(r, 200));
        const song = st.songs.find((s) => s.id === id);
        if (!song || validLoudness(st, id)) { done++; continue; }
        const sig = loudnessSignature(id, st.clips);
        try {
          const m = await measureSongLoudness(song, st);
          useStore.getState().setSongLoudness(id, { ...m, sig });
        } catch (err) {
          console.warn('[volume igual] não consegui medir', song.name, err);
          failed.set(id, sig);
        }
        done++;
        setProgress({ done, total });
        await new Promise((r) => setTimeout(r, 50));
      }
    } while (again && useStore.getState().levelMatch);
  } finally {
    running = false;
    setProgress(null);
  }
}

export function startSongLevelWatcher(): () => void {
  if (useStore.getState().levelMatch) void run();
  return useStore.subscribe((s, prev) => {
    if (!s.levelMatch) return;
    if (s.levelMatch !== prev.levelMatch || s.clips !== prev.clips || s.playlist !== prev.playlist || s.songs !== prev.songs) void run();
  });
}
