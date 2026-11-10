// Masterização por IA: medidas de engenharia antes e depois (loudness, pico real, faixa
// dinâmica, equilíbrio tonal, estéreo) numa música sintética, sem arquivo de música no repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterChannels, MASTER_CEILING_DBTP, REFERENCE_TONAL, tonalDistance } from '../src/lib/mastering.ts';
import { measureAudio } from '../src/lib/masterAnalysis.ts';
import { truePeakPrecise } from '../src/lib/masterDsp.ts';
import { integratedLoudness, gainToDb } from '../src/lib/loudness.ts';
import { synthMix, synthGuide } from './fixtures/synthMusic.mjs';

const SR = 48000;
const copy = (ch) => ch.map((c) => Float32Array.from(c));
const tp = (ch) => gainToDb(truePeakPrecise(ch));
const finite = (ch) => ch.every((c) => c.every((v) => Number.isFinite(v)));
const mix = synthMix({ seconds: 12 });

test('mixagem sem master (-16 LUFS, PLR 17): sai no alvo Equilibrado com pico real ≤ -1 dBTP', () => {
  const before = measureAudio(mix, SR);
  const { channels, report } = masterChannels(mix, SR);
  const after = measureAudio(channels, SR);
  assert.ok(finite(channels));
  assert.ok(tp(channels) <= MASTER_CEILING_DBTP + 0.005, `pico ${tp(channels).toFixed(2)} dBTP`);
  assert.equal(after.overs, 0);
  // -10 LUFS; música muito transiente pode parar antes, mas nunca longe e sempre avisando
  assert.ok(after.lufs <= -9.9 && after.lufs >= -11, `${after.lufs.toFixed(2)} LUFS`);
  if (after.lufs < -10.3) assert.ok(report.targetCapped && report.notes.some((n) => n.includes('esmagaria')));
  assert.ok(Math.abs(report.lufsAfter - integratedLoudness(channels, SR)) < 0.1, 'relatório confere com a medida');
  // ainda tem soco: PLR na faixa das masters comerciais (7 a 11 dB)
  assert.ok(after.plr >= 7 && after.plr <= 11.5, `PLR ${after.plr.toFixed(1)}`);
  assert.ok(after.lra >= before.lra * 0.4, `LRA ${before.lra.toFixed(1)} -> ${after.lra.toFixed(1)}`);
  // timbre mais perto das masters de referência
  assert.ok(report.tonalDistanceAfter < report.tonalDistanceBefore, `${report.tonalDistanceBefore.toFixed(2)} -> ${report.tonalDistanceAfter.toFixed(2)} dB`);
});

test('não mexe nos arrays recebidos (a não ser com inPlace)', () => {
  const ch = copy(mix);
  masterChannels(ch, SR);
  assert.equal(ch[0][1000], mix[0][1000]);
});

test('perfis: Streaming crava -14 LUFS; Show sai mais alto que Equilibrado', () => {
  const s = masterChannels(mix, SR, { profile: 'streaming' });
  assert.ok(Math.abs(s.report.lufsAfter - -14) <= 0.2, `${s.report.lufsAfter.toFixed(2)}`);
  assert.ok(tp(s.channels) <= MASTER_CEILING_DBTP + 0.005);
  const e = masterChannels(mix, SR, { profile: 'equilibrado' });
  const sh = masterChannels(mix, SR, { profile: 'show' });
  assert.ok(sh.report.lufsAfter >= e.report.lufsAfter + 0.3, `${e.report.lufsAfter.toFixed(2)} vs ${sh.report.lufsAfter.toFixed(2)}`);
  assert.ok(tp(sh.channels) <= MASTER_CEILING_DBTP + 0.005);
});

test('mix abafada: a IA reforça os agudos e chega mais perto da referência', () => {
  const dull = synthMix({ seconds: 12, dull: true });
  const { report } = masterChannels(dull, SR);
  const boost = report.eq.filter((b) => b.freq >= 2500 && b.gainDb >= 2);
  assert.ok(boost.length > 0, JSON.stringify(report.eq));
  assert.ok(report.tonalDistanceAfter <= report.tonalDistanceBefore * 0.75, `${report.tonalDistanceBefore.toFixed(2)} -> ${report.tonalDistanceAfter.toFixed(2)}`);
});

test('mix embolada em 250 Hz: o EQ tira mais nessa região do que na mix normal', () => {
  const gainNear = (eq, lo, hi) => eq.filter((b) => b.freq >= lo && b.freq <= hi).reduce((s, b) => s + b.gainDb, 0);
  const normal = masterChannels(mix, SR).report.eq;
  const boomy = masterChannels(synthMix({ seconds: 12, boomy: true }), SR).report.eq;
  assert.ok(gainNear(boomy, 200, 450) <= gainNear(normal, 200, 450) - 1.5, `${gainNear(normal, 200, 450)} vs ${gainNear(boomy, 200, 450)}`);
});

