// O worker de análise tem de dar exatamente o mesmo resultado que o cálculo na thread principal
// (que ele substitui): mesmo loudness, mesmo pico, mesmo tom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, mixToMono } from '../src/lib/analysisCore.ts';
import { integratedLoudness, truePeak } from '../src/lib/loudness.ts';
import { detectKey } from '../src/lib/musicKey.ts';

const SR = 22050;

// acorde de Sol maior (G, B, D) com harmônicos, 12 s, estéreo
function gMajor(seconds = 12) {
  const n = SR * seconds;
  const L = new Float32Array(n), R = new Float32Array(n);
  const notes = [196, 246.94, 293.66];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const f of notes) s += 0.2 * Math.sin(2 * Math.PI * f * t) + 0.06 * Math.sin(4 * Math.PI * f * t);
    L[i] = s;
    R[i] = s * 0.9;
  }
  return [L, R];
}

test('loudness e pico: o worker dá o mesmo que o cálculo direto', () => {
  const ch = gMajor();
  const res = analyze({ id: 1, kind: 'loudness', channels: ch, sampleRate: SR });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'loudness');
  assert.equal(res.lufs, integratedLoudness(ch, SR));
  assert.equal(res.peak, truePeak(ch));
});

test('tom: o worker dá o mesmo que a mixagem para mono + detectKey de antes', () => {
  const ch = gMajor();
  // o laço que existia em renderMelodicMono (bounceEngine.ts)
  const old = new Float32Array(ch[0].length);
  for (let c = 0; c < ch.length; c++) for (let i = 0; i < ch[c].length; i++) old[i] += ch[c][i] / ch.length;
  assert.deepEqual(mixToMono(ch), old);
  const res = analyze({ id: 2, kind: 'key', channels: ch, sampleRate: SR });
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'key');
  assert.deepEqual(res.key, detectKey(old, SR));
  assert.equal(res.key?.key, 'G');
});

test('a resposta leva o mesmo id do pedido', () => {
  const res = analyze({ id: 42, kind: 'loudness', channels: gMajor(2), sampleRate: SR });
  assert.equal(res.id, 42);
});

test('erro no cálculo vira resposta de falha, sem derrubar o worker', () => {
  const res = analyze({ id: 7, kind: 'loudness', channels: null, sampleRate: SR });
  assert.equal(res.ok, false);
  assert.equal(res.id, 7);
});
