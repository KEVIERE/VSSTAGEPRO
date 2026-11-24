// Pads sem engasgo por causa da tela: arraste de knob avisa a tela por quadro e grava no fim,
// decodificação em fila sem som velho entrando no pad, memória com teto, cópia do projeto só do que
// mudou e saída aberta já na placa certa, com o bloco do motor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getPadsState, setPadsState, setPadsStateSoon, subscribePads } from '../src/lib/samplePads.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const player = read('../src/lib/padPlayer.ts');
const storage = read('../src/lib/padStorage.ts');
const panel = read('../src/components/SamplePadPanel.tsx');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('arraste: estado na hora, tela uma vez por quadro, localStorage só no fim', async () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  let calls = 0;
  const off = subscribePads(() => { calls++; });
  try {
    setPadsStateSoon({ master: 0.5 });
    setPadsStateSoon({ master: 0.6 });
    setPadsStateSoon({ master: 0.7 });
    assert.equal(getPadsState().master, 0.7, 'o áudio lê o valor novo na hora');
    assert.equal(calls, 0, 'a tela não é avisada a cada movimento');
    assert.equal(mem.get('vsstage.pads.master'), undefined, 'nada gravado durante o arraste');
    await wait(40);
    assert.equal(calls, 1, 'três movimentos, um aviso');
    await wait(450);
    assert.equal(mem.get('vsstage.pads.master'), '0.7', 'grava o último valor no fim');
    // um ajuste imediato depois de um arraste: o mais novo fica por cima
    setPadsStateSoon({ master: 1.0 });
    setPadsState({ master: 0.8 });
    assert.equal(mem.get('vsstage.pads.master'), '0.8');
    await wait(450);
    assert.equal(mem.get('vsstage.pads.master'), '0.8', 'o arraste antigo não volta depois');
  } finally {
    off();
    globalThis.localStorage = saved;
  }
});

test('decodificação: som velho não entra no pad depois de abrir projeto, limpar ou importar', () => {
  assert.match(player, /function bumpSlot\(slot: number\): void \{\s*slotGen\.set\(slot, \(slotGen\.get\(slot\) \?\? 0\) \+ 1\);\s*decoding\.delete\(slot\);/);
  assert.match(player, /export async function clearPad\(slot: number\): Promise<void> \{\s*release\(slot\);[\s\S]{0,120}bumpSlot\(slot\);/);
  assert.match(player, /bumpSlot\(slot\);\s*sources\.set\(slot, new Blob\(\[bytes\], \{ type \}\)\);/, 'importar');
  assert.match(player, /stopAllPads\(\);[\s\S]{0,160}epoch\+\+;\s*decoding\.clear\(\);/, 'projeto aberto');
  assert.match(player, /const buffer = await decodeBlob\(blob\);[\s\S]{0,140}if \(stale\(\)\) return;\s*buffers\.set\(slot, buffer\);/);
  assert.match(player, /if \(slotToken\(slot\) !== token\) return sources\.get\(slot\) \?\? null;/, 'leitura do computador também');
});

test('decodificação em fila (2 por vez) e pad tocado passa na frente', () => {
  assert.match(player, /const MAX_DECODES = 2;/);
  assert.match(player, /while \(decodesRunning < MAX_DECODES && decodeQueue\.length > 0\)/);
  assert.match(player, /if \(info && !buffer\) void requestDecode\(slot, true\);/);
});

test('memória: sons de outros bancos ficam até o teto, saem os usados há mais tempo', () => {
  assert.match(player, /const BUFFER_BUDGET_BYTES = 200 \* 1024 \* 1024;/);
  assert.match(player, /if \(slotBank\(slot\) === bank \|\| voices\.has\(slot\)\) continue;/, 'nunca o banco aberto nem o que toca');
  assert.doesNotMatch(player, /if \(slotBank\(slot\) !== bank && !voices\.has\(slot\)\) \{\s*buffers\.delete\(slot\);/, 'trocar de banco não joga tudo fora');
});

test('reverso e corte preparados na folga, não no toque', () => {
  assert.match(player, /function prepareCopiesSoon\(slot: number\): void \{/);
  assert.match(player, /if \(patch\.reverse \|\| 'trimStart' in patch \|\| 'trimEnd' in patch\) prepareCopiesSoon\(slot\);/);
});

test('knob e pitch: som na hora, gravação no computador ao soltar', () => {
  assert.match(player, /if \(live\) setPadsStateSoon\(\{ infos \}\);/);
  assert.match(player, /export function flushPadSave\(slot: number\): void/);
  assert.match(panel, /onChange=\{liveVolume\}/);
  assert.match(panel, /onCommit=\{commitSelected\}/);
  assert.match(panel, /const Pad = memo\(function Pad\(/);
});

test('padStorage: uma conexão só, reaberta se fechar', () => {
  assert.match(storage, /let dbOpen: Promise<IDBDatabase> \| null = null;/);
  assert.doesNotMatch(storage, /db\.close\(\); resolve/, 'não fecha a cada gravação');
  assert.match(storage, /db\.onversionchange = \(\) => \{ db\.close\(\); forget\(\); \};/);
});

test('projeto aberto: não regrava no computador o som igual ao guardado; espera a música parar', () => {
  assert.doesNotMatch(player, /await clearPads\(\);/);
  assert.match(player, /if \(rec && sameStoredAudio\(rec, info, blob\.size\)\)/);
  assert.match(player, /if \(!useStore\.getState\(\)\.transport\.isPlaying\) \{ go\(\); return; \}/);
});

test('saída: já na placa certa, só os canais usados, e bloco velho é trocado com tudo parado', () => {
  assert.match(player, /new AudioContext\(\{ latencyHint: padLatencyHint\(\), sinkId: sink \} as AudioContextOptions\)/);
  // no Master, `want` já é a saída real dele (par ou mono), então a conta é a mesma
  assert.match(player, /const want = picked\.channel > 0 \? picked : resolveMasterOutput\(/);
  assert.match(player, /const used = want\.channel \+ \(want\.stereo \? 1 : 0\);/);
  assert.match(player, /try \{ gain\.disconnect\(\); \} catch/);
  assert.match(player, /if \(voices\.size > 0 \|\| useStore\.getState\(\)\.transport\.isPlaying\) return false;/);
  assert.match(read('../src/lib/clickGenerator.ts'), /if \(previewCtx && previewHint !== hint\)/);
  assert.match(read('../src/lib/maestroVoice.ts'), /if \(previewCtx && previewHint !== hint\)/);
});
