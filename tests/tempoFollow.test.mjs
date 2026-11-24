import test from 'node:test';
import assert from 'node:assert/strict';
import { beatsToSegments, dropStartStub, extendToStart, followEndingRit, hitsToSegments, isFinalRitOnly, leadInFromMap, mainBpm, plainGridBeforeRit, placeOnTimeline, realTempoChanges, splitSingleSegment } from '../src/lib/tempoFollow.ts';
import { barStartFlags, clickGridTimes } from '../src/lib/clickEdit.ts';
import { barBeatLabel, gridLines, snapTime, songGrid, uniformSegments } from '../src/lib/grid.ts';
import { beatTimesFrom } from '../src/lib/narrations.ts';

const steady = (start, bpm, n) => Array.from({ length: n }, (_, i) => start + (i * 60) / bpm);

test('duas músicas viram dois trechos com o BPM de cada uma', () => {
  const a = steady(0, 120, 64);
  const b = steady(a[63] + 0.5, 90, 65);
  const beats = [...a, ...b];
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
  const segs = beatsToSegments({ beats, downbeats, beatsPerBar: 4 }, 80);
  assert.equal(Math.round(segs[0].bpm), 120);
  assert.equal(Math.round(segs[segs.length - 1].bpm), 90);
  assert.equal(segs[segs.length - 1].endTime, 80);
});

test('introdução ganha grade em compassos inteiros, sem mudar a posição das batidas', () => {
  const [first] = extendToStart([{ startTime: 4.3, endTime: 60, bpm: 120, downbeat: 4.3 }], 4);
  assert.ok(Math.abs(first.startTime - 0.3) < 1e-9);
  const k = (4.3 - first.startTime) / 0.5;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-9);
});

test('música de um andamento só: dividir não muda nenhum click nem cria placa na régua', () => {
  const seg = { startTime: 0.3, endTime: 60.3, bpm: 120, downbeat: 0.3 };
  const parts = splitSingleSegment(seg, 4);
  assert.equal(parts.length, 2);
  const times = clickGridTimes({ bpm: 120, tempoSegments: parts }, 60.3);
  assert.equal(times.length, 120);
  times.forEach((t, i) => assert.ok(Math.abs(t - (0.3 + i * 0.5)) < 1e-6));
  const grid = songGrid({ bpm: 120, beatsPerBar: 4, tempoSegments: parts });
  assert.equal(gridLines(grid, 0, 60, 100).filter((l) => l.bpmChange).length, 0);
});

test('BPM principal é o que vale por mais tempo', () => {
  const bpm = mainBpm([
    { startTime: 0, endTime: 10, bpm: 140 },
    { startTime: 10, endTime: 100, bpm: 98 },
    { startTime: 100, endTime: 110, bpm: 70 },
  ]);
  assert.equal(bpm, 98);
});

const medley = (segs) => ({ bpm: segs[0].bpm, beatsPerBar: 4, tempoSegments: segs });

test('anacruse: o 1 da música nova cai depois dos tempos de entrada, e a placa fica na troca', () => {
  const song = medley([
    { startTime: 0, endTime: 8, bpm: 120 },
    { startTime: 8, endTime: 20, bpm: 100, downbeat: 9.2, barOffset: 2 },
  ]);
  const times = clickGridTimes(song, 20);
  const firsts = times.filter((_, i) => barStartFlags(song, times)[i]).filter((t) => t >= 8);
  assert.ok(Math.abs(firsts[0] - 9.2) < 1e-6);
  assert.ok(Math.abs(firsts[1] - 11.6) < 1e-6);
  const lines = gridLines(songGrid(song), 7.9, 12, 100);
  assert.equal(lines.find((l) => Math.abs(l.time - 8) < 1e-6).bpmChange, 100);
  assert.equal(lines.find((l) => Math.abs(l.time - 8) < 1e-6).kind, 'beat');
  assert.equal(lines.find((l) => Math.abs(l.time - 9.2) < 1e-6).kind, 'bar');
  assert.ok(Math.abs(snapTime(9.4, songGrid(song), 'bar') - 9.2) < 1e-6);
  assert.equal(barBeatLabel(9.2, songGrid(song)), '5');
});

test('emenda: batida colada na primeira da música seguinte não vira click duplo', () => {
  const song = medley([
    { startTime: 0, endTime: 10.02, bpm: 120 },
    { startTime: 10.02, endTime: 20, bpm: 90 },
  ]);
  const times = clickGridTimes(song, 20);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] > 0.3, `${times[i - 1]} e ${times[i]}`);
  assert.ok(times.includes(10.02));
  const count = beatTimesFrom(song, 9, 5);
  for (let i = 1; i < count.length; i++) assert.ok(count[i] - count[i - 1] > 0.3);
});

