// Processor do AudioWorklet que toca cada clipe. Roda na thread de áudio: este arquivo é
// juntado ao SoundTouch num script clássico (sem imports) por clipPlayerWorklet.ts e também
// é carregado direto pelos testes (tests/clipPlayer.test.mjs).
//
// O áudio de um clipe chega aos poucos: o tamanho total (total) é conhecido desde o início e
// os trechos já recebidos ficam em ranges. Um trecho que ainda não chegou toca como silêncio
// SEM parar o relógio da faixa — a faixa nunca atrasa em relação às outras e o fim de um
// trecho parcial nunca é confundido com o fim do clipe ("ended" só sai no fim de verdade).

// O áudio chega em 16 bits (inteiros) para ocupar metade da memória. Pelo tamanho do elemento,
// não por instanceof: o pedaço pode vir de outro contexto (testes) e continua valendo.
function sampleScale(arr) {
  return arr && arr.BYTES_PER_ELEMENT === 2 ? 1 / 32767 : 1;
}

const TAIL_PAD = 16384 * 2;
// Fade-out da posição antiga numa busca com a música tocando (~5 ms a 48 kHz).
const SEEK_FADE_OUT_FRAMES = 256;
// Atraso de largada que vale descontar: abaixo disso é arredondamento do relógio (meio bloco).
const LATE_TOLERANCE_S = 0.0015;
const LATE_REPORT_S = 0.01;

// ---------- dados do clipe (compartilhados por todas as vozes do reprodutor) ----------
//
// O áudio fica numa tabela de pedaços de tamanho fixo (por canal, um Int16Array por índice de
// pedaço; vazio = ainda não chegou). Nada do tamanho da música inteira é criado: cada pedaço
// nasce só quando o áudio dele chega, e um trecho que cobre o pedaço inteiro é guardado como
// está (sem cópia). Mesmo valor de SLOT_FRAMES em audioStreamer.ts (o envio já sai alinhado).
const SLOT_SHIFT = 14;
const SLOT_FRAMES = 1 << SLOT_SHIFT;
const SLOT_MASK = SLOT_FRAMES - 1;

function slotCount(total) {
  return total > 0 ? ((total + SLOT_MASK) >> SLOT_SHIFT) : 0;
}

// Tabela vazia para `total` quadros (só os ponteiros, um por pedaço).
function emptySlots(total) {
  const n = slotCount(total);
  const a = new Array(n);
  for (let i = 0; i < n; i++) a[i] = null;
  return a;
}

// Áudio contínuo (opções do reprodutor, 'extend', 'rendered') visto como tabela de pedaços:
// cada pedaço é um subarray do mesmo bloco, sem copiar nada.
function sliceSlots(arr, total) {
  const n = Math.max(slotCount(total), slotCount(arr.length));
  const a = new Array(n);
  for (let c = 0; c < n; c++) {
    const s = c << SLOT_SHIFT;
    if (s >= arr.length) { a[c] = null; continue; }
    const e = Math.min(arr.length, s + SLOT_FRAMES);
    a[c] = s === 0 && e === arr.length ? arr : arr.subarray(s, e);
  }
  return a;
}

function makeData(left, right, total, ranges) {
  const l = left || null;
  const t = Math.max(0, typeof total === 'number' ? total | 0 : (l ? l.length : 0));
  const mono = !l || !right || right === l;
  const slotsL = l ? sliceSlots(l, t) : emptySlots(t);
  return {
    left: slotsL,
    right: mono ? slotsL : sliceSlots(right, t),
    mono,
    scale: l ? sampleScale(l) : 1 / 32767,
    slotFrames: SLOT_FRAMES,
    total: t,
    // trechos recebidos, ordenados e sem sobreposição: [[início, fim), ...]
    ranges: ranges || (l && l.length > 0 ? [[0, Math.min(l.length, t)]] : []),
  };
}

// Pedaço c pronto para receber cópia de len quadros (criado na hora, ou aumentado se o que havia
// era o fim curto de um áudio contínuo).
function ownSlot(slots, c, len) {
  const cur = slots[c];
  if (cur && cur.length >= len) return cur;
  const fresh = new Int16Array(len);
  if (cur) fresh.set(cur.length > len ? cur.subarray(0, len) : cur);
  slots[c] = fresh;
  return fresh;
}

// [s, e) já está inteiro nos trechos recebidos.
function hasRange(data, s, e) {
  const rs = data.ranges;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (s < r[0]) return false;
    if (s < r[1]) return e <= r[1];
  }
  return false;
}

