import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReplaceTempoMap, clickCoverage, extendToStart, finalizeTempoMap, hitGridErrors, mapOffShare, oldMapLooksEdited,
  readClickHits, shouldReplaceTempoMap, tempoKeepKey, tempoMapSignature, weakClickSections,
} from '../src/lib/tempoFollow.ts';
import { barStartFlags, clickGridTimes } from '../src/lib/clickEdit.ts';
import { gridBeatTimes, mergeSameLineSegments, moveTempoChange, openLastSegment, uniformSegments } from '../src/lib/grid.ts';
import { songTempoPoints } from '../src/lib/reaperExport.ts';

const quantize = (hits) => hits.map((t) => Math.round(t * 22050) / 22050);
const flat = (hits) => new Array(hits.length).fill(1);

function line(start, bpm, beats) {
  return Array.from({ length: beats }, (_, i) => start + (i * 60) / bpm);
}

function worst(hits, map, duration) {
  const grid = clickGridTimes({ bpm: map.bpm, beatsPerBar: 4, tempoSegments: map.tempoSegments }, duration).sort((a, b) => a - b);
  let g = 0, top = 0;
  for (const t of hits) {
    while (g + 1 < grid.length && Math.abs(grid[g + 1] - t) <= Math.abs(grid[g] - t)) g++;
    top = Math.max(top, Math.abs(grid[g] - t));
  }
  return top;
}

function finalOf(hits, duration, peaks = flat(hits)) {
  const read = readClickHits(hits, peaks, duration);
  return finalizeTempoMap(extendToStart(read.segments, 4), { duration, beatsPerBar: 4, isClick: true, hits: read.pulseHits, halfRanges: read.halfRanges, lineTol: read.lineTol });
}

