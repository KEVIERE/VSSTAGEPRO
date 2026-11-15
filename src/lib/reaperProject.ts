// Projeto do REAPER (.rpp): lê o arquivo de texto e separa o show em músicas.
//
// Um show no REAPER é uma linha só, com uma música atrás da outra. Aqui cada música vira um
// pedaço dessa linha, que começa no 0:00 dela, como o VS Stage trabalha:
// - com regiões: cada região de fora vira uma música; uma região dentro de outra vira seção;
// - sem regiões: cada marcador abre uma música, que vai até o próximo. Marcador com nome de
//   fim ("FIM", "END", "STOP") fecha a música e o trecho até o próximo início fica de fora;
// - sem marcação nenhuma: o projeto inteiro vira uma música.
// O áudio não é copiado: cada item do REAPER vira um clipe com os cortes de início e fim.
// Sem dependência do programa (só tipos), para rodar também nos testes.

export interface RppItem {
  name: string;
  /** Posição na linha do tempo do REAPER, em segundos. */
  position: number;
  length: number;
  /** Segundos pulados do começo do arquivo (SOFFS). */
  sourceOffset: number;
  /** Volume do item (1 = original). */
  volume: number;
  mute: boolean;
  fadeIn: number;
  fadeOut: number;
  playRate: number;
  /** Caminho do áudio como está no .rpp (relativo à pasta do projeto ou absoluto). */
  file: string | null;
  /** Tipo da fonte: WAVE, MP3, FLAC, MIDI, SECTION, EMPTY... */
  sourceType: string;
}

export interface RppTrack {
  name: string;
  volume: number;
  mute: boolean;
  /** Pastas (do REAPER) por onde a faixa passa, da mais de fora para a mais de dentro. */
  folders: string[];
  /** Volume e mudo somados das pastas por cima dela. */
  folderVolume: number;
  folderMute: boolean;
  hasFx: boolean;
  items: RppItem[];
}

export interface RppMarker {
  index: number;
  name: string;
  position: number;
}

export interface RppRegion {
  index: number;
  name: string;
  start: number;
  end: number;
}

export interface RppTempoPoint {
  time: number;
  bpm: number;
  beatsPerBar?: number;
}

export interface RppProject {
  bpm: number;
  beatsPerBar: number;
  tempo: RppTempoPoint[];
  markers: RppMarker[];
  regions: RppRegion[];
  tracks: RppTrack[];
}

/** Separa a linha nos espaços, respeitando aspas (simples, duplas ou crase). */
export function rppTokens(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  const s = line.trim();
  while (i < s.length) {
    while (i < s.length && s[i] === ' ') i++;
    if (i >= s.length) break;
    const q = s[i];
    if (q === '"' || q === "'" || q === '`') {
      const end = s.indexOf(q, i + 1);
      const stop = end < 0 ? s.length : end;
      out.push(s.slice(i + 1, stop));
      i = stop + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ' ') j++;
      out.push(s.slice(i, j));
      i = j;
    }
  }
  return out;
}

const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

interface ItemDraft extends RppItem {
  takes: Array<{ file: string | null; sourceType: string; sourceOffset: number; playRate: number; name: string; volume: number; selected: boolean }>;
}

