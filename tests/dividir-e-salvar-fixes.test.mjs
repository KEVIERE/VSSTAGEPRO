// Dividir pelos menus (Editar e botão direito no clipe) recusado com a música tocando, como a
// tecla S da timeline, e ⌘S / menu Salvar que esperam a música parar para gravar o .vss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('menu Editar: "Dividir Clipes no Cursor" recusa com a música tocando e fica apagado', () => {
  const src = read('../src/components/MenuBar.tsx');
  const item = src.slice(src.indexOf("label: 'Dividir Clipes no Cursor'"), src.indexOf("label: 'Excluir Clipes Selecionados'"));
  assert.match(item, /const playing = !!sid && st\.transport\.isPlaying && st\.transport\.currentSongId === sid;/);
  assert.match(item, /if \(sid && !st\.timelineLocked && !playing\)/);
  assert.ok(item.indexOf('!playing') < item.indexOf('splitClipsAt('), 'recusa antes de dividir');
  assert.doesNotMatch(item, /getCurrentTime/, 'não corta mais no instante do áudio');
  assert.match(item, /st\.splitClipsAt\(targetIds, cursor\)\) \{\s*audioEngine\.invalidatePrepared\(sid\);/);
  assert.match(item, /shortcut: splitBlocked \? 'Pare para dividir' : 'S'/);
  assert.match(item, /disabled: splitBlocked/);
  assert.match(src, /disabled=\{item\.disabled\}/);
  assert.match(src, /onClick=\{\(\) => \{ if \(!item\.disabled\) item\.action\?\.\(\); \}\}/);
});

test('botão direito no clipe: "Dividir no Cursor" recusa com a música do clipe tocando', () => {
  const src = read('../src/components/ContextMenu.tsx');
  const start = src.indexOf('disabled={timelineLocked || (!!clip && clip.songId === playingSongId)}');
  assert.ok(start > 0, 'item apagado com a música do clipe tocando ou a timeline travada');
  const item = src.slice(start, src.indexOf('Dividir no Cursor (Split)', start) + 200);
  assert.match(item, /const playing = !!target && st\.transport\.isPlaying && st\.transport\.currentSongId === target\.songId;/);
  assert.match(item, /if \(target && !st\.timelineLocked && !playing && st\.splitClipAt\(target\.id, st\.transport\.currentTime\)\) \{\s*audioEngine\.invalidatePrepared\(target\.songId\);/);
  assert.match(item, /Pare para dividir/);
  assert.match(src, /const playingSongId = useStore\(\(s\) => \(s\.transport\.isPlaying \? s\.transport\.currentSongId : null\)\);/);
});

test('⌘S com a música tocando: só .vss (path e package) espera; now: true e pasta gravam na hora', () => {
  const src = read('../src/lib/projectQuickSave.ts');
  const fn = src.slice(src.indexOf('export async function saveCurrentProject('));
  assert.match(fn, /if \(!opts\.now && st\.transport\.isPlaying && \(target\.kind === 'path' \|\| target\.kind === 'package'\)\) \{\s*return saveWhenStopped\(target\);/);
  assert.ok(fn.indexOf('saveWhenStopped(target)') < fn.indexOf("kind: 'saving'"), 'espera antes de começar a gravar');
  assert.match(src, /export const SAVE_WHEN_STOPPED = 'Será salvo quando a música parar';/);
  const menu = read('../src/components/MenuBar.tsx');
  assert.match(menu, /useSyncExternalStore\(subscribeSaveWaiting, isSaveWaitingStop\)/);
  assert.match(menu, /\{SAVE_WHEN_STOPPED\}/);
});

// Lógica de esperar a parada tirada do projectQuickSave.ts, com uma store de mentira
function loadWaitLogic() {
  const src = read('../src/lib/projectQuickSave.ts');
  const start = src.indexOf('let waitingStop');
  const end = src.indexOf('/**\n * Salva por cima do arquivo do projeto atual');
  assert.ok(start > 0 && end > start, 'bloco do salvar depois da parada');
  const js = stripTypeScriptTypes(src.slice(start, end)).replace(/\bexport\s+/g, '');
  const factory = new Function('useStore', 'hasUnsavedChanges', 'window', 'saveCurrentProject',
    `${js}\nreturn { saveWhenStopped, isSaveWaitingStop, subscribeSaveWaiting };`);
  let state = {
    transport: { isPlaying: true },
    saveStatus: null,
    saveTarget: { kind: 'path', path: '/show.vss', name: 'show.vss' },
    unsaved: true,
  };
  const listeners = new Set();
  const store = {
    getState: () => state,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of [...listeners]) fn(state, prev);
    },
  };
  const saves = [];
  const fakeSave = async (opts) => {
    saves.push({ opts, playing: state.transport.isPlaying });
    return true;
  };
  const api = factory(store, (s) => s.unsaved, { setTimeout: (fn, ms) => setTimeout(fn, ms) }, fakeSave);
  return { api, store, saves };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('salvar depois da parada: vários ⌘S viram um só, e grava só quando a música para', async () => {
  const { api, store, saves } = loadWaitLogic();
  let notes = 0;
  api.subscribeSaveWaiting(() => { notes += 1; });
  const target = store.getState().saveTarget;
  const a = api.saveWhenStopped(target);
  const b = api.saveWhenStopped(target);
  assert.equal(a, b, 'o segundo ⌘S reaproveita o mesmo pedido');
  assert.equal(api.isSaveWaitingStop(), true);
  await tick();
  assert.equal(saves.length, 0, 'nada gravado com a música tocando');
  store.set({ transport: { isPlaying: false } });
  assert.equal(await a, true);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], { opts: { now: true }, playing: false });
  assert.equal(api.isSaveWaitingStop(), false);
  assert.equal(notes, 2, 'avisa a barra ao começar e ao terminar a espera');
});

test('salvar depois da parada: projeto trocado ao parar (abrir ou novo) não grava o antigo', async () => {
  const { api, store, saves } = loadWaitLogic();
  const p = api.saveWhenStopped(store.getState().saveTarget);
  // abrir outro projeto para a música e troca o projeto no mesmo instante
  store.set({ transport: { isPlaying: false } });
  store.set({ saveTarget: null, unsaved: false });
  assert.equal(await p, true);
  assert.equal(saves.length, 0, 'não grava nem abre a janela de salvar do projeto novo');
});

test('salvar depois da parada: outro salvar já gravando na parada (músico) não grava duas vezes', async () => {
  const { api, store, saves } = loadWaitLogic();
  const p = api.saveWhenStopped(store.getState().saveTarget);
  store.set({ transport: { isPlaying: false }, saveStatus: { kind: 'saving', message: 'Salvando...' } });
  await tick();
  assert.equal(saves.length, 0);
  store.set({ saveStatus: { kind: 'saved', message: 'Salvo' }, unsaved: false });
  assert.equal(await p, true);
  assert.equal(saves.length, 0);
});
