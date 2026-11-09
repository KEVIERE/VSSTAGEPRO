// Regras puras das marcações de fala do Maestro por IA (ordem, espaço livre e velocidade).
// O Node importa o .ts direto, como nos outros testes do projeto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wpmForSpan, sortedNarrations, narrationSignature, currentSignature, narrationBounds, freeRunAt,
  spanForNatural, spanForWpm, MIN_WPM, MAX_WPM, BASE_WPM,
  beatStartAt, isOnBeat, placeNarration, syncedToCursor,
} from '../src/lib/narrations.ts';

test('marcação menor deixa a fala mais rápida', () => {
  const texto = 'Atenção, gente: dois compassos e entra o refrão';
  const curto = wpmForSpan(texto, 1.5);
  const longo = wpmForSpan(texto, 6);
  assert.ok(curto > longo, `curto (${curto}) deveria ser mais rápido que longo (${longo})`);
});

test('texto maior pede mais velocidade para o mesmo espaço', () => {
  const curto = wpmForSpan('Já vai', 4);
  const longo = wpmForSpan('Já vai começar o show, atenção todos os músicos', 4);
  assert.ok(longo > curto, `texto maior (${longo}) deveria ser mais rápido que curto (${curto})`);
});

test('velocidade fica sempre na faixa que o motor de voz aceita', () => {
  // marcação minúscula: sobe até o teto do motor, e para aí
  assert.equal(wpmForSpan('Uma palavra só', 0.35), MAX_WPM, 'espaço mínimo deveria bater no teto');
  // espaço enorme: a fala desacelera, mas não abaixo do piso do motor de voz
  assert.equal(wpmForSpan('a b c d e f g h i j k l', 60), MIN_WPM, 'espaço enorme deveria bater no piso');
});

test('o texto cabe dentro da marcação sempre que a velocidade permitir', () => {
  // texto de tamanho normal: em qualquer marcação razoável, a conta fecha dentro do espaço
  // (5% de folga cobre o arredondamento do motor de voz)
  const texto = 'Atenção gente dois compassos e entra o refrão de uma vez';
  const palavras = texto.split(/\s+/).length;
  for (const span of [2, 3.5, 6, 10]) {
    const wpm = wpmForSpan(texto, span);
    const segundos = (palavras / wpm) * 60;
    assert.ok(segundos <= span * 1.05, `com ${wpm} p/m as ${palavras} palavras levariam ${segundos.toFixed(2)}s, mais que os ${span}s marcados`);
  }
});

test('texto longo demais para o espaço bate no teto e não inventa velocidade', () => {
  // não há como caber: a velocidade para no máximo e a tela mostra que o áudio passa da marcação
  const texto = 'linha um linha dois linha três linha quatro linha cinco linha seis linha sete';
  assert.equal(wpmForSpan(texto, 0.4), MAX_WPM);
});

test('espaço do ritmo natural devolve uma fala calma, perto do natural', () => {
  // spanForNatural dá o espaço de conversa normal; voltando, a fala fica logo abaixo do
  // ritmo natural (a folga de 6% para o fim da frase), nunca mais rápida que ele.
  const texto = '1 2 3 4 5 6 7 8 9 10';
  const wpm = wpmForSpan(texto, spanForNatural(texto));
  assert.ok(wpm <= BASE_WPM, `a fala natural não deveria ficar mais rápida que ${BASE_WPM} (veio ${wpm})`);
  assert.ok(wpm >= BASE_WPM * 0.9, `esperava perto de ${BASE_WPM}, veio ${wpm}`);
});

test('marcações ficam em ordem de início', () => {
  const list = [
    { id: 'b', start: 4, end: 5 },
    { id: 'a', start: 1, end: 2 },
  ];
  assert.deepEqual(sortedNarrations(list).map((n) => n.id), ['a', 'b']);
});

