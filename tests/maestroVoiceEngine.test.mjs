// Motor de voz do Maestro por IA no app do Mac: ajuste de velocidade pelo tamanho da marcação,
// limpeza do áudio, voz brasileira de IA (Qwen3-TTS: velocidade, texto, programa de voz) e o
// download do modelo (retomada e conferência do SHA-256).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { fitPace, floatToWav, trimSilence, wavSeconds } = require('../desktop/maestroAudio.js');

/** Voz de mentira: a fala dura `natural / pace` segundos e registra as tentativas. */
function fakeVoice(natural) {
  const tries = [];
  const speak = async (pace) => { tries.push(pace); return { seconds: natural / pace }; };
  return { speak, tries };
}

const DECIMAL = { min: 0.6, max: 2.0, round: (x) => Math.round(x * 100) / 100, minGap: 0.02 };
const SAY = { min: 80, max: 420, round: Math.round, minGap: 4 };

test('a fala ocupa de 88% a 100% da marcação quando a velocidade permite', async () => {
  for (const span of [2, 3, 4.5]) {
    const { speak, tries } = fakeVoice(3); // 3 s no ritmo normal
    const { pace, result } = await fitPace(speak, 1, span, DECIMAL);
    assert.ok(result.seconds <= span, `com ${span}s a fala (${result.seconds.toFixed(2)}s) passou do fim`);
    assert.ok(result.seconds >= span * 0.88, `com ${span}s a fala (${result.seconds.toFixed(2)}s) ficou curta demais`);
    assert.ok(tries.length <= 3, `levou ${tries.length} tentativas (velocidade ${pace})`);
  }
});

test('marcação enorme: fala na velocidade mais calma, sem passar do fim', async () => {
  const { speak } = fakeVoice(2);
  const { pace, result } = await fitPace(speak, 1, 20, DECIMAL);
  assert.equal(pace, 0.6);
  assert.ok(result.seconds < 20);
});

test('marcação curta demais: usa a velocidade máxima e devolve a fala mesmo passando', async () => {
  const { speak } = fakeVoice(6);
  const { pace, result } = await fitPace(speak, 1, 1, DECIMAL);
  assert.equal(pace, 2.0);
  assert.ok(result.seconds > 1, 'nem no máximo cabe: a tela avisa');
});

test('voz do Mac: o ritmo é inteiro e respeita os limites do `say`', async () => {
  const natural = 3 * 175; // 3 s a 175 palavras/min
  const speak = async (rate) => ({ seconds: natural / rate });
  const { pace, result } = await fitPace(speak, 175, 2.5, SAY);
  assert.ok(Number.isInteger(pace));
  assert.ok(pace >= 80 && pace <= 420);
  assert.ok(result.seconds <= 2.5 && result.seconds >= 2.5 * 0.88);
});

test('WAV de ponto flutuante: corta o silêncio das pontas e mede a duração', () => {
  const rate = 24000;
  const samples = new Float32Array(rate * 2); // 2 s, com 1 s de som no meio
  for (let i = rate / 2; i < rate * 1.5; i++) samples[i] = 0.5 * Math.sin(i / 10);
  const wav = floatToWav(samples, rate);
  assert.ok(Math.abs(wavSeconds(wav) - 2) < 1e-6);
  const trimmed = wavSeconds(trimSilence(wav));
  assert.ok(trimmed > 1 && trimmed < 1.2, `depois do corte ficou ${trimmed.toFixed(3)}s (1 s de som + respiro)`);
});

test('a voz sai centrada no zero (sem deslocamento de corrente que suja o som)', async () => {
  const { removeDcOffset } = require('../desktop/maestroAudio.js');
  const rate = 24000;
  const s = new Float32Array(rate);
  for (let i = 0; i < rate; i++) s[i] = 0.022 + 0.3 * Math.sin(i / 7); // modelo: senoide fora do zero
  const clean = removeDcOffset(s, rate);
  // depois dos primeiros 50 ms o filtro já assentou: a fala fica centrada
  let mean = 0;
  const from = Math.round(rate * 0.05);
  for (let i = from; i < clean.length; i++) mean += clean[i];
  mean /= clean.length - from;
  assert.ok(Math.abs(mean) < 1e-4, `sobrou ${mean.toFixed(6)} de corrente contínua`);
});

