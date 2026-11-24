// Voz clonada (desktop/maestroClone.js): tratamento da tomada (silêncio, -19 dB, limitador, de-esser),
// análise da voz, limite de tamanho, modos de fala e ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-clones-test-'));
process.env.VS_MAESTRO_CLONES_HOME = HOME;
const clone = require('../desktop/maestroClone.js');
const { floatToWav } = require('../desktop/maestroAudio.js');

const RATE = 24000;
function voz(seconds, amp = 0.05, hz = 220, rate = RATE) {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate) * (0.7 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / rate));
  return out;
}
const seno = (seconds, amp, hz, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const silencio = (seconds) => new Float32Array(Math.round(seconds * RATE)).map(() => (Math.random() - 0.5) * 0.0004);
const junta = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const rmsDb = (s) => 20 * Math.log10(Math.sqrt(s.reduce((n, x) => n + x * x, 0) / s.length));
const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const TEXTO = 'Boa noite, pessoal! Eu sou o diretor musical e vou guiar a banda hoje.';

test('corta o silêncio das pontas e encurta a pausa longa do meio', () => {
  const entrada = junta(silencio(1.5), voz(3), silencio(2), voz(3), silencio(1.5));
  const { samples, report } = clone.cleanVoice(entrada, RATE);
  const seconds = samples.length / RATE;
  // 6 s de voz + pausa encurtada (~0,25 s) + respiros das pontas
  assert.ok(seconds > 6 && seconds < 6.6, `duração ${seconds}`);
  assert.equal(report.clipped, false);
  assert.deepEqual(report.warnings, []);
});

test('iguala o volume da fala em -19 dB, mesmo gravada baixinha', () => {
  const { samples, report } = clone.cleanVoice(junta(silencio(0.5), voz(6, 0.01), silencio(0.5)), RATE);
  const meio = samples.subarray(Math.round(1 * RATE), Math.round(5 * RATE));
  assert.ok(Math.abs(rmsDb(meio) - clone.TARGET_DB) < 1.5, `volume ${rmsDb(meio).toFixed(1)} dB`);
  assert.ok(Math.abs(report.analysis.loudnessDb - clone.TARGET_DB) < 1.5, `análise ${report.analysis.loudnessDb} dB`);
});

test('limitador segura os picos em -1 dB', () => {
  const alto = seno(1, 1.8, 300);
  const out = clone.limit(alto, RATE);
  const teto = Math.pow(10, -1 / 20);
  assert.ok(out.every((x) => Math.abs(x) <= teto + 1e-6), 'pico acima de -1 dB');
  // a cadeia inteira também respeita o teto
  const { samples } = clone.cleanVoice(junta(silencio(0.3), voz(6, 0.9), silencio(0.3)), RATE);
  assert.ok(samples.every((x) => Math.abs(x) <= teto + 1e-6), 'tomada com pico acima de -1 dB');
});

test('de-esser abaixa o "s" forte e não mexe na voz sem chiado', () => {
  const rate = 48000;
  const base = voz(2, 0.1, 220, rate);
  const chiado = seno(2, 0.25, 7000, rate);
  const sinal = Float32Array.from(base, (x, i) => x + (i > rate * 0.8 && i < rate * 1.3 ? chiado[i] : 0));
  const out = clone.deEss(sinal, rate, { reference: 0.07 });
  // energia em 7 kHz no trecho do "s": isola com passa-alta em 5 kHz
  const banda = (s) => clone.highPass(s, rate, 5000).subarray(Math.round(rate * 0.9), Math.round(rate * 1.2));
  const antes = rmsDb(banda(sinal));
  const depois = rmsDb(banda(out));
  assert.ok(antes - depois > 3, `redução de ${(antes - depois).toFixed(1)} dB`);
  // trecho sem "s": praticamente igual
  const limpo = (s) => s.subarray(Math.round(rate * 0.2), Math.round(rate * 0.6));
  assert.ok(Math.abs(rmsDb(limpo(out)) - rmsDb(limpo(sinal))) < 0.3);
});

test('análise: tom de 120 Hz é grave e de 230 Hz é aguda', () => {
  const grave = clone.analyzeVoice(seno(2, 0.1, 120), RATE, 'um dois três quatro');
  assert.ok(Math.abs(grave.pitchHz - 120) <= 3, `tom ${grave.pitchHz}`);
  assert.equal(grave.range, 'grave');
  const aguda = clone.analyzeVoice(seno(2, 0.1, 230, 44100), 44100, '');
  assert.ok(Math.abs(aguda.pitchHz - 230) <= 4, `tom ${aguda.pitchHz}`);
  assert.equal(aguda.range, 'aguda');
  assert.equal(aguda.wordsPerMinute, null);
  assert.equal(grave.wordsPerMinute, 120); // 4 palavras em 2 s
  assert.equal(clone.rangeOf(170), 'média');
});

test('tomada longa: avisa acima de 10,5 s e recusa acima de 13 s', async () => {
  assert.ok(clone.checkLength(11).some((w) => /mais depressa/.test(w)));
  assert.deepEqual(clone.checkLength(8), []);
  assert.throws(() => clone.checkLength(13.5), /longa demais/);
  const wav = floatToWav(junta(silencio(0.3), voz(14), silencio(0.3)), RATE);
  await assert.rejects(clone.prepare({ wav: toArrayBuffer(wav), mode: 'normal', text: TEXTO, denoise: false }), /longa demais/);
});

test('salva tomadas por modo, ids com modo e modo não gravado cai no normal', async () => {
  const wav = toArrayBuffer(floatToWav(junta(silencio(0.4), voz(7), silencio(0.4)), RATE));
  const normal = await clone.prepare({ wav, mode: 'normal', text: TEXTO, denoise: false });
  const calma = await clone.prepare({ wav, mode: 'calma', text: 'Agora bem suave, só o teclado e a voz.', denoise: false });
  assert.ok(normal.report.analysis && typeof normal.report.analysis.loudnessDb === 'number');
  await assert.rejects(clone.save({ name: 'Sem normal', gender: 'masculina', takes: [{ mode: 'calma', token: calma.token, text: '' }] }), /normal/);
  const v = await clone.save({
    name: 'Diretor Teste',
    gender: 'masculina',
    takes: [{ mode: 'normal', token: normal.token, text: TEXTO }, { mode: 'calma', token: calma.token, text: '' }],
  });
  assert.match(v.id, /^clone:diretor-teste-[a-f0-9]{6}$/);
  assert.deepEqual(v.modes, ['normal', 'calma']);
  assert.deepEqual(Object.keys(clone.publicInfo(v)).sort(), ['created', 'gender', 'id', 'modes', 'name']);

  const c = clone.voiceFor(`${v.id}:calma`);
  assert.equal(c.mode, 'calma');
  assert.equal(c.id, `${v.id}:calma`);
  assert.ok(c.refPath.endsWith('voz-calma.wav'));
  assert.equal(fs.readFileSync(c.refTextPath, 'utf8'), 'Agora bem suave, só o teclado e a voz.');
  const f = clone.voiceFor(`${v.id}:forte`); // não gravado
  assert.equal(f.mode, 'normal');
  assert.equal(f.id, v.id);
  assert.ok(f.refPath.endsWith('voz-normal.wav'));
  assert.equal(clone.list().length, 1);

  assert.equal(await clone.remove(v.id), true);
  assert.equal(clone.voiceFor(v.id), null);
});

test('voz antiga (voz.wav e texto.txt) vale como o modo normal', () => {
  const dir = path.join(HOME, 'antiga-abc123');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'voz.wav'), floatToWav(voz(1), RATE));
  fs.writeFileSync(path.join(dir, 'texto.txt'), TEXTO);
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ name: 'Antiga', gender: 'feminina', created: '2026-11-01T00:00:00Z' }));
  const v = clone.voiceFor('clone:antiga-abc123:forte');
  assert.equal(v.mode, 'normal');
  assert.deepEqual(v.modes, ['normal']);
  assert.ok(v.refPath.endsWith('voz.wav'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lê de volta o WAV que grava (16 bits) sem mudar a duração', () => {
  const s = voz(1.25);
  const back = clone.readWavMono(floatToWav(s, RATE));
  assert.equal(back.rate, RATE);
  assert.equal(back.samples.length, s.length);
});

