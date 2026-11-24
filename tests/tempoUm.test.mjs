import test from 'node:test';
import assert from 'node:assert/strict';
import { attackShapes, clickTrackMap, finalizeTempoMap, placeClickMap, soundAccents, tempoMapSignature } from '../src/lib/tempoFollow.ts';
import { alignBarPhase, copyBarPhase, mixIntoRuler, planBarPhase } from '../src/lib/barPhase.ts';
import { gridBeatTimes, gridLines, songGrid } from '../src/lib/grid.ts';

const SR = 22050;

// Click sintético: `sound(batida)` diz a frequência e o volume do ataque de cada batida.
function renderClick(bpm, beats, sound, skip = 0) {
  const period = 60 / bpm;
  const x = new Float32Array(Math.ceil((beats * period + 1) * SR));
  for (let b = skip; b < beats; b++) {
    const { freq, peak } = sound(b);
    const at = Math.round((b - skip) * period * SR) + 100;
    for (let i = 0; i < 0.03 * SR; i++) {
      x[at + i] += peak * Math.exp((-i / SR) * 180) * Math.sin((2 * Math.PI * freq * i) / SR);
    }
  }
  return x;
}

const beatsOf = (segments, bpm, to) => gridBeatTimes({ bpm, beatsPerBar: 4, tempoSegments: segments.length >= 2 ? segments : undefined }, 0, to);

/** Ativação com pico em cada batida `k` do trecho, conforme a posição no compasso. */
function activation(start, bpm, beats, levels, seconds, fps = 50) {
  const out = new Float32Array(Math.ceil(seconds * fps));
  const period = 60 / bpm;
  for (let k = 0; k < beats; k++) {
    const f = Math.round((start + k * period) * fps);
    if (f >= 0 && f < out.length) out[f] = levels[k % levels.length];
  }
  return out;
}

const clickSong = (over = {}) => ({ bpm: 120, beatsPerBar: 4, duration: 60, bpmSource: 'click', ...over });

test('acento mais baixo e mais agudo é reconhecido pelo som', () => {
  const x = renderClick(105, 64, (b) => (b % 4 === 0 ? { freq: 2600, peak: 0.78 } : { freq: 1500, peak: 0.9 }));
  const read = clickTrackMap(x, SR, 4);
  assert.equal(read.accented, true);
  // arquivo com dois tempos cortados pelo clipe: o 1 cai no terceiro tempo da régua
  const period = 60 / 105;
  const placed = placeClickMap(read.segments, -2 * period, 64 * period, 4, read.accented);
  const first = placed[0];
  const firstBar = first.startTime + (first.barOffset ?? 0) * period;
  const k = Math.round(firstBar / period);
  assert.equal(((k % 4) + 4) % 4, 2);
});

test('acento no meio do arquivo: a fase sai do som, mesmo com o click começando no tempo 3', () => {
  const x = renderClick(120, 66, (b) => (b % 4 === 0 ? { freq: 2600, peak: 0.7 } : { freq: 1400, peak: 0.95 }), 2);
  const read = clickTrackMap(x, SR, 4);
  assert.equal(read.accented, true);
  const seg = read.segments[read.segments.length - 1];
  const firstBar = seg.startTime + (seg.barOffset ?? 0) * 0.5;
  const accent = 100 / SR + 2 * 0.5;
  assert.ok(Math.abs(((firstBar - accent) / 2 - Math.round((firstBar - accent) / 2))) < 0.01);
});

test('click de uma amostra só não vira acentuado', () => {
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const x = renderClick(127, 80, () => ({ freq: 1800, peak: 0.8 + 0.04 * noise() }));
  for (let i = 0; i < x.length; i++) x[i] += (noise() - 0.5) * 2e-4;
  assert.equal(clickTrackMap(x, SR, 4).accented, false);
});

test('dois sons sem regularidade não valem como acento', () => {
  // o som diferente cai em posições sem intervalo fixo (uma virada, um efeito)
  const odd = new Set([3, 7, 12, 14, 21, 22, 30, 37, 41, 50, 53, 59]);
  const x = renderClick(120, 64, (b) => (odd.has(b) ? { freq: 2600, peak: 0.8 } : { freq: 1400, peak: 0.8 }));
  const hits = [];
  for (let b = 0; b < 64; b++) hits.push(Math.round(b * 0.5 * SR) + 100);
  const beats = hits.map((_, i) => i);
  assert.equal(soundAccents(attackShapes(x, hits), beats), null);
});

