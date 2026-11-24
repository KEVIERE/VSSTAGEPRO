import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReplaceTempoMap, clickCoverage, extendToStart, finalizeTempoMap, hitsToSegments, mainBpm,
  mapOffShare, readClickHits, shouldReplaceTempoMap, tempoMapSignature,
} from '../src/lib/tempoFollow.ts';
import { clickGridTimes, clickHits } from '../src/lib/clickEdit.ts';

// Batidas de um click com vários andamentos: cada trecho é [bpm, intervalos]. A quina é compartilhada.
function clickOf(start, parts) {
  const hits = [start];
  for (const [bpm, beats] of parts) {
    const from = hits[hits.length - 1];
    for (let k = 1; k <= beats; k++) hits.push(from + (k * 60) / bpm);
  }
  return hits;
}

// leitura com precisão de amostra a 22050 Hz, como o programa recebe
const quantize = (hits) => hits.map((t) => Math.round(t * 22050) / 22050);
const flat = (hits) => new Array(hits.length).fill(1);

function worstError(hits, map, duration) {
  const grid = clickGridTimes({ bpm: map.bpm, beatsPerBar: 4, tempoSegments: map.tempoSegments }, duration).sort((a, b) => a - b);
  let g = 0, worst = 0;
  for (const t of hits) {
    while (g + 1 < grid.length && Math.abs(grid[g + 1] - t) <= Math.abs(grid[g] - t)) g++;
    worst = Math.max(worst, Math.abs(grid[g] - t));
  }
  return worst;
}

function finalOf(hits, duration) {
  const segs = extendToStart(hitsToSegments(hits, flat(hits), duration), 4);
  return finalizeTempoMap(segs, { duration, beatsPerBar: 4, isClick: true });
}

test('medley com 6 andamentos, inclusive um compasso só de 147', () => {
  const hits = quantize(clickOf(0.002, [[140, 52], [143, 28], [147, 4], [148, 332], [150, 472], [154, 340]]));
  const duration = hits[hits.length - 1] + 8;
  const map = finalOf(hits, duration);
  assert.deepEqual(map.tempoSegments.map((s) => s.bpm), [140, 143, 147, 148, 150, 154]);
  assert.ok(worstError(hits, map, duration) < 0.001, `erro ${worstError(hits, map, duration)}`);
  assert.equal(map.bpm, 150);
});

test('BPM quase igual não é engolido: a troca aparece mesmo com 0,2 BPM', () => {
  const hits = quantize(clickOf(0.5, [[120, 200], [120.2, 200]]));
  const duration = hits[hits.length - 1] + 2;
  const map = finalOf(hits, duration);
  assert.equal(map.tempoSegments.length, 2);
  assert.ok(worstError(hits, map, duration) < 0.002);
});

test('BPM fracionado fica com a precisão completa, sem arredondar a grade', () => {
  const hits = quantize(clickOf(0.25, [[123.456, 600]]));
  const [seg] = hitsToSegments(hits, flat(hits), hits[hits.length - 1] + 1);
  assert.notEqual(seg.bpm, 123);
  assert.ok(Math.abs(seg.bpm - 123.456) < 0.001);
  const last = seg.startTime + 600 * (60 / seg.bpm);
  assert.ok(Math.abs(last - hits[600]) < 0.001);
});

test('andamento único fora do 0:00: a grade fica na fase do click, sem placa', () => {
  const hits = quantize(clickOf(0.6148, [[140, 400]]));
  const duration = hits[hits.length - 1] + 3;
  const map = finalOf(hits, duration);
  assert.equal(map.bpm, 140);
  assert.ok(map.tempoSegments.length >= 2);
  assert.ok(map.tempoSegments.every((s) => s.bpm === 140));
  assert.ok(worstError(hits, map, duration) < 0.001);
});

test('andamento único no 0:00 continua sem trechos', () => {
  const hits = quantize(clickOf(0, [[105, 300]]));
  const map = finalOf(hits, hits[hits.length - 1] + 2);
  assert.equal(map.bpm, 105);
  assert.equal(map.tempoSegments, undefined);
});

test('primeiro ataque cortado não desloca a grade das outras batidas', () => {
  const clean = clickOf(-0.0027, [[174, 300]]);
  const hits = quantize([0.0167, ...clean.slice(1)]);
  const duration = hits[hits.length - 1] + 2;
  const map = finalOf(hits, duration);
  assert.equal(map.bpm, 174);
  assert.ok(map.tempoSegments.every((s) => s.bpm === 174));
  assert.ok(worstError(hits, map, duration) < 0.001);
});

test('pausa no click não quebra a reta', () => {
  const all = quantize(clickOf(0.3, [[174, 400]]));
  const hits = [...all.slice(0, 150), ...all.slice(163)];
  const segs = hitsToSegments(hits, flat(hits), hits[hits.length - 1] + 1);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].bpm, 174);
});