// Guarda um trecho recebido [offset, offset + n) na tabela. O pedaço coberto inteiro fica com a
// referência do trecho (subarray, sem cópia); só a ponta que cobre parte de um pedaço é copiada,
// para um pedaço criado agora. Roda ao receber a mensagem, nunca no bloco de som.
function putPiece(data, offset, left, right) {
  if (!left) return false;
  const total = data.total;
  const s0 = Math.max(0, offset | 0);
  const end = Math.min(total, (offset | 0) + left.length);
  if (end <= s0) return false;
  const r = right || left;
  const base = offset | 0;
  if (data.ranges.length === 0) data.scale = sampleScale(left);
  let p = s0;
  while (p < end) {
    const c = p >> SLOT_SHIFT;
    const cs = c << SLOT_SHIFT;
    const ce = Math.min(total, cs + SLOT_FRAMES);
    const stop = Math.min(end, ce);
    const a = p - base;
    const b = stop - base;
    if (p === cs && stop === ce) {
      data.left[c] = a === 0 && b === left.length ? left : left.subarray(a, b);
      if (!data.mono) data.right[c] = a === 0 && b === r.length ? r : r.subarray(a, b);
    } else if (!(data.left[c] && hasRange(data, p, stop))) {
      // ponta: copia para dentro do pedaço (o que já tinha chegado nele continua lá)
      ownSlot(data.left, c, ce - cs).set(left.subarray(a, b), p - cs);
      if (!data.mono) ownSlot(data.right, c, ce - cs).set(r.subarray(a, b), p - cs);
    }
    p = stop;
  }
  addRange(data, s0, end);
  return true;
}

// Copia [p, p + n) (já recebido) para outL/outR a partir de `at`, pedaço a pedaço, sem criar nada.
// Pedaço ausente ou curto demais vira silêncio (nunca NaN na saída).
function copyPlanar(d, p, n, outL, outR, at) {
  const k = d.scale;
  const Ls = d.left;
  const Rs = d.right;
  let i = 0;
  while (i < n) {
    const q = p + i;
    const c = q >> SLOT_SHIFT;
    const o = q & SLOT_MASK;
    let run = SLOT_FRAMES - o;
    if (run > n - i) run = n - i;
    const L = Ls[c];
    const R = Rs[c] || L;
    let ok = 0;
    if (L && R) {
      ok = Math.min(run, L.length - o, R.length - o);
      if (ok < 0) ok = 0;
      const base = at + i;
      for (let j = 0; j < ok; j++) {
        outL[base + j] = L[o + j] * k;
        outR[base + j] = R[o + j] * k;
      }
    }
    for (let j = ok; j < run; j++) { outL[at + i + j] = 0; outR[at + i + j] = 0; }
    i += run;
  }
}

// O mesmo, intercalado (esquerdo, direito, ...) como o SoundTouch lê.
function copyInterleaved(d, p, n, target, at) {
  const k = d.scale;
  const Ls = d.left;
  const Rs = d.right;
  let i = 0;
  while (i < n) {
    const q = p + i;
    const c = q >> SLOT_SHIFT;
    const o = q & SLOT_MASK;
    let run = SLOT_FRAMES - o;
    if (run > n - i) run = n - i;
    const L = Ls[c];
    const R = Rs[c] || L;
    let ok = 0;
    if (L && R) {
      ok = Math.min(run, L.length - o, R.length - o);
      if (ok < 0) ok = 0;
      let w = (at + i) * 2;
      for (let j = 0; j < ok; j++) {
        target[w++] = L[o + j] * k;
        target[w++] = R[o + j] * k;
      }
    }
    for (let j = ok; j < run; j++) { target[(at + i + j) * 2] = 0; target[(at + i + j) * 2 + 1] = 0; }
    i += run;
  }
}

// Uma amostra (para testes e diagnóstico): canal 0 esquerdo, 1 direito.
function sampleAt(data, i, channel) {
  const slots = channel ? data.right : data.left;
  const s = slots[i >> SLOT_SHIFT];
  return s ? s[i & SLOT_MASK] : 0;
}

// Junta o trecho na lista no lugar (sem montar lista nova): roda na thread de áudio a cada
// 'append', e lixo criado ali vira coleta de memória no meio do som.
function addRange(data, start, end) {

  if (end <= start) return;
  const rs = data.ranges;
  let i = 0;
  while (i < rs.length && rs[i][1] < start) i++;
  if (i === rs.length || rs[i][0] > end) {
    // não encosta em nenhum: abre espaço e insere
    for (let k = rs.length; k > i; k--) rs[k] = rs[k - 1];
    rs[i] = [start, end];
    return;
  }
  const r = rs[i];
  if (start < r[0]) r[0] = start;
  if (end > r[1]) r[1] = end;
  let j = i + 1;
  while (j < rs.length && rs[j][0] <= r[1]) {
    if (rs[j][1] > r[1]) r[1] = rs[j][1];
    j++;
  }
  const cut = j - i - 1;
  if (cut > 0) {
    for (let k = i + 1; k + cut < rs.length; k++) rs[k] = rs[k + cut];
    rs.length -= cut;
  }
}

