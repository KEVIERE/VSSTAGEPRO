// Saída do Master: escolhe mono ou par igual aos canais, nunca fica mudo se a placa não tiver a
// saída, nunca mistura com o timecode, e projeto antigo continua na 1/2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masterReservedOutputs, normalizeMasterOutput, resolveMasterOutput } from '../src/lib/outputRoute.ts';
import { masterHitsTimecode, masterOutputOptions, masterSilenced, outputOptions, usedOutputs, TIMECODE_TRACK_ID } from '../src/lib/timecode.ts';
import { routeByName } from '../src/lib/nameRouter.ts';
import { directOutFaderGain } from '../src/lib/faderScale.ts';

const base = { magic: false, outputCount: 32, interfaceMissing: false };
const track = (id, outputChannel, outputStereo = false, parentId = null) => ({ id, outputChannel, outputStereo, parentId });

test('projeto antigo ou valor inválido fica na 1/2', () => {
  for (const [c, s] of [[undefined, undefined], [0, true], [-1, false], [1.5, true], ['3', true], [4, true]]) {
    assert.deepEqual(normalizeMasterOutput(c, s), { channel: 1, stereo: true });
  }
  assert.deepEqual(normalizeMasterOutput(31, true), { channel: 31, stereo: true });
  assert.deepEqual(normalizeMasterOutput(4, false), { channel: 4, stereo: false });
});

test('sai no par ou na saída mono escolhida, inclusive 31/32', () => {
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 31, stereo: true }), { channel: 31, stereo: true });
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 7, stereo: false }), { channel: 7, stereo: false });
});

test('placa menor ou desconectada: volta para 1/2 e o show não fica mudo', () => {
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 31, stereo: true, outputCount: 8 }), { channel: 1, stereo: true });
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 7, stereo: true, outputCount: 7 }), { channel: 1, stereo: true });
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 3, stereo: true, interfaceMissing: true }), { channel: 1, stereo: true });
});

test('LR mágico em Master mono usa o par da saída, para guia e banda seguirem separadas', () => {
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 4, stereo: false, magic: true }), { channel: 3, stereo: true });
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 5, stereo: false, magic: true }), { channel: 5, stereo: true });
  assert.deepEqual(resolveMasterOutput({ ...base, channel: 3, stereo: true, magic: true }), { channel: 3, stereo: true });
});

test('a lista do Master bloqueia a saída do timecode e avisa a que tem faixa direta', () => {
  const tracks = [track(TIMECODE_TRACK_ID, 4), track('a', 5, true), track('filha', 7, false, 'a')];
  const pairs = masterOutputOptions(tracks, 8, true);
  assert.deepEqual(pairs.map((o) => o.value), [1, 3, 5, 7]);
  assert.equal(pairs[1].disabled, true);
  assert.equal(pairs[1].hint, 'timecode');
  assert.equal(pairs[2].disabled, false);
  assert.equal(pairs[2].hint, 'em uso');
  assert.equal(pairs[3].hint, undefined);
  assert.equal(masterOutputOptions(tracks, 8, false).length, 8);
});

test('o timecode passa a poder usar 1 e 2 quando o Master sai de lá, e não a saída nova', () => {
  const tc = track(TIMECODE_TRACK_ID, -1);
  const used = usedOutputs([tc], TIMECODE_TRACK_ID, [3, 4]);
  assert.equal(used.has(1), false);
  assert.equal(used.has(3), true);
  const opts = outputOptions(tc, [tc], 4, false, [3, 4]);
  assert.equal(opts.find((o) => o.value === 1).disabled, false);
  const three = opts.find((o) => o.value === 3);
  assert.equal(three.disabled, true);
  assert.equal(three.hint, 'Master');
});

test('Master mono reserva o par inteiro: ligar o LR mágico nunca cala o timecode', () => {
  const tracks = [track(TIMECODE_TRACK_ID, 4)];
  const mono = masterOutputOptions(tracks, 8, false);
  assert.equal(mono.find((o) => o.value === 3).disabled, true);
  assert.equal(mono.find((o) => o.value === 4).disabled, true);
  assert.equal(mono.find((o) => o.value === 5).disabled, false);
  assert.equal(masterHitsTimecode(3, 4), true);
  assert.equal(masterHitsTimecode(5, 4), false);
  assert.equal(masterHitsTimecode(3, -1), false);
  assert.deepEqual(masterReservedOutputs({ ...base, channel: 3, stereo: false }), [3, 4]);
});

test('placa menor: o timecode também não pode usar a 1/2, para onde o Master voltou', () => {
  assert.deepEqual(masterReservedOutputs({ ...base, channel: 5, stereo: true, outputCount: 4 }), [1, 2, 5, 6]);
  assert.deepEqual(masterReservedOutputs({ ...base, channel: 5, stereo: true, interfaceMissing: true }), [1, 2, 5, 6]);
});

test('Master desligado cala só o Master e volta se os canais roteados perderem a saída', () => {
  const m = { off: true, magic: false, outputCount: 10, interfaceMissing: false };
  const tracks = [track('guia', 3), track('banda', 9, true), track(TIMECODE_TRACK_ID, 40)];
  assert.equal(masterSilenced(m, tracks), true);
  assert.equal(masterSilenced({ ...m, off: false }, tracks), false);
  assert.equal(masterSilenced({ ...m, magic: true }, tracks), false);
  assert.equal(masterSilenced({ ...m, interfaceMissing: true }, tracks), false);
  assert.equal(masterSilenced({ ...m, outputCount: 8 }, [track('banda', 9, true)]), false);
});

test('Master desligado: o fader vira o geral dos canais roteados, sem passar de 0 dB', () => {
  assert.equal(directOutFaderGain(false, 0.2), 1);
  assert.equal(directOutFaderGain(true, 0.8), 1);
  assert.equal(directOutFaderGain(true, 0.4), 0.5);
  assert.equal(directOutFaderGain(true, 0), 0);
  assert.equal(directOutFaderGain(true, 1.5), 1);
});

test('nomes comuns de instrumento são reconhecidos pelo roteamento', () => {
  const want = {
    Click: 'track-click', Guia: 'track-guia', Teclados: 'track-teclados', Synth: 'track-teclados',
  };
  for (const name of ['Click', 'Guia', 'Bateria', 'Baixo', 'Violão 1', 'Violão 2', 'Guitarra', 'Teclados', 'Synth', 'Sanfona']) {
    const r = routeByName(`${name}.wav`);
    assert.ok(r, `${name} não foi reconhecido`);
    if (want[name]) assert.equal(r.target, want[name], name);
  }
});
