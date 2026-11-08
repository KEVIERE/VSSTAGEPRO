// Separação da BATERIA em peças (desktop/drumPieces.js).
//
// O motor é o MDX23C do DrumSep (jarredou), em OpenVINO IR. É a família que o Moises usa e a de
// maior SDR disponível abertamente (bumbo 16,66 / caixa 11,53 / toms 12,33).
//
// Histórico que importa: antes usávamos o `drumsep_v2.onnx`, um fine-tune de bateria ELETRÔNICA.
// Na bateria acústica real ele dava correlação 0,9483, vazava 0,7 a 0,87 entre as peças (não
// separava: fatiava frequências) e deixava os pratos com 0,2% do agudo — o chimbal não aparecia.
// Era isso o "chiado" e a "qualidade ruim" que o produtor relatou.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const drumPieces = require('../desktop/drumPieces.js');

const desktop = path.join(import.meta.dirname, '..', 'desktop');

test('as peças são bumbo, caixa, tons, chimbal e pratos', () => {
  assert.deepEqual(
    drumPieces.PIECES.map((p) => p.id),
    ['bumbo', 'caixa', 'tons', 'chimbal', 'pratos'],
  );
  assert.deepEqual(
    drumPieces.PIECES.map((p) => p.name),
    ['Bumbo', 'Caixa', 'Tons', 'Chimbal', 'Pratos'],
  );
  for (const p of drumPieces.PIECES) assert.match(p.file, /\.wav$/);
});

test('o modelo é o MDX23C em OpenVINO, com o pipeline de 3 redes', () => {
  const { MODEL } = drumPieces;
  assert.match(MODEL.name, /MDX23C/);
  assert.match(MODEL.base, /^https:\/\/huggingface\.co\//);
  // pre (STFT) → fwd (rede) → post (iSTFT): o STFT não exporta para ONNX por causa dos complexos
  assert.deepEqual(MODEL.files, ['mdx23c_pre', 'mdx23c_fwd', 'mdx23c_post']);
  assert.ok(MODEL.bytes > 150 * 1024 * 1024, 'o modelo tem cerca de 215 MB');
});

test('o separador roda o pipeline correto e devolve as 5 peças na ordem do modelo', () => {
  const script = fs.readFileSync(path.join(desktop, 'drumPieceSeparator.py'), 'utf8');
  // o segmento é fixo: `pre` só aceita este tamanho
  assert.match(script, /SEGMENTO = 523776/);
  // normalização por segmento: sem ela a saída vem com amplitude errada por ordens de grandeza
  assert.match(script, /normalizado = \(pedaco - media\) \/ \(desvio \+ 1e-8\)/);
  // a ordem das peças NÃO pode mudar: foi conferida com tom puro de 60 Hz e de 10 kHz
  assert.match(script, /PIECES = \("bumbo", "caixa", "tons", "chimbal", "pratos"\)/);
  // sobreposição entre segmentos, senão a emenda estala
  assert.match(script, /SOBREPOSICAO = 0\.25/);
});

test('o runtime checado é o OpenVINO, não o ONNX Runtime', () => {
  const js = fs.readFileSync(path.join(desktop, 'drumPieces.js'), 'utf8');
  assert.match(js, /import openvino, numpy/);
  assert.doesNotMatch(js, /onnxruntime==1\.20\.1/);
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

// O worklet de reprodução lê UMA amostra do áudio por frame de saída, sem reamostrar. Um buffer
// de 44,1 kHz dentro de um AudioContext de 48 kHz toca 1,088x mais rápido — 4.875 ms de deriva
// por minuto. Era esse o "as tracks não ficaram sincadas" relatado pelo produtor: as peças
// nasciam a 44,1 kHz (é o que os modelos pedem) e eram guardadas com `putClipAudio`, que — ao
// contrário de `openClipAudio`/`readWav` — não converte para a taxa do dispositivo.
test('as peças separadas são convertidas para a taxa do dispositivo', () => {
  const fonte = fs.readFileSync(path.join(desktop, '..', 'src', 'lib', 'clipStemSplit.ts'), 'utf8');
  assert.match(fonte, /async function toDeviceRate\(/, 'existe a conversão para a taxa do dispositivo');
  assert.match(fonte, /const peca = await toDeviceRate\(part\.buffer\)/, 'a peça passa pela conversão');
  // WAV, picos, áudio guardado e o campo do clipe saem todos do buffer já convertido
  assert.match(fonte, /encodeWavPcm24\(peca\)/, 'o WAV exportado usa o buffer convertido');
  assert.match(fonte, /generateWaveformPeaks\(peca,/, 'os picos usam o buffer convertido');
  assert.match(fonte, /putClipAudio\(id, clip\.songId, await toClipAudioAsync\(peca\)\)/, 'o áudio guardado usa o buffer convertido');
  assert.match(fonte, /sampleRate: peca\.sampleRate/, 'o clipe guarda a taxa real do áudio');
});