// Resposta de spanAt reaproveitada: é chamada a cada bloco de 128 amostras de cada faixa, e um
// objeto novo por chamada enchia a memória da thread de áudio (a coleta dava engasgo). Quem chama
// lê os campos na hora, antes de chamar de novo.
const SPAN = { filled: false, until: 0 };

// Até onde a posição p continua do mesmo jeito: com dados (filled) ou sem dados ainda.
function spanAt(data, p) {
  const rs = data.ranges;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (p < r[0]) { SPAN.filled = false; SPAN.until = r[0]; return SPAN; }
    if (p < r[1]) { SPAN.filled = true; SPAN.until = r[1]; return SPAN; }
  }
  SPAN.filled = false;
  SPAN.until = data.total;
  return SPAN;
}

// Áudio já processado em segundo plano (contínuo, transferido): a tabela de pedaços é montada uma
// vez aqui, e cada voz nova só aponta para ela.
function makeRendered(left, right, tempo, pitch, partial, validFrames) {
  const r = right || left;
  const slotsL = sliceSlots(left, left.length);
  return {
    slotsL,
    slotsR: r === left ? slotsL : sliceSlots(r, left.length),
    scale: sampleScale(left),
    length: left.length,
    tempo, pitch, partial, validFrames,
  };
}

function isComplete(data) {
  return data.ranges.length === 1 && data.ranges[0][0] === 0 && data.ranges[0][1] >= data.total;
}

class ClipArraySource {
  constructor(data) {
    this.data = data;
    this.position = 0;
    this.starved = false;
  }
  // Silêncio extra no fim: o SoundTouch só processa blocos cheios e cortava o final da música.
  extract(target, numFrames, position) {
    this.position = position;
    this.starved = false;
    const d = this.data;
    const n = d.total;
    const available = Math.min(numFrames, Math.max(0, n + TAIL_PAD - position));
    let i = 0;
    while (i < available) {
      const p = position + i;
      if (p >= n) {
        for (; i < available; i++) { target[i * 2] = 0; target[i * 2 + 1] = 0; }
        break;
      }
      const span = spanAt(d, p);
      const stop = Math.min(available, span.until - position);
      if (span.filled) {
        copyInterleaved(d, p, stop - i, target, i);
        i = stop;
      } else {
        this.starved = true;
        for (; i < stop; i++) { target[i * 2] = 0; target[i * 2 + 1] = 0; }
      }
    }
    return available;
  }
}

