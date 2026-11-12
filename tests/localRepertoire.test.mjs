// Repertório do produtor na Rede Local: só existe depois do "Enviar repertório" do diretor, fica no
// Mac (sem nuvem) e some 10 minutos depois de o produtor salvar as letras. Para ouvir de novo, o
// diretor envia de novo; o pedido do produtor vira só um aviso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LocalRepertoire, GRACE_MS } = require('../desktop/localRepertoire.js');
const { LocalServer } = require('../desktop/localServer.js');

function repertoire() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-repertorio-'));
  let now = 1_000_000;
  const rep = new LocalRepertoire({ dir: path.join(dir, 'rep'), now: () => now });
  return { rep, dir, tick: (ms) => { now += ms; } };
}

test('o diretor envia: áudio e letra aparecem na situação e na lista do produtor', () => {
  const { rep } = repertoire();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  rep.put('s1', 'words', JSON.stringify({ segments: [] }));
  rep.put('s2', 'audio', Buffer.from('mp3'));
  const st = rep.status();
  assert.deepEqual(st.files.map((f) => f.songId).sort(), ['s1', 's2']);
  assert.deepEqual(st.words.map((f) => f.songId), ['s1']);
  assert.equal(st.released_at, null);
  const list = rep.list('/produtor/repertorio');
  const s1 = list.find((f) => f.songId === 's1');
  assert.match(s1.url, /^\/produtor\/repertorio\/s1\.mp3\?k=[0-9a-f]{32}&v=\d+$/);
  assert.match(s1.wordsUrl, /^\/produtor\/repertorio\/s1\.words\.json\?k=/);
  assert.equal(list.find((f) => f.songId === 's2').wordsUrl, null);
});

test('fechar e abrir o programa não perde o repertório nem o relógio dos 10 minutos', () => {
  const { rep, dir, tick } = repertoire();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  rep.put('s1', 'words', '{"segments":[]}');
  const key = new URL(rep.list('/p')[0].url, 'http://x').searchParams.get('k');
  rep.release();
  // programa reaberto: outro objeto, mesma pasta
  let now = rep.now();
  const again = new LocalRepertoire({ dir: path.join(dir, 'rep'), now: () => now });
  assert.equal(again.status().files.length, 1, 'o áudio continua');
  assert.equal(again.status().words.length, 1, 'a letra lida continua');
  assert.ok(again.filePath('s1.mp3', key), 'o endereço que o produtor tem continua valendo');
  assert.ok(again.status().released_at, 'o relógio do salvar continua');
  now += GRACE_MS + 1;
  assert.equal(again.status().files.length, 0, 'e o áudio sai na hora certa');
  void tick;
});

test('nome de música estranho ou arquivo vazio é recusado', () => {
  const { rep } = repertoire();
  assert.throws(() => rep.put('../fora', 'audio', Buffer.from('x')));
  assert.throws(() => rep.put('s1', 'video', Buffer.from('x')));
  assert.throws(() => rep.put('s1', 'audio', Buffer.alloc(0)));
});

test('o produtor salvou: o áudio fica 10 minutos e depois some do Mac', () => {
  const { rep, tick } = repertoire();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  rep.release();
  assert.ok(rep.status().released_at, 'marca a hora do salvar');
  tick(GRACE_MS - 1000);
  assert.equal(rep.status().files.length, 1, 'antes dos 10 minutos continua lá');
  tick(2000);
  assert.equal(rep.status().files.length, 0, 'depois dos 10 minutos saiu');
  assert.ok(rep.status().released_at, 'a marca continua: o programa mostra "envie de novo"');
  assert.deepEqual(rep.list('/x'), []);
});

test('envio novo depois do salvar: a marca sai e o áudio novo não é apagado', () => {
  const { rep, tick } = repertoire();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  rep.release();
  tick(GRACE_MS + 1);
  rep.sweep();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  tick(GRACE_MS * 3);
  assert.equal(rep.status().released_at, null);
  assert.equal(rep.status().files.length, 1);
});

test('salvar sem nada enviado não liga o relógio', () => {
  const { rep } = repertoire();
  rep.release();
  assert.equal(rep.status().released_at, null);
});

test('pedido do produtor: o diretor pega uma vez só, e o áudio que ainda estava lá fica', () => {
  const { rep, tick } = repertoire();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  rep.release();
  tick(60_000);
  rep.request();
  assert.equal(rep.status().released_at, null);
  assert.ok(rep.takeRequest());
  assert.equal(rep.takeRequest(), null, 'o pedido é consumido');
  tick(GRACE_MS * 2);
  assert.equal(rep.status().files.length, 1, 'o pedido segura o áudio até o próximo salvar');
});

test('arquivo só sai com a chave do envio atual', () => {
  const { rep } = repertoire();
  rep.start();
  rep.put('s1', 'audio', Buffer.from('mp3'));
  const key = new URL(rep.list('/p')[0].url, 'http://x').searchParams.get('k');
  assert.ok(rep.filePath('s1.mp3', key));
  assert.equal(rep.filePath('s1.mp3', 'errada'), null);
  assert.equal(rep.filePath('../s1.mp3', key), null);
  rep.start();
  assert.equal(rep.filePath('s1.mp3', key), null, 'envio novo troca a chave');
});

async function server() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-rep-srv-'));
  const srv = new LocalServer({ webRoot: dir, storePath: path.join(dir, 'rede-local.json'), version: 't' });
  srv.published = { setlist: { songs: [{ id: 's1', name: 'Um' }] }, name: 'Show' };
  const httpServer = http.createServer((req, res) => srv.handle(req, res));
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  const post = (route, body, token) => fetch(`${origin}/api/local/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const login = async () => (await (await post('login', { role: 'producer', pin: srv.pins.producer, name: 'Produtor' })).json()).token;
  return { srv, origin, post, login, close: () => new Promise((r) => httpServer.close(r)) };
}

test('rede local: o produtor lista, ouve e lê a letra; "Salvar" liga o relógio dos 10 minutos', async () => {
  const ctx = await server();
  try {
    assert.deepEqual((await ctx.srv.repertoire.status()).files, [], 'pasta nova: nada sobe sozinho');
    ctx.srv.repertoire.start();
    ctx.srv.repertoire.put('s1', 'audio', Buffer.from('ID3-mp3'));
    ctx.srv.repertoire.put('s1', 'words', JSON.stringify({ segments: [{ start: 1, end: 2, text: 'oi', words: [] }] }));
    const token = await ctx.login();
    const list = await (await ctx.post('references', {}, token)).json();
    assert.equal(list.files.length, 1);
    const audio = await fetch(ctx.origin + list.files[0].url);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
    assert.equal(await audio.text(), 'ID3-mp3');
    const words = await (await fetch(ctx.origin + list.files[0].wordsUrl)).json();
    assert.equal(words.segments[0].text, 'oi');
    assert.equal((await fetch(`${ctx.origin}/produtor/repertorio/s1.mp3?k=errada`)).status, 404);

    assert.equal((await ctx.post('lyrics-save', {}, token)).status, 200);
    assert.ok(ctx.srv.repertoire.status().released_at, 'salvar marca a liberação');

    assert.equal((await ctx.post('repertoire-request', {}, token)).status, 200);
    assert.ok(ctx.srv.repertoire.takeRequest(), 'o pedido chega ao programa do diretor');
  } finally { await ctx.close(); }
});

test('rede local: sem login não lista nada', async () => {
  const ctx = await server();
  try {
    assert.equal((await ctx.post('references', {})).status, 401);
  } finally { await ctx.close(); }
});
