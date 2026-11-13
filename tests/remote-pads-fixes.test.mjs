// Correções do Remote na Rede Local (IP do Mac trocado no meio do show, "sem sinal" pelos 6 s) e da
// saída dos pads (não volta a rodar no meio da música) e do contexto de decodificação (parado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalServer } = require('../desktop/localServer.js');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const link = read('../src/components/remote/useRemoteLink.ts');
const player = read('../src/lib/padPlayer.ts');
const decoder = read('../src/lib/audioDecoder.ts');

async function setup(store) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-remote-pads-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>VS</title></head><body></body></html>');
  const storePath = store || path.join(dir, 'rede-local.json');
  const srv = new LocalServer({ webRoot: dir, storePath, version: 't' });
  const httpServer = http.createServer((req, res) => srv.handle(req, res));
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const close = () => new Promise((r) => httpServer.close(r));
  return { srv, dir, storePath, base, close };
}

test('identidade do Mac: criada uma vez, gravada e mantida ao reabrir e ao trocar PIN', async () => {
  const a = await setup();
  const idFile = path.join(path.dirname(a.storePath), 'rede-local-id.txt');
  let id;
  try {
    id = a.srv.installId;
    assert.match(id, /^[\w-]{8,64}$/);
    assert.equal(fs.readFileSync(idFile, 'utf8'), id);
    // persist() (troca de PIN, prompter) não mexe no id
    a.srv.persist();
    assert.equal(fs.readFileSync(idFile, 'utf8'), id);
  } finally { await a.close(); }
  const b = await setup(a.storePath);
  try {
    assert.equal(b.srv.installId, id, 'programa reaberto: a página antiga ainda reconhece o mesmo Mac');
  } finally { await b.close(); }
  // arquivo do id estragado: troca por um válido
  fs.writeFileSync(idFile, '<script>');
  const bad = await setup(a.storePath);
  try {
    assert.match(bad.srv.installId, /^[\w-]{8,64}$/);
    assert.notEqual(bad.srv.installId, '<script>');
  } finally { await bad.close(); }
});

test('instalação de versão antiga: ganha o id sem regravar o arquivo dos PINs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-remote-pads-'));
  const store = path.join(dir, 'rede-local.json');
  const raw = JSON.stringify({ pins: { musician: '123456', producer: '654321', remote: '111222' }, prompter: null });
  fs.writeFileSync(store, raw);
  const ctx = await setup(store);
  try {
    assert.equal(fs.readFileSync(store, 'utf8'), raw);
    assert.equal(fs.readFileSync(path.join(dir, 'rede-local-id.txt'), 'utf8'), ctx.srv.installId);
  } finally { await ctx.close(); }
});

test('página do Remote leva o id do Mac; o ping responde só sim ou não, com CORS e sem cache', async () => {
  const ctx = await setup();
  try {
    const html = await (await fetch(`${ctx.base}/show`)).text();
    assert.ok(html.includes(`window.__VS_ID__=${JSON.stringify(ctx.srv.installId)}`));

    const plain = await fetch(`${ctx.base}/api/local/ping`);
    assert.deepEqual(await plain.json(), { ok: true });
    assert.equal(plain.headers.get('access-control-allow-origin'), '*');
    assert.equal(plain.headers.get('cache-control'), 'no-store');

    const same = await fetch(`${ctx.base}/api/local/ping?id=${encodeURIComponent(ctx.srv.installId)}`);
    assert.deepEqual(await same.json(), { ok: true, same: true });
    const other = await (await fetch(`${ctx.base}/api/local/ping?id=outro-mac-qualquer`)).json();
    assert.deepEqual(other, { ok: true, same: false });
    assert.ok(!JSON.stringify(other).includes(ctx.srv.installId), 'o id nunca sai na resposta do ping');
  } finally { await ctx.close(); }
});

test('Remote: troca de IP pergunta ao vsstage.local se é o mesmo Mac e só então muda de endereço', () => {
  assert.match(link, /const macId = w\.__VS_ID__;/);
  assert.match(link, /\/api\/local\/ping\?id=\$\{encodeURIComponent\(macId\)\}/);
  assert.match(link, /if \(alive && !here && moved\?\.same === true\) window\.location\.replace/);
});

test('Remote: consulta pendurada marca "sem sinal" pelos 6 s, sem esperar o prazo dela', () => {
  assert.match(link, /if \(busy\) \{[\s\S]{0,200}if \(Date\.now\(\) - lastOk > LOST_MS\) setStatus\(\(s\) => \(s === 'connecting' \? s : 'lost'\)\);\s*return;\s*\}/);
});

test('pads: voltar ao Modo Show com música tocando não faz a saída parada rodar no meio da música', () => {
  // armPads e o painel aberto (openPadOutput) esperam a música parar
  assert.match(player, /if \(o\.ctx\.state !== 'running' && useStore\.getState\(\)\.transport\.isPlaying\) resumeWhenStopped\(o\);/);
  assert.match(player, /if \(!fresh && o\.ctx\.state !== 'running' && useStore\.getState\(\)\.transport\.isPlaying\) \{\s*resumeWhenStopped\(o\);\s*return o;\s*\}/);
  // só volta com o Modo Show aberto, a mesma saída e ainda parada; sair do Modo Show cancela
  assert.match(player, /if \(showReady && out === o && o\.ctx\.state === 'suspended'\)/);
  assert.match(player, /if \(!on\) \{\s*cancelResumeWhenStopped\(\);/);
  // o toque num pad continua voltando na hora (ação do operador)
  assert.match(player, /const o = padOut\(\);\s*if \(o\.ctx\.state !== 'running'\) void o\.ctx\.resume\(\);\s*const src = o\.ctx\.createBufferSource\(\);/);
});

test('contexto de decodificação fica parado logo depois de criado', () => {
  assert.match(decoder, /decodeCtx = new AudioContext\(\);\s*(\/\/[^\n]*\n\s*)*void decodeCtx\.suspend\(\)\.catch\(/);
});
