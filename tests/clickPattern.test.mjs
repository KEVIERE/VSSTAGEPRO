// O click do VS por IA sai igual ao do "Recriar metrônomo": mesmo som, mesmo nível e cada
// batida em cima da linha da grade. Usa a amostra real do metrônomo do VS Stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  alignHitsToGrid, clickBufferLength, clickGridTimes, clickHits, clickOnsetIndex, nearestGridBeat, placeClickSamples,
  playLength, remakeClickTimes,
} from '../src/lib/clickEdit.ts';
import { gridLines, songGrid } from '../src/lib/grid.ts';
import { integratedLoudness } from '../src/lib/loudness.ts';
import { USER_CLICK_SAMPLE_B64 } from '../src/lib/clickSampleData.ts';

// Amostra do metrônomo (WAV 24 bits). No programa ela é decodificada na taxa do aparelho; aqui a
// 48 kHz ela é reamostrada por interpolação, o que basta: os dois caminhos usam a mesma amostra.
function readSample() {
  const buf = Buffer.from(USER_CLICK_SAMPLE_B64, 'base64');
  let p = 12; let fmt; let data;
  while (p < buf.length) {
    const id = buf.toString('ascii', p, p + 4); const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') { data = buf.subarray(p + 8, p + 8 + size); break; }
    p += 8 + size + (size & 1);
  }
  const bytes = fmt.bits / 8; const step = bytes * fmt.ch; const n = data.length / step;
  const chs = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) chs[c][i] = data.readIntLE(i * step + c * bytes, bytes) / 2 ** (fmt.bits - 1);
  return { sr: fmt.sr, chs };
}
const SAMPLE = readSample();
function sampleAt(sr) {
  const resample = (ch) => {
    if (sr === SAMPLE.sr) return ch;
    const n = Math.round(ch.length * sr / SAMPLE.sr); const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * SAMPLE.sr / sr; const a = Math.floor(x); const f = x - a;
      out[i] = (ch[a] ?? 0) * (1 - f) + (ch[a + 1] ?? 0) * f;
    }
    return out;
  };
  const sL = resample(SAMPLE.chs[0]);
  return { sL, sR: SAMPLE.chs[1] ? resample(SAMPLE.chs[1]) : sL };
}

// O que gridClickBuffer faz no VS por IA (sem o AudioBuffer do navegador).
function vsPorIa(song, seconds, sr, s) {
  const length = clickBufferLength(seconds, sr);
  const [L, R] = placeClickSamples(clickGridTimes(song, seconds), length, sr, s.sL, s.sR);
  return { L, R, clip: { startTime: 0, duration: length / sr, trimStart: 0, trimEnd: 0 } };
}

// O que remakeMetronome faz com um clipe de click (sem o AudioBuffer do navegador).
function recriar({ L, R, clip }, song, sr, s) {
  const playStart = Math.round((clip.trimStart ?? 0) * sr);
  const playLen = Math.min(L.length - playStart, Math.round(playLength(clip) * sr));
  const times = remakeClickTimes([L, R], playStart, playLen, sr, clip.startTime, song);
  const [outL, outR] = placeClickSamples(times, clickBufferLength(playLen / sr, sr), sr, s.sL, s.sR);
  return { L: outL, R: outR, times };
}

function maxDiff(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  return d;
}
function peak(...chs) {
  let p = 0;
  for (const ch of chs) for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
}

const SONGS = [
  { bpm: 120, beatsPerBar: 4 },
  { bpm: 123.37, beatsPerBar: 4 },
  { bpm: 87.5, beatsPerBar: 3 },
  // medley: muda de andamento no meio, cada trecho recomeça a contar na mudança
  { bpm: 120, beatsPerBar: 4, tempoSegments: [{ startTime: 0, endTime: 20, bpm: 120 }, { startTime: 20, endTime: 60.25, bpm: 95 }] },
];
const SECONDS = 60.25; // como no VS por IA: 1 compasso de entrada + música, sem ser múltiplo do tempo
const label = (song, sr) => `${song.tempoSegments ? 'medley ' : ''}${song.bpm} BPM ${song.beatsPerBar}/4 a ${sr} Hz`;