/** Lê o texto do .rpp. Não usa nada além do que um show precisa: faixas, itens, andamento e marcações. */
export function parseRpp(text: string): RppProject {
  const project: RppProject = { bpm: 120, beatsPerBar: 4, tempo: [], markers: [], regions: [], tracks: [] };
  // pilha dos blocos abertos ("<TRACK", "<ITEM"...)
  const stack: string[] = [];
  let track: RppTrack | null = null;
  let item: ItemDraft | null = null;
  // pastas abertas: nome, volume e mudo de cada uma
  const folders: Array<{ name: string; volume: number; mute: boolean }> = [];
  let pendingFolderClose = 0;
  // REAPER grava a região como duas linhas MARKER com o mesmo número: início e fim
  const openRegions = new Map<number, { name: string; start: number }>();

  const finishItem = () => {
    if (!track || !item) return;
    const takes = item.takes;
    if (takes.length > 0) {
      const chosen = takes.find((t) => t.selected) ?? takes[0];
      item.file = chosen.file;
      item.sourceType = chosen.sourceType;
      item.sourceOffset = chosen.sourceOffset;
      item.playRate = chosen.playRate;
      item.name = chosen.name || item.name;
      item.volume *= chosen.volume;
    }
    track.items.push({
      name: item.name, position: item.position, length: item.length, sourceOffset: item.sourceOffset,
      volume: item.volume, mute: item.mute, fadeIn: item.fadeIn, fadeOut: item.fadeOut,
      playRate: item.playRate, file: item.file, sourceType: item.sourceType,
    });
    item = null;
  };

  const finishTrack = () => {
    if (!track) return;
    project.tracks.push(track);
    track = null;
    // a pasta fecha depois da última faixa dela
    for (; pendingFolderClose > 0; pendingFolderClose--) folders.pop();
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('<')) {
      const tok = rppTokens(line.slice(1));
      const block = tok[0];
      const parent = stack[stack.length - 1];
      stack.push(block);
      if (block === 'TRACK' && stack.length === 2) {
        const f = folders;
        track = {
          name: '',
          volume: 1,
          mute: false,
          folders: f.map((x) => x.name),
          folderVolume: f.reduce((v, x) => v * x.volume, 1),
          folderMute: f.some((x) => x.mute),
          hasFx: false,
          items: [],
        };
      } else if (block === 'ITEM' && parent === 'TRACK' && track) {
        item = {
          name: '', position: 0, length: 0, sourceOffset: 0, volume: 1, mute: false,
          fadeIn: 0, fadeOut: 0, playRate: 1, file: null, sourceType: 'EMPTY', takes: [],
        };
        // a primeira tomada mora direto no item
        item.takes.push({ file: null, sourceType: 'EMPTY', sourceOffset: 0, playRate: 1, name: '', volume: 1, selected: false });
      } else if (block === 'SOURCE' && item) {
        const take = item.takes[item.takes.length - 1];
        // SECTION (trecho invertido ou recortado) guarda outra fonte dentro: vale o tipo de fora
        if (parent === 'ITEM') take.sourceType = tok[1] ?? 'EMPTY';
      } else if (block === 'FXCHAIN' && track && parent === 'TRACK') {
        track.hasFx = true;
      }
      continue;
    }

    if (line === '>') {
      const closed = stack.pop();
      if (closed === 'ITEM') finishItem();
      else if (closed === 'TRACK') finishTrack();
      continue;
    }

    const tok = rppTokens(line);
    const key = tok[0];
    const where = stack[stack.length - 1];

    if (where === 'REAPER_PROJECT') {
      if (key === 'TEMPO') {
        project.bpm = num(tok[1], 120);
        project.beatsPerBar = Math.max(1, Math.round(num(tok[2], 4)));
      } else if (key === 'MARKER') {
        const index = num(tok[1]);
        const position = num(tok[2]);
        const name = tok[3] ?? '';
        const isRegion = (num(tok[4]) & 1) === 1;
        if (!isRegion) {
          project.markers.push({ index, name, position });
        } else {
          const open = openRegions.get(index);
          if (open) {
            openRegions.delete(index);
            if (position > open.start) project.regions.push({ index, name: open.name, start: open.start, end: position });
          } else {
            openRegions.set(index, { name, start: position });
          }
        }
      }
      continue;
    }

    if (where === 'TEMPOENVEX' && key === 'PT') {
      const bpm = num(tok[2]);
      if (bpm > 0) {
        const sig = num(tok[4]);
        const beatsPerBar = sig > 0 ? sig & 0xffff : undefined;
        project.tempo.push({ time: num(tok[1]), bpm, ...(beatsPerBar ? { beatsPerBar } : {}) });
      }
      continue;
    }

    if (where === 'TRACK' && track) {
      if (key === 'NAME') track.name = tok[1] ?? '';
      else if (key === 'VOLPAN') track.volume = num(tok[1], 1);
      else if (key === 'MUTESOLO') track.mute = num(tok[1]) === 1;
      else if (key === 'ISBUS') {
        const kind = num(tok[1]);
        const depth = num(tok[2]);
        if (kind === 1) folders.push({ name: track.name, volume: track.volume, mute: track.mute });
        else if (kind === 2 && depth < 0) pendingFolderClose = -depth;
      }
      continue;
    }

    if (where === 'ITEM' && item) {
      const take = item.takes[item.takes.length - 1];
      if (key === 'POSITION') item.position = num(tok[1]);
      else if (key === 'LENGTH') item.length = num(tok[1]);
      else if (key === 'MUTE') item.mute = num(tok[1]) === 1;
      else if (key === 'FADEIN') item.fadeIn = Math.max(num(tok[2]), num(tok[3]));
      else if (key === 'FADEOUT') item.fadeOut = Math.max(num(tok[2]), num(tok[3]));
      else if (key === 'VOLPAN') {
        // o primeiro VOLPAN do item é do item; os das tomadas seguintes, de cada tomada
        if (item.takes.length === 1) item.volume = num(tok[1], 1);
        else take.volume = num(tok[1], 1);
      } else if (key === 'TAKE') {
        item.takes.push({ file: null, sourceType: 'EMPTY', sourceOffset: 0, playRate: 1, name: '', volume: 1, selected: tok[1] === 'SEL' });
      } else if (key === 'NAME') take.name = tok[1] ?? '';
      else if (key === 'SOFFS') take.sourceOffset = num(tok[1]);
      else if (key === 'PLAYRATE') take.playRate = num(tok[1], 1);
      continue;
    }

    if (where === 'SOURCE' && item && key === 'FILE') {
      const take = item.takes[item.takes.length - 1];
      if (!take.file) take.file = tok[1] ?? null;
    }
  }

  // REAPER lê a primeira região por número; aqui a ordem que vale é a da linha do tempo
  project.regions.sort((a, b) => a.start - b.start);
  project.markers.sort((a, b) => a.position - b.position);
  project.tempo.sort((a, b) => a.time - b.time);
  return project;
}

