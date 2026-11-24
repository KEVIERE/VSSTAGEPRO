// Mede em segundo plano o loudness das músicas do show quando o "volume igual" está ligado.
// Uma música por vez, a que está no ar e a próxima primeiro; cada medida fica guardada no
// projeto e só é refeita se o áudio da música mudar (clipes, cortes, ganho de clipe).
// A medida mixa a música inteira na thread da tela: só roda pelo portão de fundo, com a música
// parada e nada abrindo, e para no próximo clipe se o Play vier no meio (mede de novo depois).
import { useStore } from '@/store';
import { measureSongLoudness } from '@/lib/bounceEngine';
import { loudnessSignature, validLoudness } from '@/lib/songLevel';
import { acquireBackgroundTurn } from '@/lib/backgroundGate';

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

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
  const sigOf = (id: string) => loudnessSignature(id, st.clips, st.tracks);
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
        if (!useStore.getState().levelMatch) break;
        // o show tem a vez: música tocando, abrindo, o começo da música no ar, clique recente
        const turn = await acquireBackgroundTurn();
        let stopped = false;
        try {
          // o estado é lido depois da espera: durante o show a música pode ter mudado
          const st = useStore.getState();
          if (!st.levelMatch) break;
          const song = st.songs.find((s) => s.id === id);
          if (!song || validLoudness(st, id)) { done++; continue; }
          const sig = loudnessSignature(id, st.clips, st.tracks);
          if (failed.get(id) === sig) { done++; continue; }
          try {
            const m = await measureSongLoudness(song, st, turn.shouldStop);
            if (!turn.stale()) useStore.getState().setSongLoudness(id, { ...m, sig });
          } catch (err) {
            if (turn.stale() || (isAbort(err) && turn.shouldStop())) {
              // o Play veio no meio (ou o projeto trocou): não é falha, mede de novo depois
              stopped = true;
            } else {
              console.warn('[volume igual] não consegui medir', song.name, err);
              failed.set(id, sig);
            }
          }
        } finally {
          turn.release();
        }
        if (stopped) { again = true; break; }
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
    if (s.levelMatch !== prev.levelMatch || s.clips !== prev.clips || s.tracks !== prev.tracks || s.playlist !== prev.playlist || s.songs !== prev.songs) void run();
  });
}
