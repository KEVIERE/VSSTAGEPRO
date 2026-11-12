// Regras puras das marcações de fala do Maestro por IA (sem store, sem áudio): a ordem, o
// encaixe no espaço livre, o beat do cursor e as palavras por minuto que o tamanho pede.
import type { MaestroNarration, Song, SongTempoSegment } from '@/types';

export const NARRATION_MIN_LENGTH = 0.35;

/** Subfaixa do Maestro onde ficam os áudios gerados pelo Maestro por IA. */
export const MAESTRO_IA_TRACK_ID = 'track-maestro-ia';

/** Palavras por minuto de uma fala normal; o ajuste parte daqui. */
export const BASE_WPM = 165;
/** Limites que o motor de voz do sistema aceita. */
export const MIN_WPM = 80;
export const MAX_WPM = 420;
/** Acima disso a fala começa a ficar difícil de entender: a tela avisa. */
export const FAST_WPM = 300;
/** Acelera 5% além do necessário para o texto terminar antes do fim da marcação. */
const FIT_MARGIN = 1.05;
/** Folga para o cursor parado "quase" no beat (arredondamento, atraso do clique) contar como nele. */
const BEAT_TOLERANCE = 0.05;

export type VoicePreset = 'feminina' | 'masculina';

export const VOICE_PRESETS: ReadonlyArray<{ id: VoicePreset; label: string }> = [
  { id: 'feminina', label: 'Feminina' },
  { id: 'masculina', label: 'Masculina' },
];

/** Marcações da música em ordem de início. */
export function sortedNarrations<T extends Pick<MaestroNarration, 'start'>>(list: T[] | undefined): T[] {
  return [...(list ?? [])].sort((a, b) => a.start - b.start);
}

/** Quantas palavras o texto tem (o que a fala vai levar para sair). */
export function wordCount(text: string): number {
  return Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
}

/**
 * Palavras por minuto para o texto caber no intervalo da marcação.
 * A marcação menor deixa a fala mais rápida; a maior deixa mais espaçada: é o tamanho da
 * marcação que manda, e é assim que o maestro segura ou acelera a leitura.
 */
export function wpmForSpan(text: string, span: number): number {
  const seconds = Math.max(0.3, span);
  // arredonda para cima: arredondar para baixo faria a fala passar do fim da marcação
  const required = Math.ceil((wordCount(text) / seconds) * 60 * FIT_MARGIN);
  return Math.max(MIN_WPM, Math.min(MAX_WPM, required));
}

/** Tamanho (s) que dá esta velocidade para o texto: o controle de ritmo anda o fim da marcação. */
export function spanForWpm(text: string, wpm: number): number {
  const clamped = Math.max(MIN_WPM, Math.min(MAX_WPM, wpm));
  return Math.max(NARRATION_MIN_LENGTH, ((wordCount(text) * 60) / clamped) * FIT_MARGIN);
}

/** Espaço (s) que o texto ocupa no ritmo de conversa: o botão "Ritmo natural" usa isso. */
export function spanForNatural(text: string): number {
  return spanForWpm(text, BASE_WPM);
}

/**
 * Versão da voz de IA. Muda quando o motor, as vozes ou o tratamento do áudio mudam: as falas feitas
 * antes deixam de valer e o app gera de novo, para tudo sair no mesmo tom.
 * qwen3: corte novo do começo da fala (sem respiração nem resto da palavra anterior na contagem).
 */
export const VOICE_VERSION = 'qwen3';

/** Marca de fala feita com a voz do Mac no lugar da voz de IA (gera de novo quando a de IA estiver pronta). */
export const FALLBACK_MARK = '|reserva';

/**
 * O que foi gerado: versão da voz, texto, voz, tamanho da marcação e velocidade fixa (contagem).
 * Mudou qualquer um, o áudio antigo já não vale (o tamanho entra porque é ele que define a
 * velocidade da fala).
 */
export function narrationSignature(text: string, voice: string, span: number, pace?: number, pitch?: string): string {
  const base = `${VOICE_VERSION}|${voice}|${Math.round(span * 100) / 100}|${text.trim()}`;
  const withPace = pace ? `${base}|x${Math.round(pace * 100) / 100}` : base;
  return pitch && pitch !== 'padrao' ? `${withPace}|t${pitch}` : withPace;
}