// ---------------------------------------------------------------------------------------------
// Separação do show em músicas

export interface ShowItem {
  track: RppTrack;
  item: RppItem;
  /** Onde o áudio começa a tocar dentro da música (0 = início da música). */
  startTime: number;
  /** Segundos pulados do começo do arquivo. */
  trimStart: number;
  /** Quanto do arquivo toca. */
  playLength: number;
  gain: number;
  mute: boolean;
  fadeIn: number;
  fadeOut: number;
}

export interface ShowSection {
  name: string;
  start: number;
  end: number;
}

export interface ShowSong {
  name: string;
  /** Onde a música começa e termina na linha do tempo do REAPER. */
  start: number;
  end: number;
  items: ShowItem[];
  /** Andamento a partir do início da música; mais de um trecho = mudança de BPM no meio. */
  tempo: Array<{ startTime: number; bpm: number }>;
  beatsPerBar: number;
  /** Marcações de dentro da música (verso, refrão...), contadas a partir do início dela. */
  sections: ShowSection[];
}

export interface ShowSkip {
  track: string;
  item: string;
  reason: 'midi' | 'velocidade' | 'trecho' | 'sem-audio';
}

export interface ShowSplit {
  songs: ShowSong[];
  skipped: ShowSkip[];
  /** Faixas com plugins: o som delas no REAPER pode ser diferente do que vai tocar aqui. */
  tracksWithFx: string[];
  /** Como a separação foi feita, para contar à pessoa. */
  mode: 'regioes' | 'marcadores' | 'inteiro';
}