test('o silêncio do modelo continua no zero: nada de espaço antes da voz', () => {
  // como o Kokoro entrega: 150 ms de zero, depois a fala 2% fora do zero, e zero no fim
  const rate = 24000;
  const samples = new Float32Array(Math.round(rate * 0.8));
  const onset = Math.round(rate * 0.15);
  const off = Math.round(rate * 0.65);
  for (let i = onset; i < off; i++) samples[i] = 0.022 + 0.3 * Math.sin(i / 7);
  const out = trimSilence(floatToWav(samples, rate));
  const first = (() => { for (let i = 0; i < (out.length - 44) / 2; i++) if (Math.abs(out.readInt16LE(44 + i * 2)) > 200) return i / rate; return -1; })();
  assert.ok(first >= 0 && first <= 0.003, `a voz começa em ${(first * 1000).toFixed(1)} ms do início do clipe (esperado até 3 ms)`);
  const secs = wavSeconds(out);
  assert.ok(secs > 0.5 && secs < 0.6, `ficou ${secs.toFixed(3)} s (0,5 s de fala + respiro curto)`);
});

test('o som começa justo no início do áudio (2 ms), com entrada suave', () => {
  const rate = 24000;
  const samples = new Float32Array(rate); // 1 s: silêncio até 300 ms, depois a voz
  for (let i = Math.round(rate * 0.3); i < rate; i++) samples[i] = 0.4 * Math.sin(i / 7);
  const out = trimSilence(floatToWav(samples, rate));
  const first = (() => { for (let i = 0; i < (out.length - 44) / 2; i++) if (Math.abs(out.readInt16LE(44 + i * 2)) > 200) return i / rate; return -1; })();
  assert.ok(first >= 0.001 && first <= 0.003, `o som começa em ${(first * 1000).toFixed(1)} ms (esperado ~2 ms)`);
  assert.equal(out.readInt16LE(44), 0, 'a primeira amostra é zero: sem estalo');
});

test('contagem com velocidade fixa: não estica para encher o tempo, só acelera se não couber', async () => {
  const { speak, tries } = fakeVoice(0.3); // "Um" leva 0,3 s no ritmo normal
  const fixed = 1.15;
  const { pace } = await fitPace(speak, fixed, 0.5, { ...DECIMAL, min: fixed });
  assert.equal(pace, fixed, 'cabe no tempo: fica na velocidade escolhida');
  assert.equal(tries.length, 1);
  const longo = fakeVoice(0.8);
  const r = await fitPace(longo.speak, fixed, 0.5, { ...DECIMAL, min: fixed });
  assert.ok(r.pace > fixed && r.result.seconds <= 0.5, 'não cabe: acelera até caber');
});

test('voz de IA: ruído fraco depois de uma pausa no fim sai; frase forte depois da pausa fica', () => {
  const rate = 24000;
  const make = (tailAmp) => {
    const s = new Float32Array(Math.round(rate * 1.2));
    for (let i = 0; i < rate * 0.3; i++) s[i] = 0.5 * Math.sin(i / 7); // "Um" (0,3 s)
    for (let i = Math.round(rate * 0.7); i < rate * 0.8; i++) s[i] = tailAmp * Math.sin(i / 5); // depois de 0,4 s de pausa
    return floatToWav(s, rate);
  };
  const blip = wavSeconds(trimSilence(make(0.05), { dropTrailingBlips: true }));
  assert.ok(blip < 0.4, `respiração no fim saiu (${blip.toFixed(2)} s)`);
  const frase = wavSeconds(trimSilence(make(0.45), { dropTrailingBlips: true }));
  assert.ok(frase > 0.8, `frase forte depois da pausa ficou (${frase.toFixed(2)} s)`);
  const estalo = wavSeconds(trimSilence(make(0.16), { dropTrailingBlips: true }));
  assert.ok(estalo < 0.4, `estalo isolado (-10 dB) depois de 0,4 s de silêncio saiu (${estalo.toFixed(2)} s)`);
  const semOpcao = wavSeconds(trimSilence(make(0.05)));
  assert.ok(semOpcao > 0.8, 'voz do Mac (sem a opção): nada muda');
});