test('as batidas são idênticas antes e depois: só o barOffset e o downbeat mudam', () => {
  const segments = [
    { startTime: 0, endTime: 22, bpm: 140, downbeat: 60 / 140, barOffset: 1 },
    { startTime: 22, endTime: 60, bpm: 150, downbeat: 22 },
  ];
  const down = activation(0, 140, 50, [0.95, 0, 0, 0], 22);
  const out = new Float32Array(60 * 50);
  out.set(down);
  out.set(activation(0, 150, 95, [0.9, 0, 0, 0], 38), 22 * 50);
  const before = beatsOf(segments, 140, 60);
  const { segments: fixed, changed } = alignBarPhase(segments, out, 50, 4);
  assert.equal(changed, true);
  assert.equal(fixed[0].barOffset, 0);
  assert.equal(fixed[0].downbeat, 0);
  assert.equal(fixed[1], segments[1]);
  fixed.forEach((s, i) => {
    assert.equal(s.startTime, segments[i].startTime);
    assert.equal(s.endTime, segments[i].endTime);
    assert.equal(s.bpm, segments[i].bpm);
  });
  assert.deepEqual(beatsOf(fixed, 140, 60), before);
});

test('toco inicial acompanha o deslocamento do trecho seguinte', () => {
  const beat = 60 / 174;
  const segments = [
    { startTime: 0.017, endTime: 0.342, bpm: 174, downbeat: 0.017 + beat, barOffset: 1 },
    { startTime: 0.342, endTime: 60, bpm: 174, downbeat: 0.342 },
  ];
  const down = activation(0.342, 174, 170, [0.07, 0.3, 0.07, 0.3], 60);
  const before = beatsOf(segments, 174, 60);
  const { segments: fixed, decisions } = alignBarPhase(segments, down, 50, 4);
  assert.equal(fixed[1].barOffset, 1);
  assert.equal(fixed[0].barOffset, 2);
  assert.equal(decisions[0].reason, 'toco');
  // a contagem atravessa a emenda sem quebrar: o 1 do toco e o do trecho são o mesmo compasso
  const barA = fixed[0].startTime + 2 * beat;
  const barB = fixed[1].startTime + 1 * beat;
  assert.ok(Math.abs(barA - barB) < 0.03);
  assert.deepEqual(beatsOf(fixed, 174, 60), before);
});

test('empate entre duas posições: sai da posição sem apoio e fica com a de menor anacruse', () => {
  const segments = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 0 }];
  const down = activation(0, 120, 120, [0.05, 0.31, 0.05, 0.3], 60);
  const { segments: fixed, decisions } = alignBarPhase(segments, down, 50, 4);
  assert.equal(decisions[0].reason, 'mudou');
  assert.equal(fixed[0].barOffset, 1);
});

test('empate real de SEU AMOR: duas posições opostas com o dobro da atual tiram o 1 de lá', () => {
  const segments = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 0 }];
  const moved = alignBarPhase(segments, activation(0, 120, 120, [0.156, 0.311, 0.144, 0.319], 60), 50, 4);
  assert.equal(moved.decisions[0].reason, 'mudou');
  assert.equal(moved.segments[0].barOffset, 1);
  // a posição atual ainda perto das duas: sem confiança, fica
  const kept = alignBarPhase(segments, activation(0, 120, 120, [0.22, 0.31, 0.2, 0.32], 60), 50, 4);
  assert.equal(kept.changed, false);
  // vantagem de 2 vezes sem empate não basta
  const single = alignBarPhase(segments, activation(0, 120, 120, [0.2, 0.42, 0.1, 0.1], 60), 50, 4);
  assert.equal(single.changed, false);
});

test('posição atual empatada com a melhor fica onde está', () => {
  const segments = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 0 }];
  const down = activation(0, 120, 120, [0.3, 0.05, 0.31, 0.05], 60);
  const { changed } = alignBarPhase(segments, down, 50, 4);
  assert.equal(changed, false);
});

test('confiança baixa ou poucos compassos não mudam nada', () => {
  const segments = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 0 }];
  // ativação fraca (como o fim do ritardando)
  assert.equal(alignBarPhase(segments, activation(0, 120, 120, [0, 0.001, 0.003, 0.076], 60), 50, 4).changed, false);
  // vantagem pequena sobre a posição atual
  assert.equal(alignBarPhase(segments, activation(0, 120, 120, [0.4, 0, 0.6, 0], 60), 50, 4).changed, false);
  // três compassos só
  const short = [{ startTime: 0, endTime: 6, bpm: 120, downbeat: 0 }];
  assert.equal(alignBarPhase(short, activation(0, 120, 12, [0, 0, 0.9, 0], 6), 50, 4).changed, false);
});

test('silêncio no fim da música não dilui a confiança', () => {
  const segments = [{ startTime: 0, endTime: 120, bpm: 120, downbeat: 0 }];
  // música só na primeira metade; depois, nada
  const down = activation(0, 120, 120, [0, 0.5, 0, 0], 120);
  const { decisions } = alignBarPhase(segments, down, 50, 4);
  assert.equal(decisions[0].bars, 30);
  assert.equal(decisions[0].after, 1);
});

