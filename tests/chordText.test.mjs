// Colar cifra em texto no caderno do músico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChordToken, isChordRow, linesFromChordText } from '../src/lib/notebook.ts';

test('reconhece acordes e não confunde palavras', () => {
  for (const c of ['C', 'Am', 'F#m7', 'G/B', 'C7M', 'Bb9', 'D4', 'Dsus4', 'Em7(b5)', 'A7(9)', 'C/E', 'Cº', 'Gadd9', '(Am)']) assert.ok(isChordToken(c), c);
  for (const w of ['Eu', 'Amor', 'De', 'Cristo', 'Glória', 'Bem', 'Ah']) assert.ok(!isChordToken(w), w);
  assert.ok(isChordRow('  G        D/F#     Em   C'));
  assert.ok(!isChordRow('Em teus braços'));
  assert.ok(isChordRow('Em'));
});

test('cifra estilo site: acorde em cima da letra', () => {
  const text = [
    '[Intro] G  D  Em  C',
    '',
    '[Primeira Parte]',
    'G              D',
    '  Quão grande és tu',
    '       Em        C',
    'Meu Deus e Senhor',
    '',
    '[Refrão]',
    'C    G',
  ].join('\n');
  const lines = linesFromChordText(text);
  assert.deepEqual(lines.map((l) => l.kind), ['section', 'chords', 'text', 'section', 'chords', 'chords', 'text', 'section', 'chords']);
  assert.equal(lines[0].label, 'Intro');
  assert.deepEqual(lines[1].chords.map((c) => c.chord), ['G', 'D', 'Em', 'C']);
  const v1 = lines[4];
  assert.equal(v1.lyric, 'Quão grande és tu');
  // G cai em "Quão" (col 0 depois de tirar o recuo), D em "és" (col 13)
  assert.deepEqual(v1.chords, [{ at: 0, chord: 'G' }, { at: 12, chord: "D" }]);
  const v2 = lines[5];
  assert.equal(v2.lyric, 'Meu Deus e Senhor');
  assert.deepEqual(v2.chords.map((c) => [v2.lyric.slice(c.at).split(' ')[0], c.chord]), [['Deus', 'Em'], ['Senhor', 'C']]);
});

test('dois acordes na mesma palavra não se perdem', () => {
  const [l] = linesFromChordText('C   G\nAleluia');
  assert.equal(l.chords.length, 2);
  assert.equal(new Set(l.chords.map((c) => c.at)).size, 2);
});

test('acordes no meio do texto e letra sem acordes', () => {
  const lines = linesFromChordText('Eu [G]sei que [D/F#]vais voltar\nSó a letra aqui');
  assert.equal(lines[0].lyric, 'Eu sei que vais voltar');
  assert.deepEqual(lines[0].chords, [{ at: 3, chord: 'G' }, { at: 11, chord: 'D/F#' }]);
  assert.deepEqual(lines[1], { ...lines[1], kind: 'chords', lyric: 'Só a letra aqui', chords: [] });
});

test('tablatura vira texto', () => {
  const lines = linesFromChordText('E|-----3---2---|\nB|---3---------|');
  assert.ok(lines.every((l) => l.kind === 'text'));
});
