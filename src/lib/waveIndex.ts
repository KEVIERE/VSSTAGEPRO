/**
 * Índice de máximos das amostras de uma faixa aberta na memória: o maior valor absoluto de cada
 * 64 quadros, os dois canais juntos, como os arquivos de picos de uma DAW.
 *
 * Com zoom aproximado cada pixel da onda cobre centenas de quadros, e cada bloco de 2048 px lia
 * milhões de amostras (7 ms por bloco a 100 px/s, medido em node). Com o índice, o miolo do pixel
 * sai de poucas leituras e só as pontas (menos de 64 quadros de cada lado) leem as amostras
 * cruas. A coluna sai IDÊNTICA à de sampleColumns (waveColumns.ts): o ataque do click continua no
 * mesmo pixel da grade. Por isso o índice guarda o valor exato em 16 bits sem sinal (0 a 32768);
 * o Int16 cortaria o -32768 em 32767, e o resumo de 8 bits do disco adianta o ataque em 1 px.
 *
 * Montar o índice de uma faixa de 4 min custa ~105 ms (medido em node): nunca de uma vez. Ele é
 * montado aos pedaços, no tempo que sobra da fila de desenho das ondas (ClipWaveform), só para as
 * faixas da tela com zoom aproximado e só com a música parada. Enquanto não fica pronto, a onda
 * usa o cálculo de sempre. Fica num WeakMap pela própria matriz de amostras (o objeto ClipAudio):
 * sai da memória junto com o áudio, sem lista para limpar.
 *
 * Sem dependências do programa (só tipos), para os testes.
 */

export const WAVE_INDEX_FRAMES = 64;
/** Com menos quadros por pixel o índice quase não ajuda: o bloco lê as amostras direto. */
export const WAVE_INDEX_MIN_FRAMES_PER_PX = 2 * WAVE_INDEX_FRAMES;
/** Pedaços de 64 quadros montados entre uma olhada no relógio e outra (~32 mil quadros, menos de 1 ms). */
export const WAVE_INDEX_STEP_BINS = 512;

/** O que o índice precisa do áudio (o ClipAudio do audioLibrary). */
export interface WaveIndexAudio {
  channels: Int16Array[];
  length: number;
}

export interface WaveIndex {
  framesPer: number;
  /** Quadros cobertos: o menor dos dois canais (o mesmo limite de sampleColumns). */
  frames: number;
  /** Maior |amostra| de cada `framesPer` quadros, nos dois canais (0 a 32768). */
  data: Uint16Array;
}

interface Entry extends WaveIndex {
  /** Os canais de quando a montagem começou: outro array no lugar, o índice recomeça. */
  chs: Int16Array[];
  /** Pedaços de 64 quadros já prontos (a montagem vai do começo para o fim). */
  done: number;
  /** Quantas ondas na tela pedem este índice (0: sai da fila, o que já foi montado fica). */
  wants: number;
}

// A chave é o objeto do áudio: o valor só existe enquanto ele existir (os canais vão junto).
const entries = new WeakMap<object, Entry>();
/**
 * Fila de montagem, a pedida mais recente primeiro. Só tem áudio que alguma onda na tela pede
 * (wants > 0); a onda que sai da tela tira o seu da fila. Por isso a fila não segura na memória
 * áudio que o audioLibrary já soltou.
 */
const queue: WaveIndexAudio[] = [];

function channelsOf(audio: WaveIndexAudio): Int16Array[] {
  return audio.channels.slice(0, 2);
}

function sameChannels(e: Entry, audio: WaveIndexAudio): boolean {
  const chs = audio.channels;
  const n = Math.min(2, chs.length);
  if (n !== e.chs.length) return false;
  for (let c = 0; c < n; c++) if (chs[c] !== e.chs[c]) return false;
  return true;
}

/** Recomeça o índice com os canais atuais do áudio (no mesmo objeto: os pedidos continuam valendo). */
function resetEntry(e: Entry, audio: WaveIndexAudio): void {
  const chs = channelsOf(audio);
  e.chs = chs;
  e.frames = chs.length ? Math.min(...chs.map((c) => c.length)) : 0;
  e.data = new Uint16Array(Math.ceil(e.frames / WAVE_INDEX_FRAMES));
  e.done = 0;
}

function entryOf(audio: WaveIndexAudio): Entry {
  let e = entries.get(audio);
  if (!e) {
    e = { framesPer: WAVE_INDEX_FRAMES, frames: 0, data: new Uint16Array(0), chs: [], done: 0, wants: 0 };
    resetEntry(e, audio);
    entries.set(audio, e);
  } else if (!sameChannels(e, audio)) {
    resetEntry(e, audio);
  }
  return e;
}

