// Salva o show como projeto .RPP: um arquivo de texto que aponta para os áudios numa pasta ao lado.
//
// As músicas ficam uma atrás da outra, com um espaço (3 s) entre elas. Cada música vira uma
// região com o nome dela (início e fim), e o andamento e a fórmula de compasso entram como
// marcas de tempo no começo de cada uma. Cada faixa do VS Stage vira uma faixa do projeto, com
// volume, balanço e mudo; as pastas (faixa com subfaixas) viram pastas.
// Sem dependência do programa (só tipos e as contas da grade), para rodar também nos testes.
import { beatSpans, spanIndexAt, type BeatSpan } from './grid.ts';

export const RPP_SONG_GAP_S = 3;

/** Maior andamento que o REAPER aceita numa marca. */
const RPP_MAX_BPM = 960;

export interface RppOutItem {
  name: string;
  /** Segundos na linha do tempo do projeto. */
  position: number;
  length: number;
  /** Caminho do áudio relativo à pasta do .rpp (com "/"). */
  file: string;
  /** Volume linear do item (1 = 0 dB). */
  volume?: number;
}

export interface RppOutTrack {
  name: string;
  /** Volume linear (1 = 0 dB). */
  volume: number;
  /** -1 (esquerda) a 1 (direita). */
  pan: number;
  mute: boolean;
  solo?: boolean;
  items: RppOutItem[];
  /** Subfaixas: a faixa vira uma pasta. */
  children?: RppOutTrack[];
}

export interface RppOutTempo {
  /** Segundos na linha do tempo do projeto. */
  time: number;
  bpm: number;
  /** Com fórmula de compasso, a marca abre um compasso novo nesse ponto. */
  beatsPerBar?: number;
}

export interface RppOutRegion {
  name: string;
  start: number;
  end: number;
}

export interface RppOutProject {
  sampleRate: number;
  tempo: RppOutTempo[];
  regions: RppOutRegion[];
  tracks: RppOutTrack[];
  /** Fader master, linear (1 = 0 dB). */
  masterVolume?: number;
  /** Segundos desde 1970 gravados no cabeçalho (só informativo). */
  timestamp?: number;
}

/** Número sem notação científica e sem zeros sobrando (o leitor do .rpp não aceita "1e-7"). */
export function rppNum(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(10).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * Texto entre aspas. O formato não tem escape: usa a aspa que não aparece no texto
 * (dupla, simples ou crase); se aparecerem as três, troca as duplas por simples.
 */
export function rppQuote(text: string): string {
  const s = String(text ?? '').replace(/[\r\n\t]+/g, ' ');
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('`')) return `\`${s}\``;
  return `"${s.replace(/"/g, "'")}"`;
}

/** Fórmula de compasso no jeito do .rpp: numerador + denominador × 65536 (4/4 = 262148). */
export function rppTimeSig(beatsPerBar: number): number {
  const num = Math.max(1, Math.min(64, Math.round(beatsPerBar)));
  const den = num === 6 ? 8 : 4;
  return num + den * 65536;
}

/** Onde cada música começa: uma atrás da outra, com `gap` segundos entre elas. */
export function layoutSongs(lengths: number[], gap = RPP_SONG_GAP_S): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const len of lengths) {
    starts.push(t);
    t += Math.max(0, len) + gap;
  }
  return starts;
}

/** Um trecho tocado da música: de onde a onde no áudio original e onde cai no projeto. */
export interface TempoSlice {
  /** Segundos no tempo original da música. */
  srcStart: number;
  srcEnd: number;
  /** Duração no projeto = duração original × alpha (BPM ajustado). */
  alpha: number;
  /** Segundos no projeto onde o trecho começa. */
  outStart: number;
}

export interface SongTempoInput {
  bpm: number;
  beatsPerBar?: number;
  tempoSegments?: Array<{ startTime: number; bpm: number; endTime?: number; downbeat?: number; barOffset?: number; beatsPerBar?: number }>;
}

/**
 * Marcas de andamento de uma música no projeto, com as mesmas batidas da grade do programa. A primeira
 * marca (com a fórmula de compasso) fica no começo dela. Quando a batida não cai no ponto da marca, uma
 * marca de ajuste leva a grade até a batida real. Cada trecho que sabe onde está o 1 abre compasso nele,
 * e a sobra no fim de um trecho vira uma batida, para a contagem não sair de fase na troca.
 */
