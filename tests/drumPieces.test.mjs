// Separação da BATERIA em peças (desktop/drumPieces.js): as peças oferecidas e a regra de que,
// sem o separador, a música continua com a bateria inteira.
//
// O motor é o drumsep (github.com/cukas/drumsep, MIT), embutido em desktop/drumsep. É
// processamento de sinal — não há modelo ONNX para baixar. O modelo anterior pedia 2,8 GB de RAM
// por janela de 40 s e travava Macs de 8 GB (relato do usuário em 06/11/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const drumPieces = require('../desktop/drumPieces.js');

const desktop = path.join(import.meta.dirname, '..', 'desktop');

test('as peças: bumbo, caixa, chimbal, pratos e tons', () => {
  assert.deepEqual(drumPieces.PIECES.map((p) => p.id), ['bumbo', 'caixa', 'chimbal', 'pratos', 'tons']);
  assert.deepEqual(drumPieces.PIECES.map((p) => p.name), ['Bumbo', 'Caixa', 'Chimbal', 'Pratos', 'Tons']);
  for (const p of drumPieces.PIECES) assert.match(p.file, /\.wav$/);
});

test('o drumsep está embutido, com a licença do projeto original', () => {
  const dir = path.join(desktop, 'drumsep');
  assert.ok(fs.existsSync(path.join(dir, 'separator.py')), 'separator.py do drumsep');
  assert.ok(fs.existsSync(path.join(dir, '__init__.py')), '__init__.py do drumsep');
  const license = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Nicolas Cukas/);
});

test('o script do separador não depende mais de modelo ONNX', () => {
  const script = fs.readFileSync(path.join(desktop, 'drumPieceSeparator.py'), 'utf8');
  assert.doesNotMatch(script, /onnxruntime/, 'não usa mais o runtime ONNX');
  assert.match(script, /import drumsep/, 'usa o drumsep embutido');
  // as peças que o script declara batem com as do app
  assert.match(script, /PIECES = \("bumbo", "caixa", "chimbal", "pratos", "tons"\)/);
});

test('sem o separador disponível, devolve o motivo e nenhuma peça', async () => {
  const wav = Buffer.alloc(2048);
  const out = await drumPieces.separateDrumPieces(wav);
  // nesta máquina pode faltar Python com librosa: o contrato é devolver `why`, nunca lançar
  assert.equal(out.bumbo, undefined);
  assert.ok(typeof out.why === 'string' && out.why.length > 0, `esperado um motivo, veio ${JSON.stringify(out)}`);
});

test('o status informa o motor atual sem quebrar', () => {
  const st = drumPieces.status();
  assert.equal(typeof st.ready, 'boolean');
  assert.ok(['ready', 'missing', 'downloading', 'error'].includes(st.state), `estado inesperado: ${st.state}`);
});
