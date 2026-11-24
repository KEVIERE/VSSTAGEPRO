import type { Song, SongTempoSegment } from '@/types';
import { segmentBar, segmentBeatLimit, segmentPickup } from './grid.ts';
import { canReplaceTempoMap, copyBarPhase, finalizeTempoMap, withPhase, type BarPhaseResult, type PhaseDecision, type PhaseReason, type ReadSegment } from './tempoFollow.ts';

export { copyBarPhase, type BarPhaseResult, type PhaseDecision, type PhaseReason };

// Qual batida é o tempo 1. Só contas: recebe os trechos já na régua e devolve os mesmos trechos com a
// fase do compasso acertada. Início, fim, BPM e número de batidas nunca mudam.

/** Sobe quando a regra muda: os projetos já conferidos passam pela conferência de novo. */
export const BAR_CHECK_VERSION = 1;

/** A melhor posição precisa ter pelo menos esta ativação média do modelo. */
const MIN_SUPPORT = 0.2;
/** E ser esta quantidade de vezes a ativação da posição atual. */
const MIN_ADVANTAGE = 3;
/** No empate entre duas posições opostas do compasso, a vantagem sobre a atual pode ser menor. */
const TIE_ADVANTAGE = 1.6;
/** Compassos com música que o trecho precisa ter para decidir. */
const MIN_BARS = 4;
/** Posições a até esta fração da melhor estão empatadas com ela. */
const TIE_SHARE = 0.85;
/** No empate, a vantagem (soma de ativação compasso a compasso) que firma uma das duas posições. */
const TIE_LEAD = 2;
/** Compasso inteiro abaixo disto é silêncio (pausa, fim da música) e não conta. */
const QUIET = 0.05;
/** Ativação média mínima para uma parte do trecho contar como música com outro 1. */
const PART_SUPPORT = 0.08;
/** Pausa no click, em tempos, que marca a emenda entre duas músicas. */
const CLICK_GAP = 1.5;
/** Desvio entre dois trechos seguidos acima do qual o click saiu da reta (outra música, outra tomada). */
const LINE_BREAK = 0.002;

/** Toco de `extendToStart`: uma batida só antes do primeiro trecho, no mesmo andamento. */
function isStub(seg: SongTempoSegment, next: SongTempoSegment | undefined): boolean {
  return !!next && Math.abs(seg.bpm - next.bpm) < 1e-6 && seg.endTime - seg.startTime <= (60 / seg.bpm) * 1.01;
}

const mod = (v: number, n: number) => ((v % n) + n) % n;

/**
 * Desvio máximo para o trecho seguinte ainda estar na mesma reta de batidas: o mesmo salto que
 * `realTempoChanges` aceita (o primeiro ataque cortado de um arquivo chega a 3 ms fora).
 */
const LINE_TOL = 0.035;

/**
 * Dois trechos seguidos na mesma reta e com a contagem continuando (a grade só guarda o 1 de um
 * andamento único em dois trechos): o 1 de um decide o do outro, senão o compasso quebra no meio.
 */
function sameCount(a: SongTempoSegment, b: SongTempoSegment, beatsPerBar: number): boolean {
  const perBar = segmentBar(a, beatsPerBar);
  if (Math.abs(a.bpm - b.bpm) > 1e-6 || segmentBar(b, beatsPerBar) !== perBar) return false;
  const beat = 60 / a.bpm;
  const k = Math.round((b.startTime - a.startTime) / beat);
  if (Math.abs(b.startTime - (a.startTime + k * beat)) > LINE_TOL) return false;
  return mod(k + segmentPickup(b) - segmentPickup(a), perBar) === 0;
}

/** Trechos que decidem juntos: o toco do começo, e os seguidos na mesma contagem. Índices em `sorted`. */
function countGroups(sorted: SongTempoSegment[], beatsPerBar: number): number[][] {
  const groups: number[][] = [];
  sorted.forEach((seg, i) => {
    const last = groups[groups.length - 1];
    const prev = sorted[i - 1];
    if (last && prev && (sameCount(prev, seg, beatsPerBar) || (i === 1 && isStub(prev, seg)))) last.push(i);
    else groups.push([i]);
  });
  return groups;
}

/**
 * Qual de duas posições abre `TIE_LEAD` de vantagem primeiro, somando compasso a compasso do começo da
 * música. A média das duas muda um pouco a cada corte do clipe; o trecho em que a música firma o 1, não.
 */