test('assinatura muda com o texto, a voz e o tamanho (que é a velocidade)', () => {
  assert.notEqual(narrationSignature('oi', 'feminina', 2), narrationSignature('oi', 'masculina', 2));
  assert.notEqual(narrationSignature('oi', 'feminina', 2), narrationSignature('oi, tudo bem', 'feminina', 2));
  assert.notEqual(narrationSignature('oi', 'feminina', 2), narrationSignature('oi', 'feminina', 3), 'marcação maior = fala mais lenta = áudio novo');
  assert.equal(narrationSignature(' oi ', 'feminina', 2), narrationSignature('oi', 'feminina', 2.001), 'espaços e milésimos não contam');
  assert.equal(currentSignature({ text: 'oi', voice: 'feminina', start: 10, end: 12 }), narrationSignature('oi', 'feminina', 2));
});

test('mover a marcação sem mudar o tamanho não pede áudio novo', () => {
  const antes = currentSignature({ text: 'Vai!', voice: 'masculina', start: 4, end: 5.5 });
  const depois = currentSignature({ text: 'Vai!', voice: 'masculina', start: 20, end: 21.5 });
  assert.equal(antes, depois);
});

test('o controle de ritmo e o tamanho da marcação são a mesma conta', () => {
  const texto = 'Atenção gente dois compassos e entra o refrão';
  for (const wpm of [120, 165, 240]) {
    const span = spanForWpm(texto, wpm);
    assert.ok(Math.abs(wpmForSpan(texto, span) - wpm) <= 2, `com ${span.toFixed(2)}s deveria dar ~${wpm} p/m`);
  }
});

test('limites para redimensionar respeitam as vizinhas', () => {
  const song = { duration: 30, narrations: [{ id: 'x', start: 5, end: 8 }, { id: 'y', start: 12, end: 15 }] };
  assert.deepEqual(narrationBounds(song, 'y'), { min: 8, max: 30 });
  assert.deepEqual(narrationBounds(song, 'x'), { min: 0, max: 12 });
});

test('espaço livre para criar: dentro de uma marcação não cria', () => {
  const song = { duration: 30, narrations: [{ id: 'x', start: 5, end: 8 }, { id: 'y', start: 12, end: 15 }] };
  assert.equal(freeRunAt(song, 6), null);
  assert.deepEqual(freeRunAt(song, 9), { lo: 8, hi: 12 });
  assert.deepEqual(freeRunAt(song, 8), { lo: 8, hi: 12 }, 'encostado no fim da anterior ainda é livre');
});

test('início do beat em que o cursor está (não o mais próximo)', () => {
  const song = { bpm: 120 }; // 0,5 s por beat
  assert.equal(beatStartAt(song, 1.4), 1.0, 'em 1,4s o beat que está tocando começou em 1,0s');
  assert.equal(beatStartAt(song, 1.0), 1.0);
  assert.equal(beatStartAt(song, 1.49), 1.5, 'quase no próximo beat (atraso do clique) conta como ele');
  assert.equal(beatStartAt(song, 0.1), 0);
  assert.equal(beatStartAt({ bpm: 0 }, 1.234), 1.234, 'sem BPM devolve o próprio tempo');
});

test('beat do cursor respeita as mudanças de andamento', () => {
  const song = {
    bpm: 120,
    tempoSegments: [
      { startTime: 0, endTime: 10, bpm: 120 },
      { startTime: 10, endTime: 40, bpm: 90 }, // 0,666 s por beat a partir de 10s
    ],
  };
  assert.equal(beatStartAt(song, 4.3), 4.0, 'antes da mudança: 0,5 s por beat');
  const t = beatStartAt(song, 11.0); // 10 + 1 beat de 0,666 = 10,666
  assert.ok(Math.abs(t - (10 + 60 / 90)) < 1e-9, `esperava 10,667s, veio ${t}`);
  assert.equal(isOnBeat(song, 10 + 2 * (60 / 90)), true);
  assert.equal(isOnBeat(song, 10.3), false);
});

test('início num beat é reconhecido', () => {
  assert.equal(isOnBeat({ bpm: 120 }, 2.0), true);
  assert.equal(isOnBeat({ bpm: 120 }, 2.2), false);
  assert.equal(isOnBeat({ bpm: 0 }, 0), false, 'sem BPM não tem beat');
});