test('VS por IA e Recriar metrônomo: mesmo som e mesmo nível, amostra por amostra', () => {
  for (const sr of [44100, 48000]) {
    const s = sampleAt(sr);
    for (const song of SONGS) {
      const ia = vsPorIa(song, SECONDS, sr, s);
      const re = recriar(ia, song, sr, s);
      const name = label(song, sr);
      assert.deepEqual(re.times, clickGridTimes(song, SECONDS), `${name}: batidas`);
      assert.equal(re.L.length, ia.L.length, `${name}: tamanho`);
      assert.equal(maxDiff(ia.L, re.L), 0, `${name}: canal esquerdo`);
      assert.equal(maxDiff(ia.R, re.R), 0, `${name}: canal direito`);
      assert.equal(peak(ia.L, ia.R), peak(re.L, re.R), `${name}: pico`);
      assert.equal(integratedLoudness([ia.L, ia.R], sr), integratedLoudness([re.L, re.R], sr), `${name}: loudness`);
      // nível do metrônomo padrão: o pico do click é o pico da amostra (sem ganho a mais)
      assert.ok(Math.abs(peak(ia.L, ia.R) - peak(s.sL, s.sR)) < 1e-6, `${name}: pico da amostra`);
    }
  }
});

test('VS por IA: o começo do som de cada batida cai na linha da grade e a 1ª entra inteira no 0', () => {
  for (const sr of [44100, 48000]) {
    const s = sampleAt(sr);
    const limit = peak(s.sL) * 0.01; // mesma regra de clickOnsetIndex (-40 dB do pico)
    for (const song of SONGS) {
      const ia = vsPorIa(song, SECONDS, sr, s);
      const name = label(song, sr);
      const times = clickGridTimes(song, SECONDS);
      for (const t of times) {
        if (t <= 0) continue;
        const line = Math.round(t * sr);
        let start = -1;
        for (let i = line - Math.round(0.01 * sr); i < line + Math.round(0.01 * sr); i++) {
          if (Math.abs(ia.L[i]) >= limit) { start = i; break; }
        }
        assert.ok(Math.abs(start - line) <= 1, `${name}: batida em ${t.toFixed(3)} s começa ${start - line} amostras fora da linha`);
      }
      // primeira batida: a amostra inteira desde o 0, sem cortar o ataque
      const onset = clickOnsetIndex(s.sL);
      assert.ok(onset > 0);
      for (let i = 0; i < Math.round(0.4 * sr); i++) assert.equal(ia.L[i], s.sL[i], `${name}: 1ª batida, amostra ${i}`);
    }
  }
});

test('as batidas do click do VS por IA são as linhas de tempo e compasso da timeline', () => {
  for (const song of SONGS) {
    const times = clickGridTimes(song, SECONDS);
    // zoom em que a timeline desenha uma linha por tempo nos dois andamentos (12 a 48 px por tempo)
    const lines = gridLines(songGrid(song), 0, SECONDS, 40).filter((l) => l.kind !== 'sub').map((l) => l.time);
    assert.equal(times.length, lines.length, label(song, '-'));
    times.forEach((t, i) => assert.ok(Math.abs(t - lines[i]) < 1e-9, `${label(song, '-')}: batida ${i}`));
    times.forEach((t) => assert.ok(Math.abs(t - nearestGridBeat(song, t)) < 1e-9));
    assert.equal(times[0], 0);
    assert.ok(times[times.length - 1] < SECONDS);
  }
});

