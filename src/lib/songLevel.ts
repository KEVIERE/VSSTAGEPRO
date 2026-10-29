// "Volume igual entre os VS": cada música tem o loudness (LUFS) e o pico real medidos uma vez;
// com a função ligada, todas recebem o ganho para soar no MESMO loudness. O alvo é o mais alto
// que todas as músicas do show alcançam sem o pico passar de -1 dBTP — assim todas ficam iguais
// e nenhuma clipa o master. Sem dependências do motor: o motor e a exportação só leem o ganho.
import { getClipSource } from '@/lib/audioLibrary';
import { dbToGain, gainToDb, matchGain } from '@/lib/loudness';
import { isTimecodeTrackId } from '@/lib/timecode';
import type { AudioClip, ProjectState, SongLoudness } from '@/types';

export const LEVEL_CEILING_DBTP = -1;
const TARGET_MAX = -14;
const TARGET_MIN = -23;

type LevelState = Pick<ProjectState, 'songs' | 'clips' | 'playlist' | 'levelMatch' | 'songLoudness'>;

/** O que define o som gravado da música (não entram os faders: mexer no show não muda a medida). */
export function loudnessSignature(songId: string, clips: AudioClip[]): string {
  return clips
    .filter((c) => c.songId === songId && !isTimecodeTrackId(c.trackId))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id}|${c.trackId}|${c.startTime.toFixed(3)}|${(c.trimStart ?? 0).toFixed(3)}|${(c.trimEnd ?? 0).toFixed(3)}|${c.gain ?? 1}|${c.mute ? 1 : 0}|${getClipSource(c.id)?.size ?? 0}`)
    .join('~');
}

export function validLoudness(state: LevelState, songId: string): SongLoudness | null {
  const m = state.songLoudness?.[songId];
  return m && m.sig === loudnessSignature(songId, state.clips) ? m : null;
}

/** Loudness comum (LUFS) das músicas do show, ou null se nenhuma foi medida ainda. */
export function levelTarget(state: LevelState): number | null {
  const ids = state.playlist.length ? state.playlist.map((p) => p.songId) : state.songs.map((s) => s.id);
  let reach = Infinity;
  for (const id of new Set(ids)) {
    const m = validLoudness(state, id);
    if (!m || !Number.isFinite(m.lufs) || m.peak <= 0) continue;
    reach = Math.min(reach, m.lufs + (LEVEL_CEILING_DBTP - gainToDb(m.peak)));
  }
  if (!Number.isFinite(reach)) return null;
  return Math.max(TARGET_MIN, Math.min(TARGET_MAX, reach));
}

/** Ganho (linear) desta música com o nivelamento ligado; 1 se desligado ou ainda sem medida. */
export function songLevelGain(state: LevelState, songId: string): number {
  if (!state.levelMatch) return 1;
  const m = validLoudness(state, songId);
  const target = levelTarget(state);
  if (!m || target === null) return 1;
  return matchGain(m.lufs, m.peak, target, LEVEL_CEILING_DBTP);
}

export { dbToGain };