test('masterização da fala gerada não muda o começo nem o tamanho', () => {
  const s = junta(voz(1.5, 0.3), silencio(0.2));
  const out = clone.readWavMono(clone.masterSpeech(floatToWav(s, RATE))).samples;
  assert.equal(out.length, s.length);
  assert.ok(Math.abs(out[200]) > 0.001, 'a fala tem de começar no ataque');
  assert.ok(out.every((x) => Math.abs(x) <= Math.pow(10, -1 / 20) + 1e-4));
});

test('voz clonada só aceita id no formato clone:<pasta>[:modo]', () => {
  assert.equal(clone.voiceFor('clone:../../etc'), null);
  assert.equal(clone.voiceFor('clone:abc/../../etc'), null);
  assert.equal(clone.voiceFor('clone:abc:../x'), null);
  assert.equal(clone.voiceFor('clone:abc:sussurro'), null);
  assert.equal(clone.voiceFor('qwen:feminina'), null);
  assert.equal(clone.voiceFor(42), null);
  assert.deepEqual(clone.parseId('clone:abc-1:forte'), { slug: 'abc-1', mode: 'forte' });
  assert.deepEqual(clone.parseId('clone:abc-1'), { slug: 'abc-1', mode: 'normal' });
});

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

test('consoante fraca no meio da fala não é abafada como pausa', () => {
  // vogal forte, chiado curto (120 ms) 30 dB abaixo, vogal de novo: o chiado tem de continuar ~30 dB abaixo
  const chiado = seno(0.12, 0.05 * Math.pow(10, -30 / 20), 5000);
  const entrada = junta(silencio(0.4), voz(2, 0.05), chiado, voz(2, 0.05), silencio(0.4));
  const { samples } = clone.cleanVoice(entrada, RATE);
  // a tomada começa 80 ms antes da primeira vogal: o chiado fica em 2,08 s
  const at = Math.round(2.08 * RATE);
  const trecho = samples.subarray(at + Math.round(0.02 * RATE), at + Math.round(0.1 * RATE));
  const vogal = samples.subarray(Math.round(0.5 * RATE), Math.round(1.5 * RATE));
  const diff = rmsDb(vogal) - rmsDb(trecho);
  // a referência não tem compressor nem abaixador de pausa: o chiado continua uns 27 dB abaixo
  assert.ok(diff < 29, `chiado ${diff.toFixed(1)} dB abaixo da vogal`);
});

