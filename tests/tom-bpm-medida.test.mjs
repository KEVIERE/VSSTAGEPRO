// Tom alterado (com ou sem BPM alterado): a faixa melódica precisa cair com o começo de cada nota na
// grade. Notas sintéticas com o instante de começo conhecido (corda pinçada e nota com harmônicos),
// processadas pelo mesmo SoundTouch e com as mesmas medidas do programa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attackEnvelope, measureHitLagMs, measureStep, measureStretchOffsetMs, nominalStretchLeadMs, reduceForMeasure, shiftSamples, stretchLeadMs,
} from '../src/lib/stretchLatency.ts';
import { SoundTouch, SimpleFilter } from '../src/lib/soundtouch.vendor.js';

const SR = 48000;
const semitone = (st) => 2 ** (st / 12);

/** Notas com começo conhecido (silêncio antes de cada uma). `ks`: corda pinçada; `sin`: harmônicos. */
function notes(seconds, seed0, kind) {
  const n = Math.round(seconds * SR);
  const x = new Int16Array(n);
  const times = [];
  let seed = seed0;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0.3 + rnd() * 0.05; t < seconds - 0.6; t += 0.25 + rnd() * 0.25) {
    const a = Math.round(t * SR);
    times.push(a);
    const f = 110 + rnd() * 500;
    if (kind === 'ks') {
      const p = Math.max(2, Math.round(SR / f));
      const buf = new Float32Array(p);
      for (let i = 0; i < p; i++) buf[i] = rnd() * 2 - 1;
      for (let i = 0, k = 0; i < 12000 && a + i < n; i++, k = (k + 1) % p) {
        const v = buf[k];
        buf[k] = 0.996 * 0.5 * (buf[k] + buf[(k + 1) % p]);
        x[a + i] = Math.max(-32000, Math.min(32000, x[a + i] + 9000 * v));
      }
    } else {
      const d = 18 + rnd() * 30;
      for (let i = 0; i < 12000 && a + i < n; i++) {
        const v = Math.sin((2 * Math.PI * f * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 2 * f * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 3 * f * i) / SR);
        x[a + i] = Math.max(-32000, Math.min(32000, x[a + i] + 9000 * v * Math.exp((-i / SR) * d) * Math.min(1, i / 48)));
      }
    }
  }
  return { x, times };
}

function stretch(x, tempo, pitch) {
  const st = new SoundTouch();
  st.stretch.setParameters(SR, 82, 28, 12);
  st.stretch.quickSeek = true;
  st.tempo = tempo;
  st.pitch = pitch;
  const source = {
    extract(target, n, position) {
      const available = Math.min(n, Math.max(0, x.length + 32768 - position));
      for (let i = 0; i < available; i++) {
        const v = position + i < x.length ? x[position + i] / 32767 : 0;
        target[i * 2] = v; target[i * 2 + 1] = v;
      }
      return available;
    },
  };
  const filter = new SimpleFilter(source, st);
  const want = Math.ceil(x.length / tempo);
  const out = new Int16Array(want);
  const buf = new Float32Array(8192);
  let total = 0;
  while (total < want) {
    const got = Math.min(filter.extract(buf, 4096), want - total);
    if (got <= 0) break;
    for (let i = 0; i < got; i++) out[total + i] = Math.max(-32768, Math.min(32767, Math.round(buf[i * 2] * 32767)));
    total += got;
  }
  return out;
}

function reduced(x) {
  const step = measureStep(SR);
  const out = new Int16Array(Math.floor(x.length / step));
  reduceForMeasure(x, x, step, out, 0, x.length);
  return { out, rate: SR / step };
}

/** Energia em passos de 0,25 ms. */
function energy(x) {
  const h = 12;
  const e = new Float32Array(Math.floor(x.length / h));
  for (let f = 0; f < e.length; f++) {
    let s = 0;
    for (let i = f * h; i < f * h + h; i++) s += Math.abs(x[i]);
    e[f] = s / h;
  }
  return e;
}

/**
 * Começo da nota perto de `want` (passos de 0,25 ms): pico da nota e volta até o primeiro ponto
 * acima de `frac` do pico.
 */
function onsetAt(e, want, frac) {
  const a = Math.max(0, Math.round(want) - 160);
  const z = Math.min(e.length, Math.round(want) + 200);
  let hi = 0;
  let hiAt = a;
  for (let f = a; f < z; f++) if (e[f] > hi) { hi = e[f]; hiAt = f; }
  if (hi < 200) return null;
  let f = hiAt;
  while (f > a && e[f - 1] >= frac * hi) f--;
  if (f <= a) return null;
  return f - 1 + (frac * hi - e[f - 1]) / Math.max(1e-9, e[f] - e[f - 1]);
}

