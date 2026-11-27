// Leitor de arquivo MIDI (Standard MIDI File 1.0), escrito aqui, sem biblioteca: só o que o VS
// Stage usa do MIDI que vem junto do VS (andamento, compasso, marcações, tom, SMPTE offset e nomes).
// Notas, program change, letras e sysex são contados e pulados, nunca guardados.
// Sem dependência do programa, para rodar igual no app (Mac, Catalina, Windows) e nos testes.

export type MidiDivision = { kind: 'ppq'; ppq: number } | { kind: 'smpte'; fps: number; ticksPerFrame: number };

export interface MidiTempoEvent { tick: number; usPerQuarter: number }
export interface MidiMeterEvent { tick: number; numerator: number; denominator: number }
export interface MidiKeyEvent { tick: number; sf: number; minor: boolean }
export interface MidiTextEvent { tick: number; text: string; kind: 'marker' | 'cue' | 'text'; track: number }
export interface MidiSmpteOffset { hours: number; minutes: number; seconds: number; frames: number; subframes: number; fps: number }

export interface MidiFileInfo {
  format: number;
  /** Faixas que o cabeçalho anuncia. */
  trackCount: number;
  /** Faixas MTrk achadas de fato. */
  tracksRead: number;
  division: MidiDivision;
  /** Trocas de andamento em ordem, sem repetição (no mesmo tick vale a da faixa de condutor; nela, a última). */
  tempos: MidiTempoEvent[];
  meters: MidiMeterEvent[];
  keys: MidiKeyEvent[];
  /** Marcadores (FF 06), cue points (FF 07) e textos (FF 01), em ordem. */
  texts: MidiTextEvent[];
  smpteOffset: MidiSmpteOffset | null;
  sequenceName: string;
  trackNames: string[];
  /** Último tick com evento (o fim do arquivo). */
  endTick: number;
  counts: { notes: number; programChanges: number; controlChanges: number; lyrics: number; sysex: number; events: number };
  /** Problemas que não impediram a leitura (faixa cortada, evento estranho...). */
  warnings: string[];
}

export class MidiParseError extends Error {}

/** Limites para um arquivo estranho não travar o programa. */
export const MIDI_MAX_BYTES = 32 * 1024 * 1024;
const MAX_EVENTS = 4_000_000;
const MAX_TRACKS = 4096;

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/** Onde começa o "MThd": no começo, dentro de um RIFF RMID ou depois de um cabeçalho (MacBinary). */
export function findMidiStart(bytes: Uint8Array): number {
  if (bytes.length >= 14 && ascii(bytes, 0) === 'MThd') return 0;
  if (bytes.length >= 20 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'RMID') {
    // pedaços do RIFF: o "data" traz o arquivo MIDI inteiro
    let at = 12;
    while (at + 8 <= bytes.length) {
      const id = ascii(bytes, at);
      const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] << 24);
      if (id === 'data' && at + 8 + 4 <= bytes.length && ascii(bytes, at + 8) === 'MThd') return at + 8;
      if (size < 0) break;
      at += 8 + size + (size & 1);
    }
  }
  const limit = Math.min(bytes.length - 4, 160);
  for (let i = 0; i <= limit; i++) if (bytes[i] === 0x4d && ascii(bytes, i) === 'MThd') return i;
  return -1;
}

/** É um arquivo MIDI? Pela assinatura, não pela extensão. */
export function looksLikeMidi(bytes: Uint8Array): boolean {
  return findMidiStart(bytes) >= 0;
}

let utf8: TextDecoder | null = null;
let latin: TextDecoder | null = null;

/**
 * Texto de um evento meta. UTF-8 quando o arquivo é UTF-8 (Logic, REAPER, Studio One); senão
 * Windows-1252, que cobre o Latin-1 (Cubase, Pro Tools e arquivos antigos). Sai o BOM, os zeros do
 * fim e uma marca de idioma "{@LATIN}" no começo.
 */
