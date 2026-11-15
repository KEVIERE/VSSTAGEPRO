// Contagem do Maestro: o ataque do número (não o primeiro murmúrio) cai na batida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackOffset, speechBounds } from '../src/lib/speechTrim.ts';
import { clipPlacement, MAX_CLIP_LEAD_S } from '../src/lib/narrations.ts';

const RATE = 48000;

/** Seno de 220 Hz com a amplitude dada por `amp(t)` (segundos). */
function tone(seconds, amp) {
  const n = Math.round(RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp(i / RATE) * Math.sin(2 * Math.PI * 220 * i / RATE);
  return out;
}

test('attackOffset: ataque imediato fica no começo', () => {
  const s = tone(0.3, () => 0.7);
  assert.ok(attackOffset(s, RATE) < 0.003, `${attackOffset(s, RATE)}`);
});

test('attackOffset: rampa lenta de 0,1 a 0,7 em 40 ms cai no meio do volume', () => {
  // 50% de 0,7 = 0,35, alcançado aos (0,35-0,1)/0,6 × 40 ms ≈ 16,7 ms
  const s = tone(0.3, (t) => (t < 0.04 ? 0.1 + 0.6 * (t / 0.04) : 0.7));
  const a = attackOffset(s, RATE);
  assert.ok(a > 0.012 && a < 0.022, `${a}`);
});

test('attackOffset: silêncio devolve 0', () => {
  assert.equal(attackOffset(new Float32Array(4800), RATE), 0);
  assert.equal(attackOffset(new Float32Array(0), RATE), 0);
});

test('speechBounds palavra solta: murmúrio fraco antes da vogal fica no máximo 30 ms', () => {
  // 50 ms de silêncio, 100 ms de murmúrio a 12% (voz fraca, não é chiado), vogal forte
  const s = tone(0.4, (t) => (t < 0.05 ? 0 : t < 0.15 ? 0.12 : 1));
  const { start } = speechBounds(s, RATE, { singleWord: true });
  const lead = 0.15 - start / RATE;
  assert.ok(lead <= 0.036 && lead >= 0.02, `murmúrio mantido: ${lead}`);
  // fala comum não muda: o murmúrio inteiro fica
  const common = speechBounds(s, RATE).start / RATE;
  assert.ok(Math.abs(common - 0.05) < 0.003, `${common}`);
});

test('speechBounds palavra solta: chiado ("s") continua inteiro', () => {
  const n = Math.round(RATE * 0.4);
  const s = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    s[i] = t < 0.05 ? 0 : t < 0.15 ? 0.05 * rnd() : Math.sin(2 * Math.PI * 220 * t);
  }
  const start = speechBounds(s, RATE, { singleWord: true }).start / RATE;
  assert.ok(start < 0.056, `${start}`);
});

test('clipPlacement com lead: recua o clipe para o ataque cair na batida', () => {
  assert.deepEqual(clipPlacement(4, 0.12), { startTime: 3.88, trimStart: 0 });
  assert.deepEqual(clipPlacement(4), { startTime: 4, trimStart: 0 });
  // limite de 0,25 s
  assert.deepEqual(clipPlacement(4, 0.9), { startTime: 4 - MAX_CLIP_LEAD_S, trimStart: 0 });
  // primeiro número em 0 s: não recua, corta a frente
  assert.deepEqual(clipPlacement(0, 0.1), { startTime: 0, trimStart: 0.1 });
  assert.deepEqual(clipPlacement(0.04, 0.1), { startTime: 0, trimStart: 0.06 });
  // não passa por cima do clipe anterior (que termina em 3,95)
  assert.deepEqual(clipPlacement(4, 0.12, 3.95), { startTime: 3.95, trimStart: 0 });
  assert.deepEqual(clipPlacement(4, 0.12, 4.2), { startTime: 4, trimStart: 0 });
  assert.deepEqual(clipPlacement(4, -1), { startTime: 4, trimStart: 0 });
});
