// Área do Músico: envio de caderno que não troca o caderno do colega, aviso de quem ficou com o
// dele, hora do Mac no Remote e prazo do comando do Remote na Rede Local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readShareResult } from '../src/lib/musicianTypes.ts';
import { joinNames, shareMessage } from '../src/components/musician/notebook/shareMessage.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// localClientApi importa '@/lib/musicianTypes': aqui o atalho aponta para o arquivo de verdade.
const typesUrl = new URL('../src/lib/musicianTypes.ts', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === '@/lib/musicianTypes') return { shortCircuit: true, url: ${JSON.stringify(typesUrl)} };
  return next(spec, ctx);
}
`));
const api = await import('../src/lib/localClientApi.ts');

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}
globalThis.sessionStorage = memStorage();
globalThis.localStorage = memStorage();

/** fetch falso por rota (`/api/local/<rota>`); `routes[rota]` devolve [status, corpo] ou uma Promise. */
function fakeFetch(routes) {
  const calls = [];
  globalThis.fetch = (url, init = {}) => {
    const route = String(url).replace('/api/local/', '');
    calls.push({ route, init });
    const r = routes[route];
    if (typeof r === 'function') return r(init);
    const [status, body] = r ?? [404, { error: 'nope' }];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return calls;
}

test('resposta do envio: servidor antigo sem skipped, ids que não são texto ficam de fora', () => {
  assert.deepEqual(readShareResult({ count: 2 }), { count: 2, skipped: [] });
  assert.deepEqual(readShareResult({ count: '1', skipped: ['a', 3, null, 'b'] }), { count: 1, skipped: ['a', 'b'] });
  assert.deepEqual(readShareResult({}), { count: 0, skipped: [] });
});

test('nomes em português', () => {
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['Ana']), 'Ana');
  assert.equal(joinNames(['Ana', 'Bia']), 'Ana e Bia');
  assert.equal(joinNames(['Ana', 'Bia', 'Caio']), 'Ana, Bia e Caio');
});

test('aviso do envio: quem já tinha caderno aparece pelo nome e ninguém recebido não sai verde', () => {
  const col = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bia' }, { id: 'c', name: 'Caio' }];
  assert.deepEqual(shareMessage(2, [], col), { ok: true, text: 'Enviado: 2 músicos receberam a partitura desta música.' });
  assert.deepEqual(shareMessage(1, ['b'], col), {
    ok: true,
    text: 'Enviado: 1 músico recebeu a partitura desta música. Bia já tem caderno desta música; o caderno não foi trocado.',
  });
  // todos pulados: antes saía "Enviado: 0 músicos" em verde
  assert.deepEqual(shareMessage(0, ['a', 'c'], col), {
    ok: false, text: 'Ana e Caio já têm caderno desta música; os cadernos não foram trocados.',
  });
  // id que não está na lista de colegas
  assert.equal(shareMessage(0, ['x'], col).text, '1 colega já tem caderno desta música; o caderno não foi trocado.');
  assert.equal(shareMessage(0, [], col).ok, false);
  assert.doesNotMatch(shareMessage(0, [], col).text, /Enviado/);
});

test('Rede Local: o envio devolve quem ficou com o caderno dele', async () => {
  localStorage.setItem('vs_local_musician_remember', 'lembrado');
  fakeFetch({
    login: [200, { token: 'tk', name: 'Ana' }],
    'sheet-share': [200, { count: 1, skipped: ['acc-2', 7] }],
  });
  const backend = api.localAccountBackend('ana');
  assert.deepEqual(await backend.share('s1', ['acc-1', 'acc-2']), { count: 1, skipped: ['acc-2'] });
  api.forgetMusician();
});

test('Remote: sem a hora do Mac não vai a hora do celular', async () => {
  fakeFetch({ login: [200, { token: 'r1' }], 'remote-state': [200, { remote: { at: 1 } }] });
  const a = await api.localRemoteState('123456');
  assert.equal(a.serverNow, undefined);
  fakeFetch({ 'remote-state': [200, { remote: { at: 2 }, server_now: 1_700_000_000_000 }] });
  const b = await api.localRemoteState('123456');
  assert.equal(b.serverNow, 1_700_000_000_000);
  api.localForget('remote', '123456');
});

test('Remote: o comando que não volta é cancelado em 2 s (a fila desiste no mesmo tempo)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  sessionStorage.setItem('vs_local_token_remote_654321', 'tok');
  let signal = null;
  fakeFetch({
    transport: (init) => new Promise((_, reject) => {
      signal = init.signal;
      init.signal.addEventListener('abort', () => reject(new DOMException('cancelado', 'AbortError')));
    }),
  });
  const p = api.localRemoteCommand('654321', { type: 'play' });
  await Promise.resolve();
  t.mock.timers.tick(1999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(signal.aborted, true);
  await assert.rejects(p, /offline/);
});

test('migração nova: envio com skipped, cópias livres, consulta leve e caderno sem duplicar', () => {
  const dir = path.join(root, 'supabase', 'migrations');
  const file = fs.readdirSync(dir).find((f) => f.endsWith('_musician_sheets_share_and_stamp.sql'));
  assert.ok(file, 'migração presente');
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS received_at timestamptz/);
  assert.match(sql, /'skipped', to_json\(v_skipped\)/);
  assert.match(sql, /received_at <> s\.updated_at/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION musician_sheets_stamp\(text\) TO anon, authenticated/);
  assert.match(sql, /shared_from IS NULL\s+ORDER BY updated_at DESC/);
  // o limite de 1,5 MB da versão do caderno rico continua
  assert.match(sql, /> 1500000/);
});

test('telas: Rede Local avisa o motivo do sem sinal e o caderno segue o caderno mostrado', () => {
  assert.match(read('src', 'components', 'LocalMusicianArea.tsx'), /signalHint=\{!offline && notReady \? LOCAL_NOTICE\.notReady : undefined\}/);
  const nb = read('src', 'components', 'musician', 'notebook', 'useNotebook.ts');
  assert.match(nb, /setSheetId\(sheet\.id\);\n\s+load\(parseDoc\(sheet\.content\)/);
});