test('picos e ruído vêm da gravação original quando passados em rawStats', () => {
  const limpo = junta(silencio(0.5), voz(6, 0.05), silencio(0.5));
  const { report } = clone.cleanVoice(limpo, RATE, { rawStats: { clipped: 0.01, floor: 0.01, loud: 0.05 } });
  assert.equal(report.clipped, true);
  assert.ok(report.noiseDb > -30, `ruído ${report.noiseDb}`);
  assert.ok(report.warnings.some((w) => /estourou/.test(w)));
  assert.ok(report.warnings.some((w) => /ruído/.test(w)));
});

// ---------------------------------------------------------------------------------------------
// Referência natural

const wavInfo = (buf) => ({ channels: buf.readUInt16LE(22), rate: buf.readUInt32LE(24), bits: buf.readUInt16LE(34) });

test('referência não é comprimida: sílaba forte continua forte', () => {
  const forte = voz(2, 0.2);
  const fraca = voz(2, 0.04);
  const { samples } = clone.cleanVoice(junta(silencio(0.3), forte, fraca, forte, silencio(0.3)), RATE);
  const inicio = Math.round(0.08 * RATE);
  const a = samples.subarray(inicio + 2400, inicio + 2 * RATE - 2400);
  const b = samples.subarray(inicio + 2 * RATE + 2400, inicio + 4 * RATE - 2400);
  assert.ok(Math.abs((rmsDb(a) - rmsDb(b)) - 14) < 0.5, `diferença ${(rmsDb(a) - rmsDb(b)).toFixed(1)} dB`);
});

