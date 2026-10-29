// Tom da música: detecção pelo áudio, nomes em cifra curta e transposição com o tuner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectKey, keyName, parseKey, songKeyLabel, transposeKey } from '../src/lib/musicKey.ts';

const SR = 22050;
const NOTE = { C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
// acorde (fundamental, terça, quinta) com harmônicos, como um teclado/violão
function progression(chords, secondsEach = 2) {
  const n = Math.round(SR * secondsEach);
  const out = new Float32Array(n * chords.length);
  chords.forEach((ch, ci) => {
    const [root, minor] = [NOTE[ch.replace('m', '')], ch.endsWith('m')];
    const pcs = [root, root + (minor ? 3 : 4), root + 7];
    for (const pc of pcs) {
      const f0 = 130.81 * Math.pow(2, pc / 12); // a partir do Dó3
      for (let h = 1; h <= 4; h++) {
        const a = 0.2 / h;
        for (let i = 0; i < n; i++) out[ci * n + i] += a * Math.sin(2 * Math.PI * f0 * h * i / SR) * Math.exp(-i / (SR * 1.5));
      }
    }
    // baixo na fundamental
    const fb = 65.41 * Math.pow(2, root / 12);
    for (let i = 0; i < n; i++) out[ci * n + i] += 0.3 * Math.sin(2 * Math.PI * fb * i / SR);
  });
  return out;
}

const cases = [
  ['G', ['G', 'D', 'Em', 'C', 'G', 'C', 'D', 'G']],
  ['C', ['C', 'G', 'Am', 'F', 'C', 'F', 'G', 'C']],
  ['D', ['D', 'A', 'Bm', 'G', 'D', 'G', 'A', 'D']],
  ['Am', ['Am', 'Dm', 'E', 'Am', 'F', 'Dm', 'E', 'Am']],
  ['Em', ['Em', 'Am', 'B', 'Em', 'C', 'Am', 'B', 'Em']],
  ['Bb', ['Bb', 'F', 'Gm', 'Eb', 'Bb', 'Eb', 'F', 'Bb']],
];
for (const [want, chords] of cases) {
  test(`progressão em ${want} é detectada como ${want}`, () => {
    const r = detectKey(progression(chords), SR);
    assert.ok(r, 'detectou algo');
    assert.equal(r.key, want);
  });
}

test('silêncio não inventa tom', () => {
  assert.equal(detectKey(new Float32Array(SR * 4), SR), null);
});

test('nomes: lê cifra e nome em português, escreve em cifra curta', () => {
  for (const [txt, want] of [['G', 'G'], ['Em', 'Em'], ['bbm', 'Bbm'], ['F#', 'F#'], ['Gb', 'F#'], ['A#m', 'Bbm'], ['Sol maior', 'G'], ['mi menor', 'Em'], ['Ré', 'D'], ['Lá m', 'Am']]) {
    const k = parseKey(txt);
    assert.ok(k, `entendeu ${txt}`);
    assert.equal(keyName(k), want, txt);
  }
  assert.equal(parseKey('xyz'), null);
  assert.equal(parseKey(''), null);
});

test('tuner transpõe o tom (G +2 = A, Em -3 = C#m, volta inteira)', () => {
  assert.equal(songKeyLabel({ musicKey: 'G', tuner: 2 }), 'A');
  assert.equal(songKeyLabel({ musicKey: 'Em', tuner: -3 }), 'C#m');
  assert.equal(songKeyLabel({ musicKey: 'C', tuner: 12 }), 'C');
  assert.equal(songKeyLabel({ musicKey: 'D' }), 'D');
  assert.equal(songKeyLabel({ musicKey: null, tuner: 2 }), '');
  assert.equal(keyName(transposeKey({ pc: 11, minor: false }, 1)), 'C');
});