test('grave aberto no estéreo: fica no centro (PA em mono não perde o baixo)', () => {
  const wide = synthMix({ seconds: 12, bassSide: 0.8 });
  const before = measureAudio(wide, SR);
  const { channels, report } = masterChannels(wide, SR);
  const after = measureAudio(channels, SR);
  assert.ok(report.monoBassHz);
  assert.ok(after.lowSideToMidDb <= before.lowSideToMidDb - 8, `${before.lowSideToMidDb.toFixed(1)} -> ${after.lowSideToMidDb.toFixed(1)} dB`);
});

test('música já masterizada: reconhece, não achata e quase não perde volume', () => {
  const once = masterChannels(mix, SR).channels;
  const a = measureAudio(once, SR);
  const { channels, report } = masterChannels(once, SR);
  const b = measureAudio(channels, SR);
  assert.ok(report.notes.some((n) => n.includes('já veio masterizada')), report.notes.join(' | '));
  assert.ok(b.lufs >= a.lufs - 0.8, `${a.lufs.toFixed(2)} -> ${b.lufs.toFixed(2)}`);
  assert.ok(b.lra >= a.lra - 0.6, `LRA ${a.lra.toFixed(2)} -> ${b.lra.toFixed(2)}`);
  assert.ok(tp(channels) <= MASTER_CEILING_DBTP + 0.005);
});

test('arquivo LR (guia/click à esquerda, música à direita): masteriza só a música, sem vazar', () => {
  const music = synthMix({ seconds: 12 })[0];
  const guide = synthGuide(music.length, SR);
  const lr = [Float32Array.from(guide), Float32Array.from(music)];
  const { channels, report } = masterChannels(lr, SR);
  assert.ok(report.lr);
  const gBefore = integratedLoudness([guide], SR), gAfter = integratedLoudness([channels[0]], SR);
  assert.ok(Math.abs(gAfter - gBefore) <= 0.6, `guia ${gBefore.toFixed(2)} -> ${gAfter.toFixed(2)}`);
  assert.ok(integratedLoudness([channels[1]], SR) > integratedLoudness([music], SR) + 3, 'a música subiu');
  assert.ok(Math.abs(measureAudio(channels, SR).correlation) < 0.1, 'um lado não vazou no outro');
  assert.ok(tp(channels) <= MASTER_CEILING_DBTP + 0.005);
});

test('stem e voz mantêm o volume (equilíbrio do VS) e seguram o pico', () => {
  for (const options of [{ role: 'instrument', instrument: 'baixo' }, { role: 'instrument', instrument: 'bateria' }, { role: 'voice' }]) {
    const stem = synthMix({ seconds: 8, lufs: -18, seed: 3 });
    const { channels, report } = masterChannels(stem, SR, options);
    assert.ok(Math.abs(report.lufsAfter - report.lufsBefore) <= 0.3, `${options.role}: ${report.lufsBefore.toFixed(2)} -> ${report.lufsAfter.toFixed(2)}`);
    assert.ok(tp(channels) <= MASTER_CEILING_DBTP + 0.005);
    assert.ok(finite(channels));
  }
});

test('stem com perfil escolhido vai ao volume da master', () => {
  const stem = synthMix({ seconds: 8, lufs: -20, seed: 4 });
  const { report, channels } = masterChannels(stem, SR, { role: 'instrument', instrument: 'violao', profile: 'equilibrado', forceProfile: true });
  assert.ok(report.lufsAfter >= -11 && report.lufsAfter <= -9.9, `${report.lufsAfter.toFixed(2)}`);
  assert.ok(tp(channels) <= MASTER_CEILING_DBTP + 0.005);
});

test('casos de borda: silêncio, clipe curtíssimo e mono', () => {
  const z = [new Float32Array(SR), new Float32Array(SR)];
  const s = masterChannels(z, SR);
  assert.equal(Math.max(...s.channels[0]), 0);
  assert.equal(integratedLoudness(s.channels, SR), -Infinity);
  const short = synthMix({ seconds: 0.3 }).map((c) => c.map((v) => v * 4));
  const r = masterChannels(short, SR);
  assert.ok(finite(r.channels) && tp(r.channels) <= MASTER_CEILING_DBTP + 0.005);
  const mono = [mix[0]];
  const m = masterChannels(mono, SR);
  assert.ok(finite(m.channels) && tp(m.channels) <= MASTER_CEILING_DBTP + 0.005);
  assert.ok(m.report.lufsAfter > m.report.lufsBefore + 3);
});

test('distância tonal: a própria referência está a 0 dB dela, com ou sem deslocamento de nível', () => {
  assert.ok(tonalDistance(REFERENCE_TONAL) < 1e-9);
  assert.ok(tonalDistance(REFERENCE_TONAL.map((v) => v + 3)) < 1e-9);
});