test('referência guardada é mono 24 kHz 16 bits, e a revisão toca a versão masterizada', async () => {
  const rate = 48000;
  const entrada = Float32Array.from({ length: rate * 7 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 220 * i) / rate) * (0.7 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / rate)));
  const p = await clone.prepare({ wav: toArrayBuffer(floatToWav(entrada, rate)), mode: 'normal', text: TEXTO, denoise: false });
  const v = await clone.save({ name: 'Natural', gender: 'feminina', takes: [{ mode: 'normal', token: p.token, text: TEXTO }] });
  const ref = fs.readFileSync(clone.voiceFor(v.id).refPath);
  assert.deepEqual(wavInfo(ref), { channels: 1, rate: 24000, bits: 16 });
  assert.equal(clone.voiceFor(v.id).masterVersion, clone.MASTER_VERSION);
  const revisao = Buffer.from(p.wavBase64, 'base64');
  assert.deepEqual(wavInfo(revisao), { channels: 1, rate: 24000, bits: 16 });
  assert.notDeepEqual(revisao.subarray(44), ref.subarray(44), 'a revisão tem de passar pela masterização');
  assert.equal(revisao.length, ref.length, 'a masterização não muda o tamanho');
  await clone.remove(v.id);
});

test('reamostragem mantém o tom e tira o que não cabe em 24 kHz', () => {
  const rate = 48000;
  const tom = clone.resample(seno(1, 0.3, 220, rate), rate, 24000);
  assert.equal(tom.length, 24000);
  const meio = tom.subarray(2400, 21600);
  assert.ok(Math.abs(rmsDb(meio) - (20 * Math.log10(0.3) - 3.01)) < 0.1, `nível ${rmsDb(meio).toFixed(2)}`);
  assert.ok(Math.abs(clone.pitchOf(tom, 24000) - 220) <= 3, 'o tom não pode mudar');
  const agudo = clone.resample(seno(1, 0.3, 15000, rate), rate, 24000).subarray(2400, 21600);
  assert.ok(rmsDb(agudo) < -70, `agudo dobrado em ${rmsDb(agudo).toFixed(1)} dB`);
});

test('Demucs só roda com ruído alto na gravação original', async () => {
  assert.equal(clone.needsDenoise({ floor: 0.0005, loud: 0.1 }), false); // -46 dB
  assert.equal(clone.needsDenoise({ floor: 0.01, loud: 0.1 }), true); // -20 dB
  let chamadas = 0;
  const deps = {
    engineInstalled: () => true,
    separate: async (_w, _n, wav) => { chamadas++; return { vocals: wav }; },
  };
  const limpa = floatToWav(junta(silencio(0.5), voz(7), silencio(0.5)), RATE);
  const r1 = await clone.prepare({ wav: toArrayBuffer(limpa), mode: 'normal', text: TEXTO }, null, deps);
  assert.equal(chamadas, 0);
  assert.equal(r1.report.denoised, false);
  const ruido = () => (Math.random() - 0.5) * 0.04;
  const suja = floatToWav(junta(silencio(0.5), voz(7), silencio(0.5)).map((x) => x + ruido()), RATE);
  const r2 = await clone.prepare({ wav: toArrayBuffer(suja), mode: 'normal', text: TEXTO }, null, deps);
  assert.equal(chamadas, 1);
  assert.equal(r2.report.denoised, true);
});

test('voz antiga mantém a masterização antiga; a nova é mais leve', () => {
  const dir = path.join(HOME, 'antiga-master1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'voz.wav'), floatToWav(voz(1), RATE));
  fs.writeFileSync(path.join(dir, 'texto.txt'), TEXTO);
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ name: 'Antiga', gender: 'feminina', created: '2026-11-01T00:00:00Z' }));
  assert.equal(clone.voiceFor('clone:antiga-master1').masterVersion, clone.LEGACY_MASTER_VERSION);
  fs.rmSync(dir, { recursive: true, force: true });
  const sinal = junta(voz(1, 0.3), voz(1, 0.03), voz(1, 0.3));
  const leve = clone.readWavMono(clone.masterSpeech(floatToWav(sinal, RATE))).samples;
  const antiga = clone.readWavMono(clone.masterSpeech(floatToWav(sinal, RATE), clone.LEGACY_MASTER_VERSION)).samples;
  // diferença entre o trecho forte e o fraco: quanto mais comprime, menor ela fica
  const contraste = (x) => rmsDb(x.subarray(Math.round(0.3 * RATE), Math.round(0.8 * RATE))) - rmsDb(x.subarray(Math.round(1.3 * RATE), Math.round(1.8 * RATE)));
  assert.ok(contraste(leve) > contraste(antiga) + 0.5, `contraste ${contraste(leve).toFixed(1)} x ${contraste(antiga).toFixed(1)} dB`);
});

