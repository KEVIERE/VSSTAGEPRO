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

// Lista de músicos do diretor: o programa manda o livro de contas como o store deixa depois de
// "Desconectar" (aparelhos lembrados saem, hora da desconexão) ou de "Excluir" (conta some).
function asDirector(ctx, change) {
  const book = JSON.parse(JSON.stringify(ctx.srv.accounts.book));
  ctx.srv.setMusicianBook(change(book));
}

test('lista de músicos: cada um aparece online pela conta e o diretor vê quem está no ar', async () => {
  const ctx = await setup();
  try {
    const token = await musicianToken(ctx);
    assert.equal((await ctx.get('sheets', token)).status, 200);
    const info = await ctx.srv.info();
    const acc = ctx.srv.accounts.findByUsername('joao.baixo');
    assert.deepEqual(info.clients.filter((c) => c.role === 'musician').map((c) => c.accountId), [acc.id]);
  } finally { await ctx.close(); }
});

test('Desconectar: cai agora, continua na lista e entra de novo com usuário e senha', async () => {
  const ctx = await setup();
  try {
    const login = await ctx.post('login', { role: 'musician', mode: 'signup', pin: ctx.srv.pins.musician, username: 'ana.voz', password: 'segredo1', name: 'Ana', instrument: 'Voz' });
    const { remember } = await login.json();
    asDirector(ctx, (b) => { b.accounts[0].status = 'approved'; b.accounts[0].updatedAt = new Date(Date.now() + 1).toISOString(); return b; });
    const back = await ctx.post('login', { role: 'musician', mode: 'resume', remember });
    assert.equal(back.status, 200);
    const token = (await back.json()).token;
    assert.equal((await ctx.get('sheets', token)).status, 200);

    // o diretor aperta Desconectar (mesma mudança que o store faz)
    await new Promise((r) => setTimeout(r, 5));
    asDirector(ctx, (b) => {
      const a = b.accounts[0];
      const at = new Date().toISOString();
      Object.assign(a, { dropped: [...a.remember], remember: [], disconnectedAt: at, updatedAt: at });
      return b;
    });
    assert.equal((await ctx.get('sheets', token)).status, 401, 'a sessão caiu');
    assert.ok(ctx.srv.accounts.findByUsername('ana.voz'), 'continua na lista');
    const again = await ctx.post('login', { role: 'musician', mode: 'resume', remember });
    assert.equal(again.status, 401);
    assert.equal((await again.json()).error, 'disconnected', 'o celular sabe que foi o diretor');

    // entra de novo com usuário e senha, e a nova sessão não cai
    await new Promise((r) => setTimeout(r, 5));
    const relog = await ctx.post('login', { role: 'musician', mode: 'login', username: 'ana.voz', password: 'segredo1' });
    assert.equal(relog.status, 200);
    const token2 = (await relog.json()).token;
    ctx.srv.dropLockedSessions();
    assert.equal((await ctx.get('sheets', token2)).status, 200);
  } finally { await ctx.close(); }
});

test('Excluir: sai da lista e precisa do PIN dos músicos para voltar', async () => {
  const ctx = await setup();
  try {
    const token = await musicianToken(ctx);
    const id = ctx.srv.accounts.findByUsername('joao.baixo').id;
    asDirector(ctx, (b) => ({ ...b, accounts: b.accounts.filter((a) => a.id !== id), removed: [...b.removed, id] }));
    assert.equal((await ctx.get('sheets', token)).status, 401);
    const relog = await ctx.post('login', { role: 'musician', mode: 'login', username: 'joao.baixo', password: 'segredo1' });
    assert.equal(relog.status, 401, 'usuário e senha não bastam');
    const semPin = await ctx.post('login', { role: 'musician', mode: 'signup', pin: '000000', username: 'joao.baixo', password: 'segredo1', name: 'João' });
    assert.equal(semPin.status, 401);
    const comPin = await ctx.post('login', { role: 'musician', mode: 'signup', pin: ctx.srv.pins.musician, username: 'joao.baixo', password: 'segredo1', name: 'João' });
    assert.equal(comPin.status, 202, 'com o PIN cria a conta de novo e espera a aprovação');
  } finally { await ctx.close(); }
});

// Programa reaberto no meio do show: o servidor liga antes de o projeto mandar o livro de contas.
// O aparelho lembrado não pode virar "usuário ou senha incorretos" nessa janela (o celular apagava
// o aparelho e a banda inteira ia para o login).
test('programa reaberto: resume sem o livro de contas responde not_ready e volta quando o livro chega', async () => {
  const ctx = await setup();
  try {
    const login = await ctx.post('login', { role: 'musician', mode: 'signup', pin: ctx.srv.pins.musician, username: 'ana.voz', password: 'segredo1', name: 'Ana', instrument: 'Voz' });
    const { remember } = await login.json();
    asDirector(ctx, (b) => { b.accounts[0].status = 'approved'; b.accounts[0].updatedAt = new Date(Date.now() + 1).toISOString(); return b; });
    const book = JSON.parse(JSON.stringify(ctx.srv.accounts.book));
    ctx.srv.setMusicianBook(null);
    const waiting = await ctx.post('login', { role: 'musician', mode: 'resume', remember });
    assert.equal(waiting.status, 503);
    assert.deepEqual(await waiting.json(), { error: 'not_ready' });
    ctx.srv.setMusicianBook(book);
    const back = await ctx.post('login', { role: 'musician', mode: 'resume', remember });
    assert.equal(back.status, 200);
    assert.equal(typeof (await back.json()).token, 'string');
  } finally { await ctx.close(); }
});

test('sem livro de contas: criar conta continua valendo e login errado continua "wrong_login"', async () => {
  const ctx = await setup();
  try {
    assert.equal(ctx.srv.accounts.book, null);
    const wrong = await ctx.post('login', { role: 'musician', mode: 'login', username: 'ninguem', password: 'segredo1' });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error, 'wrong_login');
    const signup = await ctx.post('login', { role: 'musician', mode: 'signup', pin: ctx.srv.pins.musician, username: 'ana.voz', password: 'segredo1', name: 'Ana', instrument: 'Voz' });
    assert.equal(signup.status, 202);
  } finally { await ctx.close(); }
});

test('enviar partitura: a rota diz quantos receberam e quem ficou com o caderno dele', async () => {
  const ctx = await setup();
  try {
    const token = await musicianToken(ctx);
    const fabi = ctx.srv.accounts.signup({ username: 'fabi', password: 'segredo1', name: 'Fabi' }).account;
    fabi.status = 'approved';
    ctx.srv.accounts.save(fabi.id, { songId: 's1', title: 'Minha', content: 'da Fabi' });
    const saved = await (await ctx.post('sheet-save', { songId: 's1', title: 'Intro', content: 'G C D' }, token)).json();
    const r = await ctx.post('sheet-share', { sheetId: saved.id, targets: [fabi.id] }, token);
    assert.deepEqual(await r.json(), { count: 0, skipped: [fabi.id] });
    assert.equal(ctx.srv.accounts.list(fabi.id)[0].content, 'da Fabi');
  } finally { await ctx.close(); }
});
