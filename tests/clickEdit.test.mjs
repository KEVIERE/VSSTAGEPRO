// Contas do click: compasso, empurrar o VS, batidas do click e onde o som do click começa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barSeconds, shiftSong, clickOnsetIndex, clickClipsOf,
} from '../src/lib/clickEdit.ts';
import { USER_CLICK_SAMPLE_B64 } from '../src/lib/clickSampleData.ts';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('compasso pelo BPM da música', () => {
  near(barSeconds({ bpm: 120, beatsPerBar: 4 }, 0), 2);
  near(barSeconds({ bpm: 90, beatsPerBar: 3 }, 0), 2);
  near(barSeconds({ bpm: 120 }, 0), 2); // sem fórmula: 4/4
});

test('compasso usa o andamento do trecho onde o click começa', () => {
  const song = {
    bpm: 120, beatsPerBar: 4,
    tempoSegments: [{ startTime: 0, endTime: 10, bpm: 120 }, { startTime: 10, endTime: 60, bpm: 60 }],
  };
  near(barSeconds(song, 5), 2);
  near(barSeconds(song, 20), 4);
});

test('empurrar o VS move tudo da música e deixa o começo da grade no 0', () => {
  const song = {
    id: 's', name: 'x', clips: [], bpm: 120, bpmAdjust: 0, tuner: 0, duration: 100, timelineStart: 0, blockId: null,
    regions: [{ id: 'r', name: 'Refrão', start: 10, end: 20 }],
    narrations: [{ id: 'n', text: 'Um', start: 4, end: 5 }],
    markers: [{ id: 'm', name: 'A', position: 8 }],
    medley: [{ id: 'p1', name: 'A', start: 0 }, { id: 'p2', name: 'B', start: 50 }],
    tempoSegments: [{ startTime: 0, endTime: 50, bpm: 120, downbeat: 0 }, { startTime: 50, endTime: 100, bpm: 130, downbeat: 50 }],
  };
  const clips = [
    { id: 'c1', songId: 's', trackId: 'a', startTime: 0, duration: 100, markers: [{ position: 3 }] },
    { id: 'c2', songId: 'outra', trackId: 'a', startTime: 7, duration: 10 },
  ];
  const out = shiftSong(song, clips, 2);
  near(out.song.duration, 102);
  near(out.song.regions[0].start, 12); near(out.song.regions[0].end, 22);
  near(out.song.narrations[0].start, 6);
  near(out.song.markers[0].position, 10);
  near(out.song.medley[0].start, 0); near(out.song.medley[1].start, 52);
  near(out.song.tempoSegments[0].startTime, 0); near(out.song.tempoSegments[0].endTime, 52);
  near(out.song.tempoSegments[1].startTime, 52); near(out.song.tempoSegments[1].downbeat, 52);
  near(out.clips[0].startTime, 2);
  near(out.clips[0].markers[0].position, 3); // relativo ao clipe
  near(out.clips[1].startTime, 7); // outra música não mexe
});

test('clipes de click da música em ordem', () => {
  const clips = [
    { id: 'b', songId: 's', trackId: 'track-click', startTime: 9 },
    { id: 'a', songId: 's', trackId: 'track-click', startTime: 1 },
    { id: 'x', songId: 's', trackId: 'outra', startTime: 0 },
  ];
  assert.deepEqual(clickClipsOf(clips, 's').map((c) => c.id), ['a', 'b']);
});

test('o som da amostra de click começa em ~1,5 ms (não no pico de 7,4 ms)', () => {
  const buf = Buffer.from(USER_CLICK_SAMPLE_B64, 'base64');
  let p = 12; let fmt; let data;
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') { data = buf.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size & 1);
  }
  const step = (fmt.bits / 8) * fmt.ch;
  const left = new Float32Array(data.length / step);
  for (let i = 0; i < left.length; i++) left[i] = data.readIntLE(i * step, 3) / 8388608;
  const ms = clickOnsetIndex(left) / fmt.sr * 1000;
  assert.ok(ms > 0.5 && ms < 3, `começo em ${ms} ms`);
});