test('compasso próprio do trecho (valsa) conta em 3', () => {
  const segments = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 0, beatsPerBar: 3 }];
  const down = activation(0, 120, 120, [0, 0, 0.9], 60);
  const { segments: fixed } = alignBarPhase(segments, down, 50, 4);
  assert.equal(fixed[0].barOffset, 2);
  assert.equal(fixed[0].beatsPerBar, 3);
});

test('mapa manual, do REAPER, editado ou recusado nunca muda', () => {
  const tempoSegments = [
    { startTime: 0, endTime: 30, bpm: 120, downbeat: 0 },
    { startTime: 30, endTime: 60, bpm: 130, downbeat: 30 },
  ];
  const model = { downbeat: activation(0, 120, 60, [0, 0.9, 0, 0], 60), fps: 50 };
  const plan = (over) => planBarPhase(clickSong({ tempoSegments, ...over }), { accented: false }, model);
  assert.ok(plan({}), 'mapa automático muda');
  assert.equal(plan({ tempoMapSource: 'manual' }), null);
  assert.equal(plan({ tempoMapSource: 'reaper' }), null);
  assert.equal(plan({ bpmSource: 'manual' }), null);
  assert.equal(plan({ tempoMapSource: 'click', tempoMapSig: 'outra assinatura' }), null);
  assert.equal(plan({ tempoMapKept: `120@${tempoSegments.map((s) => `${s.startTime.toFixed(3)}:${s.bpm.toFixed(3)}:0:0`).join('|')}` }), null);
});

test('andamento único corrigido vira dois trechos, com o 1 no lugar e as batidas iguais', () => {
  const song = clickSong();
  const model = { downbeat: activation(0, 120, 120, [0, 0, 0.9, 0], 60), fps: 50 };
  const next = planBarPhase(song, { accented: false }, model);
  assert.equal(next.length, 2);
  assert.ok(next.every((s) => s.barOffset === 2));
  assert.deepEqual(beatsOf(next, 120, 60), beatsOf([], 120, 60));
});

test('com acento, a fase do click vale e o modelo não é usado', () => {
  const song = clickSong();
  const placed = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 1, barOffset: 2 }];
  const next = planBarPhase(song, { accented: true, placed }, null);
  assert.ok(next.every((s) => s.barOffset === 2));
  assert.deepEqual(beatsOf(next, 120, 60), beatsOf([], 120, 60));
});

test('click sem acento e sem modelo não muda nada', () => {
  assert.equal(planBarPhase(clickSong(), { accented: false }, null), null);
});

test('fase já certa não gera troca', () => {
  const model = { downbeat: activation(0, 120, 120, [0.95, 0, 0, 0], 60), fps: 50 };
  assert.equal(planBarPhase(clickSong(), { accented: false }, model), null);
});

test('copiar a fase do click não muda as batidas salvas e respeita BPM diferente', () => {
  const saved = [
    { startTime: 0, endTime: 30, bpm: 120, downbeat: 0 },
    { startTime: 30, endTime: 60, bpm: 120, downbeat: 30 },
  ];
  const reference = [{ startTime: 0, endTime: 60, bpm: 120, downbeat: 1, barOffset: 2 }];
  const { segments } = copyBarPhase(saved, reference, 4);
  assert.deepEqual(segments.map((s) => s.barOffset), [2, 2]);
  assert.deepEqual(segments.map((s) => s.startTime), [0, 30]);
  const other = copyBarPhase(saved, [{ ...reference[0], bpm: 125 }], 4);
  assert.equal(other.changed, false);
});

test('a mistura respeita início, corte e ganho do clipe', () => {
  const rate = 22050;
  const out = new Float32Array(rate * 2);
  // 44100 Hz: o trecho a partir de 0,5 s do arquivo vale 1000; antes dele, 30000
  const ch = new Int16Array(44100 * 2).fill(30000);
  ch.fill(1000, 22050);
  mixIntoRuler(out, rate, { startTime: 1, trimStart: 0.5, playLength: 0.5, gain: 2 }, { channels: [ch, ch], sampleRate: 44100, length: ch.length });
  assert.equal(out[rate - 1], 0);
  assert.ok(Math.abs(out[rate] - (1000 / 32767) * 2) < 1e-5);
  assert.ok(Math.abs(out[Math.round(rate * 1.49)] - (1000 / 32767) * 2) < 1e-5);
  assert.equal(out[Math.round(rate * 1.51)], 0);
});

test('duas faixas somam na mesma régua, em fatias', () => {
  const rate = 22050;
  const a = new Float32Array(rate), b = new Float32Array(rate);
  const ch = new Int16Array(44100).fill(3000);
  const clip = { startTime: 0.25, playLength: 0.5 };
  const audio = { channels: [ch], sampleRate: 44100, length: ch.length };
  mixIntoRuler(a, rate, clip, audio);
  for (let f = 0; f < rate; f += 1000) mixIntoRuler(b, rate, clip, audio, f, f + 1000);
  assert.deepEqual(a, b);
});

