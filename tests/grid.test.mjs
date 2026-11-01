// Grade de compassos: tem que cair em cima da track de click importada do VS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClickTempo } from '../src/lib/beatDetector.ts';
import { clickDownbeatOnTimeline, gridLines, snapTime, songGrid } from '../src/lib/grid.ts';

const SR = 44100;

// Track de click em 16 bits, com acento no tempo 1, começando em `firstBeat` segundos.
function clickTrack(bpm, firstBeat, seconds, beatsPerBar = 4) {
  const data = new Float32Array(Math.floor(seconds * SR));
  const period = 60 / bpm;
  const beats = [];
  for (let k = 0; ; k++) {
    const t = firstBeat + k * period;
    if (t >= seconds - 0.05) break;
    beats.push(t);
    const amp = k % beatsPerBar === 0 ? 0.9 : 0.6;
    const s0 = Math.round(t * SR);
    for (let i = 0; i < 0.02 * SR && s0 + i < data.length; i++) {
      data[s0 + i] += amp * Math.sin(2 * Math.PI * 1500 * i / SR) * Math.exp(-i / (0.004 * SR));
    }
  }
  const pcm = Int16Array.from(data, (v) => Math.round(v * 32767));
  return { audio: { sampleRate: SR, length: pcm.length, channels: [pcm] }, beats };
}

// Mesmo caminho da importação: mede o click, grava o início na música e desenha a grade.
function gridFor(bpm, firstBeat, clip = { startTime: 0 }) {
  const { audio, beats } = clickTrack(bpm, firstBeat, 60);
  const r = detectClickTempo(audio, 4);
  assert.ok(r, 'o click deveria ser medido');
  const downbeat = clickDownbeatOnTimeline(r.downbeat, clip, r.bpm, 4);
  const grid = songGrid({ bpm: r.bpm, beatsPerBar: 4, downbeat });
  const shift = (clip.startTime ?? 0) - (clip.trimStart ?? 0);
  return { r, grid, beats: beats.map((t) => t + shift).filter((t) => t >= 0) };
}

function assertLinesOnClicks(grid, beats) {
  const lines = gridLines(grid, 0, 60, 30).filter((l) => l.kind !== 'sub');
  assert.ok(lines.length > 20);
  for (const l of lines) {
    if (l.time > beats[beats.length - 1]) break;
    const nearest = beats.reduce((a, b) => (Math.abs(b - l.time) < Math.abs(a - l.time) ? b : a));
    assert.ok(Math.abs(nearest - l.time) < 0.002, `linha em ${l.time.toFixed(3)} s longe do click (${nearest.toFixed(3)} s)`);
  }
}

for (const [bpm, start] of [[120, 0], [120, 0.35], [93, 1.1], [140, 0.08]]) {
  test(`grade em cima do click: ${bpm} BPM começando em ${start} s`, () => {
    const { r, grid, beats } = gridFor(bpm, start);
    assert.equal(r.bpm, bpm);
    assert.ok(Math.abs(grid.downbeat - start) < 0.002, `compasso 1 em ${grid.downbeat} s, click em ${start} s`);
    assertLinesOnClicks(grid, beats);
  });
}

test('nenhuma linha antes do compasso 1 (sem compasso quebrado no início)', () => {
  const { grid } = gridFor(93, 1.1);
  const lines = gridLines(grid, 0, 10, 200);
  assert.ok(lines[0].time >= grid.downbeat - 1e-9);
  assert.equal(lines[0].kind, 'bar');
  assert.equal(lines[0].bar, 1);
});

test('clipe de click movido ou cortado no início: a grade acompanha', () => {
  const moved = gridFor(120, 0.35, { startTime: 2 });
  assert.ok(Math.abs(moved.grid.downbeat - 2.35) < 0.002);
  assertLinesOnClicks(moved.grid, moved.beats);

  // corte de 3 s no início: o tempo cairia em -2,65 s, avança 2 compassos de 2 s
  const trimmed = gridFor(120, 0.35, { startTime: 0, trimStart: 3 });
  assert.ok(Math.abs(trimmed.grid.downbeat - 1.35) < 0.002);
  assertLinesOnClicks(trimmed.grid, trimmed.beats);
});

test('início cravado à mão (Shift + botão direito) move a grade e o imã', () => {
  const grid = songGrid({ bpm: 120, beatsPerBar: 4, downbeat: 0.4 });
  assert.equal(grid.downbeat, 0.4);
  assert.ok(Math.abs(snapTime(2.3, grid, 'bar') - 2.4) < 1e-9);
  assert.equal(songGrid({ bpm: 120, beatsPerBar: 4 }).downbeat, 0);
});

test('medley: primeiro trecho começa no click, os outros no ponto da mudança de BPM', () => {
  const grid = songGrid({
    bpm: 120, beatsPerBar: 4, downbeat: 0.35,
    tempoSegments: [
      { startTime: 0, endTime: 20.35, bpm: 120 },
      { startTime: 20.35, endTime: 60, bpm: 90, downbeat: 20.35 },
    ],
  });
  const lines = gridLines(grid, 0, 60, 30);
  const bars = lines.filter((l) => l.kind === 'bar');
  assert.ok(Math.abs(lines[0].time - 0.35) < 1e-9);
  assert.equal(bars[0].bar, 1);
  const change = bars.find((l) => l.bpmChange === 90);
  assert.ok(change && Math.abs(change.time - 20.35) < 1e-9);
  assert.equal(change.bar, 11);
});