function firstLead(rows: number[][], a: number, b: number): number | null {
  let lead = 0;
  for (const row of rows) {
    lead += row[a] - row[b];
    if (lead >= TIE_LEAD) return a;
    if (lead <= -TIE_LEAD) return b;
  }
  return null;
}

/**
 * Decide a posição do 1. Sem apoio do modelo fica onde está. A posição atual empatada com a melhor também
 * fica: o modelo não tem certeza, e vale a leitura do click. No empate entre duas posições opostas
 * (música que o modelo sente na metade do andamento, com 2 e 4 iguais) e as duas bem acima da atual,
 * vale a que a música firma primeiro.
 */
function choosePhase(scores: number[], rows: number[][], bars: number, current: number): { phase: number; reason: PhaseReason } {
  if (bars < MIN_BARS) return { phase: current, reason: 'poucos-compassos' };
  const top = Math.max(...scores);
  if (top < MIN_SUPPORT) return { phase: current, reason: 'sem-apoio' };
  const tied = scores.flatMap((v, q) => (v >= top * TIE_SHARE ? [q] : []));
  if (tied.includes(current)) return { phase: current, reason: 'igual' };
  // duas posições opostas dividem os downbeats: cada uma recebe só metade, e a vantagem aparece menor
  const opposite = tied.length === 2 && tied[1] - tied[0] === scores.length / 2;
  if (top < scores[current] * (opposite ? TIE_ADVANTAGE : MIN_ADVANTAGE)) return { phase: current, reason: 'sem-apoio' };
  if (opposite) return { phase: firstLead(rows, tied[0], tied[1]) ?? tied[0], reason: 'mudou' };
  return { phase: tied[0], reason: 'mudou' };
}

/** Compasso com música, numerado na contagem do grupo (compasso `bar` = batidas bar x perBar em diante). */
interface Row { bar: number; values: number[] }

/** Pedaço da decisão: a partir da batida `from` do grupo, o 1 fica nas batidas com resto `phase`. */
interface Piece { from: number; phase: number; reason: PhaseReason; bars: number; scores: number[] }

/**
 * Batidas do grupo contadas a partir do primeiro trecho (sem o toco). Cada trecho usa a própria grade:
 * dois trechos da mesma contagem podem estar até `LINE_TOL` fora da reta um do outro.
 */
function groupBeats(sorted: SongTempoSegment[], members: number[]): { times: number[]; starts: number[]; breaks: number[] } {
  const head = sorted[members[0]];
  const beat = 60 / head.bpm;
  const times: number[] = [];
  const starts: number[] = [];
  const breaks: number[] = [];
  members.forEach((i, n) => {
    const seg = sorted[i];
    const next = sorted[i + 1];
    const k0 = Math.round((seg.startTime - head.startTime) / beat);
    starts.push(k0);
    if (n > 0) {
      const prev = sorted[members[n - 1]];
      const k = Math.round((seg.startTime - prev.startTime) / beat);
      // o click saiu da reta: emenda de verdade entre duas leituras do click
      if (Math.abs(seg.startTime - (prev.startTime + k * beat)) > LINE_BREAK) breaks.push(k0);
    }
    const limit = next ? segmentBeatLimit(seg, next) : seg.endTime;
    const total = Math.max(0, Math.floor((limit - seg.startTime) / beat + 1e-9) + 1);
    for (let m = 0; m < total; m++) times[k0 + m] = seg.startTime + m * beat;
  });
  return { times, starts, breaks };
}

function activationAt(down: Float32Array, fps: number, t: number): number {
  const f = Math.round(t * fps);
  let v = 0;
  for (let k = f - 1; k <= f + 1; k++) if (k >= 0 && k < down.length && down[k] > v) v = down[k];
  return v;
}

/** Compassos inteiros do grupo com música (o silêncio fica de fora, mas o número do compasso fica). */
function groupRows(times: number[], perBar: number, down: Float32Array, fps: number): Row[] {
  const rows: Row[] = [];
  for (let b = 0; (b + 1) * perBar <= times.length; b++) {
    const at = Array.from({ length: perBar }, (_, q) => times[b * perBar + q]);
    if (at.some((t) => t === undefined)) continue;
    const values = at.map((t) => activationAt(down, fps, t));
    if (Math.max(...values) < QUIET) continue;
    rows.push({ bar: b, values });
  }
  return rows;
}

