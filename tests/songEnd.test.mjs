// Ajustar fim: o VS acaba 0,5 s depois do último som de harmonia; click, bateria e timecode
// não servem de referência, mas são cortados no mesmo ponto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastSoundIndex, planSongEnd, SILENCE_INT16 } from '../src/lib/songEnd.ts';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const clip = (id, startTime, duration, extra = {}) => ({ id, songId: 's', trackId: id, startTime, duration, ...extra });

test('último som em áudio com cauda que vai sumindo', () => {
  const ch = new Int16Array(1000);
  for (let i = 0; i < 600; i++) ch[i] = Math.round(20000 * Math.exp(-i / 60));
  const idx = lastSoundIndex([ch, new Int16Array(1000)], SILENCE_INT16);
  assert.ok(idx > 0 && ch[idx] >= SILENCE_INT16 && ch[idx + 1] < SILENCE_INT16);
});

test('silêncio total devolve -1', () => {
  assert.equal(lastSoundIndex([new Int16Array(500)], SILENCE_INT16), -1);
});

test('fim pela harmonia, com 0,5 s de folga; click, bateria e timecode cortados no mesmo ponto', () => {
  const clips = [clip('teclado', 2, 200), clip('click', 0, 300), clip('bateria', 2, 200), clip('tc', 0, 300)];
  const last = new Map([['teclado', 58], ['click', 299], ['bateria', 150], ['tc', 299]]);
  const plan = planSongEnd(clips, last, new Set(['teclado']), new Set(['bateria']));
  near(plan.end, 60.5);
  near(plan.cut, 300 - 60.5);
  const trim = Object.fromEntries(plan.trims.map((t) => [t.id, t.trimEnd]));
  near(trim.teclado, 202 - 60.5);
  near(trim.click, 300 - 60.5);
  near(trim.bateria, 202 - 60.5);
  near(trim.tc, 300 - 60.5);
  assert.deepEqual(plan.removeIds, []);
});

test('clipe que começa depois do fim sai da música', () => {
  const clips = [clip('teclado', 0, 100), clip('sobra', 80, 10)];
  const plan = planSongEnd(clips, new Map([['teclado', 40], ['sobra', null]]), new Set(['teclado']), new Set());
  assert.deepEqual(plan.removeIds, ['sobra']);
});

test('corte soma com o corte que o clipe já tinha', () => {
  const clips = [clip('teclado', 0, 100, { trimEnd: 10 })]; // toca 90 s
  const plan = planSongEnd(clips, new Map([['teclado', 30]]), new Set(['teclado']), new Set());
  near(plan.trims[0].trimEnd, 10 + (90 - 30.5));
});

test('sem harmonia com som, usa as outras faixas', () => {
  const clips = [clip('teclado', 0, 100), clip('guia', 0, 100)];
  const plan = planSongEnd(clips, new Map([['teclado', null], ['guia', 70]]), new Set(['teclado']), new Set(['guia']));
  near(plan.end, 70.5);
});

test('nada a cortar devolve null', () => {
  const clips = [clip('teclado', 0, 60.55)];
  assert.equal(planSongEnd(clips, new Map([['teclado', 60]]), new Set(['teclado']), new Set()), null);
  assert.equal(planSongEnd(clips, new Map([['teclado', null]]), new Set(['teclado']), new Set()), null);
});
