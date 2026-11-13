// Área do Músico e Rede Local: envio de partitura que não apaga o caderno do colega, "Trocar PIN"
// do VS Stage Remote e PIN próprio do Remote em instalações antigas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalAccounts } = require('../desktop/musicianAccounts.js');
const { LocalServer } = require('../desktop/localServer.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vs-musico-')); }

function accountsWithThree() {
  const acc = new LocalAccounts({ dir: tmpDir() });
  const later = new Date(Date.now() + 1000).toISOString();
  const make = (username, name) => {
    const a = acc.signup({ username, password: 'segredo1', name }).account;
    a.status = 'approved';
    a.updatedAt = later;
    return a;
  };
  return { acc, edu: make('edu', 'Edu'), fabi: make('fabi', 'Fabi'), gabi: make('gabi', 'Gabi') };
}

test('enviar partitura: colega com caderno próprio da música fica com o dele', () => {
  const { acc, edu, fabi, gabi } = accountsWithThree();
  acc.save(fabi.id, { songId: 's1', title: 'Minha cifra', content: 'desenhos da Fabi' });
  const id = acc.save(edu.id, { songId: 's1', title: 'Intro', content: 'G C D' });
  assert.deepEqual(acc.shareSheet(edu.id, id, [fabi.id, gabi.id]), { count: 1, skipped: [fabi.id] });
  assert.equal(acc.list(fabi.id)[0].content, 'desenhos da Fabi');
  assert.equal(acc.list(fabi.id)[0].shared_from, null);
  assert.equal(acc.list(gabi.id)[0].content, 'G C D');
  assert.equal(acc.list(gabi.id)[0].shared_from, 'Edu');
});

test('enviar partitura: cópia recebida sem edição é trocada; editada fica protegida', () => {
  const { acc, edu, fabi, gabi } = accountsWithThree();
  const id = acc.save(edu.id, { songId: 's1', title: 'Intro', content: 'versão 1' });
  assert.equal(acc.share(edu.id, id, [fabi.id, gabi.id]), 2, 'share() continua devolvendo o número');
  const gabiId = acc.list(gabi.id)[0].id;
  // Gabi anota na cópia que recebeu
  acc.save(gabi.id, { songId: 's1', title: 'Intro', content: 'versão 1 com anotações da Gabi' });
  acc.save(edu.id, { songId: 's1', title: 'Intro', content: 'versão 2' });
  assert.deepEqual(acc.shareSheet(edu.id, id, [fabi.id, gabi.id]), { count: 1, skipped: [gabi.id] });
  assert.equal(acc.list(fabi.id)[0].content, 'versão 2', 'quem não mexeu recebe a versão nova');
  assert.equal(acc.list(gabi.id)[0].content, 'versão 1 com anotações da Gabi');
  assert.equal(acc.list(gabi.id)[0].id, gabiId);
});

test('enviar partitura: caderno apagado e cópia antiga sem marca', () => {
  const { acc, edu, fabi, gabi } = accountsWithThree();
  const own = acc.save(fabi.id, { songId: 's1', title: 'x', content: 'apagar' });
  acc.remove(fabi.id, own);
  // cópia recebida antes desta regra: sem received_at, fica protegida
  gabi.sheets = { s1: { id: 'old', song_id: 's1', title: 'Intro', content: 'cópia antiga', shared_from: 'Edu', updated_at: '2026-01-01T00:00:00.000Z' } };
  const id = acc.save(edu.id, { songId: 's1', title: 'Intro', content: 'nova' });
  assert.deepEqual(acc.shareSheet(edu.id, id, [fabi.id, gabi.id]), { count: 1, skipped: [gabi.id] });
  assert.equal(acc.list(fabi.id)[0].content, 'nova');
  assert.equal(acc.list(gabi.id)[0].content, 'cópia antiga');
  assert.equal(acc.shareSheet(edu.id, 'nao-existe', [fabi.id]), null);
  assert.equal(acc.share(edu.id, 'nao-existe', [fabi.id]), null);
});