test('andamento único guardado em dois trechos decide junto: o compasso não quebra no meio', () => {
  // as duas metades com ativação diferente (a primeira sem apoio, a segunda clara)
  const saved = [
    { startTime: 0, endTime: 30, bpm: 120, downbeat: 0 },
    { startTime: 30, endTime: 60, bpm: 120, downbeat: 30 },
  ];
  const down = new Float32Array(60 * 50);
  down.set(activation(0, 120, 60, [0.26, 0.3, 0.25, 0.33], 30));
  down.set(activation(0, 120, 60, [0.05, 0.9, 0.05, 0.1], 30), 30 * 50);
  const { segments } = alignBarPhase(saved, down, 50, 4);
  assert.deepEqual(segments.map((s) => s.barOffset ?? 0), [1, 1]);
  const bars = segments.map((s) => s.startTime + (s.barOffset ?? 0) * 0.5);
  assert.equal(Math.round((bars[1] - bars[0]) / 0.5) % 4, 0);
});

test('empate do modelo com a posição atual: fica o 1 da leitura do click, em qualquer corte', () => {
  // o começo firma a posição 0 (ou a oposta); no resto, 0 e 2 empatam: o modelo não tem certeza
  const patterns = [
    (k) => (k < 32 ? [0.8, 0.05, 0.3, 0.05][k % 4] : [0.3, 0.05, 0.32, 0.05][k % 4]),
    (k) => (k < 16 ? [0.2, 0.02, 0.8, 0.02][k % 4] : [0.45, 0.03, 0.42, 0.03][k % 4]),
  ];
  const fileBeats = 400;
  for (const levels of patterns) for (const cut of [0, 2, 4, 6]) {
    const down = new Float32Array(Math.ceil(fileBeats * 0.5 * 50));
    for (let k = cut; k < fileBeats; k++) down[Math.round((k - cut) * 0.5 * 50)] = levels(k);
    // grade salva com o 1 na primeira batida da régua, como a importação faz
    const seg = { startTime: 0, endTime: (fileBeats - cut) * 0.5, bpm: 120, downbeat: 0 };
    const res = alignBarPhase([seg], down, 50, 4);
    assert.equal(res.changed, false, `corte ${cut}`);
    assert.equal(res.decisions[0].reason, 'igual');
  }
  // a posição atual fora do empate, com as duas opostas bem acima: vale a que a música firma primeiro
  const levels = (k) => (k < 32 ? [0.8, 0.05, 0.3, 0.05][k % 4] : [0.3, 0.05, 0.32, 0.05][k % 4]);
  const found = new Set();
  for (const cut of [1, 3, 5]) {
    const down = new Float32Array(Math.ceil(fileBeats * 0.5 * 50));
    for (let k = cut; k < fileBeats; k++) down[Math.round((k - cut) * 0.5 * 50)] = levels(k);
    const seg = { startTime: 0, endTime: (fileBeats - cut) * 0.5, bpm: 120, downbeat: 0 };
    const [d] = alignBarPhase([seg], down, 50, 4).decisions;
    assert.equal(d.reason, 'mudou');
    found.add((d.after + cut) % 4);
  }
  assert.deepEqual([...found], [0]);
});

test('acento só em um trecho: o outro trecho fica com o modelo, não com a fase zero do click', () => {
  const saved = [
    { startTime: 0, endTime: 24, bpm: 120, downbeat: 0 },
    { startTime: 24, endTime: 60, bpm: 140, downbeat: 24 + 2 * 60 / 140, barOffset: 2 },
  ];
  const placed = [
    { startTime: 0, endTime: 24, bpm: 120, downbeat: 0, accent: true },
    { startTime: 24, endTime: 60, bpm: 140, downbeat: 24 },
  ];
  const song = clickSong({ tempoSegments: saved, tempoMapSource: 'click', tempoMapSig: '0.000:120.000:0:0|24.000:140.000:2:0' });
  assert.equal(planBarPhase(song, { accented: false, placed }, null), null);
  const down = new Float32Array(60 * 50);
  down.set(activation(24, 140, 84, [0, 0, 0.9, 0], 36).subarray(24 * 50), 24 * 50);
  assert.equal(planBarPhase(song, { accented: false, placed }, { downbeat: down, fps: 50 }), null);
});

test('click tic-tac (dois sons alternados) não diz onde está o 1: fica a fase de sempre, para o modelo conferir', () => {
  for (const high of [0, 1]) {
    const x = renderClick(120, 96, (b) => (b % 2 === high ? { freq: 2600, peak: 0.8 } : { freq: 1400, peak: 0.8 }));
    const read = clickTrackMap(x, SR, 4);
    assert.equal(read.accented, false);
    assert.ok(read.segments.every((s) => !s.accent));
    // a fase é a da leitura de sempre (o 1 num dos sons agudos), sem certeza
    const seg = read.segments[read.segments.length - 1];
    assert.equal((seg.barOffset ?? 0) % 2, high);
  }
});