const END_NAME = /^\s*(fim|final|end|stop|parar?|pausa)\b/i;
const MIN_OVERLAP = 0.05;
const AUDIO_SOURCES = new Set(['WAVE', 'MP3', 'FLAC', 'VORBIS', 'OPUS', 'WAVPACK', 'AIFF']);

function projectEnd(project: RppProject): number {
  let end = 0;
  for (const t of project.tracks) for (const it of t.items) end = Math.max(end, it.position + it.length);
  for (const r of project.regions) end = Math.max(end, r.end);
  return end;
}

/** Trechos das músicas na linha do tempo do REAPER. */
function songRanges(project: RppProject, fallbackName: string): { ranges: Array<{ name: string; start: number; end: number }>; mode: ShowSplit['mode'] } {
  const end = projectEnd(project);
  // região dentro de outra é seção, não música
  const outer = project.regions.filter((r) => !project.regions.some((o) => o !== r && o.start <= r.start && o.end >= r.end && (o.end - o.start) > (r.end - r.start)));
  if (outer.length > 0) {
    return { ranges: outer.map((r, i) => ({ name: r.name.trim() || `Música ${i + 1}`, start: r.start, end: r.end })), mode: 'regioes' };
  }
  const starts = project.markers.filter((m) => !END_NAME.test(m.name));
  if (starts.length > 0) {
    const ranges = starts.map((m, i) => {
      const nextStart = starts[i + 1]?.position ?? end;
      const stop = project.markers.find((x) => END_NAME.test(x.name) && x.position > m.position && x.position <= nextStart);
      return { name: m.name.trim() || `Música ${i + 1}`, start: m.position, end: stop ? stop.position : nextStart };
    });
    // o que vem antes do primeiro marcador (contagem, ruído) fica de fora, como no show
    return { ranges: ranges.filter((r) => r.end - r.start > MIN_OVERLAP), mode: 'marcadores' };
  }
  return { ranges: end > 0 ? [{ name: fallbackName, start: 0, end }] : [], mode: 'inteiro' };
}

/** Andamento que vale no instante `time` (o do projeto quando não há mapa de andamento). */
function tempoAt(project: RppProject, time: number): RppTempoPoint {
  let cur: RppTempoPoint = { time: 0, bpm: project.bpm, beatsPerBar: project.beatsPerBar };
  for (const p of project.tempo) {
    if (p.time <= time + 1e-6) cur = { ...p, beatsPerBar: p.beatsPerBar ?? cur.beatsPerBar };
    else break;
  }
  return cur;
}