/** Botões de tom da voz. */
export const PITCH_PRESETS: ReadonlyArray<{ id: 'grave' | 'padrao' | 'agudo'; label: string }> = [
  { id: 'grave', label: 'Grave' },
  { id: 'padrao', label: 'Padrão' },
  { id: 'agudo', label: 'Agudo' },
];

/** Quanto o tom muda (centésimos de semitom): 2 semitons para baixo ou para cima. */
export function pitchCents(pitch?: string): number {
  return pitch === 'grave' ? -200 : pitch === 'agudo' ? 200 : 0;
}

/** Fala comum: se não couber na marcação, acelera até aqui. Nunca desacelera (sobraria silêncio). */
const MAX_FIT_TEMPO = 1.35;

/**
 * Fator de velocidade (1 = natural, 1,2 = 20% mais rápido) para uma fala que veio na velocidade
 * natural (voz online). A mesma regra da voz de IA do Mac (desktop/maestroQwen.js):
 * - fala comum (sem `pace`): só acelera se não couber na marcação, até 1,35×;
 * - contagem (`pace`): a velocidade escolhida; acelera mais só se o número não couber no tempo.
 */
export function fitTempo(natural: number, span: number, pace?: number): { tempo: number; seconds: number; overflow: boolean } {
  const s = Number(span) > 0 ? Number(span) : 0;
  let tempo: number;
  if (Number(pace) > 0) {
    tempo = Math.max(COUNT_PACE_MIN, Math.min(COUNT_PACE_MAX, Number(pace)));
    if (s > 0 && natural / tempo > s) tempo = Math.min(COUNT_PACE_MAX, natural / s);
  } else {
    tempo = 1;
    if (s > 0 && natural > s) tempo = Math.min(MAX_FIT_TEMPO, natural / s);
  }
  tempo = Math.round(tempo * 1000) / 1000;
  const seconds = natural / tempo;
  return { tempo, seconds, overflow: s > 0 && seconds > s * 1.02 };
}

/** Assinatura do que a marcação pede agora. */
export function currentSignature(n: Pick<MaestroNarration, 'text' | 'voice' | 'start' | 'end' | 'pace' | 'pitch'>): string {
  return narrationSignature(n.text, n.voice, n.end - n.start, n.pace, n.pitch);
}

/**
 * Onde o clipe da fala começa: JUSTO no início da marcação (a linha da grade). O áudio já vem sem
 * silêncio na frente, então a voz soa no mesmo instante da linha, junto com o click.
 */
export function clipPlacement(start: number): { startTime: number; trimStart: number } {
  return { startTime: Math.max(0, start), trimStart: 0 };
}

// ---------------------------------------------------------------------------------------------
// Contagem (1, 2, 3, 4...): um número por tempo da grade, junto com o click.

/** Velocidade da voz na contagem (1 = natural). */
export const COUNT_PACE_MIN = 0.85;
export const COUNT_PACE_MAX = 1.8;
export const COUNT_PACE_DEFAULT = 1.15;

const NUMBER_WORDS = [
  'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito',
  'Nove', 'Dez', 'Onze', 'Doze', 'Treze', 'Catorze', 'Quinze', 'Dezesseis',
];

/**
 * Os números falados da contagem. `restartEachBar`: 1-2-3-4, 1-2-3-4 (recomeça a cada compasso);
 * senão segue 1, 2, 3 ... até o total.
 */
export function countWords(total: number, beatsPerBar: number, restartEachBar: boolean): string[] {
  const perBar = Math.max(1, Math.round(beatsPerBar) || 4);
  return Array.from({ length: Math.max(0, total) }, (_, i) => {
    const n = restartEachBar ? (i % perBar) : i;
    return `${NUMBER_WORDS[n] ?? String(n + 1)}!`;
  });
}

/**
 * Os tempos da grade a partir de `start` (já em cima de um tempo): `count` inícios seguidos, um
 * por click, seguindo as mudanças de andamento da música. Sem BPM, devolve vazio.
 */
export function beatTimesFrom(song: Pick<Song, 'bpm'> & { tempoSegments?: SongTempoSegment[] }, start: number, count: number): number[] {
  if (!tempoAt(song, start)) return [];
  const times: number[] = [];
  let t = beatStartAt(song, start);
  for (let i = 0; i < count; i++) {
    times.push(t);
    const beat = tempoAt(song, t)!.beat;
    // o próximo tempo: um tempo adiante, encaixado na grade (se o andamento muda no caminho,
    // o começo do trecho novo manda)
    t = beatStartAt(song, t + beat);
  }
  return times;
}

