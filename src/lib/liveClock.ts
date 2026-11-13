import type { LiveView, ShowLive, SignalStatus } from '@/lib/musicianTypes';

const STALE_PLAYING_MS = 4000;
const STALE_IDLE_MS = 12000;
const BACKWARD_JUMP_S = 1.5;

export function serverLagMs(serverNow: string, liveAt: string): number {
  const lag = Date.parse(serverNow) - Date.parse(liveAt);
  return Number.isFinite(lag) ? Math.max(0, lag) : 0;
}

export function computeLiveView(
  live: ShowLive | null, duration: number | undefined, lagMs: number, receivedAt: number, now: number,
  stalePlayingMs = STALE_PLAYING_MS,
): LiveView {
  if (!live) return { status: 'ended', isPlaying: false, currentTime: 0, songProgress: 0, nextSongCountdown: 0 };
  const age = lagMs + (now - receivedAt);
  const status: SignalStatus = live.onAir !== true ? 'ended'
    : age > (live.isPlaying ? stalePlayingMs : Math.max(STALE_IDLE_MS, stalePlayingMs)) ? 'nosignal' : 'live';
  const playing = live.isPlaying && status === 'live';
  if (!playing) {
    const base = live.currentTime ?? 0;
    // Caiu o sinal no meio da música: para onde a estimativa estava, sem voltar ao último pacote.
    // No tique da troca a idade vale `stalePlayingMs`, então o tempo segue contínuo e só congela.
    // isPlaying continua false de propósito: o holdForward zera a memória e volta limpo quando o
    // sinal retorna, e os avisos programados não ficam presos com o tempo parado.
    if (live.isPlaying && status === 'nosignal') {
      const held = stalePlayingMs / 1000;
      const t = duration ? Math.min(duration, base + held) : base + held;
      return {
        status, isPlaying: false, currentTime: t,
        songProgress: duration ? Math.min(1, t / duration) : live.songProgress ?? 0,
        nextSongCountdown: live.nextSongCountdown > 0 ? Math.max(0, live.nextSongCountdown - held) : 0,
      };
    }
    return {
      status, isPlaying: false, currentTime: base,
      songProgress: live.songProgress ?? 0, nextSongCountdown: live.nextSongCountdown ?? 0,
    };
  }
  const elapsed = Math.max(0, age) / 1000;
  const t = duration ? Math.min(duration, live.currentTime + elapsed) : live.currentTime + elapsed;
  return {
    status, isPlaying: true, currentTime: t,
    songProgress: duration ? Math.min(1, t / duration) : live.songProgress,
    nextSongCountdown: live.nextSongCountdown > 0 ? Math.max(0, live.nextSongCountdown - elapsed) : 0,
  };
}

// Each director update shifts the estimate a few tenths; small backward steps are network noise, large ones are real seeks or loops.
export function holdForward(
  view: LiveView, songId: string | null, mem: { songId: string | null; t: number }, duration: number | undefined,
): LiveView {
  if (mem.songId !== songId || !view.isPlaying) {
    mem.songId = songId;
    mem.t = view.currentTime;
    return view;
  }
  const back = mem.t - view.currentTime;
  if (back > 0 && back < BACKWARD_JUMP_S) {
    return { ...view, currentTime: mem.t, songProgress: duration ? Math.min(1, mem.t / duration) : view.songProgress };
  }
  mem.t = view.currentTime;
  return view;
}