test('valsa dentro do medley: compasso de 3 só no trecho dela', () => {
  const song = medley([
    { startTime: 0, endTime: 8, bpm: 120 },
    { startTime: 8, endTime: 20, bpm: 120, downbeat: 8, beatsPerBar: 3 },
  ]);
  const bars = gridLines(songGrid(song), 0, 14, 100).filter((l) => l.kind === 'bar').map((l) => l.time);
  assert.deepEqual(bars, [0, 2, 4, 6, 8, 9.5, 11, 12.5, 14]);
  const times = clickGridTimes(song, 12);
  const flags = barStartFlags(song, times);
  assert.deepEqual(times.filter((t, i) => flags[i] && t >= 8), [8, 9.5, 11]);
});

test('troca real: BPM diferente ou batida que salta; música reta não tem troca', () => {
  assert.deepEqual(realTempoChanges([{ startTime: 0, endTime: 8, bpm: 120 }, { startTime: 8, endTime: 16, bpm: 120 }]), []);
  assert.deepEqual(realTempoChanges([{ startTime: 0, endTime: 8, bpm: 120 }, { startTime: 8.2, endTime: 16, bpm: 120 }]), [1]);
  assert.deepEqual(realTempoChanges([{ startTime: 0, endTime: 8, bpm: 120 }, { startTime: 8, endTime: 16, bpm: 98 }]), [1]);
});

test('arquivo que começa depois do 0:00: a grade vai junto e cobre da entrada até o fim', () => {
  const placed = placeOnTimeline([
    { startTime: 1, endTime: 10, bpm: 120, downbeat: 1 },
    { startTime: 10, endTime: 20, bpm: 100, downbeat: 11.2, barOffset: 2 },
  ], 3, 30, 4);
  assert.ok(Math.abs(placed[0].startTime) < 1e-9);
  assert.equal(placed[1].startTime, 13);
  assert.equal(placed[1].barOffset, 2);
  assert.equal(placed[1].endTime, 30);
});

test('BPM digitado em música de andamento único mantém o ponto de partida da grade', () => {
  const segs = uniformSegments([{ startTime: 0.3, endTime: 30, bpm: 120 }, { startTime: 30, endTime: 60.3, bpm: 120 }], 100, 4);
  assert.equal(segs[0].startTime, 0.3);
  assert.ok(segs.every((s) => s.bpm === 100));
  assert.equal(segs[1].endTime, 60.3);
});

test('faixa de click: trechos exatos, inclusive BPM quase igual e pausa no click', () => {
  const a = steady(0.5, 92, 60);
  const b = steady(a[59] + 60 / 94, 94, 60);
  const withPause = [...a.slice(0, 30), ...a.slice(34), ...b];
  const segs = hitsToSegments(withPause, withPause.map(() => 1), 90);
  assert.deepEqual(segs.map((s) => s.bpm), [92, 94]);
  // a batida da troca é a última da reta velha e a primeira da nova
  assert.ok(Math.abs(segs[1].startTime - a[59]) < 1e-6);
  assert.equal(hitsToSegments(steady(0, 120, 100), new Array(100).fill(1), 50).length, 1);
});


// Ritardando final: áudio com um ataque de nota por batida e picos do modelo a cada dois tempos.
const RIT_SR = 22050;
function ritScene({ growth = 0.04, modelFollows = true, ring = 6 } = {}) {
  const p = 0.5, start = 100, beats = [];
  for (let k = 0; start - k * p >= 0; k++) beats.unshift(start - k * p);
  const bend = [];
  for (let k = 1, t = start; k <= 8; k++) { t += p * (1 + growth * k); bend.push(t); }
  const all = [...beats, ...bend];
  const end = all[all.length - 1] + ring;
  const mono = new Float32Array(Math.ceil((end + 1) * RIT_SR));
  all.forEach((t, n) => {
    const at = Math.round(t * RIT_SR), hz = 440 + 110 * (n % 5);
    const size = n === all.length - 1 ? Math.round(ring * RIT_SR) : Math.round(0.35 * RIT_SR);
    const decay = n === all.length - 1 ? ring / 5 : 0.08;
    for (let i = 0; i < size && at + i < mono.length; i++) {
      const u = i / RIT_SR;
      mono[at + i] += 0.3 * Math.exp(-u / decay) * (Math.sin(2 * Math.PI * hz * u) + 0.5 * Math.sin(4 * Math.PI * hz * u));
    }
  });
  const beat = new Float32Array(Math.ceil(end * 50) + 10), downbeat = new Float32Array(beat.length);
  const mark = (t, v = 1) => { const i = Math.round(t * 50); if (i >= 0 && i < beat.length) beat[i] = v; };
  beats.forEach((t, i) => { if (i % 2 === beats.length % 2 || t === start) mark(t); });
  // o modelo vai ficando para trás da curva, mas não volta para a grade
  const late = [0.05, 0.09, 0.16, 0.19, 0.22];
  late.forEach((lag, i) => mark(start + (i + 1) * 2 * p + (modelFollows ? lag : 0)));
  const seg = { startTime: 0, endTime: mono.length / RIT_SR, bpm: 120, downbeat: 0 };
  return { mono, model: { beat, downbeat, fps: 50 }, seg, bend, start };
}