test('medley no mesmo BPM: a segunda música firma o próprio 1 mesmo com a contagem continuando', () => {
  // A com o 1 na primeira batida; B na mesma reta, com anacruse de um tempo
  const saved = [
    { startTime: 0, endTime: 34, bpm: 120, downbeat: 0 },
    { startTime: 34, endTime: 70, bpm: 120, downbeat: 34 },
  ];
  const down = new Float32Array(70 * 50);
  down.set(activation(0, 120, 64, [0.9, 0, 0, 0], 34));
  down.set(activation(2.5, 120, 64, [0.9, 0, 0, 0], 36), 34 * 50);
  const { segments } = alignBarPhase(saved, down, 50, 4);
  assert.deepEqual(segments.map((s) => s.barOffset ?? 0), [0, 1]);
  assert.deepEqual(beatsOf(segments, 120, 70), beatsOf(saved, 120, 70));
});

test('6/8 com o mesmo som no 1 forte e no 4 mais fraco: o 1 vem do volume', () => {
  const period = 60 / 180;
  for (const skip of [0, 1, 3, 4]) {
    const x = renderClick(180, 96 + skip, (b) => (b % 6 === 0 ? { freq: 2600, peak: 0.9 } : b % 6 === 3 ? { freq: 2600, peak: 0.7 } : { freq: 1400, peak: 0.5 }), skip);
    const read = clickTrackMap(x, SR, 6);
    assert.equal(read.accented, true, `começo no tempo ${skip + 1}`);
    const seg = read.segments[read.segments.length - 1];
    const firstBar = seg.startTime + (seg.barOffset ?? 0) * period;
    const accent = 100 / SR + ((6 - skip) % 6) * period;
    const bars = (firstBar - accent) / (6 * period);
    assert.ok(Math.abs(bars - Math.round(bars)) < 0.01, `começo no tempo ${skip + 1}`);
  }
  // 1 e 4 iguais: o click não diz qual dos dois é o 1
  const same = renderClick(180, 96, (b) => (b % 3 === 0 ? { freq: 2600, peak: 0.8 } : { freq: 1400, peak: 0.5 }));
  assert.equal(clickTrackMap(same, SR, 6).accented, false);
});

test('volume do click mudando no meio da música não apaga o acento do som', () => {
  const cases = [
    [4, 120, (b) => (b % 4 === 0 ? { freq: 2600, peak: 0.8 } : { freq: 1400, peak: 0.5 })],
    [6, 180, (b) => (b % 6 === 0 ? { freq: 2600, peak: 0.9 } : b % 6 === 3 ? { freq: 2600, peak: 0.6 } : { freq: 1400, peak: 0.5 })],
  ];
  for (const [perBar, bpm, sound] of cases) for (const gain of [0.5, 2]) {
    const period = 60 / bpm;
    const x = renderClick(bpm, 192, (b) => { const s = sound(b); return { ...s, peak: s.peak * (b >= 96 ? gain : 1) }; });
    const read = clickTrackMap(x, SR, perBar);
    assert.equal(read.accented, true, `${perBar} tempos, ganho ${gain}`);
    const seg = read.segments[read.segments.length - 1];
    const bars = (seg.startTime + (seg.barOffset ?? 0) * period - 100 / SR) / (perBar * period);
    assert.ok(Math.abs(bars - Math.round(bars)) < 0.01, `${perBar} tempos, ganho ${gain}`);
  }
});

// Medley no mesmo BPM numa reta só (120 BPM): A com 1 na batida 0, pausa de `pause` tempos, B com anacruse
// de 1 tempo. A grade salva foi dividida no meio do click (como faz splitSingleSegment), fora da emenda.
function sameLineMedley(nA, nB, pause, cutBars, levelA = 0.9, levelB = 0.9) {
  const startB = (nA + pause) * 0.5;
  const end = startB + nB * 0.5 + 1;
  const cut = cutBars * 2;
  const saved = [
    { startTime: 0, endTime: cut, bpm: 120, downbeat: 0 },
    { startTime: cut, endTime: end, bpm: 120, downbeat: cut },
  ];
  const down = new Float32Array(Math.ceil(end * 50));
  const onesA = [], onesB = [];
  for (let b = 0; b < nA; b += 4) { onesA.push(b * 0.5); down[Math.round(b * 0.5 * 50)] = levelA; }
  for (let b = 1; b < nB; b += 4) { onesB.push(startB + b * 0.5); down[Math.round((startB + b * 0.5) * 50)] = levelB; }
  const hits = [];
  for (let b = 0; b < nA; b++) hits.push(b * 0.5);
  for (let b = 0; b < nB; b++) hits.push(startB + b * 0.5);
  return { saved, down, onesA, onesB, startB, end, hits, lastA: (nA - 1) * 0.5, lastB: startB + (nB - 1) * 0.5 };
}