function seeded(n) {
  let s = n;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  return () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

test('rall final: a grade passa por cada click, batida a batida', () => {
  const hits = line(0.3, 100, 200);
  let t = hits[hits.length - 1];
  for (let i = 0; i < 6; i++) { t += 60 / (100 - i * 6); hits.push(t); }
  const clean = quantize(hits);
  const duration = clean[clean.length - 1] + 2;
  const map = finalOf(clean, duration);
  assert.ok(map.tempoSegments.length >= 3);
  assert.ok(worst(clean, map, duration) < 0.002, `erro ${worst(clean, map, duration)}`);
});

test('desvio de leitura não abre troca falsa de andamento', () => {
  for (const sd of [1, 2, 3]) {
    for (let s = 0; s < 8; s++) {
      const g = seeded(100 + s * 7 + sd);
      const hits = line(0.5, 120, 150).map((t) => t + (g() * sd) / 1000);
      const read = readClickHits(hits, flat(hits), 80);
      assert.equal(new Set(read.segments.map((x) => Math.round(x.bpm))).size, 1, `desvio ${sd} sorteio ${s}`);
      assert.ok(clickCoverage(hits, extendToStart(read.segments, 4), read.coverTol, read.halfRanges) >= 0.98);
    }
  }
});

test('emenda em dobro ou metade fica em dois trechos', () => {
  const a = line(0.2, 150, 80), b = line(a[79] + 0.4, 75, 50);
  const hits = quantize([...a, ...b]);
  const duration = hits[hits.length - 1] + 1;
  const map = finalOf(hits, duration);
  assert.deepEqual(map.tempoSegments.map((s) => Math.round(s.bpm)), [150, 75]);
  assert.ok(worst(hits, map, duration) < 0.002);
});

test('dois andamentos com pontas coincidentes não viram um só', () => {
  const a = line(0, 90, 180), b = line(a[179] + 60 / 90, 120, 121);
  const hits = quantize([...a, ...b]);
  const duration = hits[hits.length - 1] + 0.01;
  const map = finalOf(hits, duration);
  assert.deepEqual(map.tempoSegments.map((s) => Math.round(s.bpm)), [90, 120]);
  assert.ok(worst(hits, map, duration) < 0.002);
});

test('compasso sai do acento: valsa em projeto de 4 e 2/4 no meio de um 4/4', () => {
  const waltz = line(0.2, 90, 100);
  const peaks = waltz.map((_, i) => (i % 3 === 0 ? 1 : 0.5));
  const read = readClickHits(quantize(waltz), peaks, 75);
  assert.equal(read.segments[0].beatsPerBar, 3);

  const hits = line(0, 120, 126);
  const accents = hits.map((_, i) => (i < 64 ? i % 4 === 0 : (i - 64) % 2 === 0 && i < 66) || (i >= 66 && (i - 66) % 4 === 0) ? 1 : 0.5);
  const map = finalOf(quantize(hits), 70, accents);
  const song = { bpm: map.bpm, beatsPerBar: 4, tempoSegments: map.tempoSegments };
  const flags = barStartFlags(song, hits);
  hits.forEach((_, i) => { if (accents[i] === 1) assert.equal(flags[i], true, `acento ${i}`); });
});

test('swing e colcheia pontuada: o pulso é a soma dos dois intervalos', () => {
  for (const part of [2 / 3, 3 / 4]) {
    const hits = [];
    for (let i = 0; i < 120; i++) hits.push(0.2 + i * 0.5, 0.2 + i * 0.5 + 0.5 * part);
    const clean = quantize(hits);
    const read = readClickHits(clean, flat(clean), 62);
    assert.ok(read.segments.every((s) => Math.abs(s.bpm - 120) < 0.1), read.segments.map((s) => s.bpm).join(' '));
    assert.equal(read.pulseHits.length, 120);
  }
});

test('click em tercina ou semicolcheia não contradiz a grade certa', () => {
  const triplet = line(0, 180, 180);
  assert.ok(mapOffShare({ bpm: 60, beatsPerBar: 4 }, triplet, 60) < 0.02);
  const sixteenth = line(0, 400, 400);
  assert.ok(mapOffShare({ bpm: 100, beatsPerBar: 4 }, sixteenth, 60) < 0.02);
  // sem a batida da grade cair num ataque, continua contradizendo
  assert.ok(mapOffShare({ bpm: 100, beatsPerBar: 4 }, line(0.13, 140, 100), 60) > 0.1);
});

test('portão compara o erro: desvio pequeno e constante também é corrigido', () => {
  const hits = quantize(line(0.0027, 174, 300));
  const song = { bpm: 174, beatsPerBar: 4, duration: 110, bpmSource: 'click', tempoSegments: undefined };
  assert.ok(hitGridErrors(song, hits, 110)[10] > 0.002);
  const segs = [{ startTime: 0.0027, endTime: 50, bpm: 174 }, { startTime: 50.0027 + 0.1 - 0.1, endTime: 110, bpm: 174 }];
  assert.equal(shouldReplaceTempoMap(song, hits, { map: { bpm: 174, tempoSegments: segs }, coverage: 1 }), true);
});

test('recusa fica na música e assinatura antiga continua valendo', () => {
  const segs = [{ startTime: 0, endTime: 10, bpm: 120 }, { startTime: 10, endTime: 20, bpm: 90 }];
  const key = tempoKeepKey({ bpm: 120, tempoSegments: segs });
  assert.equal(canReplaceTempoMap({ bpm: 120, tempoSegments: segs, bpmSource: 'click', tempoMapKept: key }), false);
  assert.equal(canReplaceTempoMap({ bpm: 120, tempoSegments: segs, bpmSource: 'click', tempoMapKept: 'outro' }), true);
  const oldSig = segs.map((s) => `${s.startTime.toFixed(3)}:${s.bpm.toFixed(3)}`).join('|');
  assert.equal(canReplaceTempoMap({ bpm: 120, tempoSegments: segs, tempoMapSource: 'click', tempoMapSig: oldSig }), true);
  const marked = [segs[0], { ...segs[1], barOffset: 1 }];
  assert.notEqual(tempoMapSignature(marked), tempoMapSignature(segs));
});

test('mapa antigo igual ao do algoritmo antigo é automático; diferente foi ajustado à mão', () => {
  const hits = quantize([...line(0, 120, 120), ...line(60.4, 180, 180)]);
  const auto = [{ startTime: 0, endTime: 60.4, bpm: 120 }, { startTime: 60.4, endTime: 120.5, bpm: 180 }];
  assert.equal(oldMapLooksEdited({ tempoSegments: auto }, hits), false);
  const dragged = [{ ...auto[0], endTime: 58 }, { ...auto[1], startTime: 58 }];
  assert.equal(oldMapLooksEdited({ tempoSegments: dragged }, hits), true);
  assert.equal(oldMapLooksEdited({ tempoSegments: dragged, tempoMapSource: 'click' }, hits), false);
});

test('cobertura por trecho aponta só o trecho ruim', () => {
  const good = line(0, 120, 100);
  const bad = Array.from({ length: 20 }, (_, i) => 50 + i * 0.5 + (i % 2 ? 0.2 : 0));
  const segs = [{ startTime: 0, endTime: 50, bpm: 120 }, { startTime: 50, endTime: 60, bpm: 120 }];
  const weak = weakClickSections([...good, ...bad], segs, 0.005);
  assert.equal(weak.ranges.length, 1);
  assert.ok(weak.ranges[0][0] >= 49.9);
  assert.ok(weak.share < 0.2);
});

test('corte interno some antes de editar, e o último trecho vale até o fim da música', () => {
  const segs = [{ startTime: 0, endTime: 119.055, bpm: 127 }, { startTime: 119.055, endTime: 241.46, bpm: 127 }];
  assert.equal(mergeSameLineSegments(segs, 4).length, 1);
  const open = openLastSegment([{ startTime: 0.3, endTime: 80.3, bpm: 120 }, { startTime: 80.3, endTime: 162, bpm: 150 }], 290);
  assert.equal(open[1].endTime, 290);
  const moved = moveTempoChange(open, 1, 175, { keepPhase: true, beatsPerBar: 4 });
  assert.ok(moved[1].startTime > 170);
});

test('BPM digitado igual não mexe no mapa; BPM novo mantém a batida solta', () => {
  const segs = [{ startTime: 0.017, endTime: 0.342, bpm: 174 }, { startTime: 0.342, endTime: 278, bpm: 174 }];
  assert.equal(uniformSegments(segs, 174, 4), segs);
  const next = uniformSegments(segs, 170, 4);
  assert.equal(next[0].startTime, 0.017);
  assert.equal(next[1].startTime, 0.342);
  assert.ok(next.every((s) => s.bpm === 170));
});

test('REAPER usa as mesmas batidas da grade, com a fase do primeiro trecho', () => {
  const song = { bpm: 140, beatsPerBar: 4, tempoSegments: [
    { startTime: 0.615, endTime: 100, bpm: 140, downbeat: 0.615 },
    { startTime: 100.05, endTime: 200, bpm: 150, downbeat: 100.05 },
  ] };
  const pts = songTempoPoints(song, [{ srcStart: 0, srcEnd: 200, alpha: 1, outStart: 0 }]);
  // grade do REAPER: conta tempos a partir das marcas
  const beats = [];
  let pos = 0;
  pts.forEach((p, i) => {
    const end = i + 1 < pts.length ? pts[i + 1].time : 200;
    const size = 60 / p.bpm;
    for (let n = Math.ceil(pos - 1e-9); ; n++) {
      const t = p.time + (n - pos) * size;
      if (t >= end) break;
      beats.push(t);
    }
    pos += (end - p.time) / size;
  });
  const wanted = gridBeatTimes(song, 1, 199);
  for (const t of wanted) {
    const near = beats.reduce((m, v) => Math.min(m, Math.abs(v - t)), 9);
    assert.ok(near < 0.002, `batida ${t} a ${near}`);
  }
});
