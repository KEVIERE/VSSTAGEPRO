// Processor do AudioWorklet que toca cada clipe. Roda na thread de áudio: este arquivo é
// juntado ao SoundTouch num script clássico (sem imports) por clipPlayerWorklet.ts e também
// é carregado direto pelos testes (tests/clipPlayer.test.mjs).
//
// O áudio de um clipe chega aos poucos: o tamanho total (total) é conhecido desde o início e
// os trechos já recebidos ficam em ranges. Um trecho que ainda não chegou toca como silêncio
// SEM parar o relógio da faixa — a faixa nunca atrasa em relação às outras e o fim de um
// trecho parcial nunca é confundido com o fim do clipe ("ended" só sai no fim de verdade).

// O áudio chega em 16 bits (inteiros) para ocupar metade da memória.
function sampleScale(arr) {
  return arr instanceof Int16Array ? 1 / 32767 : 1;
}

const TAIL_PAD = 16384 * 2;

// ---------- dados do clipe (compartilhados por todas as vozes do reprodutor) ----------

function makeData(left, right, total, ranges) {
  const l = left || new Int16Array(0);
  const t = Math.max(0, typeof total === 'number' ? total | 0 : l.length);
  return {
    left: l,
    right: right || l,
    scale: sampleScale(l),
    total: t,
    // trechos recebidos, ordenados e sem sobreposição: [[início, fim), ...]
    ranges: ranges || (l.length > 0 ? [[0, Math.min(l.length, t)]] : []),
  };
}

function addRange(data, start, end) {
  if (end <= start) return;
  const out = [];
  let s = start;
  let e = end;
  let placed = false;
  for (const r of data.ranges) {
    if (r[1] < s) { out.push(r); continue; }
    if (r[0] > e) {
      if (!placed) { out.push([s, e]); placed = true; }
      out.push(r);
      continue;
    }
    s = Math.min(s, r[0]);
    e = Math.max(e, r[1]);
  }
  if (!placed) out.push([s, e]);
  data.ranges = out;
}