/** Os 1 que a grade desenha entre `from` e `to`. */
function barsBetween(segments, from, to) {
  const out = [];
  for (const s of segments) {
    const next = segments.find((q) => q.startTime > s.startTime);
    const limit = next ? next.startTime - 0.125 : s.endTime;
    for (let t = s.startTime + (s.barOffset ?? 0) * 0.5; t <= limit + 1e-9; t += 2) if (t >= from - 1e-6 && t <= to + 1e-6) out.push(Math.round(t * 1000) / 1000);
  }
  return out.sort((a, b) => a - b);
}

test('medley de tamanhos diferentes na mesma reta: a primeira música não perde o 1 no corte do meio', () => {
  // A 96 + B 64: o corte do meio (21 compassos) cai dentro de A
  for (const pause of [8, 4, 9]) {
    const m = sameLineMedley(96, 64, pause, 21);
    const { segments } = alignBarPhase(m.saved, m.down, 50, 4);
    assert.deepEqual(barsBetween(segments, 0, m.lastA), m.onesA, `pausa ${pause}: A`);
    assert.deepEqual(barsBetween(segments, m.startB, m.lastB), m.onesB, `pausa ${pause}: B`);
    assert.deepEqual(beatsOf(segments, 120, m.end), beatsOf(m.saved, 120, m.end));
  }
  // A 32 + B 128: B maior não leva o 1 de A junto
  const big = sameLineMedley(32, 128, 8, 20);
  const { segments } = alignBarPhase(big.saved, big.down, 50, 4);
  assert.deepEqual(barsBetween(segments, 0, big.lastA), big.onesA);
  assert.deepEqual(barsBetween(segments, big.startB, big.lastB), big.onesB);
});

test('medley sem emenda (sem pausa na música): fica como a leitura do click deixou', () => {
  for (const [nA, nB, cut] of [[96, 64, 20], [32, 128, 20], [64, 64, 16]]) {
    const m = sameLineMedley(nA, nB, 0, cut);
    const res = alignBarPhase(m.saved, m.down, 50, 4);
    assert.equal(res.changed, false, `A ${nA} B ${nB}`);
  }
  // A fraco e B firme na mesma reta, sem pausa: o modelo fraco em A não deixa B levar o 1 de A
  const weak = sameLineMedley(64, 64, 0, 16, 0.1, 0.9);
  assert.equal(alignBarPhase(weak.saved, weak.down, 50, 4).changed, false);
});

test('medley com os ataques do click: só divide onde o click para, e a música nova entra no ataque seguinte', () => {
  const m = sameLineMedley(96, 64, 8, 21);
  // click parado na pausa: divide no primeiro ataque de B
  const { segments } = alignBarPhase(m.saved, m.down, 50, 4, undefined, m.hits);
  assert.ok(segments.some((s) => Math.abs(s.startTime - m.startB) < 1e-9), 'trecho novo no primeiro ataque de B');
  assert.deepEqual(barsBetween(segments, 0, m.lastA), m.onesA);
  assert.deepEqual(barsBetween(segments, m.startB, m.lastB), m.onesB);
  // click tocando sem parar (a música parou, o click não): não é emenda, fica a leitura do click
  const steady = [];
  for (let t = 0; t <= m.lastB + 1e-9; t += 0.5) steady.push(t);
  assert.equal(alignBarPhase(m.saved, m.down, 50, 4, undefined, steady).changed, false);
});

test('automação de volume no click não apaga o acento só por volume, nem o do 1 e 3 no mesmo som', () => {
  const kinds = [
    [4, 120, (q) => ({ freq: 1400, peak: [0.9, 0.4, 0.65, 0.4][q] })],
    [4, 120, (q) => (q === 0 ? { freq: 2600, peak: 0.9 } : q === 2 ? { freq: 2600, peak: 0.55 } : { freq: 1400, peak: 0.5 })],
    [6, 180, (q) => ({ freq: 1400, peak: q === 0 ? 0.9 : q === 3 ? 0.65 : 0.4 })],
  ];
  const profiles = [(b) => (b < 48 ? 1 : 0.5), (b) => (b < 48 ? 1 : 2), (b) => Math.min(1, Math.max(0.1, (96 - b) / 28.8))];
  for (const [perBar, bpm, sound] of kinds) profiles.forEach((gain, n) => {
    for (const skip of [0, 1]) {
      const period = 60 / bpm;
      const x = renderClick(bpm, 96 + skip, (b) => { const s = sound(b % perBar); return { ...s, peak: s.peak * gain(b - skip) }; }, skip);
      const read = clickTrackMap(x, SR, perBar);
      assert.equal(read.accented, true, `${perBar} tempos, perfil ${n}, começo ${skip}`);
      const seg = read.segments[read.segments.length - 1];
      const firstOne = 100 / SR + ((perBar - skip) % perBar) * period;
      const bars = (seg.startTime + (seg.barOffset ?? 0) * period - firstOne) / (perBar * period);
      assert.ok(Math.abs(bars - Math.round(bars)) < 0.01, `${perBar} tempos, perfil ${n}, começo ${skip}`);
    }
  });
  // tic-tac com o volume caindo pela metade continua sem dizer onde está o 1
  const tick = renderClick(120, 96, (b) => ({ freq: b % 2 ? 1400 : 2600, peak: 0.8 * (b < 48 ? 1 : 0.5) }));
  assert.equal(clickTrackMap(tick, SR, 4).accented, false);
});

