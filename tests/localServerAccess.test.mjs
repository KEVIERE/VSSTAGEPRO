// Rede Local: cada motivo de recusa tem resposta própria, e "PIN incorreto" só sai com PIN errado.
// "Desconectar" derruba a sessão sem bloquear o aparelho (antes o IP ficava bloqueado para sempre e
// outro celular que recebia esse IP do roteador via "PIN incorreto" com o PIN certo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalServer } = require('../desktop/localServer.js');

async function setup(storePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-acesso-'));
  const store = storePath || path.join(dir, 'rede-local.json');
  const srv = new LocalServer({ webRoot: dir, storePath: store, version: 't' });
  const httpServer = http.createServer((req, res) => srv.handle(req, res));
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${httpServer.address().port}/api/local/`;
  const login = (role, pin) => fetch(base + 'login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, pin, name: 'Teste' }),
  });
  const state = (token) => fetch(base + 'state', { headers: { Authorization: `Bearer ${token}` } });
  const musician = (body) => fetch(base + 'login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'musician', ...body }),
  });
  const close = () => new Promise((r) => httpServer.close(r));
  return { srv, store, login, state, musician, close };
}

const answer = async (res) => ({ status: res.status, error: (await res.json()).error });
// um PIN de 6 dígitos que não é nenhum dos três do servidor
const wrongPin = (srv) => ['000000', '111111', '222222', '333333'].find((p) => !Object.values(srv.pins).includes(p));

test('PIN errado: só ele responde "invalid_code"', async () => {
  const ctx = await setup();
  try {
    assert.deepEqual(await answer(await ctx.login('producer', wrongPin(ctx.srv))), { status: 401, error: 'invalid_code' });
    // PIN dos músicos digitado na área do produtor também é PIN errado
    assert.deepEqual(await answer(await ctx.login('producer', ctx.srv.pins.musician)), { status: 401, error: 'invalid_code' });
  } finally { await ctx.close(); }
});

test('projeto sem músicas: o Mac responde "not_ready", não falta de conexão', async () => {
  const ctx = await setup();
  try {
    const { token } = await (await ctx.login('producer', ctx.srv.pins.producer)).json();
    assert.deepEqual(await answer(await ctx.state(token)), { status: 503, error: 'not_ready' });
    ctx.srv.publish({ name: 'Show', setlist: { songs: [{ id: 's1' }] }, live: {}, lyrics: {} });
    assert.equal((await ctx.state(token)).status, 200);
  } finally { await ctx.close(); }
});

test('Desconectar: a sessão cai com "disconnected" e o PIN certo entra de novo, sem bloqueio', async () => {
  const ctx = await setup();
  try {
    const { token } = await (await ctx.login('producer', ctx.srv.pins.producer)).json();
    const id = [...ctx.srv.sessions.values()][0].id;
    ctx.srv.kick(id);
    assert.deepEqual(await answer(await ctx.state(token)), { status: 401, error: 'disconnected' });
    assert.equal((await ctx.login('producer', ctx.srv.pins.producer)).status, 200);
    // nada de bloqueio guardado no disco
    assert.equal(JSON.parse(fs.readFileSync(ctx.store, 'utf8')).banned, undefined);
  } finally { await ctx.close(); }
});

test('sessão que sumiu (programa reaberto): "no_session", e o celular entra de novo com o PIN', async () => {
  const ctx = await setup();
  try {
    assert.deepEqual(await answer(await ctx.state('token-de-antes')), { status: 401, error: 'no_session' });
  } finally { await ctx.close(); }
});

test('bloqueios por IP de versões antigas são ignorados: o aparelho entra com o PIN certo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-acesso-'));
  const store = path.join(dir, 'rede-local.json');
  const pins = { musician: '123456', producer: '654321', remote: '111222' };
  fs.writeFileSync(store, JSON.stringify({ pins, prompter: null, banned: ['producer|127.0.0.1', 'remote|127.0.0.1', 'screen|127.0.0.1'] }));
  const ctx = await setup(store);
  try {
    assert.equal((await ctx.login('producer', '654321')).status, 200);
    assert.equal((await ctx.login('remote', '111222')).status, 200);
    assert.equal((await ctx.login('screen', 'TELA')).status, 200);
    ctx.srv.persist();
    assert.equal(JSON.parse(fs.readFileSync(store, 'utf8')).banned, undefined);
  } finally { await ctx.close(); }
});

test('músico: cadastro com PIN errado é "PIN incorreto"; com o PIN certo, nunca', async () => {
  const ctx = await setup();
  try {
    const account = { mode: 'signup', name: 'Ana', instrument: 'Voz', username: 'ana.voz', password: 'segredo1' };
    assert.deepEqual(await answer(await ctx.musician({ ...account, pin: wrongPin(ctx.srv) })), { status: 401, error: 'invalid_code' });
    // conta nova fica esperando o diretor aprovar (202), sem erro de PIN
    assert.equal((await ctx.musician({ ...account, pin: ctx.srv.pins.musician })).status, 202);
  } finally { await ctx.close(); }
});
