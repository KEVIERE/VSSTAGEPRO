import { audioEngine, isMelodicTrack } from '@/lib/audioEngine';
import { getClipPlayAudio, getClipSource, openClipAudio, putClipAudio, withSongAudio } from '@/lib/audioLibrary';
import { MAESTRO_IA_TRACK_ID } from '@/lib/narrations';
import { lastSoundIndex, planSongEnd, SILENCE_INT16, type SongEndPlan } from '@/lib/songEnd';
import { isTimecodeTrackId } from '@/lib/timecode';
import { useStore } from '@/store';
import type { AudioClip, Track } from '@/types';

// Ajustar fim (barra da grade): corta o silêncio do final do VS 0,5 s depois do último som de
// harmonia. Cada corte só esconde o trecho (o arquivo fica inteiro) e tudo volta com um Cmd+Z.

function inTree(track: Track | undefined, rootId: string, all: Track[]): boolean {
  for (let t = track, guard = 0; t && guard < 50; guard++) {
    if (t.id === rootId) return true;
    t = t.parentId ? all.find((x) => x.id === t!.parentId) : undefined;
  }
  return false;
}

/** Click, Maestro, Maestro IA e Timecode nunca servem de referência para o fim. */
function isNeverReference(track: Track | undefined, all: Track[]): boolean {
  if (!track) return true;
  return isTimecodeTrackId(track.id) || ['track-click', 'track-maestro', MAESTRO_IA_TRACK_ID].some((id) => inTree(track, id, all));
}

/** Harmonia: as faixas melódicas, fora Guia e as que nunca servem de referência. */
function isHarmony(track: Track | undefined, all: Track[]): boolean {
  return !!track && !isNeverReference(track, all) && !inTree(track, 'track-guia', all) && isMelodicTrack(track, all);
}

/** Segundos do último som no trecho que toca do clipe, ou null (mudo, silêncio ou sem arquivo). */
async function lastSoundOf(clip: AudioClip): Promise<number | null> {
  if (clip.mute) return null;
  let audio = getClipPlayAudio(clip);
  if (!audio) {
    const src = getClipSource(clip.id);
    if (!src) return null;
    putClipAudio(clip.id, clip.songId, await openClipAudio(clip.songId, clip.id, src));
    audio = getClipPlayAudio(clip);
  }
  if (!audio) return null;
  const idx = lastSoundIndex(audio.channels, SILENCE_INT16);
  return idx < 0 ? null : (idx + 1) / audio.sampleRate;
}

async function planFor(songId: string): Promise<SongEndPlan | null> {
  const { clips: all, tracks } = useStore.getState();
  const clips = all.filter((c) => c.songId === songId);
  const trackOf = (c: AudioClip) => tracks.find((t) => t.id === c.trackId);
  const harmony = new Set(clips.filter((c) => isHarmony(trackOf(c), tracks)).map((c) => c.id));
  const others = new Set(clips.filter((c) => !harmony.has(c.id) && !isNeverReference(trackOf(c), tracks)).map((c) => c.id));

  // Lê primeiro só a harmonia; as outras faixas só se a harmonia estiver em silêncio.
  const last = new Map<string, number | null>();
  for (const c of clips) if (harmony.has(c.id)) last.set(c.id, await lastSoundOf(c));
  if (![...last.values()].some((v) => v != null)) {
    for (const c of clips) if (others.has(c.id)) last.set(c.id, await lastSoundOf(c));
  }
  return planSongEnd(clips, last, harmony, others);
}

function apply(plans: { songId: string; plan: SongEndPlan }[]) {
  if (!plans.length) return;
  useStore.getState().applySongEnds(plans.map(({ songId, plan }) => ({ songId, trims: plan.trims, removeIds: plan.removeIds })));
  plans.forEach(({ songId }) => audioEngine.invalidatePrepared(songId));
}

/** Ajustar fim desta música. Devolve quantos segundos saíram (0 = já estava certo). */
export async function trimSongEnd(songId: string): Promise<number> {
  const plan = await withSongAudio(songId, () => planFor(songId));
  if (!plan) return 0;
  apply([{ songId, plan }]);
  return plan.cut;
}

/** Ajustar fim de todas as músicas do show, uma por vez (solta o áudio de cada uma depois). */
export async function trimAllSongEnds(onProgress?: (done: number, total: number) => void): Promise<{ changed: number; unchanged: number; cut: number }> {
  const ids = [...new Set(useStore.getState().playlist.map((p) => p.songId))];
  const plans: { songId: string; plan: SongEndPlan }[] = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress?.(i, ids.length);
    const plan = await withSongAudio(ids[i], () => planFor(ids[i])).catch(() => null);
    if (plan) plans.push({ songId: ids[i], plan });
  }
  apply(plans);
  return { changed: plans.length, unchanged: ids.length - plans.length, cut: plans.reduce((s, p) => s + p.plan.cut, 0) };
}