/** Instantes em que a grade do mapa final desenha o 1, até `to`. */
function onesOf(map, perBar, to) {
  const grid = songGrid({ bpm: map.bpm, beatsPerBar: perBar, tempoSegments: map.tempoSegments });
  return gridLines(grid, 0, to, 200).filter((l) => l.kind === 'bar').map((l) => l.time).sort((a, b) => a - b);
}

/** Importação nova sem modelo (versão web, sem banda): leitura, régua e passo final. */
function importNoModel(x, perBar, offset, duration) {
  const read = clickTrackMap(x, SR, perBar);
  const placed = placeClickMap(read.segments, offset, duration, perBar, read.accented !== false);
  const map = finalizeTempoMap(placed, { duration, beatsPerBar: perBar, isClick: true, keepSingle: true, hits: read.hits?.map((t) => t + offset), halfRanges: read.halfRanges?.map(([a, b]) => [a + offset, b + offset]), lineTol: read.lineTol });
  return { read, placed, map };
}

test('acento que se repete no compasso, com o 1 o mais forte: sem modelo o 1 fica no lugar', () => {
  // 1 forte e 2 quase igual, ou 1 forte e 3 médio com um compasso baixo a cada 8: a leitura nova não tem
  // certeza, e a fase fica a de sempre (o 1 no som mais forte)
  const kinds = [
    [4, 120, (q) => [0.9, 0.8, 0.4, 0.4][q], () => 1],
    [3, 100, (q) => [0.9, 0.4, 0.75][q], (b) => (b < 64 ? 1 : 0.5)],
    [4, 120, (q) => [0.9, 0.4, 0.75, 0.4][q], (b) => (Math.floor(b / 4) % 8 === 5 ? 0.3 : 1)],
  ];
  for (const [perBar, bpm, level, gain] of kinds) for (let skip = 0; skip < perBar; skip++) {
    const period = 60 / bpm;
    const x = renderClick(bpm, 128 + skip, (b) => ({ freq: 1400, peak: 0.5 * level(b % perBar) * gain(b - skip) }), skip);
    const duration = x.length / SR;
    const { map } = importNoModel(x, perBar, 0, duration);
    const want = [];
    for (let b = skip; b < 128 + skip; b++) if (b % perBar === 0) want.push(100 / SR + (b - skip) * period);
    const got = onesOf(map, perBar, duration).filter((t) => t > 0.02 && t < 100 / SR + (127.5) * period);
    assert.deepEqual(got.map((t) => t.toFixed(3)), want.filter((t) => t > 0.02).map((t) => t.toFixed(3)), `${perBar} tempos, começo ${skip}`);
  }
});

test('projeto salvo que já guarda o 1: um som diferente do click em outro tempo não troca o 1 salvo', () => {
  const period = 0.5, lead = 100 / SR;
  // som agudo só no tempo 3: a leitura de sempre põe o 1 ali, mas o projeto guarda o 1 no tempo 1
  const x = renderClick(120, 96, (b) => (b % 4 === 2 ? { freq: 2600, peak: 0.8 } : { freq: 1400, peak: 0.8 }));
  const duration = x.length / SR;
  const read = clickTrackMap(x, SR, 4);
  const placed = placeClickMap(read.segments, 0, duration, 4, read.accented !== false);
  const saved = [
    { startTime: 0, endTime: lead, bpm: 120, downbeat: 0 },
    { startTime: lead, endTime: duration, bpm: 120, downbeat: lead },
  ];
  const song = clickSong({ duration, tempoSegments: saved, tempoMapSource: 'click', tempoMapSig: tempoMapSignature(saved) });
  assert.equal(planBarPhase(song, { accented: read.accented, placed }, null), null);
  // projeto de grade uniforme (sem 1 guardado): a fase do acento vale
  const uniform = planBarPhase(clickSong({ duration }), { accented: read.accented, placed }, null);
  assert.ok(uniform);
  const ones = onesOf({ bpm: 120, tempoSegments: uniform }, 4, duration).filter((t) => t > lead + 0.01 && t < 47);
  assert.ok(ones.length > 20);
  for (const t of ones) assert.equal(Math.round((t - lead) / period) % 4, 2);
});

