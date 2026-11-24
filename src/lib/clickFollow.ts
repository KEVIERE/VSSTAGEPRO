import { barStartFlags, playLength } from './clickEdit.ts';
import { gridBeatTimes } from './grid.ts';
import type { ClickSoundId } from './clickSounds.ts';
import type { AudioClip, Song } from '@/types';

// Click gerado pelo programa acompanha o mapa de andamento. Só ele: o click importado é a
// referência da música e nunca é refeito sozinho. Contas puras, para dar para testar.

type SongTempo = Pick<Song, 'bpm' | 'beatsPerBar' | 'tempoSegments'>;

/** Marca do click feito pelo programa: o som usado e as batidas em que ele foi montado. */
export type GeneratedClickMark = { sound: ClickSoundId; beats: string };

export type ClickClip = AudioClip & { generatedClick?: GeneratedClickMark };

type ClipSpan = Pick<AudioClip, 'startTime' | 'duration' | 'trimStart' | 'trimEnd'>;

// Áudio montado pelo programa em cima da grade: o clipe feito com ele sai marcado como gerado.
const generatedAudio = new WeakMap<object, GeneratedClickMark>();

export function markGeneratedClick(buffer: object, mark: GeneratedClickMark): void {
  generatedAudio.set(buffer, mark);
}

export function generatedMarkOf(buffer: object): GeneratedClickMark | undefined {
  return generatedAudio.get(buffer);
}

/** Batidas da grade dentro do clipe, em segundos a partir do começo dele. */
export function generatedClickTimes(song: SongTempo, clip: ClipSpan): number[] {
  // 1 ms de folga: a duração do áudio é arredondada para cima e não contém uma batida bem no fim
  const end = clip.startTime + playLength(clip) - 0.001;
  return gridBeatTimes(song, clip.startTime, end).map((t) => t - clip.startTime);
}

/** Identidade das batidas e dos acentos (0,1 ms de resolução), para saber se o click ficou velho. */
export function clickBeatsKey(song: SongTempo, clip: ClipSpan): string {
  const times = generatedClickTimes(song, clip);
  const accents = barStartFlags(song, times.map((t) => clip.startTime + t));
  let hash = 2166136261;
  const mix = (v: number) => {
    hash ^= v;
    hash = Math.imul(hash, 16777619);
  };
  times.forEach((t, i) => {
    mix(Math.round(t * 10000));
    mix(accents[i] ? 1 : 0);
  });
  return `${times.length}:${(hash >>> 0).toString(36)}`;
}

/** Clipes de click gerados que não batem mais com o mapa atual da música. */
export function staleGeneratedClicks(song: SongTempo, clips: ClickClip[]): ClickClip[] {
  return clips.filter((c) => !!c.generatedClick && c.generatedClick.beats !== clickBeatsKey(song, c));
}

/** O mapa de andamento mudou? (BPM de ajuste não conta: ele não mexe na grade.) */
export function tempoMapChanged(a: SongTempo, b: SongTempo): boolean {
  return a.bpm !== b.bpm || a.beatsPerBar !== b.beatsPerBar || a.tempoSegments !== b.tempoSegments;
}

/**
 * Click que veio de fora: nunca tem as batidas movidas. Sem a marca nova, o que saiu do VS por IA
 * de versões antigas ainda é reconhecido pela rota 'ai' e pode ser alinhado à grade por inteiro.
 */
export function isImportedClick(clip: ClickClip): boolean {
  return !clip.generatedClick && clip.routingMethod !== 'ai';
}