async function setup(storePath) {
  const dir = tmpDir();
  const store = storePath || path.join(dir, 'rede-local.json');
  const srv = new LocalServer({ webRoot: dir, storePath: store, version: 't' });
  const httpServer = http.createServer((req, res) => srv.handle(req, res));
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${httpServer.address().port}/api/local/`;
  const login = (role, pin) => fetch(base + 'login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, pin, name: 'Teste' }),
  });
  const state = (token) => fetch(base + 'remote-meters', { headers: { Authorization: `Bearer ${token}` } });
  const close = () => new Promise((r) => { clearInterval(srv.repertoireTimer); httpServer.close(r); });
  return { srv, store, login, state, close };
}

const errorOf = async (res) => ({ status: res.status, error: (await res.json()).error });

test('Trocar PIN do Remote: o PIN muda, quem estava dentro cai e o PIN antigo não entra mais', async () => {
  const ctx = await setup();
  try {
    const old = ctx.srv.pins.remote;
    const { token } = await (await ctx.login('remote', old)).json();
    assert.equal((await ctx.state(token)).status, 200);
    ctx.srv.regeneratePin('remote');
    const pins = ctx.srv.pins;
    assert.notEqual(pins.remote, old);
    assert.notEqual(pins.remote, pins.producer);
    assert.notEqual(pins.remote, pins.musician);
    assert.deepEqual(await errorOf(await ctx.state(token)), { status: 401, error: 'no_session' });
    assert.deepEqual(await errorOf(await ctx.login('remote', old)), { status: 401, error: 'invalid_code' });
    assert.equal((await ctx.login('remote', pins.remote)).status, 200);
    assert.equal(JSON.parse(fs.readFileSync(ctx.store, 'utf8')).pins.remote, pins.remote, 'gravado no disco');
  } finally { await ctx.close(); }
});

test('Trocar PIN nunca repete o PIN de outro papel', async () => {
  const ctx = await setup();
  try {
    for (let i = 0; i < 30; i += 1) {
      for (const role of ['musician', 'producer', 'remote']) {
        ctx.srv.regeneratePin(role);
        const { musician, producer, remote } = ctx.srv.pins;
        assert.equal(new Set([musician, producer, remote]).size, 3);
      }
    }
    const before = { ...ctx.srv.pins };
    ctx.srv.regeneratePin('screen');
    assert.deepEqual(ctx.srv.pins, before, 'a tela entra com o código fixo, sem PIN');
  } finally { await ctx.close(); }
});

test('instalação antiga sem PIN do Remote: ganha um próprio, gravado, e o PIN do produtor não abre o Remote', async () => {
  for (const pins of [
    { musician: '123456', producer: '654321' },
    { musician: '123456', producer: '654321', remote: '654321' },
  ]) {
    const dir = tmpDir();
    const store = path.join(dir, 'rede-local.json');
    fs.writeFileSync(store, JSON.stringify({ pins, prompter: { fontScale: 1.2 } }));
    const ctx = await setup(store);
    try {
      const { remote } = ctx.srv.pins;
      assert.match(remote, /^\d{6}$/);
      assert.ok(remote !== '123456' && remote !== '654321');
      assert.equal(ctx.srv.pins.musician, '123456');
      assert.equal(ctx.srv.pins.producer, '654321');
      assert.deepEqual(await errorOf(await ctx.login('remote', '654321')), { status: 401, error: 'invalid_code' });
      assert.equal((await ctx.login('remote', remote)).status, 200);
      const saved = JSON.parse(fs.readFileSync(store, 'utf8'));
      assert.equal(saved.pins.remote, remote);
      assert.equal(saved.pins.producer, '654321');
      assert.deepEqual(saved.prompter, { fontScale: 1.2 }, 'a tela do palco continua com a configuração');
    } finally { await ctx.close(); }
  }
});

test('instalação com PIN próprio do Remote: nada muda', async () => {
  const dir = tmpDir();
  const store = path.join(dir, 'rede-local.json');
  const raw = JSON.stringify({ pins: { musician: '123456', producer: '654321', remote: '111222' }, prompter: null });
  fs.writeFileSync(store, raw);
  const ctx = await setup(store);
  try {
    assert.equal(ctx.srv.pins.remote, '111222');
    assert.equal(fs.readFileSync(store, 'utf8'), raw, 'o arquivo não foi regravado');
  } finally { await ctx.close(); }
});