// ---------------------------------------------------------------------------------------------
// Fila das falas

const qwen = require('../desktop/maestroQwen.js');
const { PRIORITY, createSpeechQueue, warmPlan, WARM_MIN_FREE_BYTES } = qwen;
const adiado = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tique = () => new Promise((r) => setImmediate(r));

test('pedido do diretor passa à frente de frases salvas, sem matar o que está gerando', async () => {
  const q = createSpeechQueue();
  const ordem = [];
  const trava = adiado();
  const a = q.add({ key: 'rodando', priority: PRIORITY.PIN, run: async () => { ordem.push('rodando'); await trava.promise; } });
  const b = q.add({ key: 'frase', priority: PRIORITY.PIN, run: async () => { ordem.push('frase'); } });
  const c = q.add({ key: 'fundo', priority: PRIORITY.BACKGROUND, run: async () => { ordem.push('fundo'); } });
  const d = q.add({ key: 'diretor', priority: PRIORITY.USER, run: async () => { ordem.push('diretor'); } });
  await tique();
  trava.resolve();
  await Promise.all([a.promise, b.promise, c.promise, d.promise]);
  assert.deepEqual(ordem, ['rodando', 'diretor', 'fundo', 'frase']);
});

test('pedido idêntico não gera duas vezes e sobe de prioridade', async () => {
  const q = createSpeechQueue();
  const ordem = [];
  const trava = adiado();
  const a = q.add({ key: 'x', priority: PRIORITY.USER, run: async () => { await trava.promise; } });
  let gerou = 0;
  const b = q.add({ key: 'igual', priority: PRIORITY.PIN, run: async () => { gerou++; ordem.push('igual'); return 'wav'; } });
  const c = q.add({ key: 'outra', priority: PRIORITY.BACKGROUND, run: async () => { ordem.push('outra'); } });
  const d = q.add({ key: 'igual', priority: PRIORITY.USER, run: async () => { gerou++; return 'errado'; } });
  trava.resolve();
  const [, rb, , rd] = await Promise.all([a.promise, b.promise, c.promise, d.promise]);
  assert.equal(gerou, 1);
  assert.equal(rb, 'wav');
  assert.equal(rd, 'wav');
  assert.deepEqual(ordem, ['igual', 'outra']);
});

test('cancelar a prévia não para a geração e o resultado continua valendo', async () => {
  const q = createSpeechQueue();
  const trava = adiado();
  let guardou = false;
  const previa = q.add({ key: 'fala', run: async () => { await trava.promise; guardou = true; return 'wav'; } });
  await tique();
  const gerar = q.add({ key: 'fala', run: async () => 'errado' });
  assert.equal(previa.cancel(), true);
  await assert.rejects(previa.promise, (e) => e.canceled === true && e.message === 'fala_cancelada');
  assert.equal(q.stateOf('fala'), 'gerando');
  trava.resolve();
  assert.equal(await gerar.promise, 'wav', 'o Gerar aproveita a mesma geração');
  assert.equal(guardou, true);
});

test('cancelar antes de começar não gera; o que está rodando termina mesmo sem ninguém', async () => {
  const q = createSpeechQueue();
  const trava = adiado();
  let terminou = false;
  const rodando = q.add({ key: 'a', run: async () => { await trava.promise; terminou = true; } });
  let gerou = false;
  const fila = q.add({ key: 'b', run: async () => { gerou = true; } });
  await tique();
  fila.cancel();
  rodando.cancel();
  await assert.rejects(fila.promise);
  await assert.rejects(rodando.promise);
  trava.resolve();
  await tique();
  await tique();
  assert.equal(terminou, true);
  assert.equal(gerou, false);
  assert.equal(q.size(), 0);
});

