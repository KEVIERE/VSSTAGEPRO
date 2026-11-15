// No Mac a placa usa o menor bloco pedido entre todas as saídas abertas: nenhum AudioContext extra
// pode pedir bloco menor que o do motor das músicas (estalo e engasgo com música tocando).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('engineLatency lê a mesma chave do motor (estável por padrão)', () => {
  const lat = read('lib/engineLatency.ts');
  const engine = read('lib/audioEngine.ts');
  assert.match(engine, /const STABLE_MODE_LS = 'vs_stable_audio';/);
  assert.match(lat, /localStorage\.getItem\('vs_stable_audio'\) !== '0' \? 'playback' : 'interactive'/);
});

test('nenhum AudioContext extra sem latencyHint (o padrão interactive encurtaria o bloco do motor)', () => {
  const files = [
    'lib/padPlayer.ts', 'lib/audioOutput.ts', 'lib/clickGenerator.ts', 'lib/audioDeviceTest.ts', 'lib/audioRecorder.ts',
    'lib/crowdIsolation.ts', 'lib/audioDecoder.ts', 'lib/maestroVoice.ts', 'lib/bounceEngine.ts',
  ];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /new AudioContext(Class)?\(\)/, `${f}: AudioContext sem latencyHint`);
    assert.doesNotMatch(src, /latencyHint: (0|'interactive')\s*\}/, `${f}: bloco fixo menor que o do motor`);
  }
  // o que só guarda amostras nem abre saída
  assert.doesNotMatch(read('lib/crowdIsolation.ts'), /new AudioContext/);
});

test('painel de pads: sons carregam ao montar, saída só depois da pintura e sem criar com música tocando', () => {
  const panel = read('components/SamplePadPanel.tsx');
  assert.match(panel, /useEffect\(\(\) => \{ void loadPadSounds\(\); \}, \[\]\);/);
  assert.match(panel, /return afterPaint\(\(\) => \{ warmPadOutput\(\); \}\);/);
  assert.doesNotMatch(panel, /openPadOutput/);
  const player = read('lib/padPlayer.ts');
  assert.match(player, /export function loadPadSounds\(\): Promise<void> \{\s*return loadPads\(\)\.then\(\(\) => prepareBank\(getPadsState\(\)\.bank\)\);/);
  // painel e keepPadsReady pedem o mesmo banco: decodifica uma vez
  assert.match(player, /let job = decoding\.get\(slot\);/);
});

test('pads: bloco curto (toque sai na hora); as outras saídas extras seguem o bloco do motor', () => {
  const lat = read('lib/engineLatency.ts');
  assert.match(lat, /export function padLatencyHint\(\): AudioContextLatencyCategory \{\s*return 'interactive';/);
  const player = read('lib/padPlayer.ts');
  assert.doesNotMatch(player, /engineLatencyHint/);
  assert.match(player, /o\.hint === padLatencyHint\(\)/);
  for (const f of ['lib/audioOutput.ts', 'lib/clickGenerator.ts', 'lib/audioDeviceTest.ts', 'lib/audioRecorder.ts']) {
    assert.doesNotMatch(read(f), /padLatencyHint/, `${f}: só os pads usam o bloco curto`);
  }
});
