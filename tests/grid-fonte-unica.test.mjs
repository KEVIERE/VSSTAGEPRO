// Uma fonte só de batidas: grade, click gerado, contagem do Maestro, snap e nearestGridBeat
// precisam cair exatamente nos mesmos instantes, inclusive nas emendas de um medley.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barBeatLabel, gridBeatTimes, gridLines, keepSegmentPhase, markBarStart, moveTempoChange,
  reachSongStart, snapTime, songGrid, uniformSegments,
} from '../src/lib/grid.ts';
import { barSeconds, barStartFlags, clickGridTimes, nearestGridBeat, shiftSong } from '../src/lib/clickEdit.ts';
import { beatStartAt, beatTimesFrom } from '../src/lib/narrations.ts';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} longe de ${b}`);

// mapa real do medley de teste: 6 andamentos, com um compasso de 147
const medleyReal = {
  bpm: 148,
  beatsPerBar: 4,
  tempoSegments: [
    { startTime: 0.002, endTime: 22.286, bpm: 140 },
    { startTime: 22.286, endTime: 34.034, bpm: 143 },
    { startTime: 34.034, endTime: 35.667, bpm: 147 },
    { startTime: 35.667, endTime: 170.261, bpm: 148 },
    { startTime: 170.261, endTime: 359.061, bpm: 150 },
    { startTime: 359.061, endTime: 492.308, bpm: 154 },
  ],
};

const lineBeats = (song, to) => gridLines(songGrid(song), 0, to, 200).filter((l) => l.kind !== 'sub').map((l) => l.time);

test('grade e click têm exatamente as mesmas batidas no medley real', () => {
  const click = clickGridTimes(medleyReal, 500.879);
  const lines = lineBeats(medleyReal, 500.879);
  assert.equal(lines.length, click.length);
  click.forEach((t, i) => near(lines[i], t, 1e-9));
});

test('último trecho vale até o fim da música, mesmo com endTime antigo', () => {
  const click = clickGridTimes(medleyReal, 500.879);
  assert.ok(click[click.length - 1] > 492.308, 'click continua depois do endTime salvo');
  const lines = lineBeats(medleyReal, 500.879);
  near(lines[lines.length - 1], click[click.length - 1], 1e-9);
});

test('contagem do Maestro cai nas batidas do click, inclusive na emenda de 170,261', () => {
  const click = clickGridTimes(medleyReal, 500.879);
  const at = click.findIndex((t) => t > 169);
  const count = beatTimesFrom(medleyReal, click[at], 8);
  count.forEach((t, i) => near(t, click[at + i], 1e-9));
  assert.ok(count.some((t) => Math.abs(t - 170.261) < 1e-9), 'a entrada do trecho 150 é uma das batidas');
});

test('nearestGridBeat e snap não inventam batida colada na emenda', () => {
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: [{ startTime: 0, endTime: 10.02, bpm: 120 }, { startTime: 10.02, endTime: 20, bpm: 90 }] };
  const click = clickGridTimes(song, 20);
  assert.ok(!click.some((t) => Math.abs(t - 10) < 1e-6), 'o click não toca em 10,0');
  near(nearestGridBeat(song, 10.0), 10.02);
  near(snapTime(10.0, songGrid(song), 'beat'), 10.02);
  near(beatStartAt(song, 10.0), 10.02);
});

test('mover a placa mantém todas as batidas do trecho e o 1 no lugar', () => {
  const segs = [
    { startTime: 0, endTime: 30, bpm: 120 },
    { startTime: 30, endTime: 90, bpm: 100, downbeat: 31.2, barOffset: 2 },
  ];
  const before = clickGridTimes({ bpm: 120, tempoSegments: segs }, 90).filter((t) => t >= 40);
  const flagsBefore = barStartFlags({ bpm: 120, beatsPerBar: 4, tempoSegments: segs }, before);
  const moved = moveTempoChange(segs, 1, 34.1, { keepPhase: true, beatsPerBar: 4 });
  near(moved[1].startTime, 30 + 7 * 0.6, 1e-9);
  near(moved[0].endTime, moved[1].startTime, 1e-12);
  assert.equal(moved[1].barOffset, 3);
  near(moved[1].downbeat, 34.2 + 3 * 0.6, 1e-9);
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: moved };
  const after = clickGridTimes(song, 90).filter((t) => t >= 40);
  assert.equal(after.length, before.length);
  after.forEach((t, i) => near(t, before[i], 1e-9));
  assert.deepEqual(barStartFlags(song, after), flagsBefore);
});

test('mover para trás também mantém a fase, e sem keepPhase continua no ponto exato', () => {
  const segs = [{ startTime: 0, endTime: 30, bpm: 120 }, { startTime: 30, endTime: 90, bpm: 100 }];
  const moved = moveTempoChange(segs, 1, 27.1, { keepPhase: true, beatsPerBar: 4 });
  near(moved[1].startTime, 27.0, 1e-9);
  assert.equal(moved[1].barOffset, 1, '5 tempos para trás: o 1 fica 1 tempo depois do início');
  assert.equal(moveTempoChange(segs, 1, 27.1)[1].startTime, 27.1);
});

test('numeração: compasso incompleto conta e nenhum número repete nem pula', () => {
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: [{ startTime: 0, endTime: 9, bpm: 120 }, { startTime: 9, endTime: 30, bpm: 100 }] };
  const bars = gridLines(songGrid(song), 0, 30, 200).filter((l) => l.kind === 'bar').map((l) => l.bar);
  bars.forEach((b, i) => assert.equal(b, i + 1));
  assert.equal(barBeatLabel(9, songGrid(song)), '6');
});

test('numeração no medley real: sequência contínua', () => {
  const bars = gridLines(songGrid(medleyReal), 0, 500, 200).filter((l) => l.kind === 'bar').map((l) => l.bar);
  bars.forEach((b, i) => assert.equal(b, i + 1));
});

test('anacruse da abertura entra na grade e no click', () => {
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: [
    { startTime: 0.3, endTime: 30, bpm: 120, downbeat: 1.3, barOffset: 2 },
    { startTime: 30, endTime: 60, bpm: 100 },
  ] };
  const click = clickGridTimes(song, 3);
  near(click[0], 0.3);
  near(click[1], 0.8);
  near(click[2], 1.3);
  assert.deepEqual(barStartFlags(song, click.slice(0, 3)), [false, false, true]);
  const bar = gridLines(songGrid(song), 0, 3, 200).find((l) => l.kind === 'bar');
  near(bar.time, 1.3);
  assert.equal(bar.bar, 1);
});

test('empurrar com início quase zero: o compasso novo tem grade e as batidas não mudam', () => {
  const song = {
    id: 's', name: 'x', clips: [], bpmAdjust: 0, tuner: 0, duration: 60, timelineStart: 0, blockId: null,
    ...{ bpm: 140, beatsPerBar: 4, tempoSegments: [{ startTime: 0.002, endTime: 22.286, bpm: 140 }, { startTime: 22.286, endTime: 60, bpm: 143 }] },
  };
  const bar = barSeconds(song, 0);
  const antes = clickGridTimes(song, 30);
  const out = shiftSong(song, [], bar).song;
  near(out.tempoSegments[0].startTime, 0.002);
  const depois = clickGridTimes(out, 30 + bar);
  assert.equal(depois.length, antes.length + 4);
  antes.forEach((t, i) => near(depois[i + 4], t + bar, 1e-9));
  assert.equal(out.tempoSegments[0].barOffset, undefined);
});

test('valsa no começo do medley: empurra 3 tempos e o 1 continua no 1', () => {
  const song = {
    id: 's', name: 'x', clips: [], bpmAdjust: 0, tuner: 0, duration: 60, timelineStart: 0, blockId: null,
    bpm: 120, beatsPerBar: 4,
    tempoSegments: [{ startTime: 0.01, endTime: 20, bpm: 120, beatsPerBar: 3 }, { startTime: 20, endTime: 60, bpm: 100 }],
  };
  const bar = barSeconds(song, 0);
  near(bar, 1.5);
  const out = shiftSong(song, [], bar).song;
  assert.equal(out.tempoSegments[0].barOffset, undefined);
  const times = clickGridTimes(out, 4);
  const firsts = times.filter((_, i) => barStartFlags(out, times)[i]);
  near(firsts[0], 0.01);
  near(firsts[1], 1.51);
});

test('empurrar com batida solta no 0:00 mantém ela e cria a grade antes', () => {
  const beat = 60 / 120;
  const segs = reachSongStart([
    { startTime: 2, endTime: 2.48, bpm: 120 },
    { startTime: 2.48, endTime: 30, bpm: 120, downbeat: 2.48 },
  ], 4);
  assert.equal(segs.length, 3);
  near(segs[0].startTime, 2.48 - 4 * beat);
  near(segs[1].startTime, 2);
  near(segs[2].startTime, 2.48);
});

test('apagar a última troca mantém a fase da grade', () => {
  const seg = { startTime: 0.615, endTime: 100, bpm: 140, downbeat: 0.615 };
  const parts = keepSegmentPhase(seg, 4, 100);
  assert.equal(parts.length, 2);
  const beat = 60 / 140;
  clickGridTimes({ bpm: 140, tempoSegments: parts }, 100).forEach((t, i) => near(t, 0.615 + i * beat, 1e-9));
  assert.equal(gridLines(songGrid({ bpm: 140, beatsPerBar: 4, tempoSegments: parts }), 0, 100, 100).filter((l) => l.bpmChange).length, 0);
  assert.equal(keepSegmentPhase({ startTime: 0, endTime: 100, bpm: 140 }, 4, 100), undefined, 'fase do 0:00: fica a grade simples');
});

test('anacruse continua valendo ao apagar a troca', () => {
  const parts = keepSegmentPhase({ startTime: 0.3, endTime: 60, bpm: 120, downbeat: 1.3, barOffset: 2 }, 4, 60);
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: parts };
  const times = clickGridTimes(song, 60);
  const firsts = times.filter((_, i) => barStartFlags(song, times)[i]);
  firsts.forEach((t) => near((t - 1.3) / 2, Math.round((t - 1.3) / 2), 1e-6));
});

test('Shift + botão direito: em cima da batida só renumera', () => {
  const song = { bpm: 120, beatsPerBar: 4 };
  const segs = markBarStart(song, 1.505, 60);
  const fixed = { ...song, tempoSegments: segs };
  const times = clickGridTimes(fixed, 60);
  times.forEach((t, i) => near(t, i * 0.5, 1e-9));
  const firsts = times.filter((_, i) => barStartFlags(fixed, times)[i]);
  near(firsts[0], 1.5);
  near(firsts[1], 3.5);
});

test('Shift + botão direito: fora da batida a grade anda até o ponto', () => {
  const song = { bpm: 120, beatsPerBar: 4 };
  const segs = markBarStart(song, 1.25, 60);
  const fixed = { ...song, tempoSegments: segs };
  const times = clickGridTimes(fixed, 60);
  near(times[0], 0.25);
  near(times[1], 0.75);
  const firsts = times.filter((_, i) => barStartFlags(fixed, times)[i]);
  near(firsts[0], 1.25);
  assert.equal(markBarStart(song, 2, 60), undefined, 'já é um 1 da grade simples');
});

test('Shift + botão direito em música de um andamento guardada em dois trechos vale para ela toda', () => {
  const song = { bpm: 120, beatsPerBar: 4, tempoSegments: [{ startTime: 0.3, endTime: 30.3, bpm: 120 }, { startTime: 30.3, endTime: 60, bpm: 120 }] };
  const fixed = { ...song, tempoSegments: markBarStart(song, 0.8, 60) };
  const times = clickGridTimes(fixed, 60);
  const firsts = times.filter((_, i) => barStartFlags(fixed, times)[i]);
  firsts.forEach((t) => near((t - 0.8) / 2, Math.round((t - 0.8) / 2), 1e-6));
  assert.ok(firsts.length > 20);
});

test('Shift + botão direito no medley só mexe no trecho clicado', () => {
  const fixed = { ...medleyReal, tempoSegments: markBarStart(medleyReal, 170.261 + 60 / 150, 500) };
  assert.equal(fixed.tempoSegments[5].startTime, 359.061);
  assert.equal(fixed.tempoSegments[4].barOffset, 1);
  assert.equal(fixed.tempoSegments[3].barOffset, undefined);
  const before = clickGridTimes(medleyReal, 500);
  const after = clickGridTimes(fixed, 500);
  assert.equal(after.length, before.length);
  after.forEach((t, i) => near(t, before[i], 1e-9));
});

test('BPM digitado mantém a anacruse', () => {
  const segs = uniformSegments([
    { startTime: 0.3, endTime: 30, bpm: 120, barOffset: 2, downbeat: 1.3 },
    { startTime: 30, endTime: 60.3, bpm: 120 },
  ], 100, 4);
  assert.equal(segs[0].barOffset, 2);
  near(segs[0].downbeat, 0.3 + 2 * 0.6);
});

test('lista de batidas: intervalo aberto no fim e nada antes do 0:00', () => {
  assert.deepEqual(gridBeatTimes({ bpm: 120 }, 0, 2), [0, 0.5, 1, 1.5]);
  assert.deepEqual(gridBeatTimes({ bpm: 120 }, 0.6, 1.6), [1, 1.5]);
});