test('dois clipes no mesmo BPM, o segundo fora do compasso: o acento vale com certeza nos dois', () => {
  // as duas leituras trocam o 1 no mesmo lugar da reta: o click inteiro conta como acentuado
  const beats = [];
  for (let b = 0; b < 64; b++) beats.push([b, b % 4 === 0]);
  for (let b = 0; b < 64; b++) beats.push([65 + b, b % 4 === 0]);
  const x = new Float32Array(Math.ceil((130 * 0.5 + 1) * SR));
  for (const [k, one] of beats) {
    const at = Math.round(k * 0.5 * SR), freq = one ? 2600 : 1400;
    for (let i = 0; i < 0.03 * SR; i++) x[at + i] += 0.8 * Math.exp((-i / SR) * 180) * Math.sin((2 * Math.PI * freq * i) / SR);
  }
  const duration = x.length / SR;
  const read = clickTrackMap(x, SR, 4);
  assert.equal(read.accented, true);
  const placed = placeClickMap(read.segments, 0, duration, 4, read.accented);
  const next = planBarPhase(clickSong({ duration }), { accented: read.accented, placed }, null);
  assert.ok(next);
  // todo 1 das duas músicas tem linha de compasso (a troca de fase fica perto da emenda, como na importação)
  const ones = new Set(onesOf({ bpm: 120, tempoSegments: next }, 4, duration).map((t) => t.toFixed(3)));
  const want = beats.filter(([, one]) => one).map(([k]) => (k * 0.5).toFixed(3));
  assert.deepEqual(want.filter((t) => !ones.has(t)), []);
});

test('o 1 achado só pelo som (mesmo volume e mesmo timbre) não mexe nas batidas da grade simples', () => {
  // dois sons com a mesma frequência e o mesmo volume, um com harmônico: o volume e o timbre não dizem nada
  const bpm = 105, period = 60 / bpm, beats = 96;
  const env = (i) => Math.exp((-i / SR) * 180);
  const plainTone = (i) => 0.8 * env(i) * Math.sin((2 * Math.PI * 1400 * i) / SR);
  const richTone = (i) => (0.8 * env(i) * (Math.sin((2 * Math.PI * 1400 * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 2800 * i) / SR))) / 1.1;
  for (const skip of [1, 2, 3]) {
    const x = new Float32Array(Math.ceil((beats * period + 1) * SR));
    for (let b = 0; b < beats; b++) {
      const f = (b + skip) % 4 === 0 ? richTone : plainTone, at = Math.round(b * period * SR);
      for (let i = 0; i < 0.03 * SR; i++) x[at + i] += f(i);
    }
    const duration = x.length / SR;
    const { read, map } = importNoModel(x, 4, 0, duration);
    assert.equal(read.accented, true, `começo ${skip}`);
    // a grade da leitura continua a de sempre: o 1 do som vem marcado à parte
    assert.ok(read.segments.some((s) => s.one !== undefined));
    const want = [];
    for (let b = 0; b < beats; b++) if ((b + skip) % 4 === 0) want.push(b * period);
    const got = onesOf(map, 4, duration).filter((t) => t < (beats - 0.5) * period);
    assert.deepEqual(got.map((t) => t.toFixed(4)), want.map((t) => t.toFixed(4)), `começo ${skip}`);
    const plain = gridBeatTimes({ bpm: map.bpm, beatsPerBar: 4 }, 0, duration);
    const now = gridBeatTimes({ bpm: map.bpm, beatsPerBar: 4, tempoSegments: map.tempoSegments }, 0, duration);
    assert.equal(now.length, plain.length);
    assert.ok(now.every((t, q) => Math.abs(t - plain[q]) < 1e-9), `começo ${skip}: batidas iguais à grade simples`);
  }
});

test('fase do click que muda dentro de um trecho salvo divide o trecho, sem mexer nas batidas', () => {
  const saved = [{ startTime: 0, endTime: 64, bpm: 120, downbeat: 0 }];
  const reference = [
    { startTime: 0, endTime: 32.5, bpm: 120, downbeat: 0 },
    { startTime: 32.5, endTime: 64, bpm: 120, downbeat: 32.5 },
  ];
  const { segments, changed } = copyBarPhase(saved, reference, 4);
  assert.equal(changed, true);
  assert.deepEqual(segments.map((s) => [s.startTime, s.barOffset ?? 0]), [[0, 0], [32.5, 0]]);
  assert.deepEqual(beatsOf(segments, 120, 64), beatsOf([], 120, 64));
});