export function songTempoPoints(song: SongTempoInput, slices: TempoSlice[]): RppOutTempo[] {
  const segs = (song.tempoSegments ?? []).filter((s) => s.bpm > 0);
  const sorted = segs.length >= 2 ? [...segs].sort((a, b) => a.startTime - b.startTime) : null;
  const fallback = song.beatsPerBar ?? 4;
  const spans = sorted
    ? beatSpans({ bpm: song.bpm, beatsPerBar: fallback, tempoSegments: sorted.map((x) => ({ ...x, endTime: x.endTime ?? x.startTime })) })
    : null;
  const single: BeatSpan = { start: 0, beat: 60 / song.bpm, bpm: song.bpm, perBar: fallback, pickup: 0, firstBeat: 0, lastBeat: Infinity, limit: Infinity, firstBar: 1 };
  const list = spans ?? [single];

  type Mark = { t: number; bpm: number; bar?: number };
  const marks: Mark[] = [];
  list.forEach((sp, i) => {
    const next = list[i + 1];
    if (i > 0) marks.push({ t: sp.start, bpm: sp.bpm });
    if (sorted?.[i]?.downbeat !== undefined) marks.push({ t: sp.start + sp.pickup * sp.beat, bpm: sp.bpm, bar: sp.perBar });
    if (next && sp.lastBeat >= 0 && Number.isFinite(sp.lastBeat)) {
      const tail = sp.start + sp.lastBeat * sp.beat;
      const gap = next.start - tail;
      if (gap > 1e-3 && Math.abs(gap - sp.beat) > 1e-4) marks.push({ t: tail, bpm: 60 / gap });
    }
  });

  // batida real em que a grade entra a partir de `from`: perto demais pede um BPM impossível
  const lead = (from: number): { bpm: number; mark?: Mark } => {
    const at = spanIndexAt(list, from);
    const sp = list[at];
    let k = Math.ceil((from - sp.start) / sp.beat - 1e-9);
    const grid = (b: number) => (b > sp.lastBeat && list[at + 1] ? list[at + 1].start : sp.start + b * sp.beat);
    let to = grid(k);
    if (to - from < 1e-4) return { bpm: sp.bpm };
    if (to - from < 0.2 * sp.beat) { k++; to = grid(k); }
    const n = Math.max(1, Math.round((to - from) / sp.beat));
    return { bpm: Math.min(RPP_MAX_BPM, (60 * n) / (to - from)), mark: { t: to, bpm: list[spanIndexAt(list, to)].bpm } };
  };

  const out: RppOutTempo[] = [];
  const push = (time: number, bpm: number, beatsPerBar?: number) => {
    if (!(bpm > 0) || !Number.isFinite(bpm)) return;
    const last = out[out.length - 1];
    if (last && Math.abs(last.time - time) < 1e-6) {
      out[out.length - 1] = { time, bpm, ...(beatsPerBar ?? last.beatsPerBar ? { beatsPerBar: beatsPerBar ?? last.beatsPerBar } : {}) };
      return;
    }
    if (last && !beatsPerBar && Math.abs(last.bpm - bpm) < 1e-6) return;
    out.push({ time, bpm, ...(beatsPerBar ? { beatsPerBar } : {}) });
  };
  slices.forEach((sl, i) => {
    const a = sl.alpha > 0 ? sl.alpha : 1;
    const place = (t: number) => sl.outStart + (t - sl.srcStart) * a;
    const entry = lead(sl.srcStart);
    const firstBar = i === 0 ? list[spanIndexAt(list, sl.srcStart)].perBar : undefined;
    push(sl.outStart, entry.bpm / a, firstBar);
    // entre o começo e a marca de ajuste vale só o BPM do ajuste: outra marca ali tiraria a grade de fase
    const from = entry.mark ? entry.mark.t : sl.srcStart;
    const inside = marks.filter((m) => m.t > from - 1e-6 && m.t > sl.srcStart + 1e-6 && m.t < sl.srcEnd - 1e-6);
    if (entry.mark && entry.mark.t < sl.srcEnd - 1e-6) inside.push(entry.mark);
    inside.sort((x, y) => x.t - y.t || (x.bar ? 1 : -1));
    for (const m of inside) push(place(m.t), m.bpm / a, m.bar);
  });
  return out;
}

interface FlatTrack {
  track: RppOutTrack;
  /** 1 abre pasta; negativo fecha tantas pastas depois desta faixa; 0 faixa comum. */
  delta: number;
}

function flatten(list: RppOutTrack[]): FlatTrack[] {
  const out: FlatTrack[] = [];
  for (const t of list) {
    const kids = flatten(t.children ?? []);
    if (kids.length === 0) {
      out.push({ track: t, delta: 0 });
      continue;
    }
    out.push({ track: t, delta: 1 });
    kids[kids.length - 1].delta -= 1;
    out.push(...kids);
  }
  return out;
}