export function splitShow(project: RppProject, fallbackName = 'Projeto .RPP'): ShowSplit {
  const { ranges, mode } = songRanges(project, fallbackName);
  const skipped: ShowSkip[] = [];
  const skippedKeys = new Set<RppItem>();

  const songs: ShowSong[] = ranges.map((range) => {
    const items: ShowItem[] = [];
    for (const track of project.tracks) {
      for (const item of track.items) {
        const from = Math.max(item.position, range.start);
        const to = Math.min(item.position + item.length, range.end);
        if (to - from < MIN_OVERLAP) continue;
        const kind = item.sourceType.toUpperCase();
        const reason: ShowSkip['reason'] | null =
          kind === 'MIDI' ? 'midi'
          : kind === 'SECTION' ? 'trecho'
          : !item.file || !AUDIO_SOURCES.has(kind) ? 'sem-audio'
          : Math.abs(item.playRate - 1) > 1e-4 ? 'velocidade'
          : null;
        if (reason) {
          if (!skippedKeys.has(item) && kind !== 'EMPTY') {
            skippedKeys.add(item);
            skipped.push({ track: track.name, item: item.name || track.name, reason });
          }
          continue;
        }
        items.push({
          track,
          item,
          startTime: from - range.start,
          trimStart: item.sourceOffset + (from - item.position),
          playLength: to - from,
          gain: item.volume * track.volume * track.folderVolume,
          mute: item.mute || track.mute || track.folderMute,
          // o fade só vale se a ponta do item cai dentro da música
          fadeIn: item.position >= range.start ? item.fadeIn : 0,
          fadeOut: item.position + item.length <= range.end ? item.fadeOut : 0,
        });
      }
    }

    const first = tempoAt(project, range.start);
    const tempo = [{ startTime: 0, bpm: first.bpm }];
    for (const p of project.tempo) {
      if (p.time <= range.start + 1e-6 || p.time >= range.end - 1e-6) continue;
      if (Math.abs(p.bpm - tempo[tempo.length - 1].bpm) < 1e-3) continue;
      tempo.push({ startTime: p.time - range.start, bpm: p.bpm });
    }

    const duration = range.end - range.start;
    const inner = [
      ...project.regions
        .filter((r) => r.start >= range.start && r.end <= range.end && !(r.start === range.start && r.end === range.end))
        .map((r) => ({ name: r.name, start: r.start - range.start, end: r.end - range.start })),
    ];
    if (mode === 'regioes') {
      // marcador solto dentro da música vira seção até o próximo marcador (ou o fim da música)
      const ms = project.markers.filter((m) => m.position >= range.start && m.position < range.end - MIN_OVERLAP);
      ms.forEach((m, i) => {
        const next = ms[i + 1]?.position ?? range.end;
        inner.push({ name: m.name, start: m.position - range.start, end: Math.min(next, range.end) - range.start });
      });
    }
    const sections = inner
      .filter((s) => s.name.trim() && s.end - s.start > MIN_OVERLAP && s.end <= duration + 1e-6)
      .sort((a, b) => a.start - b.start);

    return {
      name: range.name,
      start: range.start,
      end: range.end,
      items,
      tempo,
      beatsPerBar: first.beatsPerBar ?? project.beatsPerBar,
      sections,
    };
  });

  const tracksWithFx = project.tracks.filter((t) => t.hasFx && t.items.length > 0).map((t) => t.name);
  return { songs: songs.filter((s) => s.items.length > 0), skipped, tracksWithFx, mode };
}

// ---------------------------------------------------------------------------------------------
// Achar o arquivo de áudio que o .rpp cita

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').normalize('NFC').toLowerCase();

function joinPath(dir: string, rel: string): string {
  const parts = [...dir.split('/'), ...rel.split('/')];
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

/**
 * Acha, entre os arquivos da pasta escolhida, o que o .rpp cita. Tenta o caminho relativo à
 * pasta do projeto; se não der (caminho absoluto, projeto movido de lugar), o mesmo nome de
 * arquivo, preferindo o que tem mais pastas em comum no fim do caminho.
 */
export function resolveMediaPath<T>(ref: string, rppDir: string, files: Array<{ path: string; file: T }>): T | null {
  const want = normPath(ref);
  const isAbsolute = want.startsWith('/') || /^[a-z]:\//.test(want);
  if (!isAbsolute) {
    const full = normPath(joinPath(rppDir, ref.replace(/\\/g, '/')));
    const hit = files.find((f) => normPath(f.path) === full);
    if (hit) return hit.file;
  }
  const wantParts = want.split('/').filter(Boolean);
  const base = wantParts[wantParts.length - 1];
  let best: { file: T; score: number } | null = null;
  for (const f of files) {
    const parts = normPath(f.path).split('/').filter(Boolean);
    if (parts[parts.length - 1] !== base) continue;
    let score = 0;
    while (score < parts.length && score < wantParts.length && parts[parts.length - 1 - score] === wantParts[wantParts.length - 1 - score]) score++;
    if (!best || score > best.score) best = { file: f.file, score };
  }
  return best?.file ?? null;
}