test('Recriar metrônomo continua dando o mesmo resultado de antes da mudança', () => {
  // cópias do código antigo de generateClickAt e da leitura das batidas do remakeMetronome
  const oldClickAt = (times, seconds, sr, sL, sR) => {
    const length = Math.max(1, Math.ceil(Math.max(0.05, seconds) * sr));
    const L = new Float32Array(length); const R = new Float32Array(length);
    const onset = clickOnsetIndex(sL);
    for (const t of times) {
      const start = Math.max(0, Math.round(t * sr) - onset);
      for (let i = 0; i < sL.length; i++) { const dest = start + i; if (dest >= length) break; L[dest] += sL[i]; R[dest] += sR[i]; }
    }
    return { L, R };
  };
  const oldTimes = (channels, playStart, playLen, sr, clipStart, song) => {
    const data = new Float32Array(playLen);
    for (const ch of channels) for (let i = 0; i < playLen; i++) { const v = ch[playStart + i]; if (Math.abs(v) > Math.abs(data[i])) data[i] = v; }
    const hits = clickHits(data, sr);
    const onTimeline = hits.map((h) => clipStart + h / sr);
    return alignHitsToGrid(onTimeline, (t) => nearestGridBeat(song, t)).map((t) => t - clipStart);
  };
  const sr = 48000;
  const s = sampleAt(sr);
  // batidas fora da grade, uma colada no começo (0,5 ms) e uma perto do fim
  const odd = [0, 0.0005, 0.7, 1.2345, 2.01, 3.9999];
  const [L, R] = placeClickSamples(odd, clickBufferLength(4, sr), sr, s.sL, s.sR);
  const old = oldClickAt(odd, 4, sr, s.sL, s.sR);
  assert.equal(L.length, old.L.length);
  assert.equal(maxDiff(L, old.L), 0);
  assert.equal(maxDiff(R, old.R), 0);

  // click antigo de outro programa: 100 BPM, 6 ms adiantado, num clipe que começa em 2 s e
  // tem 0,3 s cortado no começo
  const song = { bpm: 100, beatsPerBar: 4 };
  const early = Array.from({ length: 40 }, (_, k) => 0.3 + k * 0.6 - 0.006);
  const ref = oldClickAt(early, 25, sr, s.sL, s.sR);
  const playStart = Math.round(0.3 * sr);
  const playLen = Math.round(24 * sr);
  assert.deepEqual(
    remakeClickTimes([ref.L, ref.R], playStart, playLen, sr, 2, song),
    oldTimes([ref.L, ref.R], playStart, playLen, sr, 2, song),
  );
});

test('VS por IA antigo (click alinhado pelo pico, ~6 ms adiantado): o Recriar põe na grade', () => {
  const sr = 48000;
  const s = sampleAt(sr);
  const song = { bpm: 120, beatsPerBar: 4 };
  const length = clickBufferLength(SECONDS, sr);
  const L = new Float32Array(length); const R = new Float32Array(length);
  const peakOffset = Math.round(0.0075 * sr); // conta do generateClickTrack antigo
  for (const t of clickGridTimes(song, SECONDS)) {
    const target = Math.round(t * sr);
    const start = target <= 0 ? 0 : Math.max(0, target - peakOffset);
    for (let i = 0; i < s.sL.length && start + i < length; i++) { L[start + i] += s.sL[i]; R[start + i] += s.sR[i]; }
  }
  const re = recriar({ L, R, clip: { startTime: 0, duration: length / sr, trimStart: 0, trimEnd: 0 } }, song, sr, s);
  const grid = clickGridTimes(song, SECONDS);
  assert.equal(re.times.length, grid.length);
  // as batidas adiantadas vão para a linha da grade
  re.times.slice(1).forEach((t, i) => assert.equal(t, grid[i + 1], `batida ${i + 1}`));
  // a 1ª já estava inteira no 0: o Recriar acha o começo do som dela (~1,5 ms) e põe o som novo
  // no mesmo lugar. O resultado soa igual ao click do VS por IA de agora.
  const ia = vsPorIa(song, SECONDS, sr, s);
  const firstEnd = Math.round(0.4 * sr);
  assert.equal(maxDiff(ia.L.subarray(firstEnd), re.L.subarray(firstEnd)), 0, 'depois da 1ª batida');
  assert.ok(maxDiff(ia.L.subarray(0, firstEnd), re.L.subarray(0, firstEnd)) < 0.02, '1ª batida');
});

test('VS por IA e Recriar metrônomo passam pelo mesmo código', () => {
  const read = (f) => fs.readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8');
  const stem = read('stemSeparator.ts');
  assert.match(stem, /from '@\/lib\/clickClip'/);
  assert.match(stem, /gridClickBuffer\(/);
  assert.match(stem, /makeClickClip\(song, clickBuffer, 0\)/);
  assert.doesNotMatch(stem, /generateClickTrack|Click Metrônomo|parentTrackId: 'track-click'/);
  assert.doesNotMatch(read('clickGenerator.ts'), /generateClickTrack/);
  const tools = read('clickTools.ts');
  assert.match(tools, /import \{ makeClickClip \} from '@\/lib\/clickClip'/);
  assert.doesNotMatch(tools, /function makeClickClip/);
  const clip = read('clickClip.ts');
  assert.match(clip, /generateClickAt\(clickGridTimes\(song, durationSeconds\), durationSeconds, deviceSampleRate\(\)\)/);
});
