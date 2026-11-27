// VS sem arquivo de click: a IA ouvia a percussão (bloco, cowbell, aro) como "Wood block" ou
// "Plop", as mesmas classes do click, e mandava o áudio para a faixa Click ("Click 1", selo IA).
// Medido no "FIQUEI SABENDO": PERCS VS.wav foi para o Click. Agora o som só vai para o Click
// quando é metrônomo de verdade; na dúvida, Percussões.
//
// Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { routeByYamnetScores } from '../src/lib/yamnetCategories.ts';
import { looksLikeMetronome, metronomeStats } from '../src/lib/metronomeCheck.ts';

const parse = (txt) => [...txt.matchAll(/(.+?) (\d+)%(?:, |$)/g)].map((m) => ({ className: m[1], probability: Number(m[2]) / 100 }));
const where = (txt) => { const r = routeByYamnetScores(parse(txt)); return r ? `${r.target}/${r.childName}` : null; };

test('percussão tocada que a IA ouve como bloco de madeira vai para Percussões, não para o Click', () => {
  // as 3 notas reais do PERCS VS.wav do "FIQUEI SABENDO"
  assert.equal(where('Music 84%, Percussion 33%, Wood block 25%, Musical instrument 20%, Drum 15%, Drum kit 6%'), 'track-percussoes/Percussão');
  assert.equal(where('Music 79%, Wood block 36%, Percussion 32%, Musical instrument 22%, Drum 11%, Drum kit 2%'), 'track-percussoes/Percussão');
  // bateria ou percussão mais forte que o som de click, mesmo sem "Music"
  assert.equal(where('Percussion 40%, Plop 20%, Drum 18%, Music 10%'), 'track-percussoes/Percussão');
});

test('o click de verdade continua indo para o Click', () => {
  assert.equal(where('Plop 67%, Wood block 20%, Tick 12%, Clock 3%, Musical instrument 3%'), 'track-click/Click');
  assert.equal(where('Wood block 29%, Plop 11%, Music 8%, Musical instrument 8%, Percussion 8%'), 'track-click/Click');
  assert.equal(where('Silence 45%, Tick 23%, Sound effect 14%, Ping 12%, Clock 11%'), 'track-click/Click');
});

// ---------------------------------------------------------------- áudio sintético

const SR = 16000;
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const hit = Float32Array.from({ length: Math.round(0.03 * SR) }, (_, i) => Math.sin(2 * Math.PI * 1500 * i / SR) * Math.exp(-i / (0.006 * SR)));
const source = (out) => ({ length: out.length, sampleRate: SR, channels: 1, sample: (_c, i) => out[i] ?? 0 });
function place(times, gains, secs) {
  const out = new Float32Array(secs * SR);
  times.forEach((t, k) => { const at = Math.round(t * SR); for (let i = 0; i < hit.length && at + i < out.length; i++) out[at + i] += hit[i] * gains[k]; });
  return source(out);
}
function metronome(plan, accent = 0.5) {
  const times = []; let t = 0.5;
  for (const [bpm, secs, pause = 0] of plan) { const end = t + secs; while (t < end) { times.push(t); t += 60 / bpm; } t += pause; }
  return place(times, times.map((_, k) => (k % 4 === 0 ? 1 : accent)), Math.ceil(t) + 1);
}

test('metrônomo: 70, 120 e 160 BPM, com acento, sem acento, medley com breque', () => {
  assert.equal(looksLikeMetronome(metronome([[70, 60]])), true);
  assert.equal(looksLikeMetronome(metronome([[120, 60]])), true);
  assert.equal(looksLikeMetronome(metronome([[160, 60]], 1)), true);
  assert.equal(looksLikeMetronome(metronome([[90, 30, 4], [140, 30, 3], [100, 30]])), true);
});

test('percussão tocada não é metrônomo, nem quando é regular', () => {
  // ritmo sincopado (forró: 1, 1a, e, a), força de músico
  const sync = []; for (let bar = 0; bar < 40; bar++) for (const off of [0, 0.375, 0.5, 0.875]) sync.push(0.5 + bar * 1 + off * 0.5);
  assert.equal(looksLikeMetronome(place(sync, sync.map(() => 0.5 + rnd() * 0.5), 45)), false);
  // semicolcheia certinha (balde, shaker), mas cada toque com uma força
  const steady = Array.from({ length: 480 }, (_, k) => 0.5 + k * 0.125);
  assert.equal(looksLikeMetronome(place(steady, steady.map(() => 0.4 + rnd() * 0.6), 62)), false);
  // pouco áudio não decide
  assert.equal(looksLikeMetronome(metronome([[120, 3]])), false);
});

// ---------------------------------------------------------------- VS reais do Mac (se existirem)

const FIQUEI = '/Users/jonatha/Downloads/FIQUEI SABENDO midi file ';
const ESQUECA = '/Users/jonatha/Downloads/VS PROFISSIONAL - ESQUECA-ME SE FOR CAPAZ - MARILIA MENDONCA';
function readWav(p) {
  const b = readFileSync(p); let o = 12, fmt, data;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') { data = { off: o + 8, len: Math.min(sz, b.length - o - 8) }; break; }
    o += 8 + sz + (sz & 1);
  }
  const bps = fmt.bits / 8;
  return {
    length: Math.floor(data.len / (bps * fmt.ch)), sampleRate: fmt.sr, channels: fmt.ch,
    sample: (c, i) => { const q = data.off + (i * fmt.ch + c) * bps; return bps === 3 ? b.readIntLE(q, 3) / 8388608 : b.readInt16LE(q) / 32768; },
  };
}
function readMp3(p) {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'], { maxBuffer: 1 << 30 });
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return { length: f.length / 2, sampleRate: 44100, channels: 2, sample: (c, i) => f[i * 2 + c] ?? 0 };
}
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('FIQUEI SABENDO: nenhuma percussão é metrônomo', { skip: !existsSync(FIQUEI) && 'VS não está neste Mac' }, () => {
  for (const n of ['PERCS', 'PERCS ELETRO', 'BALDE', 'DRUM']) {
    const s = readWav(`${FIQUEI}/FIQUEI SABENDO - ${n} VS.wav`);
    assert.equal(looksLikeMetronome(s), false, `${n}: ${JSON.stringify(metronomeStats(s))}`);
  }
});

test('ESQUECA-ME: o CLICK 122 é metrônomo; congas, shaker e torpedo não', { skip: (!existsSync(ESQUECA) || !hasFfmpeg) && 'VS ou ffmpeg não está neste Mac' }, () => {
  assert.equal(looksLikeMetronome(readMp3(`${ESQUECA}/CLICK 122 - CLUBE DO VS.mp3`)), true);
  for (const n of ['CONGAS', 'SHAKER', 'TORPEDO']) {
    const s = readMp3(`${ESQUECA}/${n} - CLUBE DO VS.mp3`);
    assert.equal(looksLikeMetronome(s), false, `${n}: ${JSON.stringify(metronomeStats(s))}`);
  }
});

test('a votação da IA confere o metrônomo antes de mandar para o Click', () => {
  const src = readFileSync(new URL('../src/lib/aiRouter.ts', import.meta.url), 'utf8');
  assert.match(src, /target === 'track-click' && !looksLikeMetronome\(src\)\) return \{ \.\.\.best, \.\.\.PERCUSSION_ROUTE \}/);
});