test('arrastar por cima de outra marcação cai no espaço livre mais perto', () => {
  const song = { duration: 30, narrations: [{ id: 'a', start: 5, end: 8 }, { id: 'b', start: 10, end: 12 }] };
  assert.equal(placeNarration(song, 'b', 20, 2), 20, 'espaço livre: fica onde soltou');
  assert.equal(placeNarration(song, 'b', 5.2, 2), 3, 'em cima de "a": andar 2,2s para trás é menos que 2,8s para frente');
  assert.equal(placeNarration(song, 'b', 6, 2), 8, 'em cima de "a": andar 2s para frente é menos que 3s para trás');
  assert.equal(placeNarration(song, 'b', 29.5, 2), 28, 'não passa do fim da música');
  assert.equal(placeNarration({ duration: 4, narrations: [{ id: 'a', start: 0, end: 3 }] }, 'z', 1, 2), null, 'sem espaço: não encaixa');
});

test('sincar no beat do cursor mantém o tamanho e não invade as vizinhas', () => {
  const song = { bpm: 120, duration: 30, narrations: [{ id: 'x', start: 5, end: 7 }, { id: 'y', start: 12, end: 15 }] };
  const placed = syncedToCursor(song, 'y', 13.2);
  assert.deepEqual(placed, { start: 13, end: 16 }, 'beat de 13,2s começa em 13,0s; o tamanho (3s) não muda');
  const encostada = syncedToCursor(song, 'y', 6.2);
  assert.ok(encostada.start >= 7, 'nunca invade a marcação de trás');
  assert.equal(encostada.end - encostada.start, 3);
});

// --- contagem e encaixe na grade ---------------------------------------------------------------
import { beatTimesFrom, countWords, clipPlacement } from '../src/lib/narrations.ts';

test('contagem: um tempo por click, a partir do tempo do cursor', () => {
  const song = { bpm: 120 }; // 0,5 s por tempo
  assert.deepEqual(beatTimesFrom(song, 2.2, 5), [2, 2.5, 3, 3.5, 4], 'o cursor em 2,2s começa no tempo de 2,0s');
  assert.deepEqual(beatTimesFrom({ bpm: 0 }, 1, 4), [], 'sem BPM não há grade');
});

test('contagem segue a mudança de andamento no meio do caminho', () => {
  const song = { bpm: 120, tempoSegments: [{ startTime: 0, endTime: 2, bpm: 120 }, { startTime: 2, endTime: 40, bpm: 60 }] };
  assert.deepEqual(beatTimesFrom(song, 1, 5), [1, 1.5, 2, 3, 4], 'depois de 2s o tempo passa a durar 1s');
});

test('números falados: 1 a N, ou recomeçando a cada compasso', () => {
  assert.deepEqual(countWords(4, 4, false), ['Um!', 'Dois!', 'Três!', 'Quatro!']);
  assert.deepEqual(countWords(8, 4, true), ['Um!', 'Dois!', 'Três!', 'Quatro!', 'Um!', 'Dois!', 'Três!', 'Quatro!']);
  assert.equal(countWords(6, 3, false)[5], 'Seis!');
});

test('a velocidade fixa da contagem entra na assinatura (mudou, gera de novo)', () => {
  assert.notEqual(narrationSignature('Um!', 'feminina', 0.5, 1.1), narrationSignature('Um!', 'feminina', 0.5, 1.3));
  assert.equal(narrationSignature('Um!', 'feminina', 0.5), narrationSignature('Um!', 'feminina', 0.5, undefined), 'fala comum continua igual');
  assert.notEqual(narrationSignature('Um!', 'feminina', 0.5, 1.1, 'grave'), narrationSignature('Um!', 'feminina', 0.5, 1.1), 'mudou o tom: gera de novo');
  assert.equal(narrationSignature('Um!', 'feminina', 0.5, 1.1, 'padrao'), narrationSignature('Um!', 'feminina', 0.5, 1.1), 'tom padrão = sem tom');
});

test('o clipe da fala começa justo na linha da grade (sem adiantar nem atrasar)', () => {
  assert.deepEqual(clipPlacement(4), { startTime: 4, trimStart: 0 });
  assert.deepEqual(clipPlacement(-0.01), { startTime: 0, trimStart: 0 }, 'nunca antes do zero');
});
