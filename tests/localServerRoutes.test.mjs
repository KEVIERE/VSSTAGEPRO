// Servidor da Rede Local: o "Salvar" da Área do Músico pede ao programa para gravar o projeto, e a
// aba Mixer do VS Stage Remote busca os medidores dos faders. Roda sem ligar a rede de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalServer } = require('../desktop/localServer.js');

async function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-rotas-'));
  const srv = new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede-local.json'), version: 't', ...opts });
  const httpServer = http.createServer((req, res) => srv.handle(req, res));
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${httpServer.address().port}/api/local/`;
  const post = (route, body, token) => fetch(base + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const get = (route, token) => fetch(base + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const close = () => new Promise((r) => httpServer.close(r));
  return { srv, dir, post, get, close };
}

async function musicianToken(ctx) {
  const { account } = ctx.srv.accounts.signup({ username: 'joao.baixo', password: 'segredo1', name: 'João', instrument: 'Baixo' });
  account.status = 'approved';
  const r = await ctx.post('login', { role: 'musician', mode: 'login', username: 'joao.baixo', password: 'segredo1' });
  assert.equal(r.status, 200);
  return (await r.json()).token;
}

async function remoteToken(ctx) {
  const r = await ctx.post('login', { role: 'remote', pin: ctx.srv.pins.remote, name: 'VS Stage Remote' });
  return (await r.json()).token;
}

test('Salvar do músico: o programa grava e o caderno vai na hora para a cópia de segurança', async () => {
  let asked = 0;
  const ctx = await setup({ onProjectSave: async () => { asked += 1; return 'saved'; } });
  try {
    const token = await musicianToken(ctx);
    const saved = await ctx.post('sheet-save', { songId: 's1', title: 'Minha cifra', content: '{"v":1}' }, token);
    assert.equal(saved.status, 200);
    const r = await ctx.post('project-save', {}, token);
    assert.deepEqual(await r.json(), { status: 'saved' });
    assert.equal(asked, 1);
    const file = path.join(ctx.dir, 'rede-local-contas', `${ctx.srv.accounts.book.id}.json`);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(backup.accounts[0].sheets.s1.title, 'Minha cifra');
  } finally { await ctx.close(); }
});

test('Salvar do músico: cada resposta do programa chega ao celular; erro vira "error"', async () => {
  for (const [answer, expected] of [['later', 'later'], ['no_file', 'no_file'], ['qualquer', 'error']]) {
    const ctx = await setup({ onProjectSave: async () => answer });
    try {
      const token = await musicianToken(ctx);
      assert.deepEqual(await (await ctx.post('project-save', {}, token)).json(), { status: expected });
    } finally { await ctx.close(); }
  }
  const failing = await setup({ onProjectSave: async () => { throw new Error('caiu'); } });
  try {
    const token = await musicianToken(failing);
    assert.deepEqual(await (await failing.post('project-save', {}, token)).json(), { status: 'error' });
  } finally { await failing.close(); }
  const old = await setup();
  try {
    const token = await musicianToken(old);
    assert.deepEqual(await (await old.post('project-save', {}, token)).json(), { status: 'unavailable' });
  } finally { await old.close(); }
});

test('Salvar só para músico com conta; o Remote não salva o projeto', async () => {
  const ctx = await setup({ onProjectSave: async () => 'saved' });
  try {
    assert.equal((await ctx.post('project-save', {})).status, 401);
    const remote = await remoteToken(ctx);
    assert.equal((await ctx.post('project-save', {}, remote)).status, 403);
  } finally { await ctx.close(); }
});

test('medidores do Remote: o programa publica e a aba Mixer lê; músico não lê', async () => {
  const ctx = await setup();
  try {
    const remote = await remoteToken(ctx);
    assert.deepEqual(await (await ctx.get('remote-meters', remote)).json(), { meters: null });
    const meters = { v: 1, at: 5, ids: ['track-click'], levels: [0.5], master: 0.7 };
    ctx.srv.publishMeters(meters);
    assert.deepEqual(await (await ctx.get('remote-meters', remote)).json(), { meters });
    ctx.srv.publishMeters({ ids: ['a'], levels: [] });
    assert.deepEqual(await (await ctx.get('remote-meters', remote)).json(), { meters: null });
    const musician = await musicianToken(ctx);
    assert.equal((await ctx.get('remote-meters', musician)).status, 403);
  } finally { await ctx.close(); }
});