test('aquecimento sai da fila quando chega fala e frase salva espera a música', async () => {
  let tocando = true;
  const q = createSpeechQueue({ isHeld: (rank) => rank >= PRIORITY.PIN && tocando });
  let aqueceu = false;
  let gravou = false;
  const aquecer = q.add({ key: 'aquecer', priority: PRIORITY.WARM, yields: true, run: async () => { aqueceu = true; } });
  const frase = q.add({ key: 'frase', priority: PRIORITY.PIN, run: async () => { gravou = true; } });
  await tique();
  assert.equal(gravou, false, 'com música a frase espera');
  assert.equal(await aquecer.promise, null, 'a frase tirou o aquecimento da fila');
  await q.add({ key: 'fala', priority: PRIORITY.USER, run: async () => 'ok' }).promise;
  assert.equal(gravou, false, 'pedido do diretor passa mesmo com música');
  tocando = false;
  q.pump();
  await frase.promise;
  assert.equal(gravou, true);
  assert.equal(aqueceu, false);
});

test('aquecimento: sem memória livre não gera fala descartável', () => {
  const base = { helperOpen: false, sameRef: false, busy: false, playing: false, recentSpeech: false };
  assert.equal(warmPlan({ ...base, freeBytes: WARM_MIN_FREE_BYTES }), 'completo');
  assert.equal(warmPlan({ ...base, freeBytes: 300e6 }), 'abrir');
  assert.equal(warmPlan({ ...base, freeBytes: 300e6, helperOpen: true }), 'nada');
  assert.equal(warmPlan({ ...base, freeBytes: 8e9, busy: true }), 'nada');
  assert.equal(warmPlan({ ...base, freeBytes: 8e9, playing: true }), 'nada');
  assert.equal(warmPlan({ ...base, freeBytes: 8e9, helperOpen: true, recentSpeech: true }), 'nada');
});

// ---------------------------------------------------------------------------------------------
// Ruído medido nas pausas de verdade

test('leitura contínua com poucas pausas limpas não vai para o Demucs', async () => {
  // 94% de fala e 6% de pausa quase muda: o percentil 10 das janelas já é voz
  const gravacao = junta(silencio(0.25), voz(4, 0.08), silencio(0.1), voz(4, 0.08), silencio(0.2));
  const stats = clone.rawStatsOf(gravacao, RATE);
  assert.equal(clone.needsDenoise(stats), false, `fundo ${(20 * Math.log10(stats.floor / stats.loud)).toFixed(1)} dB`);
  let chamadas = 0;
  const deps = { engineInstalled: () => true, separate: async (_w, _n, wav) => { chamadas++; return { vocals: wav }; } };
  const r = await clone.prepare({ wav: toArrayBuffer(floatToWav(gravacao, RATE)), mode: 'normal', text: TEXTO }, null, deps);
  assert.equal(chamadas, 0);
  assert.ok(!r.report.warnings.some((w) => /ruído/.test(w)), 'sem aviso falso de lugar ruidoso');
});

test('zero digital no começo não esconde o ruído constante do lugar', () => {
  const ruido = (x) => x + (Math.random() - 0.5) * 0.04;
  const gravacao = junta(new Float32Array(Math.round(0.5 * RATE)), voz(7).map(ruido), silencio(0.5).map(ruido));
  assert.equal(clone.needsDenoise(clone.rawStatsOf(gravacao, RATE)), true);
});

// ---------------------------------------------------------------------------------------------
// Motor com programa falso

const canRunFake = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync('/usr/bin/python3');
const FAKE = (startup) => `#!/usr/bin/python3
import sys, json, struct, math, os, time
def send(o):
    sys.stdout.write('@@VS ' + json.dumps(o) + '\\n'); sys.stdout.flush()
marca = sys.argv[0] + '.aberturas'
open(marca, 'a').write('x')
${startup}
send({'id': 'ready', 'ok': True, 'sampleRate': 24000})
for line in sys.stdin:
    r = json.loads(line)
    open(sys.argv[0] + '.falas', 'a').write('x')
    s = [0.3 * math.sin(i / 7) for i in range(9600)]
    open(r['out'], 'wb').write(struct.pack('<%df' % len(s), *s))
    send({'id': r['id'], 'ok': True, 'samples': len(s), 'sampleRate': 24000, 'elapsed': 0.01})
`;

