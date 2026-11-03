// Toda fala do Maestro por IA começa JUSTO no primeiro som da palavra, para cair na linha da grade
// junto com o click: sem silêncio, sem respiração e, na contagem, sem o resto da palavra anterior.
// E sem cortar consoante de verdade (o "s" de "Seis", o "v" de "Vamos").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechBounds, trimSpeechChannels } from '../src/lib/speechTrim.ts';
import { fitTempo } from '../src/lib/narrations.ts';

const RATE = 24000;

/** Monta um áudio a partir de pedaços: silêncio, tom (voz) ou ruído (chiado de "s"). */
function build(parts) {
  const total = parts.reduce((n, p) => n + Math.round(p.ms * RATE / 1000), 0);
  const out = new Float32Array(total);
  let at = 0;
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  for (const p of parts) {
    const len = Math.round(p.ms * RATE / 1000);
    for (let i = 0; i < len; i++) {
      if (p.kind === 'tone') out[at + i] = p.level * Math.sin((2 * Math.PI * (p.hz ?? 220) * i) / RATE);
      else if (p.kind === 'noise') out[at + i] = p.level * noise();
    }
    at += len;
  }
  return out;
}

const ms = (samples) => (samples / RATE) * 1000;

test('silêncio na frente sai: a fala começa na amostra do primeiro som', () => {
  const s = build([{ kind: 'silence', ms: 180 }, { kind: 'tone', level: 0.6, ms: 300 }, { kind: 'silence', ms: 400 }]);
  const { start, end } = speechBounds(s, RATE);
  assert.ok(Math.abs(ms(start) - 180) <= 1, `começa em ${ms(start).toFixed(1)} ms (esperado 180)`);
  assert.ok(ms(end) >= 480 && ms(end) <= 560, `termina em ${ms(end).toFixed(0)} ms: o fim fica com um respiro curto`);
});

test('contagem: o resto da palavra anterior (fraco, antes de uma pausa) sai', () => {
  // "...m" do "Um" vazando no começo do "Dois", depois a pausa e a palavra
  const s = build([
    { kind: 'tone', level: 0.12, hz: 180, ms: 200 },
    { kind: 'silence', ms: 40 },
    { kind: 'tone', level: 0.7, ms: 300 },
  ]);
  const { start } = speechBounds(s, RATE, { singleWord: true });
  assert.ok(Math.abs(ms(start) - 240) <= 2, `começa em ${ms(start).toFixed(1)} ms (esperado 240)`);
});

test('contagem: respiração fraca antes do número sai', () => {
  const s = build([
    { kind: 'noise', level: 0.02, ms: 50 },
    { kind: 'silence', ms: 30 },
    { kind: 'tone', level: 0.7, ms: 300 },
  ]);
  const { start } = speechBounds(s, RATE, { singleWord: true });
  assert.ok(Math.abs(ms(start) - 80) <= 2, `começa em ${ms(start).toFixed(1)} ms (esperado 80)`);
});

test('o "s" de "Seis" fica (chiado colado na vogal)', () => {
  const s = build([
    { kind: 'silence', ms: 60 },
    { kind: 'noise', level: 0.08, ms: 120 },
    { kind: 'silence', ms: 8 },
    { kind: 'tone', level: 0.7, ms: 300 },
  ]);
  for (const singleWord of [false, true]) {
    const { start } = speechBounds(s, RATE, { singleWord });
    assert.ok(Math.abs(ms(start) - 60) <= 2, `começa em ${ms(start).toFixed(1)} ms (esperado 60, no "s")`);
  }
});

test('o "v" de "Vamos" fica (voz fraca colada na vogal)', () => {
  const s = build([
    { kind: 'silence', ms: 50 },
    { kind: 'tone', level: 0.1, hz: 150, ms: 40 },
    { kind: 'tone', level: 0.7, ms: 300 },
  ]);
  const { start } = speechBounds(s, RATE);
  assert.ok(Math.abs(ms(start) - 50) <= 2, `começa em ${ms(start).toFixed(1)} ms (esperado 50, no "v")`);
});

test('fala comum: duas palavras com pausa entre elas ficam inteiras', () => {
  // "Fica... aí!": a primeira palavra é forte, nada dela pode sair
  const s = build([
    { kind: 'tone', level: 0.5, ms: 200 },
    { kind: 'silence', ms: 120 },
    { kind: 'tone', level: 0.7, ms: 250 },
  ]);
  // (a primeira amostra do seno é zero: o corte pode cair 1 amostra adiante)
  assert.ok(speechBounds(s, RATE).start <= 1);
  assert.ok(speechBounds(s, RATE, { singleWord: true }).start <= 1, 'parte forte nunca sai, nem na contagem');
});

test('o corte entra sem estalo e mantém todos os canais alinhados', () => {
  const s = build([{ kind: 'silence', ms: 100 }, { kind: 'tone', level: 0.6, ms: 200 }]);
  const [l, r] = trimSpeechChannels([s, s.slice()], RATE);
  assert.equal(l.length, r.length);
  assert.ok(Math.abs(l[0]) < 0.05, 'a primeira amostra entra baixinha (1 ms de entrada)');
  const firstLoud = l.findIndex((v) => Math.abs(v) > 0.3);
  assert.ok(ms(firstLoud) < 3, `a voz já está forte em ${ms(firstLoud).toFixed(1)} ms`);
});

test('silêncio puro volta inteiro (nada para cortar)', () => {
  const s = new Float32Array(RATE / 2);
  assert.deepEqual(speechBounds(s, RATE), { start: 0, end: s.length });
});

test('voz online: a velocidade segue a mesma regra da voz de IA do Mac', () => {
  // contagem: a velocidade escolhida; só acelera mais se o número não couber no tempo
  assert.equal(fitTempo(0.4, 0.5, 1.15).tempo, 1.15);
  assert.equal(fitTempo(0.8, 0.5, 1.15).tempo, 1.6);
  assert.equal(fitTempo(2, 0.5, 1.15).tempo, 1.8, 'não passa de 1,8×');
  assert.ok(fitTempo(2, 0.5, 1.15).overflow);
  // fala comum: nunca desacelera; acelera até 1,35× para caber
  assert.equal(fitTempo(1, 3).tempo, 1);
  assert.equal(fitTempo(1.2, 1).tempo, 1.2);
  assert.equal(fitTempo(3, 1).tempo, 1.35);
});