// Até onde a posição p continua do mesmo jeito: com dados (filled) ou sem dados ainda.
function spanAt(data, p) {
  for (const r of data.ranges) {
    if (p < r[0]) return { filled: false, until: r[0] };
    if (p < r[1]) return { filled: true, until: r[1] };
  }
  return { filled: false, until: data.total };
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
    const k = d.scale;
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
        for (; i < stop; i++) {
          target[i * 2] = d.left[position + i] * k;
          target[i * 2 + 1] = d.right[position + i] * k;
        }
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
    const k = d.scale;
    const avail = Math.max(0, Math.min(count, d.total - this.pos));
    let i = 0;
    while (i < avail) {
      const p = this.pos + i;
      const span = spanAt(d, p);
      const stop = Math.min(avail, span.until - this.pos);
      if (span.filled) {
        for (; i < stop; i++) {
          outL[start + i] = d.left[this.pos + i] * k;
          outR[start + i] = d.right[this.pos + i] * k;
        }
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
    this.rendered = o.renderedLeft ? { left: o.renderedLeft, right: o.renderedRight || o.renderedLeft, tempo: o.renderedTempo, pitch: o.renderedPitch, partial: true, validFrames: o.renderedValidFrames | 0 } : null;
    this.voice = this.makeVoice(o.offsetSamples | 0);
    this.fadeInTotal = (o.fadeInFrames | 0) || 0;
    this.fadeInDone = 0;
    this.jump = null;
    this.fadeOutVoice = null;
    this.fadeOutTotal = 0;
    this.fadeOutDone = 0;
    this.tmpL = new Float32Array(128);
    this.tmpR = new Float32Array(128);

    this.port.onmessage = (ev) => this.handleMessage(ev.data || {});
  }

  handleMessage(d) {
    if (this.stopped) return;
    if (d.dropPartial && this.rendered && this.rendered.partial) this.rendered = null;
    // O áudio inteiro chegou de uma vez: o começo carregado antes é o início dele, então a leitura segue sem corte.
    if (d.type === 'extend') {
      const left = d.left;
      this.replaceData(left, d.right || left, typeof d.total === 'number' ? d.total : left.length, [[0, left.length]]);
      return;
    }
    // Novos blocos (já do tamanho total) para receber o áudio aos poucos; ranges diz o que já vem preenchido.
    if (d.type === 'stream') {
      this.replaceData(d.left, d.right || d.left, d.total, (d.ranges || []).map((r) => [r[0], r[1]]));
      return;
    }
    // Mais um trecho do áudio chegou.
    if (d.type === 'append') {
      const data = this.data;
      const offset = d.offset | 0;
      const n = Math.min(d.left.length, Math.max(0, data.left.length - offset));
      if (n <= 0) return;
      data.left.set(n === d.left.length ? d.left : d.left.subarray(0, n), offset);
      if (data.right !== data.left) {
        const r = d.right || d.left;
        data.right.set(n === r.length ? r : r.subarray(0, n), offset);
      }
      addRange(data, offset, offset + n);
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
      this.voice = this.makeVoice(d.offsetSamples | 0);
      this.jump = null;
      this.fadeOutVoice = null;
      this.readyPosted = false;
      this.endedPosted = false;
      this.underrun = false;
      this.fadeInTotal = (d.fadeInFrames | 0) || this.fadeInTotal || 1024;
      this.fadeInDone = 0;
      if (typeof d.startTime === 'number') this.startTime = d.startTime;
      if (d.silent === true) this.startTime = Number.POSITIVE_INFINITY;
      return;
    }
    if (d.type === 'jump') {
      const resumeAt = typeof d.resumeAt === 'number' ? d.resumeAt : d.at;
      this.jump = {
        at: d.at,
        resumeAt,
        crossfade: Math.max(1, d.crossfadeFrames | 0),
        fadeIn: (d.offsetSamples | 0) > 0 && resumeAt <= d.at,
        voice: this.makeVoice(d.offsetSamples | 0),
      };
      return;
    }
    // Áudio já processado em segundo plano: as próximas vozes só leem, sem SoundTouch ao vivo.
    if (d.type === 'rendered') {
      this.rendered = { left: d.left, right: d.right, tempo: d.tempo, pitch: d.pitch, partial: false, validFrames: d.left.length };
      return;
    }
    // Troca BPM/tom de todas as faixas no mesmo instante, a partir da mesma posição.
    if (d.type === 'retime') {
      if (typeof d.tempo === 'number') this.tempo = d.tempo;
      if (typeof d.pitch === 'number') this.pitch = d.pitch;
      if (typeof d.process === 'boolean') this.processAll = d.process;
      this.dropStaleRendered();
      this.jump = {
        at: d.at,
        resumeAt: d.at,
        crossfade: Math.max(1, d.crossfadeFrames | 0),
        fadeIn: true,
        voice: this.makeVoice(d.offsetSamples | 0),
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
    if (typeof d.startTime === 'number') this.startTime = d.startTime;
    if (d.type === 'stop') this.release();
  }

  // Troca o áudio de todas as vozes ao mesmo tempo: elas leem o mesmo objeto de dados.
  replaceData(left, right, total, ranges) {
    const data = this.data;
    data.left = left;
    data.right = right || left;
    data.scale = sampleScale(left);
    data.total = Math.max(0, total | 0);
    data.ranges = [];
    for (const r of ranges) addRange(data, Math.max(0, r[0]), Math.min(data.total, r[1]));
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
      const total = r.partial ? Math.max(r.validFrames, Math.ceil(this.data.total / this.tempo)) : r.left.length;
      const data = makeData(r.left, r.right, total, [[0, Math.min(r.validFrames, r.left.length)]]);
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

  renderMain(outL, outR, from, to, frames) {
    const s = Math.max(from, this.indexOf(this.startTime, frames));
    if (s >= to) return;
    const n = to - s;
    this.ensureTmp(n);
    this.voice.read(this.tmpL, this.tmpR, 0, n);
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
      const g = 1 - (this.fadeOutDone + i) / this.fadeOutTotal;
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
    const R = outR === outL ? new Float32Array(frames) : outR;

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
      try { this.port.postMessage({ type: 'underrun', frame: this.voice.pos }); } catch (e) {}
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