function trackLines(f: FlatTrack): string[] {
  const t = f.track;
  const isbus = f.delta > 0 ? '1 1' : f.delta < 0 ? `2 ${f.delta}` : '0 0';
  const lines = [
    '  <TRACK',
    `    NAME ${rppQuote(t.name)}`,
    `    VOLPAN ${rppNum(Math.max(0, t.volume))} ${rppNum(Math.max(-1, Math.min(1, t.pan)))} -1 -1 1`,
    `    MUTESOLO ${t.mute ? 1 : 0} ${t.solo ? 2 : 0} 0`,
    `    ISBUS ${isbus}`,
    '    NCHAN 2',
  ];
  for (const it of t.items) {
    lines.push(
      '    <ITEM',
      `      POSITION ${rppNum(it.position)}`,
      `      LENGTH ${rppNum(it.length)}`,
      '      LOOP 0',
      '      FADEIN 1 0 0 1 0 0 0',
      '      FADEOUT 1 0 0 1 0 0 0',
      '      MUTE 0 0',
      `      NAME ${rppQuote(it.name)}`,
      `      VOLPAN ${rppNum(Math.max(0, it.volume ?? 1))} 0 1 -1`,
      '      SOFFS 0',
      '      PLAYRATE 1 1 0 -1 0 0.0025',
      '      <SOURCE WAVE',
      `        FILE ${rppQuote(it.file)}`,
      '      >',
      '    >',
    );
  }
  lines.push('  >');
  return lines;
}

/** Monta o texto do .rpp. */
export function buildRpp(p: RppOutProject): string {
  const tempo = [...p.tempo].filter((t) => t.bpm > 0).sort((a, b) => a.time - b.time);
  const first = tempo[0];
  const bpm0 = first?.bpm ?? 120;
  const bpb0 = Math.max(1, Math.round(first?.beatsPerBar ?? 4));
  const lines: string[] = [
    `<REAPER_PROJECT 0.1 "6.0" ${Math.max(0, Math.floor(p.timestamp ?? 0))}`,
    '  RIPPLE 0',
    '  AUTOXFADE 0',
    '  ENVATTACH 0',
    '  TIMELOCKMODE 1',
    '  TEMPOENVLOCKMODE 1',
    `  TEMPO ${rppNum(bpm0)} ${bpb0} ${bpb0 === 6 ? 8 : 4}`,
    '  PLAYRATE 1 0 0.25 4',
    '  MASTERAUTOMODE 0',
    `  SAMPLERATE ${Math.round(p.sampleRate)} 0 0`,
    `  MASTER_VOLUME ${rppNum(Math.max(0, p.masterVolume ?? 1))} 0 -1 -1 1`,
  ];
  if (tempo.length > 0) {
    lines.push('  <TEMPOENVEX', '    ACT 1 -1', '    VIS 1 0 1', '    LANEHEIGHT 0 0', '    ARM 0', '    DEFSHAPE 1 -1 -1');
    // forma 1 = degrau: o BPM muda de uma vez na marca, sem rampa
    for (const t of tempo) {
      lines.push(t.beatsPerBar ? `    PT ${rppNum(t.time)} ${rppNum(t.bpm)} 1 ${rppTimeSig(t.beatsPerBar)}` : `    PT ${rppNum(t.time)} ${rppNum(t.bpm)} 1`);
    }
    lines.push('  >');
  }
  // região = duas linhas MARKER com o mesmo número (início com o nome, fim sem nome)
  p.regions.forEach((r, i) => {
    const n = i + 1;
    lines.push(`  MARKER ${n} ${rppNum(r.start)} ${rppQuote(r.name)} 1 0 1`);
    lines.push(`  MARKER ${n} ${rppNum(r.end)} "" 1`);
  });
  lines.push('  <MASTERPLAYSPEEDENV', '    ACT 0 -1', '    VIS 0 0 1', '    LANEHEIGHT 0 0', '    ARM 0', '    DEFSHAPE 0 -1 -1', '  >');
  for (const f of flatten(p.tracks)) lines.push(...trackLines(f));
  lines.push('>');
  return `${lines.join('\n')}\n`;
}

/** Nome de arquivo sem os caracteres que o Mac ou o Windows não aceitam. */
export function rppFileName(name: string): string {
  return (name || '').replace(/[/\\:*?"<>|`']/g, '_').replace(/\s+/g, ' ').trim() || 'Sem Nome';
}
