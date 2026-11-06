// Separação da BATERIA em peças (desktop/drumPieces.js).
//
// O motor é o modelo drumsep_v2 (ONNX), um Hybrid Demucs afinado para bateria. Foi tentado
// trocá-lo pelo drumsep do cukas (processamento de sinal, leve), mas na música real ele jogou
// a energia do bumbo nos tons e entregou a caixa sem agudos — qualidade não serviu.
//
// O que resolveu o travamento (2,8 GB num Mac de 8 GB) foi rodar cada janela de 40 s num
// PROCESSO FILHO: o sistema recupera a memória quando ele termina. Ver drumPieceSeparator.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const drumPieces = require('../desktop/drumPieces.js');

const desktop = path.join(import.meta.dirname, '..', 'desktop');

test('as peças são bumbo, caixa, pratos e tons', () => {
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

test('a inferência roda em processo filho (o que evita travar o Mac de 8 GB)', () => {
  const script = fs.readFileSync(path.join(desktop, 'drumPieceSeparator.py'), 'utf8');
  assert.match(script, /subprocess\.run/, 'a janela roda em subprocesso');
  assert.match(script, /def run_window_local/, 'o worker tem a inferência local');
  // as duas entradas obrigatórias do modelo
  assert.match(script, /if "mag" in names/, 'envia a magnitude');
  assert.match(script, /if "mix" in names/, 'envia a onda crua');
  // a janela é fixa: o modelo recusa outro tamanho (conferido contra o .onnx)
  assert.match(script, /WINDOW = 1764000/);
  // sem isso a peça sai menor que a música e fica fora da grade
  assert.match(script, /length=|np\.zeros\(\(len\(PIECES\), 2, total\)/);
});

test('sem o separador disponível, devolve o motivo e nenhuma peça', async () => {
  const out = await drumPieces.separateDrumPieces(Buffer.alloc(2048));
  assert.equal(out.bumbo, undefined);
  assert.ok(typeof out.why === 'string' && out.why.length > 0, `esperado um motivo, veio ${JSON.stringify(out)}`);
});

test('o status informa o estado do modelo sem quebrar', () => {
  const st = drumPieces.status();
  assert.equal(typeof st.ready, 'boolean');
  assert.ok(['ready', 'missing', 'downloading', 'error'].includes(st.state), `estado inesperado: ${st.state}`);
});

// O modelo Hybrid Demucs tem DOIS ramos e a saída é a soma: `time_out` (áudio pronto) +
// `ispec(freq_out * fase_unitária)`. Usar só o ramo do tempo deixava as peças sem agudo —
// o chimbal não aparecia nos "Pratos" (2,9% acima de 2 kHz contra 90% na bateria real) e a
// caixa vinha sem a cordinha. Foi o "qualidade ruim" relatado pelo produtor.
test('a separação soma o ramo de frequência ao do tempo', () => {
  const script = fs.readFileSync(path.join(desktop, 'drumPieceSeparator.py'), 'utf8');
  assert.match(script, /freq_out/, 'pede a saída de frequência');
  assert.match(script, /time_out/, 'pede a saída de tempo');
  // freq_out é máscara: só vira som aplicada à fase unitária e passada pelo istft
  assert.match(script, /MÁSCARA/, 'documenta que freq_out é máscara');
  assert.match(script, /ESCALA_FREQ = 0\.25/, 'a escala medida contra a bateria real');
  assert.match(script, /istft/);
});