test('acha o começo de cada batida de um click, com acento e sem acento', async () => {
  const { clickHits } = await import('../src/lib/clickEdit.ts');
  const sr = 48000;
  const data = new Float32Array(sr * 3);
  const starts = [0.5, 1.0, 1.5, 2.0].map((t) => Math.round(t * sr));
  starts.forEach((s, n) => {
    const amp = n === 0 ? 1 : 0.5; // primeira batida acentuada
    for (let i = 0; i < sr * 0.05; i++) data[s + i] = amp * Math.sin(2 * Math.PI * 1500 * i / sr) * Math.exp(-i / sr * 60) * Math.min(1, i / (sr * 0.002));
  });
  const hits = clickHits(data, sr);
  assert.equal(hits.length, 4);
  hits.forEach((h, i) => assert.ok(Math.abs(h - starts[i]) < sr * 0.001, `batida ${i}: ${(h - starts[i]) / sr * 1000} ms`));
});

test('batida perto da grade vai para a linha certa, também com mudança de andamento', async () => {
  const { nearestGridBeat } = await import('../src/lib/clickEdit.ts');
  near(nearestGridBeat({ bpm: 120 }, 2.493), 2.5);
  const song = { bpm: 120, tempoSegments: [{ startTime: 0, endTime: 10, bpm: 120 }, { startTime: 10, endTime: 60, bpm: 100 }] };
  near(nearestGridBeat(song, 10.61), 10.6);
});

test('click todo adiantado 6 ms vai para a grade; grade errada não mexe nas batidas', async () => {
  const { alignHitsToGrid, nearestGridBeat } = await import('../src/lib/clickEdit.ts');
  const grid100 = (t) => nearestGridBeat({ bpm: 100 }, t);
  // click antigo: 100 BPM, cada batida 6 ms antes da linha
  const early = Array.from({ length: 20 }, (_, k) => k * 0.6 - 0.006).slice(1);
  alignHitsToGrid(early, grid100).forEach((t, i) => near(t, (i + 1) * 0.6, 1e-9));
  // medley: a música está em 120 BPM mas a grade acha que é 100 — nada pode ser puxado
  const real120 = Array.from({ length: 40 }, (_, k) => 24 + k * 0.5);
  assert.deepEqual(alignHitsToGrid(real120, grid100), real120);
});

test('medley: o click de uma parte mais baixo (-20 dB) também é achado', async () => {
  const { clickHits } = await import('../src/lib/clickEdit.ts');
  const sr = 48000;
  const data = new Float32Array(sr * 20);
  const beats = [];
  for (let t = 0.5; t < 10; t += 0.6) beats.push([t, 0.9]);
  for (let t = 10.2; t < 19.5; t += 0.5) beats.push([t, 0.09]); // parte 2: 120 BPM e 20 dB mais baixa
  for (const [t, amp] of beats) {
    const s = Math.round(t * sr);
    for (let i = 0; i < sr * 0.04; i++) data[s + i] = amp * Math.sin(2 * Math.PI * 2000 * i / sr) * Math.exp(-i / sr * 90) * Math.min(1, i / (sr * 0.001));
  }
  const hits = clickHits(data, sr);
  assert.equal(hits.length, beats.length);
  hits.forEach((h, i) => assert.ok(Math.abs(h / sr - beats[i][0]) < 0.001));
});

test('o fim do som da última batida não vira batida a mais (som padrão do VS)', async () => {
  const { clickHits } = await import('../src/lib/clickEdit.ts');
  const buf = Buffer.from(USER_CLICK_SAMPLE_B64, 'base64');
  let p = 12; let data;
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'data') { data = buf.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size & 1);
  }
  const sample = new Float32Array(data.length / 6);
  for (let i = 0; i < sample.length; i++) sample[i] = data.readIntLE(i * 6, 3) / 8388608;
  const sr = 44100;
  const out = new Float32Array(sr * 8);
  const beats = [0.5, 1.1, 1.7, 2.3, 5.0]; // pausa antes da última, como entre partes de um medley
  for (const t of beats) { const s = Math.round(t * sr); for (let i = 0; i < sample.length && s + i < out.length; i++) out[s + i] += sample[i]; }
  assert.equal(clickHits(out, sr).length, beats.length);
});