test('ritardando final: a grade acompanha a desaceleração, compasso a compasso', () => {
  const { mono, model, seg, bend, start } = ritScene();
  const out = followEndingRit(mono, RIT_SR, model, [seg], 4);
  const rit = out.filter((s) => s.rit);
  assert.equal(rit.length, 2);
  assert.ok(Math.abs(rit[0].startTime - start) < 1e-6);
  assert.ok(rit[0].bpm < 120 && rit[1].bpm < rit[0].bpm);
  assert.equal(out[out.length - 1].endTime, mono.length / RIT_SR);
  const grid = clickGridTimes({ bpm: 120, beatsPerBar: 4, tempoSegments: out }, mono.length / RIT_SR);
  // um andamento por compasso: a virada do compasso cai em cima, e o meio dele fica perto da curva
  bend.forEach((t, i) => {
    const miss = Math.min(...grid.map((g) => Math.abs(g - t)));
    assert.ok(miss < ((i + 1) % 4 === 0 ? 0.035 : 0.05), `batida ${t}: ${miss}`);
  });
  assert.equal(isFinalRitOnly(out), true);
});

test('ritardando final: o 1 continua na contagem que vinha', () => {
  const { mono, model, seg } = ritScene();
  const moved = { ...seg, startTime: 0.25, downbeat: 0.25 + 0.5, barOffset: 1 };
  const shifted = new Float32Array(mono.length);
  shifted.set(mono.subarray(0, mono.length - Math.round(0.25 * RIT_SR)), Math.round(0.25 * RIT_SR));
  const beat = new Float32Array(model.beat.length);
  beat.set(model.beat.subarray(0, beat.length - 13), 13);
  const out = followEndingRit(shifted, RIT_SR, { ...model, beat }, [moved], 4);
  for (const s of out.filter((x) => x.rit)) assert.equal((s.barOffset ?? 0) % 4, 1);
});

test('fim sem o modelo escorregar não vira ritardando, mesmo com ataques fora da grade', () => {
  const { mono, model, seg } = ritScene({ modelFollows: false });
  const out = followEndingRit(mono, RIT_SR, model, [seg], 4);
  assert.deepEqual(out, [seg]);
});

test('música de andamento fixo terminando em nota longa fica como estava', () => {
  const { mono, model, seg } = ritScene({ growth: 0, modelFollows: false });
  assert.deepEqual(followEndingRit(mono, RIT_SR, model, [seg], 4), [seg]);
});

test('troca de andamento comum não conta como ritardando', () => {
  const medley = [{ startTime: 0, endTime: 60, bpm: 140 }, { startTime: 60, endTime: 120, bpm: 120 }];
  assert.equal(isFinalRitOnly(medley), false);
  assert.equal(isFinalRitOnly([{ startTime: 0, endTime: 120, bpm: 120 }]), false);
  assert.equal(isFinalRitOnly([...medley, { startTime: 120, endTime: 124, bpm: 100, rit: true }]), false);
});

test('ritardando final não tira o compasso de entrada do VS por IA', () => {
  const beat = 60 / 140;
  const stub = { startTime: 0, endTime: beat, bpm: 140, downbeat: 0 };
  const main = { startTime: beat, endTime: 190, bpm: 140, downbeat: 4 * beat, barOffset: 3 };
  const rit = [{ startTime: 190, endTime: 192, bpm: 127, downbeat: 190, rit: true }, { startTime: 192, endTime: 200, bpm: 110, downbeat: 192, rit: true }];
  assert.equal(leadInFromMap(dropStartStub([stub, main]), 4), leadInFromMap(dropStartStub([stub, main, ...rit]), 4));
  // a batida colada no 0:00 sai também com ritardando: a fase da música é a do trecho de verdade
  assert.deepEqual(dropStartStub([stub, main, ...rit]), [main, ...rit]);
  // medley de verdade continua sem o trecho colado no 0:00
  assert.equal(dropStartStub([stub, main, { startTime: 190, endTime: 300, bpm: 120 }]).length, 2);
});

test('VS por IA com ritardando: grade sem emenda do 0:00 até o ritardando', () => {
  const beat = 60 / 140, lead = 4 * beat;
  const map = [
    { startTime: lead, endTime: lead + beat, bpm: 140, downbeat: lead },
    { startTime: lead + beat, endTime: 190, bpm: 140, downbeat: 2 * lead, barOffset: 3 },
    { startTime: 190, endTime: 192, bpm: 127, downbeat: 190, rit: true },
    { startTime: 192, endTime: 200, bpm: 110, downbeat: 192, rit: true },
  ];
  const out = plainGridBeforeRit(map);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { startTime: 0, endTime: 190, bpm: 140, downbeat: 0 });
  assert.equal(isFinalRitOnly(out), true);
  const medley = [{ startTime: 0, endTime: 60, bpm: 140 }, { startTime: 60, endTime: 120, bpm: 120 }];
  assert.equal(plainGridBeforeRit(medley), medley);
});
