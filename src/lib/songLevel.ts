// "Volume igual entre os VS" (botão IGUALAR): mede o volume percebido (LUFS) só da banda de cada
// música e aplica o ganho nos canais da banda, em qualquer saída da placa. Click, guia, Maestro e
// timecode ficam sempre no mesmo volume. Nenhuma música passa do teto de pico. Sem dependências do
// motor: o motor e a exportação só leem o ganho.
import { getClipSource } from '@/lib/audioLibrary';
import { dbToGain, gainToDb, matchGain } from '@/lib/loudness';
import { LEVEL_CEILING_DBTP, MAX_BOOST_DB, TARGET_LUFS_DEFAULT, clampLufs, isFixedLevelTrack } from '@/lib/levelTarget';
import type { AudioClip, ProjectState, SongLoudness, Track } from '@/types';

type LevelState = Pick<ProjectState, 'songs' | 'clips' | 'tracks' | 'playlist' | 'levelMatch' | 'levelMatchLufs' | 'songLoudness'>;

/** Sobe quando a forma de medir muda: a medida antiga (pico do mix inteiro) é refeita. */
const MEASURE_VERSION = 'banda-lufs-1';

/** O que define o som gravado da banda (não entram os faders: mexer no show não muda a medida). */
export function loudnessSignature(songId: string, clips: AudioClip[], tracks: Pick<Track, 'id' | 'parentId'>[]): string {
  const band = clips
    .filter((c) => c.songId === songId && !isFixedLevelTrack(c.trackId, tracks))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id}|${c.trackId}|${c.startTime.toFixed(3)}|${(c.trimStart ?? 0).toFixed(3)}|${(c.trimEnd ?? 0).toFixed(3)}|${c.gain ?? 1}|${c.mute ? 1 : 0}|${getClipSource(c.id)?.size ?? 0}`)
    .join('~');
  return `${MEASURE_VERSION}~${band}`;
}

export function validLoudness(state: LevelState, songId: string): SongLoudness | null {
  const m = state.songLoudness?.[songId];
  return m && m.sig === loudnessSignature(songId, state.clips, state.tracks) ? m : null;
}

/** Volume (LUFS) em que a banda de todas as músicas fica: o escolhido, ou o padrão. */
export function levelTarget(state: LevelState): number {
  const v = state.levelMatchLufs;
  return typeof v === 'number' && Number.isFinite(v) ? clampLufs(v) : TARGET_LUFS_DEFAULT;
}

/** Ganho (linear) da banda desta música com o IGUALAR ligado; 1 se desligado ou ainda sem medida. */
export function songLevelGain(state: LevelState, songId: string): number {
  if (!state.levelMatch) return 1;
  const m = validLoudness(state, songId);
  if (!m || m.peak <= 0 || !Number.isFinite(m.lufs)) return 1;
  return Math.min(dbToGain(MAX_BOOST_DB), matchGain(m.lufs, m.peak, levelTarget(state), LEVEL_CEILING_DBTP));
}

/**
 * A música não chega ao volume pedido sem passar do teto de pico. Serve só para avisar na tela:
 * ela continua tocando, só que um pouco abaixo das outras.
 */
export function belowTarget(state: LevelState, songId: string): boolean {
  if (!state.levelMatch) return false;
  const m = validLoudness(state, songId);
  if (!m || m.peak <= 0 || !Number.isFinite(m.lufs)) return false;
  return m.lufs + gainToDb(songLevelGain(state, songId)) < levelTarget(state) - 0.5;
}

export { dbToGain };
export { MAX_BOOST_DB, TARGET_DB_DEFAULT, TARGET_LUFS_DEFAULT, TARGET_LUFS_MAX, TARGET_LUFS_MIN, clampLufs, isFixedLevelTrack, parseTargetLufs } from '@/lib/levelTarget';
