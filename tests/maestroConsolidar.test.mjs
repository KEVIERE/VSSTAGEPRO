// Consolidar o Maestro IA: as falas viram um áudio só na faixa Maestro, no mesmo tempo, com o
// ganho e os fades de cada uma; desfazer volta tudo (um passo só).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// mixParts é pura, mas o arquivo importa o programa: testa a conta copiando só a função
const src = read('lib/maestroConsolidate.ts');
const body = src.slice(src.indexOf('export function mixParts'), src.indexOf('/** Áudio tocável do clipe'));
const js = body
  .replace('export function mixParts(parts: MixPart[], from: number, totalFrames: number, rate: number, channels: number): Int16Array[]', 'function mixParts(parts, from, totalFrames, rate, channels)')
  .replace(/\?\? 'linear'/g, '')
  .replace(/\(p\.fadeCurveIn\s*\)/g, '(p.fadeCurveIn)')
  .replace(/: Int16Array\[\]/g, '');
const mixParts = new Function('evaluateFadeCurve', `${js}; return mixParts;`)(() => 1);

const mono = (rate, values) => ({ sampleRate: rate, length: values.length, channels: [Int16Array.from(values)] });

test('cada fala cai no ponto certo da timeline, com o silêncio entre elas', () => {
  const out = mixParts([
    { startTime: 1, audio: mono(10, [100, 100]), gain: 1, fadeIn: 0, fadeOut: 0 },
    { startTime: 2, audio: mono(10, [50]), gain: 2, fadeIn: 0, fadeOut: 0 },
  ], 1, 12, 10, 1);
  assert.deepEqual(Array.from(out[0]), [100, 100, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0]);
});

test('fala em outra taxa é convertida (mesma duração) e a soma não passa do teto', () => {
  const out = mixParts([{ startTime: 0, audio: mono(5, [1000, 1000]), gain: 1, fadeIn: 0, fadeOut: 0 }], 0, 4, 10, 1);
  assert.equal(out[0].length, 4);
  assert.deepEqual(Array.from(out[0]), [1000, 1000, 1000, 1000]);
  const loud = mixParts([
    { startTime: 0, audio: mono(10, [30000]), gain: 1, fadeIn: 0, fadeOut: 0 },
    { startTime: 0, audio: mono(10, [30000]), gain: 1, fadeIn: 0, fadeOut: 0 },
  ], 0, 1, 10, 1);
  assert.equal(loud[0][0], 32767);
});

test('consolidar: vai para a faixa Maestro, tira falas e marcações num passo só e prepara de novo', () => {
  // vai para a faixa Maestro, com o volume da linha Maestro IA no ganho e a mesma entrada seca
  assert.match(src, /trackId: MAESTRO_TRACK_ID,/);
  assert.match(src, /export const MAESTRO_TRACK_ID = 'track-maestro';/);
  assert.match(src, /gain: iaTrack \? faderToGain\(iaTrack\.volume\) : 1,/);
  assert.match(read('lib/audioEngine.ts'), /track\.id === 'track-maestro' \|\| track\.id === 'track-click'/);
  // pausada pode consolidar; só tocando bloqueia
  assert.match(src, /if \(store\.transport\.isPlaying && store\.transport\.currentSongId === songId\) return 'tocando';/);
  assert.match(src, /songs: s\.songs\.map\(\(sg\) => \(sg\.id === songId \? \{ \.\.\.sg, narrations: \[\] \} : sg\)\),/);
  assert.match(src, /audioEngine\.invalidatePrepared\(songId\);/);
  // falas mudas não entram; com solo, só as em solo
  assert.match(src, /const sounding = iaClips\.filter\(\(c\) => \(anySolo \? c\.solo : !c\.mute\)\)/);
  // mudou durante a montagem ou começou a tocar: não troca nada
  assert.match(src, /if \(!sameClips\) return 'mudou';/);
  const timeline = read('components/TimelinePanel.tsx');
  assert.match(timeline, /aria-label="Consolidar as falas do Maestro IA num áudio só"/);
});