test('subdivisão na mesma fase não vira troca de andamento', () => {
  const quarter = clickOf(0.5, [[120, 64]]);
  const from = quarter[quarter.length - 1];
  const eighth = Array.from({ length: 32 }, (_, i) => from + ((i + 1) * 60) / 240);
  const back = Array.from({ length: 64 }, (_, i) => eighth[eighth.length - 1] + ((i + 1) * 60) / 120);
  const hits = quantize([...quarter, ...eighth, ...back]);
  const read = readClickHits(hits, flat(hits), hits[hits.length - 1] + 1);
  assert.deepEqual(read.segments.map((s) => s.bpm), [120]);
  assert.equal(clickCoverage(hits, read.segments, 0.005, read.halfRanges), 1);
});

test('rampa gradual vira degraus curtos que passam pelos ataques', () => {
  const hits = [0.2];
  for (let i = 0; i < 48; i++) hits.push(hits[hits.length - 1] + 60 / (120 + (i * 20) / 48));
  for (let i = 0; i < 32; i++) hits.push(hits[hits.length - 1] + 60 / 140);
  const clean = quantize(hits);
  const duration = clean[clean.length - 1] + 2;
  const map = finalOf(clean, duration);
  assert.ok(map.tempoSegments.length > 3);
  assert.ok(worstError(clean, map, duration) < 0.005, `erro ${worstError(clean, map, duration)}`);
});

test('click com acento forte: o tempo fraco entre dois acentos é lido', () => {
  const sr = 22050;
  const beat = Math.round(sr * 0.4);
  const data = new Float32Array(beat * 64 + sr);
  for (let b = 0; b < 64; b++) {
    const amp = b % 4 === 0 ? 1 : 0.2;
    for (let i = 0; i < 200; i++) data[b * beat + i] = amp * Math.sin(i * 0.9) * Math.exp(-i / 60);
  }
  assert.equal(clickHits(data, sr).length, 64);
});

test('mapa que já bate com o click nunca é trocado', () => {
  const hits = quantize(clickOf(0, [[120, 200]]));
  const song = { bpm: 120, beatsPerBar: 4, duration: 110, bpmSource: 'click' };
  assert.ok(mapOffShare(song, hits, 110) <= 0.1);
  assert.equal(shouldReplaceTempoMap(song, hits, { map: { bpm: 120 }, coverage: 1 }), false);
});

test('mapa salvo errado é trocado quando a leitura nova fecha com o click', () => {
  const hits = quantize(clickOf(0.002, [[140, 52], [143, 28], [147, 4], [148, 332], [150, 472], [154, 340]]));
  const duration = hits[hits.length - 1] + 8;
  const wrong = [{ startTime: 0, endTime: 170, bpm: 141.04 }, { startTime: 170, endTime: 359, bpm: 149.16 }, { startTime: 359, endTime: duration, bpm: 154 }];
  const song = { bpm: 149.16, beatsPerBar: 4, duration, bpmSource: 'click', tempoSegments: wrong };
  assert.ok(mapOffShare(song, hits, duration) > 0.1);
  const map = finalOf(hits, duration);
  assert.equal(shouldReplaceTempoMap(song, hits, { map, coverage: 1 }), true);
  // leitura fraca não troca
  assert.equal(shouldReplaceTempoMap(song, hits, { map, coverage: 0.9 }), false);
});

test('mapa manual, do REAPER ou editado depois da medição nunca é trocado', () => {
  const segs = [{ startTime: 0, endTime: 10, bpm: 120 }, { startTime: 10, endTime: 20, bpm: 90 }];
  assert.equal(canReplaceTempoMap({ tempoSegments: segs, tempoMapSource: 'manual' }), false);
  assert.equal(canReplaceTempoMap({ tempoSegments: segs, tempoMapSource: 'reaper' }), false);
  assert.equal(canReplaceTempoMap({ tempoSegments: segs, bpmSource: 'manual' }), false);
  const sig = tempoMapSignature(segs);
  assert.equal(canReplaceTempoMap({ tempoSegments: segs, tempoMapSource: 'click', tempoMapSig: sig }), true);
  const moved = [{ ...segs[0], endTime: 11 }, { ...segs[1], startTime: 11 }];
  assert.equal(canReplaceTempoMap({ tempoSegments: moved, tempoMapSource: 'click', tempoMapSig: sig }), false);
  assert.equal(canReplaceTempoMap({ tempoSegments: segs, bpmSource: 'click' }), true);
});

test('BPM principal é o que soma mais tempo, mesmo em trechos separados', () => {
  assert.equal(mainBpm([
    { startTime: 0, endTime: 30, bpm: 100 },
    { startTime: 30, endTime: 70, bpm: 120 },
    { startTime: 70, endTime: 100, bpm: 100 },
  ]), 100);
});

test('introdução em tempos inteiros: a anacruse fica no compasso certo', () => {
  const [first] = extendToStart([{ startTime: 1.3, endTime: 60, bpm: 120, downbeat: 1.3 }], 4);
  assert.ok(Math.abs(first.startTime - 0.3) < 1e-9);
  assert.equal(first.barOffset, 2);
  assert.ok(Math.abs(first.downbeat - 1.3) < 1e-9);
});