export function decodeMidiText(raw: Uint8Array): string {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end--;
  let bytes = raw.subarray(0, end);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  let text: string;
  try {
    utf8 ??= new TextDecoder('utf-8', { fatal: true });
    text = utf8.decode(bytes);
  } catch {
    try {
      latin ??= new TextDecoder('windows-1252');
      text = latin.decode(bytes);
    } catch {
      text = Array.from(bytes, (c) => String.fromCharCode(c)).join('');
    }
  }
  return text.replace(/^\{@[A-Z0-9_-]*\}/i, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SMPTE_RATES: Record<number, number> = { 0: 24, 1: 25, 2: 29.97, 3: 30 };

/** Lê o arquivo. Cabeçalho inválido ou ausente: MidiParseError. Faixa com defeito: lida até onde deu, com aviso. */
export function parseMidiFile(input: ArrayBuffer | Uint8Array): MidiFileInfo {
  const all = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (all.length > MIDI_MAX_BYTES) throw new MidiParseError('arquivo MIDI grande demais');
  const start = findMidiStart(all);
  if (start < 0) throw new MidiParseError('não é um arquivo MIDI');
  const b = all.subarray(start);
  if (b.length < 14) throw new MidiParseError('cabeçalho do MIDI com defeito');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const headerLen = view.getUint32(4);
  if (headerLen < 6 || 8 + headerLen > b.length) throw new MidiParseError('cabeçalho do MIDI com defeito');
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const rawDiv = view.getUint16(12);
  let division: MidiDivision;
  if (rawDiv & 0x8000) {
    const fpsByte = (rawDiv >> 8) & 0xff;
    const neg = fpsByte > 127 ? 256 - fpsByte : fpsByte;
    const fps = neg === 29 ? 29.97 : neg;
    const ticksPerFrame = rawDiv & 0xff;
    if (![24, 25, 29.97, 30].includes(fps) || ticksPerFrame === 0) throw new MidiParseError('divisão SMPTE inválida');
    division = { kind: 'smpte', fps, ticksPerFrame };
  } else {
    if (rawDiv === 0) throw new MidiParseError('divisão zero no cabeçalho');
    division = { kind: 'ppq', ppq: rawDiv };
  }
  if (format > 2) throw new MidiParseError('formato de MIDI desconhecido');

  const info: MidiFileInfo = {
    format, trackCount, tracksRead: 0, division,
    tempos: [], meters: [], keys: [], texts: [], smpteOffset: null,
    sequenceName: '', trackNames: [], endTick: 0,
    counts: { notes: 0, programChanges: 0, controlChanges: 0, lyrics: 0, sysex: 0, events: 0 },
    warnings: [],
  };
  const rawTempos: Array<MidiTempoEvent & { order: number; track: number }> = [];
  const rawMeters: Array<MidiMeterEvent & { order: number; track: number }> = [];
  let order = 0;

  let at = 8 + headerLen;
  let trackIndex = 0;
  while (at + 8 <= b.length && trackIndex < MAX_TRACKS) {
    const id = ascii(b, at);
    const len = view.getUint32(at + 4);
    const bodyStart = at + 8;
    if (id !== 'MTrk') {
      // pedaço desconhecido: pula pelo tamanho
      at = bodyStart + len;
      continue;
    }
    let bodyEnd = bodyStart + len;
    if (bodyEnd > b.length) {
      info.warnings.push(`faixa ${trackIndex + 1} cortada no fim do arquivo`);
      bodyEnd = b.length;
    }
    // formato 2: cada faixa é uma sequência própria; para o VS vale só a primeira
    const useTrack = format !== 2 || trackIndex === 0;
    const track = trackIndex;
    let p = bodyStart;
    let tick = 0;
    let running = 0;
    let ended = false;
    let broken: string | null = null;
    const readVlq = (): number => {
      let v = 0;
      for (let n = 0; n < 4; n++) {
        if (p >= bodyEnd) throw new MidiParseError('fim da faixa no meio de um número');
        const c = b[p++];
        v = v * 128 + (c & 0x7f);
        if (!(c & 0x80)) return v;
      }
      throw new MidiParseError('número com mais de 4 bytes');
    };
    try {
      while (p < bodyEnd) {
        if (++info.counts.events > MAX_EVENTS) throw new MidiParseError('eventos demais no arquivo');
        tick += readVlq();
        if (p >= bodyEnd) throw new MidiParseError('evento sem dados');
        let status = b[p];
        if (status >= 0x80) p++;
        else if (running) status = running;
        else throw new MidiParseError('byte de dados sem status');
        // meta e sysex cancelam o running status pela norma; aqui o último status de canal fica valendo,
        // porque há exportador antigo que conta com isso (num arquivo certo nada muda: lá todo dado tem status)
        if (status === 0xff) {
          if (p >= bodyEnd) throw new MidiParseError('meta sem tipo');
          const type = b[p++];
          const size = readVlq();
          if (p + size > bodyEnd) throw new MidiParseError('meta passa do fim da faixa');
          const data = b.subarray(p, p + size);
          p += size;
          if (!useTrack) { if (type === 0x2f) { ended = true; break; } continue; }
          if (type === 0x2f) { ended = true; if (tick > info.endTick) info.endTick = tick; break; }
          if (tick > info.endTick) info.endTick = tick;
          if (type === 0x51) {
            if (size >= 3) {
              const us = (data[0] << 16) | (data[1] << 8) | data[2];
              if (us > 0) rawTempos.push({ tick, usPerQuarter: us, order: order++, track });
            }
          } else if (type === 0x58) {
            if (size >= 2 && data[0] > 0 && data[1] < 8) rawMeters.push({ tick, numerator: data[0], denominator: 2 ** data[1], order: order++, track });
          } else if (type === 0x59) {
            if (size >= 2) {
              const sf = data[0] > 127 ? data[0] - 256 : data[0];
              if (sf >= -7 && sf <= 7) info.keys.push({ tick, sf, minor: data[1] === 1 });
            }
          } else if (type === 0x54) {
            if (size >= 5 && !info.smpteOffset) {
              const hr = data[0];
              info.smpteOffset = { hours: hr & 0x1f, minutes: data[1], seconds: data[2], frames: data[3], subframes: data[4], fps: SMPTE_RATES[(hr >> 5) & 3] };
            }
          } else if (type === 0x03) {
            const text = decodeMidiText(data);
            if (text) {
              if (track === 0 && !info.sequenceName) info.sequenceName = text;
              if (!info.trackNames[track]) info.trackNames[track] = text;
            }
          } else if (type === 0x06 || type === 0x07 || type === 0x01) {
            const text = decodeMidiText(data);
            if (text) info.texts.push({ tick, text, kind: type === 0x06 ? 'marker' : type === 0x07 ? 'cue' : 'text', track });
          } else if (type === 0x05) {
            info.counts.lyrics++;
          }
          continue;
        }
        if (status === 0xf0 || status === 0xf7) {
          const size = readVlq();
          if (p + size > bodyEnd) throw new MidiParseError('sysex passa do fim da faixa');
          p += size;
          info.counts.sysex++;
          continue;
        }
        if (status >= 0xf0) throw new MidiParseError('status de sistema dentro da faixa');
        running = status;
        const kind = status & 0xf0;
        const need = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        if (p + need > bodyEnd) throw new MidiParseError('evento de canal cortado');
        for (let i = 0; i < need; i++) if (b[p + i] >= 0x80) throw new MidiParseError('evento de canal com defeito');
        if (useTrack) {
          if (kind === 0x90 && b[p + 1] > 0) info.counts.notes++;
          else if (kind === 0xc0) info.counts.programChanges++;
          else if (kind === 0xb0) info.counts.controlChanges++;
          if (tick > info.endTick) info.endTick = tick;
        }
        p += need;
      }
    } catch (err) {
      if (!(err instanceof MidiParseError)) throw err;
      if (err.message === 'eventos demais no arquivo') throw err;
      broken = err.message;
    }
    if (broken) info.warnings.push(`faixa ${trackIndex + 1} com defeito (${broken}): lida até onde deu`);
    else if (!ended) info.warnings.push(`faixa ${trackIndex + 1} sem o fim de faixa`);
    info.tracksRead++;
    trackIndex++;
    at = bodyStart + len;
  }
  if (info.tracksRead === 0) throw new MidiParseError('o arquivo MIDI não tem nenhuma faixa');
  if (info.tracksRead < trackCount) info.warnings.push(`o cabeçalho fala em ${trackCount} faixas e só ${info.tracksRead} vieram`);
  if (format === 2 && info.tracksRead > 1) info.warnings.push('MIDI de formato 2 (sequências separadas): só a primeira foi lida');

  // tempo e compasso de todas as faixas, em ordem; repetido sai. No mesmo tick vale o da faixa de
  // condutor (a primeira, onde a norma põe o mapa no formato 1) e, dentro da faixa, o último
  const conductorLast = (x: { track: number }, y: { track: number }) => (x.track === 0 ? 1 : 0) - (y.track === 0 ? 1 : 0);
  rawTempos.sort((x, y) => x.tick - y.tick || conductorLast(x, y) || x.order - y.order);
  for (const t of rawTempos) {
    const last = info.tempos[info.tempos.length - 1];
    if (last && last.tick === t.tick) info.tempos[info.tempos.length - 1] = { tick: t.tick, usPerQuarter: t.usPerQuarter };
    else info.tempos.push({ tick: t.tick, usPerQuarter: t.usPerQuarter });
  }
  info.tempos = info.tempos.filter((t, i, list) => i === 0 || t.usPerQuarter !== list[i - 1].usPerQuarter);
  rawMeters.sort((x, y) => x.tick - y.tick || conductorLast(x, y) || x.order - y.order);
  for (const m of rawMeters) {
    const last = info.meters[info.meters.length - 1];
    if (last && last.tick === m.tick) info.meters[info.meters.length - 1] = { tick: m.tick, numerator: m.numerator, denominator: m.denominator };
    else info.meters.push({ tick: m.tick, numerator: m.numerator, denominator: m.denominator });
  }
  info.meters = info.meters.filter((m, i, list) => i === 0 || m.numerator !== list[i - 1].numerator || m.denominator !== list[i - 1].denominator);
  info.texts.sort((x, y) => x.tick - y.tick);
  info.keys.sort((x, y) => x.tick - y.tick);
  return info;
}