function meanOf(rows: Row[], perBar: number): number[] {
  const sum = new Array<number>(perBar).fill(0);
  for (const r of rows) r.values.forEach((v, q) => { sum[q] += v; });
  return sum.map((v) => (rows.length ? v / rows.length : 0));
}

const argmax = (v: number[]) => v.reduce((best, x, q) => (x > v[best] ? q : best), 0);

/** Posições empatadas com a melhor (a até `TIE_SHARE` dela). */
const topPositions = (v: number[]) => { const top = Math.max(...v); return v.flatMap((x, q) => (x >= top * TIE_SHARE ? [q] : [])); };

/**
 * Onde as músicas do trecho trocam de 1: cada lado com pelo menos `MIN_BARS` compassos, e as posições
 * mais fortes de cada lado (com as empatadas) valendo `MIN_ADVANTAGE` vezes as do outro lado, nos dois
 * lados. Em ordem da mais firme para a menos firme. Vazio quando o trecho inteiro conta o 1 no mesmo lugar,
 * ou quando o modelo não separa as duas partes com clareza.
 */
function phaseChanges(rows: Row[], perBar: number): Array<{ c: number; x: number; y: number }> {
  const n = rows.length;
  if (n < 2 * MIN_BARS) return [];
  const prefix: number[][] = [new Array<number>(perBar).fill(0)];
  rows.forEach((r, i) => prefix.push(prefix[i].map((v, q) => v + r.values[q])));
  const found: Array<{ c: number; x: number; y: number; evidence: number }> = [];
  for (let c = MIN_BARS; c <= n - MIN_BARS; c++) {
    const s1 = prefix[c].map((v) => v / c);
    const s2 = prefix[n].map((v, q) => (v - prefix[c][q]) / (n - c));
    const t1 = topPositions(s1), t2 = topPositions(s2);
    if (t1.some((q) => t2.includes(q))) continue;
    const x = argmax(s1), y = argmax(s2);
    if (s1[x] < PART_SUPPORT || s2[y] < PART_SUPPORT) continue;
    const low = (v: number[], qs: number[]) => Math.min(...qs.map((q) => v[q]));
    const high = (v: number[], qs: number[]) => Math.max(...qs.map((q) => v[q]));
    if (low(s1, t1) < high(s1, t2) * MIN_ADVANTAGE || low(s2, t2) < high(s2, t1) * MIN_ADVANTAGE) continue;
    found.push({ c, x, y, evidence: c * (s1[x] - s1[y]) + (n - c) * (s2[y] - s2[x]) });
  }
  return found.sort((a, b) => b.evidence - a.evidence);
}

/**
 * Decide os compassos `rows[lo..hi)`. Sem troca de 1 dentro deles, decide junto (choosePhase). Com troca
 * numa emenda real (`seamAt`), cada lado decide sozinho. Com troca sem emenda, não há como saber onde uma
 * música acaba: fica a fase atual, a mesma de antes da conferência.
 */
function decideRows(rows: Row[], lo: number, hi: number, perBar: number, before: number, seamAt: (last: Row, x: number, first: Row, y: number) => number | null): Piece[] {
  const part = rows.slice(lo, hi);
  const scores = meanOf(part, perBar);
  const changes = phaseChanges(part, perBar);
  if (!changes.length) {
    const { phase, reason } = choosePhase(scores, part.map((r) => r.values), part.length, before);
    return [{ from: -Infinity, phase, reason, bars: part.length, scores }];
  }
  for (const { c, x, y } of changes) {
    const at = seamAt(part[c - 1], x, part[c], y);
    if (at === null) continue;
    const tail = decideRows(rows, lo + c, hi, perBar, before, seamAt);
    tail[0] = { ...tail[0], from: at };
    return [...decideRows(rows, lo, lo + c, perBar, before, seamAt), ...tail];
  }
  return [{ from: -Infinity, phase: before, reason: 'misturado', bars: part.length, scores }];
}

/**
 * Acerta o 1 de cada trecho pela ativação de downbeat do modelo (`fps` quadros por segundo). Trechos na
 * mesma contagem decidem juntos. Quando o modelo firma dois 1 diferentes no mesmo grupo (medley no mesmo
 * BPM), o grupo só se divide numa emenda real: o click sai da reta, ou a música para (compasso inteiro
 * sem ativação) junto com uma pausa no click (`hits`, quando se sabe). `fixed` diz os trechos em que o 1
 * já veio do acento do click.
 */
