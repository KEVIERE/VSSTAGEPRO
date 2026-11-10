// Contas dos músicos da Rede Local: usuário e senha, aprovação do diretor, cadernos por conta,
// envio para colega, junção com a cópia do projeto e cadernos antigos (por nome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalAccounts, usernameKey, hashPassword, checkPassword, mergeBooks } = require('../desktop/musicianAccounts.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vs-contas-')); }
function make(extra = {}) {
  const changes = [];
  const acc = new LocalAccounts({ dir: tmpDir(), onChange: (c) => changes.push(c), ...extra });
  return { acc, changes };
}
const approve = (a, account) => { account.status = 'approved'; account.updatedAt = new Date(Date.now() + 1000).toISOString(); };

test('usuário sem acento, minúsculo e com ponto no lugar do espaço', () => {
  assert.equal(usernameKey('  João Baixo '), 'joao.baixo');
  assert.equal(usernameKey('Zé'), 'ze');
});

test('senha guardada embaralhada no formato do Supabase ($2a$) e conferida', () => {
  const h = hashPassword('segredo1');
  assert.ok(h.startsWith('$2a$10$'));
  assert.equal(checkPassword('segredo1', h), true);
  assert.equal(checkPassword('errada', h), false);
});

test('conta nova fica pendente; aprovada entra direto com usuário e senha', () => {
  const { acc } = make();
  const r = acc.signup({ username: 'Joao Baixo', password: 'segredo1', name: 'João', instrument: 'Baixo' });
  assert.equal(r.account.status, 'pending');
  assert.equal(acc.login({ username: 'joao.baixo', password: 'segredo1' }).error, 'pending');
  approve(acc, r.account);
  const ok = acc.login({ username: 'JOÃO baixo', password: 'segredo1' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.account.id, r.account.id);
  assert.equal(acc.login({ username: 'joao.baixo', password: 'outra' }).error, 'wrong_login');
});

test('usuário repetido, curto ou senha fraca são recusados', () => {
  const { acc } = make();
  acc.signup({ username: 'ana', password: 'segredo1', name: 'Ana' });
  assert.equal(acc.signup({ username: 'Ana', password: 'segredo1', name: 'Outra' }).error, 'username_taken');
  assert.equal(acc.signup({ username: 'ab', password: 'segredo1', name: 'X' }).error, 'bad_username');
  assert.equal(acc.signup({ username: 'bruno', password: '123', name: 'Bruno' }).error, 'weak_password');
});

test('bloqueado não entra; senha zerada pede o PIN e uma senha nova', () => {
  const { acc } = make();
  const { account } = acc.signup({ username: 'carla', password: 'segredo1', name: 'Carla' });
  approve(acc, account);
  account.status = 'blocked';
  assert.equal(acc.login({ username: 'carla', password: 'segredo1' }).error, 'blocked');
  account.status = 'approved';
  account.passwordHash = null;
  assert.equal(acc.login({ username: 'carla', password: 'x' }).error, 'needs_password');
  assert.equal(acc.login({ username: 'carla', newPassword: 'novasenha', pinOk: true }).error, undefined);
  assert.equal(acc.login({ username: 'carla', password: 'novasenha' }).error, undefined);
});

test('aparelho lembrado volta sem senha; esquecido não', () => {
  const { acc } = make();
  const { account } = acc.signup({ username: 'davi', password: 'segredo1', name: 'Davi' });
  approve(acc, account);
  const token = acc.remember(account);
  assert.equal(acc.resume(token).account.id, account.id);
  acc.forget(account, token);
  assert.equal(acc.resume(token).error, 'wrong_login');
});

test('cadernos por conta; enviar para colega aprovado; apagar fica marcado', () => {
  const { acc } = make();
  const a = acc.signup({ username: 'edu', password: 'segredo1', name: 'Edu' }).account;
  const b = acc.signup({ username: 'fabi', password: 'segredo1', name: 'Fabi' }).account;
  const c = acc.signup({ username: 'gabi', password: 'segredo1', name: 'Gabi' }).account; // pendente
  approve(acc, a); approve(acc, b);
  const id = acc.save(a.id, { songId: 's1', title: 'Intro', content: 'G C D' });
  assert.equal(acc.list(a.id).length, 1);
  assert.equal(acc.list(b.id).length, 0);
  assert.deepEqual(acc.colleagues(a.id).map((x) => x.name), ['Fabi']);
  assert.equal(acc.share(a.id, id, [b.id, c.id]), 1);
  assert.equal(acc.list(b.id)[0].shared_from, 'Edu');
  assert.equal(acc.list(c.id).length, 0);
  assert.equal(acc.remove(a.id, id), true);
  assert.equal(acc.list(a.id).length, 0);
});

test('junção com a cópia: caderno mais novo vence, apagado não volta, conta apagada não volta', () => {
  const sheet = (content, at) => ({ id: 'x', song_id: 's1', title: '', content, shared_from: null, updated_at: at });
  const projeto = {
    id: 'livro', removed: ['velha'],
    accounts: [{ id: 'u1', username: 'u', updatedAt: '2026-01-01', sheets: { s1: sheet('antigo', '2026-01-01') } }],
  };
  const copia = {
    id: 'livro',
    accounts: [
      { id: 'u1', username: 'u', updatedAt: '2026-01-01', sheets: { s1: sheet('novo', '2026-02-01') } },
      { id: 'velha', username: 'v', updatedAt: '2026-03-01', sheets: {} },
    ],
  };
  const m = mergeBooks(projeto, copia);
  assert.equal(m.accounts.length, 1);
  assert.equal(m.accounts[0].sheets.s1.content, 'novo');
  const apagado = mergeBooks(m, { id: 'livro', accounts: [{ id: 'u1', username: 'u', updatedAt: '2026-01-01', sheets: { s1: { id: 'x', song_id: 's1', deleted: true, updated_at: '2026-04-01' } } }] });
  assert.equal(apagado.accounts[0].sheets.s1.deleted, true);
});

test('diretor zerou a senha: os aparelhos lembrados não voltam na junção', () => {
  const velho = { id: 'u1', username: 'u', updatedAt: '2026-01-01', remember: ['a', 'b'], passwordHash: 'h', sheets: {} };
  const zerado = { ...velho, updatedAt: '2026-02-01', remember: [], passwordHash: null };
  const m = mergeBooks({ id: 'l', accounts: [zerado] }, { id: 'l', accounts: [velho] });
  assert.deepEqual(m.accounts[0].remember, []);
  assert.equal(m.accounts[0].passwordHash, null);
});

test('o programa reabre o projeto sem ter salvo: a cópia de segurança devolve o que entrou pela rede', () => {
  const dir = tmpDir();
  const changes = [];
  const a1 = new LocalAccounts({ dir, onChange: (c) => changes.push(c) });
  a1.setBook({ id: 'proj', accounts: [] });
  const u = a1.signup({ username: 'hugo', password: 'segredo1', name: 'Hugo' }).account;
  a1.save(u.id, { songId: 's1', title: 'T', content: 'Am F' });
  a1.flush();
  // programa fechou sem salvar o projeto: reabre com o livro antigo (vazio)
  const changes2 = [];
  const a2 = new LocalAccounts({ dir, onChange: (c) => changes2.push(c) });
  a2.setBook({ id: 'proj', accounts: [] });
  assert.equal(a2.accounts.length, 1);
  assert.equal(a2.list(a2.accounts[0].id)[0].content, 'Am F');
  assert.ok(changes2.some((c) => c.account?.username === 'hugo')); // avisa o programa
});

test('quem tinha caderno na rede local antiga (por nome) leva ele ao criar a conta', () => {
  const dir = tmpDir();
  const legacyFile = path.join(dir, 'rede-local-cadernos.json');
  fs.writeFileSync(legacyFile, JSON.stringify({ musicians: { 'joao (baixo)': { id: 'old', name: 'João (baixo)', sheets: { s9: { id: 'k', song_id: 's9', title: 'Velho', content: 'E A', shared_from: null, updated_at: '2026-01-01' } } } } }));
  const acc = new LocalAccounts({ dir, legacyFile });
  const { account } = acc.signup({ username: 'joao', password: 'segredo1', name: 'João (Baixo)' });
  assert.equal(account.sheets.s9.content, 'E A');
  const sobra = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  assert.equal(Object.keys(sobra.musicians).length, 0);
});

test('servidor da rede local: criar conta, esperar aprovação, entrar, salvar caderno, bloquear', async () => {
  const { LocalServer } = require('../desktop/localServer.js');
  const dir = tmpDir();
  const changes = [];
  const server = new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede-local.json'), version: 't', onAccountsChange: (c) => changes.push(c) });
  server.setMusicianBook({ id: 'proj-teste', accounts: [] });
  await server.start();
  const base = `http://127.0.0.1:${server.port}/api/local`;
  const post = async (route, body, token) => {
    const res = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const pin = server.pins.musician;
    const errado = await post('login', { role: 'musician', mode: 'signup', pin: '000000' === pin ? '111111' : '000000', username: 'ivo', password: 'segredo1', name: 'Ivo' });
    assert.equal(errado.status, 401);
    const nova = await post('login', { role: 'musician', mode: 'signup', pin, username: 'Ivo', password: 'segredo1', name: 'Ivo', instrument: 'Teclado' });
    assert.equal(nova.status, 202);
    assert.equal(nova.body.pending, true);
    const conta = changes.map((c) => c.account).filter(Boolean).at(-1);
    assert.equal(conta.username, 'ivo');
    // ainda pendente
    assert.equal((await post('login', { role: 'musician', mode: 'resume', remember: nova.body.remember })).status, 202);
    // o diretor aprova no programa (o livro do projeto volta com a conta aprovada)
    server.setMusicianBook({ id: 'proj-teste', accounts: [{ ...conta, status: 'approved', updatedAt: new Date(Date.now() + 5000).toISOString() }] });
    const entrou = await post('login', { role: 'musician', mode: 'login', username: 'ivo', password: 'segredo1' });
    assert.equal(entrou.status, 200);
    const salvo = await post('sheet-save', { songId: 's1', title: 'Intro', content: 'C G' }, entrou.body.token);
    assert.equal(typeof salvo.body.id, 'string');
    assert.equal(server.accounts.list(conta.id)[0].content, 'C G');
    assert.equal((await post('login', { role: 'musician', mode: 'login', username: 'ivo', password: 'errada' })).status, 401);
    // o diretor bloqueia: a sessão cai na hora
    const atual = server.accounts.find(conta.id);
    server.setMusicianBook({ id: 'proj-teste', accounts: [{ ...atual, status: 'blocked', updatedAt: new Date(Date.now() + 10000).toISOString() }] });
    assert.equal((await post('sheet-save', { songId: 's1', title: 'x', content: 'y' }, entrou.body.token)).status, 401);
    assert.equal((await post('login', { role: 'musician', mode: 'login', username: 'ivo', password: 'segredo1' })).status, 403);
  } finally {
    await server.stop();
  }
});
