// Separação da BATERIA em peças (desktop/drumPieces.js): as peças oferecidas, o encaixe na pasta
// Bateria e a regra de que, sem o modelo, a música continua com a bateria inteira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const drumPieces = require('../desktop/drumPieces.js');

test('as peças são exatamente as do Moises: bumbo, caixa, pratos e tons', () => {
  assert.deepEqual(drumPieces.PIECES.map((p) => p.id), ['bumbo', 'caixa', 'pratos', 'tons']);
  assert.deepEqual(drumPieces.PIECES.map((p) => p.name), ['Bumbo', 'Caixa', 'Pratos', 'Tons']);
  for (const p of drumPieces.PIECES) assert.match(p.file, /\.wav$/);
});

test('o modelo é o drumsep v2 (o afinado para bateria), de licença livre', () => {
  const { MODEL } = drumPieces;
  assert.match(MODEL.file, /drumsep_v2\.onnx$/);
  assert.match(MODEL.url, /^https:\/\/huggingface\.co\//);
  assert.ok(MODEL.bytes > 300 * 1024 * 1024, 'o modelo tem cerca de 335 MB');
});

test('sem o modelo baixado, o status diz que não está pronto e nada quebra', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-drumsep-'));
  process.env.VS_DRUMSEP_HOME = home;
  try {
    const st = drumPieces.status();
    assert.equal(st.ready, false);
    assert.equal(st.state, 'missing');
    assert.equal(st.progress, 0);
    assert.equal(drumPieces.isReady(), false);
    // o caminho do modelo fica na pasta escolhida
    assert.equal(drumPieces.modelPath(), path.join(home, 'drumsep_v2.onnx'));
  } finally {
    delete process.env.VS_DRUMSEP_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('modelo pequeno demais (download pela metade) não conta como pronto', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-drumsep-'));
  process.env.VS_DRUMSEP_HOME = home;
  try {
    fs.writeFileSync(drumPieces.modelPath(), Buffer.alloc(1024 * 1024)); // 1 MB
    assert.equal(drumPieces.isReady(), false, 'um arquivo de 1 MB não serve');
  } finally {
    delete process.env.VS_DRUMSEP_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('o separador responde com JSON de erro quando falta o modelo, sem lançar', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-drumsep-'));
  process.env.VS_DRUMSEP_HOME = home;
  try {
    const wav = Buffer.alloc(2048);
    const out = await drumPieces.separateDrumPieces(wav);
    // sem python/onnxruntime/modelo nesta máquina, devolve o motivo e nenhuma peça
    assert.equal(out.bumbo, undefined);
    assert.ok(typeof out.why === 'string' && out.why.length > 0, `esperado um motivo, veio ${JSON.stringify(out)}`);
  } finally {
    delete process.env.VS_DRUMSEP_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