// Uma "voz" é uma leitura independente do clipe a partir de uma posição.
// Ter duas permite pré-aquecer o início do loop enquanto o fim ainda toca.
// Com BPM e afinação no original, a voz lê o áudio direto (sem SoundTouch).
class Voice {
  constructor(data, sr, tempo, pitch, offset, primeTarget, forceProcess) {
    this.forceProcess = !!forceProcess;
    this.data = data;
    this.sr = sr;
    this.tempo = tempo || 1;
    this.pitch = pitch || 1;
    this.pos = Math.min(data.total, Math.max(0, offset | 0));
    this.filter = null;
    this.engine = null;
    this.source = null;
    this.primeTarget = primeTarget;
    this.primeL = new Float32Array(primeTarget);
    this.primeR = new Float32Array(primeTarget);
    this.primeFill = 0;
    this.primeReadPos = 0;
    this.primed = true;
    this.drained = false;
    this.starved = false;
    // já saiu som desta voz (só então ela precisa de fade-out ao ser trocada)
    this.heard = false;
    this.scratch = new Float32Array(1024);
    if (!this.isBypass()) this.buildFilter();
  }
  get length() {
    return this.data.total;
  }
  isBypass() {
    return !this.forceProcess && Math.abs(this.tempo - 1) < 1e-6 && Math.abs(this.pitch - 1) < 1e-6;
  }
  buildFilter() {
    this.engine = new SoundTouch(this.sr);
    // mesmas janelas do preparo em segundo plano: menos som metálico em música
    this.engine.stretch.setParameters(this.sr, 82, 28, 12);
    this.engine.tempo = this.tempo;
    this.engine.pitch = this.pitch;
    this.source = new ClipArraySource(this.data);
    this.source.position = this.pos;
    this.filter = new SimpleFilter(this.source, this.engine);
    // A posição do filtro nunca volta (busca e salto criam outra voz): sem histórico guardado,
    // a fila de saída fica pequena e cada cópia interna do SoundTouch move menos dados.
    this.filter.historyBufferSize = 0;
    this.filter.sourcePosition = this.pos;
    this.primeFill = 0;
    this.primeReadPos = 0;
    this.primed = false;
  }
  setParams(tempo, pitch, process) {
    if (typeof process === 'boolean') this.forceProcess = process;
    if (typeof tempo === 'number') this.tempo = tempo;
    if (typeof pitch === 'number') this.pitch = pitch;
    if (this.isBypass()) {
      if (this.filter) {
        this.pos = Math.min(this.length, this.source.position);
        this.filter = null;
        this.engine = null;
        this.source = null;
        this.primeFill = 0;
        this.primeReadPos = 0;
        this.primed = true;
      }
      return;
    }
    if (!this.filter) {
      this.buildFilter();
      return;
    }
    this.engine.tempo = this.tempo;
    this.engine.pitch = this.pitch;
  }
  // Leitura direta: a posição sempre anda junto com o relógio, tenha ou não chegado o dado.
  readDirect(outL, outR, start, count) {
    const d = this.data;
    const avail = Math.max(0, Math.min(count, d.total - this.pos));
    let i = 0;
    while (i < avail) {
      const p = this.pos + i;
      const span = spanAt(d, p);
      const stop = Math.min(avail, span.until - this.pos);
      if (span.filled) {
        copyPlanar(d, p, stop - i, outL, outR, start + i);
        i = stop;
      } else {
        this.starved = true;
        for (; i < stop; i++) { outL[start + i] = 0; outR[start + i] = 0; }
      }
    }
    for (let j = avail; j < count; j++) {
      outL[start + j] = 0;
      outR[start + j] = 0;
    }
    this.pos += avail;
    if (this.pos >= d.total) this.drained = true;
  }
  // O SoundTouch lê à frente: só pré-aquece quando o trecho da largada já chegou, senão o
  // silêncio de "ainda não chegou" ficaria guardado no começo da faixa.
  pump() {
    if (this.primed || !this.filter) return;
    const at = this.source.position;
    if (at < this.length && !spanAt(this.data, at).filled) return;
    const chunk = Math.min(this.primeTarget - this.primeFill, 512);
    if (chunk > 0) {
      const got = this.filter.extract(this.scratch, chunk);
      for (let i = 0; i < got; i++) {
        this.primeL[this.primeFill + i] = this.scratch[i * 2];
        this.primeR[this.primeFill + i] = this.scratch[i * 2 + 1];
      }
      this.primeFill += got;
      if (got === 0 && this.source.position >= this.length) this.primed = true;
    }
    if (this.primeFill >= this.primeTarget) this.primed = true;
  }
  read(outL, outR, start, count) {
    if (!this.filter) {
      this.readDirect(outL, outR, start, count);
      return;
    }
    let pos = start;
    const end = start + count;
    const avail = this.primeFill - this.primeReadPos;
    if (avail > 0) {
      const take = Math.min(avail, count);
      for (let i = 0; i < take; i++) {
        outL[pos + i] = this.primeL[this.primeReadPos + i];
        outR[pos + i] = this.primeR[this.primeReadPos + i];
      }
      this.primeReadPos += take;
      pos += take;
    }
    if (pos < end) {
      const needed = end - pos;
      if (this.scratch.length < needed * 2) this.scratch = new Float32Array(needed * 2);
      const got = this.filter.extract(this.scratch, needed);
      for (let i = 0; i < needed; i++) {
        outL[pos + i] = i < got ? this.scratch[i * 2] : 0;
        outR[pos + i] = i < got ? this.scratch[i * 2 + 1] : 0;
      }
      if (got === 0 && this.source.position >= this.length) this.drained = true;
    }
    // o SoundTouch busca o áudio em blocos à frente: vale o que faltou na última busca
    if (this.source.starved) this.starved = true;
  }
}

class ClipPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.data = makeData(o.left, o.right || o.left, typeof o.totalFrames === 'number' ? o.totalFrames : undefined);
    this.sr = o.sampleRate;
    this.tempo = o.tempo || 1;
    this.pitch = o.pitch || 1;
    this.processAll = !!o.process;
    this.primeTarget = (o.primeTargetFrames | 0) || 2048;
    // Nasce em modo idle: só silêncio até receber ordem de largada.
    this.startTime = Number.POSITIVE_INFINITY;
    this.stopped = false;
    this.endedPosted = false;
    this.readyPosted = false;
    this.loadedPosted = isComplete(this.data);
    this.underrun = false;
    // Começo já processado (só os primeiros segundos): vale até validFrames; depois o motor troca para o áudio inteiro.
    this.rendered = o.renderedLeft ? makeRendered(o.renderedLeft, o.renderedRight, o.renderedTempo, o.renderedPitch, true, o.renderedValidFrames | 0) : null;
    // ponto (no áudio original) de onde a voz principal começa: base para descontar largada atrasada
    this.voiceOffset = o.offsetSamples | 0;
    this.voice = this.makeVoice(this.voiceOffset);
    this.fadeInTotal = (o.fadeInFrames | 0) || 0;
    this.fadeInDone = 0;
    this.jump = null;
    this.fadeOutVoice = null;
    this.fadeOutTotal = 0;
    this.fadeOutDone = 0;
    this.fadeOutGain = 1;
    this.tmpL = new Float32Array(128);
    this.tmpR = new Float32Array(128);
    // lado direito descartável quando a saída é mono: criado uma vez, não a cada bloco
    this.monoR = new Float32Array(128);
    // voz e posição no começo do bloco: dizem a folga que havia quando faltou dado
    this.quantumVoice = null;
    this.quantumPos = 0;

    this.port.onmessage = (ev) => this.handleMessage(ev.data || {});
  }

  handleMessage(d) {
    if (this.stopped) return;
    if (d.dropPartial && this.rendered && this.rendered.partial) this.rendered = null;
    // O áudio inteiro chegou de uma vez: o começo carregado antes é o início dele, então a leitura segue sem corte.
    // Vira a tabela de pedaços por subarray, sem copiar.
    if (d.type === 'extend') {
      const left = d.left;
      this.replaceData(left, d.right || left, typeof d.total === 'number' ? d.total : left.length, [[0, left.length]]);
      return;
    }
    // Áudio novo deste reprodutor: só o total, se é estéreo e os trechos que já vêm junto
    // (o da largada). A tabela nasce vazia; nada do tamanho da música é criado.
    // Formato antigo (left/right do tamanho total + ranges) continua aceito.
    if (d.type === 'stream') {
      if (d.left) {
        this.replaceData(d.left, d.right || d.left, d.total, (d.ranges || []).map((r) => [r[0], r[1]]));
        return;
      }
      this.resetData(d.total, d.stereo === false);
      const ps = d.pieces;
      if (ps) for (let i = 0; i < ps.length; i++) putPiece(this.data, ps[i].offset, ps[i].left, ps[i].right);
      this.afterDataChange();
      return;
    }
    // Mais um trecho do áudio chegou: a referência fica guardada (o trecho veio transferido).
    if (d.type === 'append') {
      const data = this.data;
      if (!putPiece(data, d.offset, d.left, d.right)) return;
      if (!this.loadedPosted && isComplete(data)) {
        this.loadedPosted = true;
        try { this.port.postMessage({ type: 'loaded' }); } catch (e) {}
      }
      return;
    }
    if (d.type === 'seek') {
      // A busca deve aplicar o andamento e tom do ponto de destino antes de criar a voz.
      if (typeof d.tempo === 'number') this.tempo = d.tempo;
      if (typeof d.pitch === 'number') this.pitch = d.pitch;
      if (typeof d.process === 'boolean') this.processAll = d.process;
      this.dropStaleRendered();
      // Música tocando: a voz que soava sai num fade curto em vez de ser cortada seca (o corte
      // de uma amostra para a outra dava estalo no PA em todas as faixas ao mesmo tempo).
      const prev = this.voice;
      const prevAudible = !!prev && prev.heard && !prev.drained && this.startTime <= currentTime;
      // Ganho em que a voz trocada estava soando: se ela ainda entrava em fade-in (busca logo
      // depois de outra busca, ou no meio de um cruzamento), o fade-out parte desse ganho, não de 1.
      let prevGain = this.fadeInDone < this.fadeInTotal ? this.fadeInDone / this.fadeInTotal : 1;
      // Um fade-out ainda em andamento (cruzamento de loop, de BPM/tom ou de outra busca) é
      // trocado por este: o ganho que faltava dele entra na conta, para o nível somado seguir
      // de onde estava, sem subir e sem cair de uma amostra para a outra.
      const fo = this.fadeOutVoice;
      if (prevAudible && fo && !fo.drained && this.fadeOutDone < this.fadeOutTotal) {
        prevGain += this.fadeOutGain * (1 - this.fadeOutDone / this.fadeOutTotal);
      }
      this.voiceOffset = d.offsetSamples | 0;
      this.voice = this.makeVoice(this.voiceOffset);
      this.jump = null;
      this.readyPosted = false;
      this.endedPosted = false;
      this.underrun = false;
      this.fadeInTotal = (d.fadeInFrames | 0) || this.fadeInTotal || 1024;
      this.fadeInDone = 0;
      if (typeof d.startTime === 'number') this.startTime = d.startTime;
      if (d.silent === true) this.startTime = Number.POSITIVE_INFINITY;
      else this.catchUpLateStart();
      // Se a voz trocada nem chegou a soar (duas buscas seguidas), o fade-out em andamento continua.
      if (prevAudible) this.startSeekFadeOut(prev, prevGain);
      return;
    }
    if (d.type === 'jump') {
      let resumeAt = typeof d.resumeAt === 'number' ? d.resumeAt : d.at;
      let offset = d.offsetSamples | 0;
      // ordem que chegou depois da hora: a voz nova entra já adiantada pelo atraso
      const late = this.lateBy(resumeAt);
      const resumeOriginal = resumeAt;
      if (late > 0) { offset += this.lateFrames(late); resumeAt = currentTime; this.noteLate(late); }
      this.jump = {
        at: d.at,
        resumeAt,
        crossfade: Math.max(1, d.crossfadeFrames | 0),
        // entrando atrasada no meio do som, a voz nova também precisa de rampa (senão estala)
        fadeIn: offset > 0 && (late > 0 || resumeOriginal <= d.at),
        voice: this.makeVoice(offset),
      };
      return;
    }
    // Áudio já processado em segundo plano: as próximas vozes só leem, sem SoundTouch ao vivo.
    if (d.type === 'rendered') {
      this.rendered = makeRendered(d.left, d.right, d.tempo, d.pitch, false, d.left.length);
      return;
    }
    // Troca BPM/tom de todas as faixas no mesmo instante, a partir da mesma posição.
    if (d.type === 'retime') {
      if (typeof d.tempo === 'number') this.tempo = d.tempo;
      if (typeof d.pitch === 'number') this.pitch = d.pitch;
      if (typeof d.process === 'boolean') this.processAll = d.process;
      this.dropStaleRendered();
      let at = d.at;
      let offset = d.offsetSamples | 0;
      const late = this.lateBy(at);
      if (late > 0) { offset += this.lateFrames(late); at = currentTime; this.noteLate(late); }
      this.jump = {
        at,
        resumeAt: at,
        crossfade: Math.max(1, d.crossfadeFrames | 0),
        fadeIn: true,
        voice: this.makeVoice(offset),
      };
      return;
    }
    if (d.type === 'cancelJump') {
      this.jump = null;
      return;
    }
    if (typeof d.tempo === 'number') this.tempo = d.tempo;
    if (typeof d.pitch === 'number') this.pitch = d.pitch;
    if (typeof d.process === 'boolean') this.processAll = d.process;
    if (typeof d.tempo === 'number' || typeof d.pitch === 'number' || typeof d.process === 'boolean') {
      this.dropStaleRendered();
      this.voice = this.retuneVoice(this.voice, d);
      if (this.jump) this.jump.voice = this.retuneVoice(this.jump.voice, d);
      if (this.fadeOutVoice) {
        if (this.fadeOutVoice.rendered) this.fadeOutVoice = null;
        else this.fadeOutVoice.setParams(d.tempo, d.pitch, d.process);
      }
    }
    if (typeof d.startTime === 'number') {
      this.startTime = d.startTime;
      this.catchUpLateStart();
    }
    if (d.type === 'stop') this.release();
  }

  // Quanto (s) a hora marcada já passou quando a ordem chegou aqui.
  lateBy(t) {
    if (typeof t !== 'number' || !Number.isFinite(t)) return 0;
    const late = currentTime - t;
    return late > LATE_TOLERANCE_S ? late : 0;
  }

  // Segundos de atraso em amostras do áudio original (com BPM alterado, o original anda tempo vezes).
  lateFrames(late) {
    return Math.round(late * this.sr * (this.tempo || 1));
  }

  // A ordem de largada chegou depois da hora marcada (Play com muitos reprodutores sendo criados
  // de uma vez, a tela ocupada): antes a faixa começava do ponto pedido AGORA e ficava atrasada em
  // relação às outras até o próximo Play. Agora ela entra adiantada pelo atraso, no tempo certo.
  catchUpLateStart() {
    if (!this.voice || this.voice.heard) return;
    const late = this.lateBy(this.startTime);
    if (late <= 0) return;
    this.voice = this.makeVoice(this.voiceOffset + this.lateFrames(late));
    this.startTime = currentTime;
    // entra no meio do som: um fade curto evita o estalo
    if (!this.fadeInTotal || this.fadeInTotal < 256) { this.fadeInTotal = 256; this.fadeInDone = 0; }
    this.noteLate(late);
  }

  // Para o diário: só atraso que dá para ouvir (arraste de clipe tocando sempre chega um pouco atrasado).
  noteLate(late) {
    if (late < LATE_REPORT_S) return;
    try { this.port.postMessage({ type: 'late', ms: Math.round(late * 1000) }); } catch (e) {}
  }

  // Troca o áudio de todas as vozes ao mesmo tempo: elas leem o mesmo objeto de dados.
  replaceData(left, right, total, ranges) {
    const t = Math.max(0, total | 0);
    const fresh = makeData(left, right || left, t, []);
    this.adoptData(fresh);
    for (const r of ranges) addRange(this.data, Math.max(0, r[0]), Math.min(t, r[1]));
    this.afterDataChange();
  }

  // Tabela vazia para `total` quadros; os trechos chegam depois (putPiece).
  resetData(total, mono) {
    const t = Math.max(0, total | 0);
    const slotsL = emptySlots(t);
    this.adoptData({ left: slotsL, right: mono ? slotsL : emptySlots(t), mono: !!mono, scale: 1 / 32767, slotFrames: SLOT_FRAMES, total: t, ranges: [] });
  }

  // Copia os campos para o objeto que as vozes já leem (não troca o objeto).
  adoptData(fresh) {
    const data = this.data;
    data.left = fresh.left;
    data.right = fresh.right;
    data.mono = fresh.mono;
    data.scale = fresh.scale;
    data.slotFrames = fresh.slotFrames;
    data.total = fresh.total;
    data.ranges = fresh.ranges;
  }

  afterDataChange() {
    const data = this.data;
    this.loadedPosted = isComplete(data);
    for (const v of [this.voice, this.jump && this.jump.voice, this.fadeOutVoice]) {
      if (v && !v.rendered && !v.filter && v.drained && v.pos < v.length) v.drained = false;
    }
  }

  // Solta o áudio na hora: o navegador pode demorar para descartar um reprodutor parado.
  release() {
    this.stopped = true;
    this.data = null;
    this.rendered = null;
    this.voice = null;
    this.jump = null;
    this.fadeOutVoice = null;
    this.port.onmessage = null;
  }

  renderedMatches() {
    const r = this.rendered;
    if (!r) return false;
    const wantsBypass = !this.processAll && Math.abs(this.tempo - 1) < 1e-6 && Math.abs(this.pitch - 1) < 1e-6;
    return !wantsBypass && Math.abs(r.tempo - this.tempo) < 1e-6 && Math.abs(r.pitch - this.pitch) < 1e-6;
  }

  dropStaleRendered() {
    if (this.rendered && !this.renderedMatches()) this.rendered = null;
  }

  // offset sempre em amostras do áudio original; no processado ele é dividido pelo tempo.
  makeVoice(offset) {
    const r0 = this.rendered;
    const inRange = !r0 || !r0.partial || offset / this.tempo < r0.validFrames - this.sr * 0.5;
    if (inRange && this.renderedMatches()) {
      const r = this.rendered;
      // O começo ajustado cobre só parte do clipe: depois dele vem silêncio sem fim falso,
      // até o motor trocar para o áudio inteiro.
      const total = r.partial ? Math.max(r.validFrames, Math.ceil(this.data.total / this.tempo)) : r.length;
      // a tabela de pedaços do processado já foi montada ao receber; aqui só o objeto da voz
      const data = { left: r.slotsL, right: r.slotsR, mono: r.slotsL === r.slotsR, scale: r.scale, slotFrames: SLOT_FRAMES, total, ranges: [[0, Math.min(r.validFrames, r.length)]] };
      const v = new Voice(data, this.sr, 1, 1, Math.floor(offset / this.tempo), this.primeTarget, false);
      v.rendered = true;
      v.tempoScale = this.tempo;
      return v;
    }
    return new Voice(this.data, this.sr, this.tempo, this.pitch, offset, this.primeTarget, this.processAll);
  }

  retuneVoice(v, d) {
    if (v.rendered) return this.makeVoice(Math.floor(v.pos * v.tempoScale));
    v.setParams(d.tempo, d.pitch, d.process);
    return v;
  }

  ensureTmp(n) {
    if (this.tmpL.length < n) {
      this.tmpL = new Float32Array(n);
      this.tmpR = new Float32Array(n);
    }
  }

  indexOf(time, frames) {
    if (time <= currentTime) return 0;
    const i = Math.round((time - currentTime) * sampleRate);
    return i >= frames ? frames : i;
  }

  // Fade-out curto da voz trocada numa busca. Se a voz nova entra antes de ele acabar, o
  // fade-out não passa do fade-in dela: somadas, as duas nunca ficam acima do pico de cada uma.
  // gain é o ganho em que a voz trocada estava; o fade-out desce dele até zero.
  startSeekFadeOut(prev, gain = 1) {
    let n = SEEK_FADE_OUT_FRAMES;
    const startsIn = (this.startTime - currentTime) * sampleRate;
    if (startsIn < n) n = Math.max(1, Math.min(n, this.fadeInTotal | 0));
    this.fadeOutVoice = prev;
    this.fadeOutTotal = n;
    this.fadeOutDone = 0;
    this.fadeOutGain = Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : 1;
  }

  // Ponto que a voz está lendo nos dados dela (o SoundTouch lê à frente do que já soou).
  readPos(v) {
    return v.filter ? v.source.position : v.pos;
  }

  // Quadros já recebidos em sequência a partir de p (a folga até faltar dado).
  filledFrom(v, p) {
    if (p >= v.data.total) return 0;
    const sp = spanAt(v.data, p);
    return sp.filled ? sp.until - p : 0;
  }

  // Quadros que ainda faltam a partir de p até o próximo trecho recebido.
  missingFrom(v, p) {
    if (p >= v.data.total) return 0;
    const sp = spanAt(v.data, p);
    return sp.filled ? 0 : sp.until - p;
  }

  renderMain(outL, outR, from, to, frames) {
    const s = Math.max(from, this.indexOf(this.startTime, frames));
    if (s >= to) return;
    const n = to - s;
    this.ensureTmp(n);
    this.voice.read(this.tmpL, this.tmpR, 0, n);
    this.voice.heard = true;
    for (let i = 0; i < n; i++) {
      let g = 1;
      if (this.fadeInDone < this.fadeInTotal) {
        g = this.fadeInDone / this.fadeInTotal;
        this.fadeInDone++;
      }
      outL[s + i] += this.tmpL[i] * g;
      outR[s + i] += this.tmpR[i] * g;
    }
  }

  renderFadeOut(outL, outR, from, to) {
    const v = this.fadeOutVoice;
    if (!v || from >= to) return;
    const n = Math.min(to - from, this.fadeOutTotal - this.fadeOutDone);
    this.ensureTmp(n);
    v.read(this.tmpL, this.tmpR, 0, n);
    for (let i = 0; i < n; i++) {
      const g = this.fadeOutGain * (1 - (this.fadeOutDone + i) / this.fadeOutTotal);
      outL[from + i] += this.tmpL[i] * g;
      outR[from + i] += this.tmpR[i] * g;
    }
    this.fadeOutDone += n;
    if (this.fadeOutDone >= this.fadeOutTotal) this.fadeOutVoice = null;
  }

  process(_inputs, outputs) {
    if (this.stopped) return false;
    const out = outputs[0];
    const outL = out[0];
    const outR = out[1] || out[0];
    const frames = outL.length;
    for (let i = 0; i < frames; i++) { outL[i] = 0; if (outR !== outL) outR[i] = 0; }
    let R = outR;
    if (outR === outL) {
      if (this.monoR.length < frames) this.monoR = new Float32Array(frames);
      R = this.monoR;
      for (let i = 0; i < frames; i++) R[i] = 0;
    }
    this.quantumVoice = this.voice;
    this.quantumPos = this.readPos(this.voice);

    if (!this.voice.primed) this.voice.pump();
    if (this.jump && !this.jump.voice.primed) this.jump.voice.pump();
    if (this.voice.primed && !this.readyPosted) {
      this.readyPosted = true;
      try { this.port.postMessage({ type: 'ready' }); } catch (e) {}
    }

    this.voice.starved = false;
    const swapAt = this.jump ? this.indexOf(this.jump.at, frames) : frames;
    this.renderFadeOut(outL, R, 0, swapAt);
    this.renderMain(outL, R, 0, swapAt, frames);

    if (swapAt < frames) {
      const j = this.jump;
      this.jump = null;
      const wasPlaying = this.startTime <= j.at && !this.voice.drained;
      this.fadeOutVoice = wasPlaying ? this.voice : null;
      this.fadeOutTotal = j.crossfade;
      this.fadeOutDone = 0;
      // Loop e troca de BPM/tom continuam com o cruzamento de sempre, a partir do ganho cheio.
      this.fadeOutGain = 1;
      this.voice = j.voice;
      this.voice.starved = false;
      this.startTime = j.resumeAt;
      this.fadeInTotal = j.fadeIn ? j.crossfade : 0;
      this.fadeInDone = 0;
      this.endedPosted = false;
      this.renderFadeOut(outL, R, swapAt, frames);
      this.renderMain(outL, R, swapAt, frames, frames);
    }

    // Faltou dado no ar: avisa uma vez (a faixa segue no tempo certo, em silêncio, até o dado chegar).
    const starved = this.voice.starved;
    if (starved && !this.underrun) {
      this.underrun = true;
      // Para o diagnóstico: posição (no áudio original), folga que havia à frente no começo do
      // bloco e tamanho do buraco. 'frame' fica como antes para quem já lê esse campo.
      const v = this.voice;
      const at = this.readPos(v);
      const ahead = v === this.quantumVoice ? this.filledFrom(v, this.quantumPos) : 0;
      const gap = this.missingFrom(v, at);
      const k = v.rendered ? v.tempoScale : 1;
      try {
        this.port.postMessage({
          type: 'underrun', frame: v.pos,
          position: Math.floor(at * k), ahead: Math.floor(ahead * k), gap: Math.floor(gap * k), time: currentTime,
        });
      } catch (e) {}
    } else if (!starved && this.underrun && this.startTime <= currentTime) {
      this.underrun = false;
      try { this.port.postMessage({ type: 'recovered', frame: this.voice.pos }); } catch (e) {}
    }

    // Esgotado: fica em silêncio (não encerra) para poder voltar num loop.
    if (this.voice.drained && !this.fadeOutVoice && !this.jump && !this.endedPosted) {
      this.endedPosted = true;
      try { this.port.postMessage({ type: 'ended' }); } catch (e) {}
    }
    return true;
  }
}

registerProcessor('clip-player', ClipPlayerProcessor);