/** Monta os pedaços [e.done, to) do índice. */
function fillBins(e: Entry, to: number): void {
  const { chs, data, frames } = e;
  const fp = WAVE_INDEX_FRAMES;
  const nch = chs.length;
  for (let b = e.done; b < to; b++) {
    const a = b * fp;
    const z = Math.min(frames, a + fp);
    let m = 0;
    for (let c = 0; c < nch; c++) {
      const ch = chs[c];
      for (let s = a; s < z; s++) {
        const r = ch[s];
        const v = r < 0 ? -r : r;
        if (v > m) m = v;
      }
    }
    data[b] = m;
  }
  e.done = to;
}

/** O índice pronto deste áudio, ou null (ainda montando, nunca pedido ou de outros canais). */
export function readyWaveIndex(audio: WaveIndexAudio | null | undefined): WaveIndex | null {
  if (!audio) return null;
  const e = entries.get(audio);
  if (!e || e.done < e.data.length || !sameChannels(e, audio)) return null;
  return e;
}

/**
 * Uma onda na tela vai ler as amostras deste áudio com zoom aproximado: põe o índice na frente da
 * fila de montagem. Devolve a função que desfaz o pedido (a onda saiu da tela ou o zoom afastou).
 */
export function wantWaveIndex(audio: WaveIndexAudio): () => void {
  const entry = entryOf(audio);
  if (entry.done >= entry.data.length) return () => { /* já pronto */ };
  entry.wants++;
  const at = queue.indexOf(audio);
  if (at >= 0) queue.splice(at, 1);
  queue.unshift(audio);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.wants = Math.max(0, entry.wants - 1);
    if (entry.wants > 0) return;
    const i = queue.indexOf(audio);
    if (i >= 0) queue.splice(i, 1);
  };
}

/** Há índice pedido e ainda não pronto. */
export function waveIndexPending(): boolean {
  return queue.length > 0;
}

/**
 * Monta um pouco dos índices pedidos, até o relógio `now` passar de `deadline`. Olha o relógio a
 * cada ~32 mil quadros. Devolve true se ainda falta montar.
 */
export function buildWaveIndexStep(deadline: number, now: () => number = () => performance.now()): boolean {
  while (queue.length > 0) {
    const audio = queue[0];
    const e = entries.get(audio);
    if (!e || e.wants <= 0) { queue.shift(); continue; }
    // os canais foram trocados no mesmo objeto: recomeça com os novos
    if (!sameChannels(e, audio)) resetEntry(e, audio);
    if (e.done >= e.data.length) { queue.shift(); continue; }
    if (now() >= deadline) return true;
    fillBins(e, Math.min(e.data.length, e.done + WAVE_INDEX_STEP_BINS));
    if (e.done >= e.data.length) queue.shift();
  }
  return false;
}

/** Para teste: monta o índice inteiro de uma vez. */
export function buildWaveIndexNow(audio: WaveIndexAudio): WaveIndex {
  const e = entryOf(audio);
  fillBins(e, e.data.length);
  const i = queue.indexOf(audio);
  if (i >= 0) queue.splice(i, 1);
  return e;
}

/** Para teste: esvazia a fila (os índices prontos saem com o áudio). */
export function clearWaveIndexQueue(): void {
  queue.length = 0;
}

/**
 * Igual a sampleColumns(channels, 0, totalFrames, perPx, offset, width), coluna a coluna, lendo o
 * miolo de cada pixel no índice. `index` tem de ser o índice destes canais (readyWaveIndex).
 */
export function indexColumns(
  channels: Int16Array[],
  index: WaveIndex,
  totalFrames: number,
  perPx: number,
  offset: number,
  width: number,
): Float32Array {
  const out = new Float32Array(width + 1);
  const chs = channels.slice(0, 2);
  const nch = chs.length;
  const fp = index.framesPer;
  const data = index.data;
  const end = Math.min(totalFrames, index.frames);
  for (let x = 0; x <= width; x++) {
    if (offset + x < 0) continue;
    const s0 = Math.floor((offset + x) * perPx);
    if (s0 >= end) break;
    const s1 = Math.min(end, Math.max(s0 + 1, Math.floor((offset + x + 1) * perPx)));
    let m = 0;
    // pedaços de 64 quadros inteiros dentro de [s0, s1): lidos no índice
    const b0 = Math.ceil(s0 / fp);
    const b1 = Math.floor(s1 / fp);
    if (b1 > b0) {
      for (let b = b0; b < b1; b++) if (data[b] > m) m = data[b];
      const a = b0 * fp;
      const z = b1 * fp;
      for (let c = 0; c < nch; c++) {
        const ch = chs[c];
        for (let s = s0; s < a; s++) {
          const r = ch[s];
          const v = r < 0 ? -r : r;
          if (v > m) m = v;
        }
        for (let s = z; s < s1; s++) {
          const r = ch[s];
          const v = r < 0 ? -r : r;
          if (v > m) m = v;
        }
      }
    } else {
      for (let c = 0; c < nch; c++) {
        const ch = chs[c];
        for (let s = s0; s < s1; s++) {
          const r = ch[s];
          const v = r < 0 ? -r : r;
          if (v > m) m = v;
        }
      }
    }
    out[x] = m / 32768;
  }
  return out;
}
