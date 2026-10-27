import { useStore } from '@/store';
import { effectiveBpm } from '@/lib/musicianApi';
import { playedDuration } from '@/lib/medley';
import type { PlaylistEntry, Song } from '@/types';

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
}

export function toneLabel(tuner: number): string {
  return tuner === 0 ? 'Original' : `${tuner > 0 ? '+' : ''}${tuner}`;
}

export function bpmLabel(song: Song | undefined): string {
  if (!song) return '-';
  if (song.bpmMissing && !song.bpmDetected) return '?';
  return String(effectiveBpm(song.bpm, song.bpmDetected, song.bpmAdjust) ?? '-');
}

export function useShowTotals(playlist: PlaylistEntry[] = [], songs: Song[] = []) {
  const currentSongId = useStore((s) => s.transport.currentSongId);
  const isPlaying = useStore((s) => s.transport.isPlaying);
  const currentTime = useStore((s) => s.transport.currentTime);
  const durOf = (p: PlaylistEntry) => {
    if (!p) return 0;
    const dur = playedDuration(songs.find((s) => s.id === p.songId), p.duration ?? 0);
    return Number.isFinite(dur) && dur > 0 ? dur : 0;
  };
  const list = Array.isArray(playlist) ? playlist : [];
  const total = list.reduce((a, p) => a + durOf(p), 0);
  const curIdx = currentSongId ? list.findIndex((p) => p?.songId === currentSongId) : -1;
  const before = curIdx > 0 ? list.slice(0, curIdx).reduce((a, p) => a + durOf(p), 0) : 0;
  const played = curIdx >= 0 ? before + (isPlaying && Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0) : 0;
  return { total, played, remaining: Math.max(0, total - played) };
}