/** Trecho de andamento que vale em `time` (o BPM da música quando não há mudanças cadastradas). */
function tempoAt(song: Pick<Song, 'bpm'> & { tempoSegments?: SongTempoSegment[] }, time: number): { origin: number; beat: number } | null {
  const segs = (song.tempoSegments ?? []).filter((s) => s.bpm > 0).sort((a, b) => a.startTime - b.startTime);
  if (segs.length > 1) {
    const seg = [...segs].reverse().find((s) => time >= s.startTime - 1e-6) ?? segs[0];
    return { origin: seg.startTime, beat: 60 / seg.bpm };
  }
  if (!song.bpm || song.bpm <= 0) return null;
  return { origin: 0, beat: 60 / song.bpm };
}

/**
 * Início do beat em que o cursor está (não o mais próximo: o que já começou). Quem aperta
 * "sincar" tocando a música aperta um pouco depois do beat, então volta para o começo dele.
 * Sem BPM, devolve o próprio tempo.
 */
export function beatStartAt(song: Pick<Song, 'bpm'> & { tempoSegments?: SongTempoSegment[] }, time: number): number {
  const t = tempoAt(song, time);
  if (!t) return Math.max(0, time);
  const k = Math.floor((time - t.origin) / t.beat + BEAT_TOLERANCE);
  return Math.max(0, t.origin + k * t.beat);
}

/** Um início já está em cima de um beat (menos de 2% do beat fora dele)? */
export function isOnBeat(song: Pick<Song, 'bpm'> & { tempoSegments?: SongTempoSegment[] }, time: number): boolean {
  const t = tempoAt(song, time);
  if (!t) return false;
  const pos = (time - t.origin) / t.beat;
  return Math.abs(pos - Math.round(pos)) < 0.02;
}

/**
 * Onde a marcação cabe mais perto de `desired` sem invadir as outras (mantém o tamanho).
 * Arrastar por cima de uma vizinha leva para o espaço livre mais perto. Sem espaço, null.
 */
export function placeNarration(
  song: Pick<Song, 'duration' | 'narrations'>,
  narrationId: string,
  desired: number,
  length: number,
): number | null {
  const others = sortedNarrations(song.narrations).filter((n) => n.id !== narrationId);
  const gaps: Array<{ lo: number; hi: number }> = [];
  let cursor = 0;
  for (const n of others) {
    gaps.push({ lo: cursor, hi: n.start });
    cursor = Math.max(cursor, n.end);
  }
  gaps.push({ lo: cursor, hi: song.duration });
  let best: number | null = null;
  for (const g of gaps) {
    if (g.hi - g.lo < length - 1e-6) continue;
    const start = Math.min(Math.max(desired, g.lo), g.hi - length);
    if (best === null || Math.abs(start - desired) < Math.abs(best - desired)) best = start;
  }
  return best;
}

/**
 * "Sincar no beat do cursor": leva o início da marcação para o começo do beat em que o cursor
 * está, mantendo o tamanho. Se ali já houver outra marcação, vai para o espaço livre mais perto.
 */
export function syncedToCursor(song: Song, narrationId: string, cursor: number): { start: number; end: number } | null {
  const n = (song.narrations ?? []).find((x) => x.id === narrationId);
  if (!n) return null;
  const length = n.end - n.start;
  const start = placeNarration(song, narrationId, beatStartAt(song, cursor), length);
  return start === null ? null : { start, end: start + length };
}

/** Limites para redimensionar a marcação sem invadir as vizinhas. */
export function narrationBounds(song: Pick<Song, 'duration' | 'narrations'>, narrationId: string): { min: number; max: number } {
  const list = sortedNarrations(song.narrations);
  const idx = list.findIndex((n) => n.id === narrationId);
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null;
  return { min: prev ? prev.end : 0, max: next ? next.start : song.duration };
}

/** Espaço livre (sem invadir as vizinhas) em volta de `at`: onde uma marcação nova pode nascer. */
export function freeRunAt(song: Pick<Song, 'duration' | 'narrations'>, at: number): { lo: number; hi: number } | null {
  const list = sortedNarrations(song.narrations);
  if (list.some((n) => at > n.start + 1e-6 && at < n.end - 1e-6)) return null;
  const prev = list.filter((n) => n.end <= at + 1e-6).pop();
  const next = list.find((n) => n.start >= at - 1e-6);
  return { lo: prev ? prev.end : 0, hi: next ? next.start : song.duration };
}