export function alignBarPhase(segments: SongTempoSegment[], down: Float32Array, fps: number, beatsPerBar: number, fixed?: (seg: SongTempoSegment) => boolean, hits?: number[]): BarPhaseResult {
  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const out: SongTempoSegment[] = [];
  const decisions: PhaseDecision[] = [];
  const clickHits = hits ? [...hits].sort((a, b) => a - b) : null;
  for (const group of countGroups(sorted, beatsPerBar)) {
    // o toco do começo anda junto com o trecho seguinte, para a contagem não quebrar
    const stub = group.length > 1 && group[0] === 0 && isStub(sorted[0], sorted[1]) ? 1 : 0;
    const members = group.slice(stub);
    const head = sorted[members[0]];
    const perBar = segmentBar(head, beatsPerBar);
    const beat = 60 / head.bpm;
    const before = segmentPickup(head) % perBar;
    const locked = !!fixed && group.some((i) => fixed(sorted[i]));
    const { times, starts, breaks } = groupBeats(sorted, members);
    const rows = groupRows(times, perBar, down, fps);
    // emenda entre o último compasso de uma música (1 em x) e o primeiro da outra (1 em y)
    const seamAt = (last: Row, x: number, first: Row, y: number): number | null => {
      const lastOne = last.bar * perBar + x;
      const firstOne = first.bar * perBar + y;
      const inside = (k: number) => k > lastOne && k <= firstOne;
      const broke = breaks.filter(inside);
      if (broke.length) return broke[broke.length - 1];
      // música parada: pelo menos um compasso inteiro sem ativação entre as duas
      if (first.bar - last.bar < 2) return null;
      if (clickHits) {
        // e o click para junto: a música nova entra no primeiro ataque depois da pausa
        const t0 = times[lastOne], t1 = times[firstOne];
        if (t0 === undefined || t1 === undefined) return null;
        let restart: number | null = null;
        for (let j = 1; j < clickHits.length; j++) {
          const h = clickHits[j];
          if (h <= t0 + beat * 0.5) continue;
          if (h > t1 + beat * 0.25) break;
          if (h - clickHits[j - 1] >= CLICK_GAP * beat) restart = h;
        }
        if (restart === null) return null;
        const k = Math.round((restart - head.startTime) / beat);
        return inside(k) ? k : null;
      }
      const known = starts.filter(inside);
      if (known.length) return known[known.length - 1];
      return Math.max(lastOne + 1, firstOne - perBar + 1);
    };
    const pieces: Piece[] = locked
      ? [{ from: -Infinity, phase: before, reason: 'igual', bars: rows.length, scores: meanOf(rows, perBar) }]
      : decideRows(rows, 0, rows.length, perBar, before, seamAt).sort((a, b) => a.from - b.from);
    const pieceAt = (k: number) => pieces.reduce((p, q) => (q.from <= k ? q : p), pieces[0]);
    group.forEach((i, n) => {
      const seg = sorted[i];
      const toco = n < stub;
      const k0 = toco ? -1 : starts[n - stub];
      const own = segmentPickup(seg) % perBar;
      const end = n + 1 < group.length ? (toco ? 0 : starts[n - stub + 1]) : Infinity;
      const cuts = pieces.filter((p) => p.from > k0 && p.from < end).map((p) => p.from);
      const note = (piece: SongTempoSegment, from: number, k: number) => {
        const p = pieceAt(k);
        out.push(piece);
        decisions.push({
          start: piece.startTime, end: piece.endTime, bars: toco ? 0 : p.bars, before: from, after: segmentPickup(piece) % perBar,
          scores: toco ? new Array<number>(perBar).fill(0) : p.scores, reason: toco ? 'toco' : p.reason,
        });
      };
      if (!cuts.length) {
        const after = mod(pieceAt(k0).phase - k0, perBar);
        note(after === own ? seg : withPhase(seg, after), own, k0);
        return;
      }
      // a música nova entra no meio deste trecho: ele se divide ali, na própria grade
      const { barOffset: _old, ...rest } = seg;
      [k0, ...cuts].forEach((k, j) => {
        const startTime = j ? seg.startTime + (k - k0) * beat : seg.startTime;
        const endTime = cuts[j] !== undefined ? seg.startTime + (cuts[j] - k0) * beat : seg.endTime;
        const pickup = mod(pieceAt(k).phase - k, perBar);
        // pedaços da mesma reta guardam a fase mesmo quando ela é zero: é ela que separa um do outro
        note({ ...rest, startTime, endTime, downbeat: startTime + pickup * beat, barOffset: pickup }, mod(own - (k - k0), perBar), k);
      });
    });
  }
  return { segments: out, changed: out.length !== sorted.length || out.some((seg, i) => seg !== sorted[i]), decisions };
}

