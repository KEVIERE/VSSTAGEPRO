// BPM pela track de click do VS e grade de compassos: o compasso 1 fica no 0:00 (como na DAW de
// onde o VS saiu) e cada linha da grade cai em cima de um click. Os andamentos dos medleys vêm de
// VS reais medidos no app (ex.: "BLOCO ASSUNTO DELICADO": 140 → 148 → 150 → 154).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClickTempo } from '../src/lib/beatDetector.ts';
import { gridLines, moveTempoChange, snapTempoChange, songGrid, tempoChangeIndex } from '../src/lib/grid.ts';

const SR = 44100;

// Track de click em 16 bits. `sections`: [{ bpm, seconds }] em sequência, como num medley.
// O primeiro click fica na primeira amostra do arquivo, como sai da DAW.
function clickTrack(sections, { accent = false, gapBetween = 0, extra = [] } = {}) {
  const beats = [];
  let t = 0;
  for (const [n, s] of sections.entries()) {
    if (n > 0) t += gapBetween;
    const end = t + s.seconds;
    for (; t < end - 1e-9; t += 60 / s.bpm) beats.push({ t, amp: accent && beats.length % 4 === 0 ? 0.9 : 0.6 });
  }
  const total = (beats[beats.length - 1]?.t ?? 0) + 1;
  const data = new Float32Array(Math.ceil(total * SR));
  for (const { t: at, amp } of [...beats, ...extra]) {
    const s0 = Math.round(at * SR);
    for (let i = 0; i < 0.02 * SR && s0 + i < data.length; i++) {
      data[s0 + i] += amp * Math.sin(2 * Math.PI * 1500 * i / SR) * Math.exp(-i / (0.004 * SR));
    }
  }
  const pcm = Int16Array.from(data, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767));
  return { audio: { sampleRate: SR, length: pcm.length, channels: [pcm] }, beats: beats.map((b) => b.t) };
}

function measure(sections, opts) {
  const { audio, beats } = clickTrack(sections, opts);
  const r = detectClickTempo(audio, 4);
  assert.ok(r, 'o click deveria ser medido');
  return { r, beats };
}

for (const bpm of [92, 98, 103, 111, 138, 148, 160]) {
  test(`click de ${bpm} BPM do começo ao fim: mede ${bpm}`, () => {
    const { r } = measure([{ bpm, seconds: 120 }]);
    assert.equal(r.bpm, bpm);
  });
}

test('medley: mede o andamento da primeira música, não o trecho mais longo', () => {
  // BLOCO ASSUNTO DELICADO: antes saía 148.23 (mistura dos trechos)
  const { r } = measure([{ bpm: 140, seconds: 28 }, { bpm: 148, seconds: 130 }, { bpm: 150, seconds: 180 }, { bpm: 154, seconds: 120 }]);
  assert.equal(r.bpm, 140);
});

test('medley com mudança pequena de andamento (122 → 124)', () => {
  // BLOCO NAO GOSTO EU AMO: antes saía 123.28
  const { r } = measure([{ bpm: 122, seconds: 40 }, { bpm: 124, seconds: 200 }]);
  assert.equal(r.bpm, 122);
});

test('medley com pausa entre as músicas', () => {
  const { r } = measure([{ bpm: 96, seconds: 30 }, { bpm: 132, seconds: 120 }], { gapBetween: 2.3 });
  assert.equal(r.bpm, 96);
});

test('ataque solto no meio do click (voz, virada) não muda o andamento', () => {
  const extra = [5.13, 5.31, 5.52, 9.07].map((t) => ({ t, amp: 0.8 }));
  const { r } = measure([{ bpm: 140, seconds: 60 }], { extra });
  assert.equal(r.bpm, 140);
});

test('click com acento no tempo 1', () => {
  const { r } = measure([{ bpm: 133, seconds: 60 }], { accent: true });
  assert.equal(r.bpm, 133);
});

test('grade: compasso 1 no 0:00 e cada linha em cima de um click', () => {
  const { r, beats } = measure([{ bpm: 111, seconds: 60 }]);
  // o início salvo em versões antigas (um tempo depois do 0) não mexe na grade
  const grid = songGrid({ bpm: r.bpm, beatsPerBar: 4, downbeat: 0.5405 });
  const lines = gridLines(grid, 0, 58, 30).filter((l) => l.kind !== 'sub');
  assert.equal(lines[0].time, 0);
  assert.equal(lines[0].kind, 'bar');
  assert.equal(lines[0].bar, 1);
  for (const l of lines) {
    const nearest = beats.reduce((a, b) => (Math.abs(b - l.time) < Math.abs(a - l.time) ? b : a));
    assert.ok(Math.abs(nearest - l.time) < 0.002, `linha em ${l.time.toFixed(3)} s longe do click (${nearest.toFixed(3)} s)`);
  }
});

// Medley como o BLOCO ASSUNTO DELICADO: 140 no começo, mudança cravada à mão perto dos 28 s
const medley = [
  { startTime: 0, endTime: 28.37, bpm: 140 },
  { startTime: 28.37, endTime: 160, bpm: 148, downbeat: 28.37 },
  { startTime: 160, endTime: 494, bpm: 150, downbeat: 160 },
];

test('plaquinha: acha a mudança mais perto (nunca o primeiro trecho)', () => {
  assert.equal(tempoChangeIndex(medley, 0), 1);
  assert.equal(tempoChangeIndex(medley, 30), 1);
  assert.equal(tempoChangeIndex(medley, 150), 2);
  assert.equal(tempoChangeIndex([{ startTime: 0, endTime: 100, bpm: 120 }], 10), -1);
});

test('plaquinha: arrastar move a mudança e o fim do trecho de antes', () => {
  const moved = moveTempoChange(medley, 1, 31);
  assert.equal(moved[0].endTime, 31);
  assert.equal(moved[1].startTime, 31);
  assert.equal(moved[1].downbeat, 31);
  assert.equal(moved[2].startTime, 160);
  // não passa por cima das vizinhas: fica a pelo menos um tempo delas
  assert.ok(Math.abs(moveTempoChange(medley, 1, -5)[1].startTime - 60 / 140) < 1e-9);
  assert.ok(Math.abs(moveTempoChange(medley, 1, 500)[1].startTime - (160 - 60 / 148)) < 1e-9);
});

test('plaquinha: ajustar no beat da grade de antes da mudança', () => {
  const beat = 60 / 140;
  const t = snapTempoChange(medley, 1, 28.37, 4, 'beat');
  assert.ok(Math.abs(t / beat - Math.round(t / beat)) < 1e-9, 'tem que cair num tempo da grade de 140');
  assert.ok(Math.abs(t - 28.37) <= beat / 2);
  assert.ok(Math.abs(t - 28.2857142857) < 1e-6);
  const bar = snapTempoChange(medley, 1, 28.37, 4, 'bar');
  assert.ok(Math.abs(bar / (4 * beat) - Math.round(bar / (4 * beat))) < 1e-9);
  // na grade, a placa (mudança) aparece exatamente nesse ponto
  const grid = songGrid({ bpm: 140, beatsPerBar: 4, tempoSegments: moveTempoChange(medley, 1, t) });
  const change = gridLines(grid, 0, 60, 30).find((l) => l.bpmChange === 148);
  assert.ok(change && Math.abs(change.time - t) < 1e-9);
});
