// Faixa Maestro: REC e microfone em cima do M e S (sobra lugar para o fader) e o microfone escolhe
// a placa e o canal dela. A gravação pega só o canal escolhido (mono) e a escolha fica guardada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inputConstraints, inputLabel, meterBallistics, peakOf, pickDevice, saveMaestroInput, savedMaestroInput, usableChannel,
} from '../src/lib/maestroInput.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', 'src', ...p), 'utf8');

test('a entrada escolhida fica guardada; sem nada guardado é a padrão, canal 1', () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    assert.deepEqual(savedMaestroInput(), { deviceId: '', channel: 0 });
    saveMaestroInput({ deviceId: 'placa', channel: 1 });
    assert.deepEqual(savedMaestroInput(), { deviceId: 'placa', channel: 1 });
    mem.set('vsstage.maestroInput', '{"deviceId":"x","channel":-3}');
    assert.deepEqual(savedMaestroInput(), { deviceId: '', channel: 0 }, 'valor estranho volta ao padrão');
  } finally {
    globalThis.localStorage = saved;
  }
});

test('a placa abre crua: sem eco, redutor de ruído ou ganho automático, com todos os canais', () => {
  const a = inputConstraints('placa').audio;
  assert.deepEqual(a.deviceId, { exact: 'placa' });
  assert.equal(a.echoCancellation, false);
  assert.equal(a.noiseSuppression, false);
  assert.equal(a.autoGainControl, false);
  assert.deepEqual(a.channelCount, { ideal: 32 });
  assert.equal(inputConstraints('').audio.deviceId, undefined, 'sem placa escolhida usa a padrão do sistema');
});

test('canal que a placa não tem volta para o 1', () => {
  assert.equal(usableChannel(1, 2), 1);
  assert.equal(usableChannel(3, 2), 0);
  assert.equal(usableChannel(0, 0), 0);
});

test('nomes das placas na lista', () => {
  assert.deepEqual(inputLabel('Scarlett 2i2 USB', 0), { label: 'Scarlett 2i2 USB', named: true });
  assert.deepEqual(inputLabel('Default - Microfone do MacBook Pro', 0), { label: 'Padrão do sistema: Microfone do MacBook Pro', named: true });
  assert.deepEqual(inputLabel('', 1), { label: 'Entrada 2', named: false }, 'sem permissão vem sem nome');
});

test('placa guardada que sumiu volta para a primeira da lista', () => {
  const list = [{ deviceId: 'a', label: 'A', named: true }, { deviceId: 'b', label: 'B', named: true }];
  assert.equal(pickDevice('b', list), 'b');
  assert.equal(pickDevice('sumiu', list), 'a');
  assert.equal(pickDevice('x', []), '');
});

test('a gravação pega só o canal escolhido e solta o microfone ao parar', () => {
  const rec = read('lib', 'audioRecorder.ts');
  assert.match(rec, /createChannelSplitter\(channels\)/);
  assert.match(rec, /splitter\.connect\(pick, usableChannel\(input\.channel, channels\)\)/, 'liga só o canal escolhido');
  assert.match(rec, /dest\.channelCount = 1;/, 'grava mono');
  assert.match(rec, /new MediaRecorder\(this\.dest\.stream/, 'grava o canal escolhido, não a placa inteira');
  assert.match(rec, /await ctx\.resume\(\)/, 'sem isso a gravação sairia em silêncio');
  assert.match(rec, /this\.stream\?\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/, 'solta o microfone');
  assert.match(rec, /const probe = await navigator\.mediaDevices\.getUserMedia/, 'pede a permissão para os nomes aparecerem');
});

test('faixa Maestro: REC e microfone em cima do M e S, e o fader aparece como nas outras', () => {
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /const stackMaestro = isMaestro && !isChild && !compact && trackHeight >= 36;/);
  assert.match(panel, /const showFader = headerWidth >= \(isMaestro && !stackMaestro \? 240 : 170\);/, 'na coluna normal (220) o fader cabe');
  assert.match(panel, /\{stackMaestro && maestroControls\}\s*<div className="flex items-center gap-\[3px\]">/, 'REC e microfone na fileira de cima, M e S embaixo');
  assert.match(panel, /<LedMeterH id="input-maestro"/, 'gravando, o medidor mostra o sinal que entra');
  assert.match(panel, /<MaestroInputMenu/, 'o microfone abre o menu da entrada');
});

test('o menu da entrada fica por cima da tela, sem ser cortado pela coluna das faixas', () => {
  const menu = read('components', 'MaestroInputMenu.tsx');
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /document\.body,/);
  assert.match(menu, /aria-label="Canal da placa"/, 'escolhe o canal da placa');
  assert.match(menu, /<LedMeterH id="input-maestro"/, 'mostra o sinal do canal escolhido');
});

test('medidor do mic: sobe na hora e desce devagar, como os do mixer', () => {
  assert.equal(meterBallistics(0.1, 0.8, 0.033), 0.8, 'sobe na hora até o pico');
  const after = meterBallistics(1, 0, 0.1);
  assert.ok(Math.abs(20 * Math.log10(after) + 2.4) < 1e-9, 'desce 24 dB por segundo (2,4 dB em 0,1 s)');
  assert.equal(meterBallistics(1, 0, 5), meterBallistics(1, 0, 0.1), 'pausa longa não derruba de uma vez');
  assert.equal(peakOf(Float32Array.from([0.125, -0.75, 0.25])), 0.75);
});

test('medidor do mic não treme com a voz oscilando entre quadros', () => {
  // pico do instante alternando entre forte e fraco a cada quadro (o que fazia o medidor tremer)
  let level = 0;
  const shown = [];
  for (let k = 0; k < 30; k++) {
    level = meterBallistics(level, k % 2 === 0 ? 0.5 : 0.05, 0.033);
    shown.push(level);
  }
  const db = shown.slice(2).map((v) => 20 * Math.log10(v));
  assert.ok(Math.max(...db) - Math.min(...db) < 1, `varia menos de 1 dB (antes pulava 20 dB): ${(Math.max(...db) - Math.min(...db)).toFixed(2)} dB`);
});

test('o medidor do mic lê a janela dos medidores do mixer, sem exagero', () => {
  const rec = read('lib', 'audioRecorder.ts');
  assert.match(rec, /analyser\.fftSize = 2048;/);
  assert.match(rec, /getFloatTimeDomainData\(data\)/);
  assert.match(rec, /level = meterBallistics\(level, peakOf\(data\), \(now - last\) \/ 1000\);/);
  assert.doesNotMatch(rec, /peak \* 1\.6/, 'sem multiplicar o sinal');
  assert.doesNotMatch(rec, /getByteTimeDomainData/);
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /const level = db <= -48 \? 0 : Math\.min\(1, \(db \+ 48\) \/ 48\);/, 'o VU pequeno usa a escala em dB do mixer');
});
