// Mexer na tela com música tocando não pode engasgar o áudio: nada de window.confirm/alert
// (param o programa inteiro), Modo Show trocado em segundo plano e sem animar a largura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPromptChannel, askImportAgain, duplicateImportPrompt } from '../src/lib/appPrompt.ts';

const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('pergunta com janela montada: mostra, responde e fecha', async () => {
  const ch = createPromptChannel(50);
  const shown = [];
  const off = ch.register((p) => shown.push(p));
  const res = ch.ask((answer) => ({ q: 'a', answer }), 'cancel');
  assert.equal(shown.length, 1);
  assert.equal(shown[0].q, 'a');
  shown[0].answer('save');
  assert.equal(await res, 'save');
  assert.equal(shown.at(-1), null, 'a janela fecha');
  off();
});

test('sem janela: espera ela montar e então mostra', async () => {
  const ch = createPromptChannel(200);
  const res = ch.ask((answer) => ({ answer }), 'cancel');
  await new Promise((r) => setTimeout(r, 20));
  let prompt = null;
  ch.register((p) => { if (p) prompt = p; });
  assert.ok(prompt, 'apareceu quando a janela montou');
  prompt.answer('discard');
  assert.equal(await res, 'discard');
});

test('sem janela nenhuma: devolve o padrão depois do prazo, sem travar', async () => {
  const ch = createPromptChannel(30);
  assert.equal(await ch.ask((answer) => ({ answer }), 'cancel'), 'cancel');
});

test('uma pergunta por vez; a da fila não vence o prazo enquanto espera a vez', async () => {
  const ch = createPromptChannel(20);
  const shown = [];
  ch.register((p) => { if (p) shown.push(p); });
  const a = ch.ask((answer) => ({ id: 1, answer }), 0);
  const b = ch.ask((answer) => ({ id: 2, answer }), 0);
  assert.equal(shown.length, 1);
  await new Promise((r) => setTimeout(r, 50));
  shown[0].answer(10);
  assert.equal(await a, 10);
  assert.equal(shown.length, 2);
  assert.equal(shown[1].id, 2);
  shown[1].answer(20);
  assert.equal(await b, 20);
});

test('a janela sai com a pergunta aberta: devolve o padrão', async () => {
  const ch = createPromptChannel(20);
  const off = ch.register(() => {});
  const res = ch.ask((answer) => ({ answer }), 'cancel');
  off();
  assert.equal(await res, 'cancel');
});

test('música repetida: "Importar de novo" e "Pular" chegam à importação', async () => {
  let prompt = null;
  const off = duplicateImportPrompt.register((p) => { prompt = p; });
  const yes = askImportAgain('Ousado Amor');
  assert.equal(prompt.songName, 'Ousado Amor');
  prompt.answer(true);
  assert.equal(await yes, true);
  const no = askImportAgain('Ousado Amor');
  prompt.answer(false);
  assert.equal(await no, false);
  off();
});

test('nenhuma janela do navegador que para o programa nesses caminhos', () => {
  assert.doesNotMatch(read('lib/importManager.ts'), /window\.confirm\(/);
  assert.match(read('lib/importManager.ts'), /await askImportAgain\(groupName\)/);
  assert.doesNotMatch(read('lib/unsavedChanges.ts'), /window\.confirm\(/);
  const timeline = read('components/TimelinePanel.tsx');
  assert.doesNotMatch(timeline, /\balert\('Não foi possível acessar a entrada de áudio/);
  assert.match(timeline, /setPlaybackError\('Não foi possível acessar a entrada de áudio/);
  assert.match(read('App.tsx'), /<ImportDuplicateDialog \/>/);
});

test('Modo Show: a tela troca na hora e a playlist não anima a largura na troca', () => {
  const app = read('App.tsx');
  // o adiamento com startTransition saiu: tocando, a store descartava a montagem e só atrasava
  assert.doesNotMatch(app, /useShowModeView/);
  assert.match(app, /const playlistMaximized = useStore\(\(s\) => s\.playlistMaximized\);/);
  assert.match(app, /<PlaylistPanel maximized=\{playlistMaximized\} /);
  const panel = read('components/PlaylistPanel.tsx');
  assert.match(panel, /\$\{modeJustChanged \? '' : 'transition-\[width\] duration-200'\}/);
  assert.match(panel, /useLayoutEffect\(\(\) => \{ prevMaximized\.current = playlistMaximized; \}, \[playlistMaximized\]\);/);
});