/**
 * Mediana (ms, positivo = atrasada) de onde cada nota começou no som tocado, contra o começo dela no
 * original levado para o andamento novo, a 10% e a 50% do pico. `leadMs`: quanto o reprodutor atrasa
 * a leitura da faixa.
 */
function noteErrorMs(x, times, out, tempo, leadMs) {
  const eIn = energy(x);
  const eOut = energy(out);
  const res = {};
  for (const frac of [0.1, 0.5]) {
    const dev = [];
    for (const t of times) {
      const truth = onsetAt(eIn, t / 12, frac);
      if (truth === null) continue;
      const got = onsetAt(eOut, truth / tempo - leadMs * 4, frac);
      if (got !== null) dev.push((got - truth / tempo) / 4 + leadMs);
    }
    dev.sort((a, b) => a - b);
    res[frac === 0.1 ? 'start' : 'half'] = dev[dev.length >> 1];
    res.count = Math.min(res.count ?? Infinity, dev.length);
  }
  return res;
}

const median = (v) => [...v].sort((a, b) => a - b)[v.length >> 1];

// Cada nota sai do SoundTouch com até ±12 ms de espalhamento; com cerca de 100 notas a mediana varia
// uns 1,3 ms, e o começo de uma nota que cai na emenda de duas janelas fica espalhado por ela. O limite
// por caso é perto de 4 vezes essa variação, no começo da nota (10% do pico), até 7 semitons. A 50% do
// pico e em ±12 semitons o ataque fica esticado ou encurtado pela troca de tom, e vale só o conjunto.
const PER_CASE_MS = 5;
const OVERALL_MS = 2;

function check(label, cases) {
  const start = cases.map((c) => Math.abs(c.r.start));
  const half = cases.map((c) => Math.abs(c.r.half));
  for (const c of cases) {
    assert.ok(c.r.count > 60, `${c.name}: ${c.r.count} notas`);
    if (Math.abs(c.st) <= 7) assert.ok(Math.abs(c.r.start) <= PER_CASE_MS, `${c.name}: começo das notas a ${c.r.start.toFixed(2)} ms da grade`);
  }
  assert.ok(median(start) <= OVERALL_MS, `${label}: mediana do erro no começo das notas ${median(start).toFixed(2)} ms`);
  assert.ok(median(half) <= OVERALL_MS, `${label}: mediana do erro na meia subida ${median(half).toFixed(2)} ms`);
}

test('tom e BPM alterados juntos: o começo de cada nota cai na grade', () => {
  const cases = [];
  for (const kind of ['ks', 'sin']) {
    for (const seed of [11, 29]) {
      const { x, times } = notes(40, seed, kind);
      const a = reduced(x);
      for (const tempo of [0.75, 1.25]) {
        for (const st of [2, -2, 7, -7, 12, -12]) {
          const out = stretch(x, tempo, semitone(st));
          const lead = stretchLeadMs(a.out, reduced(out).out, a.rate, tempo, semitone(st));
          cases.push({ name: `${kind} ${seed} ${tempo}x tom ${st}`, st, r: noteErrorMs(x, times, out, tempo, lead) });
        }
      }
    }
  }
  check('tom e BPM', cases);
});

test('só tom alterado: o arquivo preparado cai com o começo das notas na grade', () => {
  // O mesmo deslocamento que o worker grava no arquivo; o reprodutor não desconta mais nada.
  const cases = [];
  for (const kind of ['ks', 'sin']) {
    for (const seed of [11, 29]) {
      const { x, times } = notes(40, seed, kind);
      const inputAttacks = attackEnvelope(x, x, SR);
      for (const st of [2, -2, 7, -7, 12, -12]) {
        const pitch = semitone(st);
        const out = stretch(x, 1, pitch);
        const measured = measureStretchOffsetMs(inputAttacks, attackEnvelope(out, out, SR), 1);
        const shiftMs = measured === null ? nominalStretchLeadMs(1, pitch) : -measured;
        const saved = shiftSamples(out, Math.round((shiftMs * SR) / 1000));
        cases.push({ name: `${kind} ${seed} tom ${st}`, st, r: noteErrorMs(x, times, saved, 1, 0) });
      }
    }
  }
  check('só tom', cases);
});

test('sem tom alterado a medida continua a mesma', () => {
  const { x } = notes(30, 11, 'sin');
  const a = reduced(x);
  for (const tempo of [0.8, 1.15]) {
    const b = reduced(stretch(x, tempo, 1));
    assert.equal(stretchLeadMs(a.out, b.out, a.rate, tempo, 1), -measureHitLagMs(a.out, b.out, a.rate, tempo));
  }
});