test('contagem falada de uma vez: corta nas pausas, uma palavra por pedaço', () => {
  const { splitWords } = require('../desktop/maestroAudio.js');
  const rate = 24000;
  const s = new Float32Array(rate * 3);
  const words = [[0.1, 0.35], [0.7, 1.05], [1.4, 1.8], [2.2, 2.5]];
  for (const [a, b] of words) for (let i = Math.round(a * rate); i < b * rate; i++) s[i] = 0.4 * Math.sin(i / 6);
  const cuts = splitWords(s, rate, 4);
  assert.ok(cuts, 'separou');
  assert.equal(cuts.length, 4);
  cuts.forEach(([a, b], k) => {
    assert.ok(a / rate <= words[k][0] + 0.02 && b / rate >= words[k][1] - 0.02, `palavra ${k + 1} inteira no pedaço ${k + 1}`);
  });
  // pausa longa (silêncio comprido) é um corte só, não vários
  const longa = new Float32Array(rate * 3);
  for (const [a, b] of [[0.1, 0.3], [1.2, 1.5], [1.8, 2.1], [2.4, 2.7]]) for (let i = Math.round(a * rate); i < b * rate; i++) longa[i] = 0.4 * Math.sin(i / 6);
  assert.equal(splitWords(longa, rate, 4)?.length, 4);
  // um som contínuo, sem pausas: não dá para separar com segurança
  const continuo = new Float32Array(rate * 2).map((_, i) => 0.4 * Math.sin(i / 6));
  assert.equal(splitWords(continuo, rate, 4), null);
});

test('voz de IA: começa onde a voz ganha força, sem a respiração da frente (mas com o "s" ou o "v")', () => {
  const rate = 24000;
  const withLead = (lead) => {
    const s = new Float32Array(Math.round(rate * 0.6));
    const a = Math.round(rate * 0.1);
    for (let i = 0; i < a; i++) s[i] = lead(i); // 100 ms antes da palavra
    for (let i = a; i < s.length; i++) s[i] = 0.5 * Math.sin(i / 7); // a palavra
    return floatToWav(s, rate);
  };
  const firstStrong = (buf) => { for (let i = 0; i < (buf.length - 44) / 2; i++) if (Math.abs(buf.readInt16LE(44 + i * 2)) > 0.25 * 32767) return i / rate; return -1; };
  // respiração: fraca (3%) e lisa (onda lenta)
  const breath = withLead((i) => 0.015 * Math.sin(i / 40));
  const cut = trimSilence(breath, { tightStart: true });
  assert.ok(firstStrong(cut) < 0.01, `a palavra começa em ${(firstStrong(cut) * 1000).toFixed(0)} ms (a respiração saiu)`);
  assert.ok(firstStrong(trimSilence(breath)) > 0.09, 'sem a opção (voz do Mac), nada muda');
  // consoante chiada: fraca (4%), mas cheia de cruzamentos por zero: fica (até 80 ms)
  const hiss = withLead((i) => 0.02 * Math.sin(i * 2.7));
  const kept = trimSilence(hiss, { tightStart: true });
  assert.ok(firstStrong(kept) > 0.06, `o "s" da frente ficou (${(firstStrong(kept) * 1000).toFixed(0)} ms antes da vogal)`);
});