function motorFalso(startup, extraEnv = {}) {
  const dir = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `vs-motor-${n}-`));
  const engine = dir('programa');
  const programa = path.join(engine, 'vs-maestro-voz');
  fs.writeFileSync(programa, FAKE(startup), { mode: 0o755 });
  fs.mkdirSync(path.join(engine, 'voices'));
  for (const v of ['feminina', 'masculina']) {
    fs.writeFileSync(path.join(engine, 'voices', `${v}.wav`), 'x');
    fs.writeFileSync(path.join(engine, 'voices', `${v}.txt`), 'Boa noite, pessoal!\n');
  }
  const model = dir('modelo');
  fs.writeFileSync(path.join(model, 'config.json'), '{}');
  const casa = dir('casa');
  const env = { VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: casa, VS_MAESTRO_FORCE_CPU: undefined, ...extraEnv };
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const qwenPath = require.resolve('../desktop/maestroQwen.js');
  const downloadPath = require.resolve('../desktop/maestroVoiceDownload.js');
  delete require.cache[qwenPath];
  delete require.cache[downloadPath];
  const m = require(qwenPath);
  const contagem = (sufixo) => { try { return fs.readFileSync(programa + sufixo, 'utf8').length; } catch { return 0; } };
  const restore = () => {
    m.stopHelper();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[qwenPath];
    delete require.cache[downloadPath];
    require.cache[qwenPath] = { id: qwenPath, filename: qwenPath, loaded: true, exports: qwen };
  };
  return { m, casa, falas: () => contagem('.falas'), aberturas: () => contagem('.aberturas'), restore };
}

const wavsDe = (raiz) => fs.readdirSync(raiz, { recursive: true }).map(String).filter((f) => f.includes('falas-prontas') && f.endsWith('.wav')).map((f) => path.join(raiz, f));

test('programa que passa do tempo de abrir é descartado e a próxima fala abre outro', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const startup = "if len(open(marca).read()) == 1: time.sleep(30)";
  const { m, falas, aberturas, restore } = motorFalso(startup, { VS_MAESTRO_LOAD_TIMEOUT_MS: '2500' });
  try {
    const voice = m.qwenVoiceFor('feminina');
    await assert.rejects(m.render({ text: 'Primeira fala', voice }), /demorou demais para abrir/);
    const r = await m.render({ text: 'Segunda fala', voice });
    assert.equal(r.cached, false);
    assert.equal(aberturas(), 2);
    assert.equal(falas(), 1);
  } finally {
    restore();
  }
});

test('fala guardada quebrada é gerada de novo e a escrita não deixa temporário', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const { m, casa, falas, restore } = motorFalso('');
  try {
    const voice = m.qwenVoiceFor('feminina');
    const a = await m.render({ text: 'Fala para quebrar', voice });
    const [arquivo] = wavsDe(casa);
    assert.ok(arquivo, 'a fala foi guardada');
    assert.deepEqual(fs.readdirSync(path.dirname(arquivo)).filter((f) => f.endsWith('.tmp')), []);
    for (const quebrado of [a.buf.subarray(0, 44), Buffer.alloc(0)]) {
      const antes = falas();
      fs.writeFileSync(arquivo, quebrado);
      const r = await m.render({ text: 'Fala para quebrar', voice });
      assert.equal(r.cached, false, 'não pode voltar como pronta');
      assert.ok(r.seconds > 0);
      assert.equal(falas(), antes + 1);
    }
    assert.equal((await m.render({ text: 'Fala para quebrar', voice })).cached, true);
  } finally {
    restore();
  }
});

test('apagar frase na fila com a música tocando responde na hora e não gera', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const { m, falas, restore } = motorFalso('');
  try {
    const frase = { text: 'Frase que vai sair', voice: 'qwen:feminina' };
    m.setPlaying(true);
    const gravando = m.pinPhrase(frase);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(m.pinnedStates({ texts: [frase.text], voice: frase.voice })[frase.text], 'gravando');
    const fim = await Promise.race([m.unpinPhrase(frase), new Promise((r) => setTimeout(() => r('preso'), 1000))]);
    assert.equal(fim, true);
    assert.equal(await gravando, 'cancelada');
    m.setPlaying(false);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(falas(), 0, 'a frase apagada não pode ser gerada');
    assert.equal(m.pinnedStates({ texts: [frase.text], voice: frase.voice })[frase.text], 'nao');
  } finally {
    m.setPlaying(false);
    restore();
  }
});
