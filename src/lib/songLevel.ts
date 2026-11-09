// "Volume igual entre os VS" (botão IGUALAR): o usuário escolhe um pico em dB (ex.: -2) e cada
// música recebe o ganho para o MAIOR pico dela ficar exatamente nesse valor. As músicas mais
// baixas sobem e as mais altas descem até o mesmo pico. O pico de cada música é medido uma vez
// (true peak da gravação com os faders em 0 dB). Sem dependências do motor: o motor e a
// exportação só leem o ganho.
import { getClipSource } from '@/lib/audioLibrary';
import { dbToGain, peakMatchGain } from '@/lib/loudness';
import { isTimecodeTrackId } from '@/lib/timecode';
import { MAX_BOOST_DB, TARGET_DB_DEFAULT, clampTarget } from '@/lib/levelTarget';
import type { AudioClip, ProjectState, SongLoudness } from '@/types';

type LevelState = Pick<ProjectState, 'songs' | 'clips' | 'playlist' | 'levelMatch' | 'levelMatchDb' | 'songLoudness'>;

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

/** Pico (dB) em que todas as músicas ficam: o que o usuário escolheu, ou o padrão. */
export function levelTarget(state: LevelState): number {
  const db = state.levelMatchDb;
  return typeof db === 'number' && Number.isFinite(db) ? clampTarget(db) : TARGET_DB_DEFAULT;
}

/** Ganho (linear) desta música com o IGUALAR ligado; 1 se desligado ou ainda sem medida. */
export function songLevelGain(state: LevelState, songId: string): number {
  if (!state.levelMatch) return 1;
  const m = validLoudness(state, songId);
  if (!m || m.peak <= 0) return 1;
  return peakMatchGain(m.peak, levelTarget(state), MAX_BOOST_DB);
}

/**
 * A música é tão baixa que nem subindo o máximo (+24 dB) chega ao pico pedido. Serve só para
 * avisar na tela: ela continua tocando, só que abaixo das outras.
 */
export function belowTarget(state: LevelState, songId: string): boolean {
  if (!state.levelMatch) return false;
  const m = validLoudness(state, songId);
  if (!m || m.peak <= 0) return false;
  return m.peak * dbToGain(MAX_BOOST_DB) < dbToGain(levelTarget(state)) - 1e-9;
}

export { dbToGain };
export { MAX_BOOST_DB, TARGET_DB_DEFAULT, TARGET_DB_MAX, TARGET_DB_MIN, clampTarget, parseTargetDb } from '@/lib/levelTarget';