type PhaseSong = Pick<Song, 'bpm' | 'beatsPerBar' | 'duration' | 'tempoSegments' | 'bpmSource' | 'tempoMapSource' | 'tempoMapSig' | 'tempoMapKept'>;

/** Os trechos que a grade usa hoje. Com menos de dois, ela é uniforme a partir do 0:00. */
export function savedPhaseSegments(song: PhaseSong): SongTempoSegment[] {
  if ((song.tempoSegments?.length ?? 0) >= 2) return song.tempoSegments!;
  return [{ startTime: 0, endTime: song.duration, bpm: song.bpm, downbeat: 0 }];
}

/**
 * Plano da conferência do tempo 1: onde o click tem acento vale a fase dele, no resto a do modelo. Click
 * sem acento num trecho começa no 1 da primeira batida, e isso não é informação. Devolve os trechos novos
 * ou null (nada a mudar). Mapa manual, do REAPER, editado ou recusado nunca muda. Mapa salvo que guarda o
 * 1 só ganha o 1 novo do som do click onde ele é o da leitura de sempre; o resto fica como está.
 */
export function planBarPhase(
  song: PhaseSong,
  click: { accented?: boolean; placed?: ReadSegment[]; hits?: number[] },
  model?: { downbeat: Float32Array; fps: number } | null,
): SongTempoSegment[] | null {
  if (!canReplaceTempoMap(song)) return null;
  const beatsPerBar = song.beatsPerBar ?? 4;
  const base = [...savedPhaseSegments(song)].sort((a, b) => a.startTime - b.startTime);
  const marked = (click.placed ?? []).filter((s) => click.accented || s.accent);
  const copied = copyBarPhase(base, marked, beatsPerBar, (song.tempoSegments?.length ?? 0) >= 2);
  const fromClick = new Set(copied.segments.filter((_, i) => copied.decisions[i].reason !== 'sem-apoio'));
  let segments = copied.segments;
  if (!click.accented && model) segments = alignBarPhase(segments, model.downbeat, model.fps, beatsPerBar, (s) => fromClick.has(s), click.hits).segments;
  if (segments.length === base.length && segments.every((s, i) => s === base[i])) return null;
  if (segments.length > 1) return segments;
  // andamento único: a grade só guarda o 1 em dois trechos, e o passo final é quem divide
  const map = finalizeTempoMap(segments, { duration: song.duration, beatsPerBar, isClick: true, keepSingle: true });
  return map?.tempoSegments && map.tempoSegments.length >= 2 ? map.tempoSegments : null;
}

/**
 * Soma um clipe na mistura mono da régua, na taxa de `out`: respeita início, corte e ganho. Reduz a taxa
 * pela média das amostras de cada quadro, sem guardar cópia do clipe. `first` e `last` são os quadros da
 * régua deste pedaço, para somar em fatias sem travar a tela.
 */
export function mixIntoRuler(
  out: Float32Array,
  rate: number,
  clip: { startTime: number; trimStart?: number; playLength: number; gain?: number },
  audio: { channels: ArrayLike<number>[]; sampleRate: number; length: number },
  first = 0,
  last = Infinity,
): void {
  const step = audio.sampleRate / rate;
  const gain = (clip.gain ?? 1) / 32767 / Math.max(1, audio.channels.length);
  const startFrame = Math.round(clip.startTime * rate);
  const from = Math.max(first, startFrame, 0);
  const to = Math.min(last, out.length, startFrame + Math.ceil(clip.playLength * rate));
  const origin = (clip.trimStart ?? 0) * audio.sampleRate;
  for (let o = from; o < to; o++) {
    const a = origin + (o - startFrame) * step;
    const i = Math.floor(a);
    const j = Math.max(i + 1, Math.floor(a + step));
    if (i >= audio.length) break;
    let sum = 0, n = 0;
    for (let q = i; q < j && q < audio.length; q++) {
      for (const ch of audio.channels) sum += ch[q];
      n++;
    }
    if (n) out[o] += (sum / n) * gain;
  }
}
