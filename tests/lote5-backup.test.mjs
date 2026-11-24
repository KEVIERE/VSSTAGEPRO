// Lote 5, passo 2: o ⌘S só guarda backup quando algo mudou. Antes, dez ⌘S sem mudança gravavam
// dez cópias iguais e apagavam todos os backups úteis (só os 10 mais novos ficam). Com mudança no
// projeto, o backup começa antes de gravar, como antes. Falhou ou cancelou: guarda, como antes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Tudo em volta do salvar vira módulo de mentira; o projectQuickSave.ts é o real.
globalThis.__qs = { backups: [], next: null, state: null, unsaved: false, order: [] };
const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/store': [
    'export const useStore = { getState: () => globalThis.__qs.state, subscribe: () => () => {} };',
    'export const hasUnsavedChanges = () => globalThis.__qs.unsaved;',
  ].join('\\n'),
  '@/lib/projectSaver': [
    'export const quickSave = async () => { globalThis.__qs.order.push("gravar"); const n = globalThis.__qs.next; if (n instanceof Error) throw n; return n; };',
    'export const reopenProject = async () => { throw new Error("não usado"); };',
    'export const saveTargetLabel = (t) => t.name;',
  ].join('\\n'),
  '@/lib/transportControl': 'export const stopPlayback = () => {};',
  '@/lib/recentProjects': 'export const forgetRecentProject = async () => {}; export const rememberProject = async () => {};',
  '@/lib/projectBackups': 'export const saveProjectBackup = async (st) => { globalThis.__qs.order.push("backup"); globalThis.__qs.backups.push(st); return null; };',
  '@/lib/friendlyError': 'export const friendlyError = (e, f) => f ?? String(e);',
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

globalThis.window = { setTimeout: () => 0, clearTimeout: () => {} };
const quick = await import('../src/lib/projectQuickSave.ts');

function fakeState() {
  const s = {
    saveStatus: null,
    saveTarget: { kind: 'path', path: '/Show.vss', name: 'Show.vss' },
    transport: { isPlaying: false },
    projectName: 'Show',
    exportProgress: null,
    setSaveStatus: (v) => { s.saveStatus = v; },
    setExportProgress: (v) => { s.exportProgress = v; },
    markProjectSaved: () => {},
    setSaveTarget: (t) => { s.saveTarget = t; },
    setSaveDialogOpen: () => {},
  };
  return s;
}

async function save(result, unsaved = false) {
  globalThis.__qs.state = fakeState();
  globalThis.__qs.backups = [];
  globalThis.__qs.order = [];
  globalThis.__qs.unsaved = unsaved;
  globalThis.__qs.next = result;
  const err = console.error;
  console.error = () => {};
  try {
    const ok = await quick.saveCurrentProject();
    return { ok, backups: globalThis.__qs.backups, state: globalThis.__qs.state, order: globalThis.__qs.order };
  } finally {
    console.error = err;
  }
}

test('⌘S sem mudança nenhuma: não guarda backup (os 10 úteis continuam lá)', async () => {
  const r = await save({ missingCount: 0, unchanged: true });
  assert.equal(r.ok, true);
  assert.equal(r.backups.length, 0);
  assert.match(r.state.saveStatus.message, /Nada mudou/);
});

test('⌘S com mudança no projeto: guarda o backup antes de gravar, como antes', async () => {
  const r = await save({ missingCount: 0 }, true);
  assert.equal(r.ok, true);
  assert.equal(r.backups.length, 1);
  assert.deepEqual(r.order, ['backup', 'gravar'], 'se cair no meio do salvar, o backup já começou');
  assert.equal(r.backups[0], r.state, 'o estado de quando o salvar começou');
});

test('⌘S só com o que o Desfazer não vê (zoom, pads) e o arquivo mudou: guarda depois de gravar', async () => {
  const r = await save({ missingCount: 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.order, ['gravar', 'backup']);
});

test('⌘S que falhou ou foi cancelado: guarda o backup como antes', async () => {
  for (const unsaved of [false, true]) {
    const failed = await save(new Error('disco cheio'), unsaved);
    assert.equal(failed.ok, false);
    assert.equal(failed.backups.length, 1);
    const cancelled = await save(new DOMException('Cancelado', 'AbortError'), unsaved);
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.backups.length, 1);
  }
});

test('dez ⌘S seguidos sem mudança depois de um salvar: um backup só', async () => {
  let total = 0;
  total += (await save({ missingCount: 0 }, true)).backups.length;
  for (let i = 0; i < 10; i++) total += (await save({ missingCount: 0, unchanged: true })).backups.length;
  assert.equal(total, 1);
});
