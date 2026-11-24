// Rede local: adivinhar o PIN fica caro, o PIN certo nunca é recusado e site de fora não entra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PinThrottle, FREE_FAILURES, MAX_DELAY_MS, MAX_PENDING } = require('../desktop/pinThrottle.js');
const { LocalServer, allowedHost } = require('../desktop/localServer.js');

function clocked() {
  let t = 1_000_000;
  const slept = [];
  const throttle = new PinThrottle({ now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  return { throttle, slept, advance: (ms) => { t += ms; } };
}

test('poucos erros não atrasam nada', async () => {
  const { throttle, slept } = clocked();
  for (let i = 0; i < FREE_FAILURES - 1; i++) throttle.note('10.0.0.2');
  assert.equal(await throttle.run('10.0.0.2', () => 'entrou'), 'entrou');
  assert.deepEqual(slept, []);
});

test('com muitos erros o PIN certo ainda entra, com no máximo 2 segundos de espera', async () => {
  const { throttle, slept } = clocked();
  for (let i = 0; i < 500; i++) throttle.note('10.0.0.2');
  assert.equal(await throttle.run('10.0.0.2', () => 'entrou'), 'entrou');
  assert.equal(slept.length, 1);
  assert.ok(slept[0] <= MAX_DELAY_MS);
});

test('acertar outro código não zera a conta de erros', async () => {
  const { throttle } = clocked();
  for (let i = 0; i < FREE_FAILURES + 2; i++) throttle.note('10.0.0.2');
  await throttle.run('10.0.0.2', () => 'tela');
  assert.equal(throttle.count('10.0.0.2'), FREE_FAILURES + 2);
});

test('a conta de erros some depois de 5 minutos', () => {
  const { throttle, advance } = clocked();
  for (let i = 0; i < 20; i++) throttle.note('10.0.0.2');
  advance(5 * 60_000);
  assert.equal(throttle.delayFor('10.0.0.2'), 0);
});

test('vários aparelhos errando juntos também passam pela fila', () => {
  const { throttle } = clocked();
  for (let i = 0; i < 30; i++) throttle.note(`10.0.0.${i + 2}`);
  assert.ok(throttle.delayFor('10.0.1.1') > 0);
});

test('um aparelho não enche a fila com tentativas simultâneas', async () => {
  const { throttle } = clocked();
  let release;
  const hold = new Promise((r) => { release = r; });
  const open = Array.from({ length: MAX_PENDING }, () => throttle.run('10.0.0.2', () => hold));
  assert.equal(await throttle.run('10.0.0.2', () => 'extra'), PinThrottle.BUSY);
  assert.equal(await throttle.run('10.0.0.3', () => 'outro'), 'outro');
  release('ok');
  await Promise.all(open);
});

test('Host: aceita os endereços do show e recusa domínio de fora', () => {
  for (const h of ['192.168.0.10:8080', '127.0.0.1:8080', '[::1]:8080', 'localhost:8080', 'vsstage.local:8080', 'VSSTAGE.LOCAL', undefined]) {
    assert.equal(allowedHost(h), true, String(h));
  }
  for (const h of ['evil.example:8080', 'vsstage.local.evil.example', '192.168.0.10.evil.example']) {
    assert.equal(allowedHost(h), false, h);
  }
});

test('servidor: PIN certo entra depois de vários errados e Host de fora recebe 403', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-pin-'));
  const server = new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede.json'), version: '1' });
  const calls = [];
  const res = () => ({ writeHead: (status) => calls.push(status), end: () => {} });
  server.readBody = async (req) => req.body;
  const login = (pin) => server.api(
    { method: 'POST', url: '/api/local/login', headers: {}, socket: { remoteAddress: '10.0.0.9' }, body: { role: 'remote', pin } },
    res(),
    'login',
  );
  try {
    const wrong = server.pins.remote === '000000' ? '000001' : '000000';
    for (let i = 0; i < FREE_FAILURES - 1; i++) await login(wrong);
    assert.ok(calls.every((s) => s === 401));
    await login(server.pins.remote);
    assert.equal(calls.at(-1), 200);

    await server.handle({ method: 'GET', url: '/', headers: { host: 'evil.example' }, socket: {} }, res());
    assert.equal(calls.at(-1), 403);
  } finally {
    clearInterval(server.repertoireTimer);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
