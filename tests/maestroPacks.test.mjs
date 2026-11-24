// Pacotes de falas do Maestro: tudo contra um servidor local, sem tocar no servidor real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createMaestroPacks, parsePackPath, parseManifest } = require('../desktop/maestroPacks.js');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vs-pacotes-'));
const audio = (seed, size = 4000) => Buffer.alloc(size, seed);

function publish(voice, version, entries) {
  const files = Object.entries(entries).map(([p, data]) => ({ path: p, size: data.length, sha256: sha(data) }));
  const raw = Buffer.from(JSON.stringify({ schema: 1, voice, version, files }));
  return { raw, pin: { version, sha256: sha(raw), size: raw.length }, entries };
}

async function serve(routes, hook) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push({ url: req.url, range: req.headers.range });
    if (hook?.(req, res)) return;
    const body = routes[req.url];
    if (!body) { res.statusCode = 404; res.end(); return; }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (m) {
      const from = Number(m[1]);
      res.writeHead(206, { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}`, 'Content-Length': body.length - from });
      res.end(body.subarray(from));
      return;
    }
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    log,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

const routesOf = (voice, pack) => {
  const routes = { [`/${voice}/${pack.pin.version}/manifest.json`]: pack.raw };
  for (const [p, data] of Object.entries(pack.entries)) routes[`/${voice}/${pack.pin.version}/${p}`] = data;
  return routes;
};
const roomy = async () => ({ bavail: 1e9, bsize: 4096 });
const stateOf = async (packs, voice) => (await packs.status()).find((s) => s.voice === voice);
const basic = () => publish('will', 'v1', { 'abre.mp3': audio(1), 'calma/abre.mp3': audio(2), 'forte/abre.mp3': audio(3), 'levada-de-coco.mp3': audio(4) });

test('sem manifesto publicado: nenhum acesso à rede e a voz fica indisponível', async () => {
  const srv = await serve({});
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { schema: 1, voices: {} } });
  packs.start();
  await packs.idle();
  assert.equal(srv.log.length, 0);
  const all = await packs.status();
  assert.deepEqual(all.map((s) => [s.voice, s.state, s.progress]), [['will', 'indisponivel', 0], ['carla', 'indisponivel', 0]]);
  assert.equal(await packs.file({ voice: 'will', mode: 'normal', id: 'abre' }), null);
  await srv.close();
});

test('o arquivo que vai no app começa vazio', () => {
  assert.deepEqual(require('../desktop/maestro-packs.json').voices, {});
});

test('manifesto travado mas ainda não publicado: 404 não vira erro nem baixa nada', async () => {
  const pack = basic();
  const srv = await serve({});
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy });
  packs.start();
  await packs.idle();
  assert.equal((await stateOf(packs, 'will')).state, 'indisponivel');
  assert.equal(srv.log.length, 1);
  await srv.close();
});

test('baixa, confere e continua funcionando sem internet', async () => {
  const pack = basic();
  const srv = await serve(routesOf('will', pack));
  const home = tmp();
  const seen = [];
  const packs = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy });
  packs.setProgressListener((p) => seen.push(p));
  packs.start();
  await packs.idle();
  const st = await stateOf(packs, 'will');
  assert.equal(st.state, 'pronto');
  assert.equal(st.progress, 1);
  assert.deepEqual(st.recorded, { normal: ['abre', 'levada-de-coco'], calma: ['abre'], forte: ['abre'] });
  assert.equal(seen.at(-1).state, 'pronto');
  await srv.close();

  const offline = createMaestroPacks({ home, baseUrl: 'http://127.0.0.1:9', pins: { voices: { will: pack.pin } }, statfs: roomy });
  offline.start();
  await offline.idle();
  const got = await offline.file({ voice: 'will', mode: 'forte', id: 'abre' });
  assert.ok(got instanceof ArrayBuffer);
  assert.deepEqual(Buffer.from(got), audio(3));
  assert.equal(await offline.file({ voice: 'will', mode: 'calma', id: 'levada-de-coco' }), null);
  assert.equal(await offline.file({ voice: 'carla', mode: 'normal', id: 'abre' }), null);
});

test('retoma de onde parou com Range', async () => {
  const pack = publish('carla', 'v1', { 'abre.mp3': audio(7, 9000) });
  const srv = await serve(routesOf('carla', pack));
  const home = tmp();
  const dir = path.join(home, 'carla', 'v1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'abre.mp3.part'), audio(7, 3000));
  const packs = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: pack.pin } }, statfs: roomy });
  packs.start();
  await packs.idle();
  assert.equal(srv.log.find((r) => r.url.endsWith('abre.mp3')).range, 'bytes=3000-');
  assert.deepEqual(Buffer.from(await packs.file({ voice: 'carla', mode: 'normal', id: 'abre' })), audio(7, 9000));
  await srv.close();
});

test('SHA-256 errado: não ativa a voz nem deixa arquivo final', async () => {
  const pack = basic();
  const routes = routesOf('will', pack);
  routes['/will/v1/abre.mp3'] = audio(9);
  const srv = await serve(routes);
  const home = tmp();
  const packs = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy, retryMs: [3_600_000] });
  packs.start();
  await packs.idle();
  packs.stop();
  const st = await stateOf(packs, 'will');
  assert.equal(st.state, 'erro');
  assert.deepEqual(st.recorded, { normal: [], calma: [], forte: [] });
  assert.equal(fs.existsSync(path.join(home, 'will', 'v1', 'abre.mp3')), false);
  assert.equal(fs.existsSync(path.join(home, 'will', 'atual.json')), false);
  await srv.close();
});

test('manifesto diferente da trava é recusado antes de baixar qualquer fala', async () => {
  const pack = basic();
  const routes = routesOf('will', pack);
  routes['/will/v1/manifest.json'] = Buffer.from(pack.raw.toString().replace('abre', 'abra'));
  const srv = await serve(routes);
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy, retryMs: [3_600_000] });
  packs.start();
  await packs.idle();
  packs.stop();
  assert.equal((await stateOf(packs, 'will')).state, 'erro');
  assert.equal(srv.log.length, 1);
  await srv.close();
});

test('recusa caminho malicioso no manifesto', () => {
  const ruins = ['../fora.mp3', '/etc/passwd.mp3', 'calma/../../x.mp3', 'C:\\x.mp3', 'calma\\x.mp3', 'grave/x.mp3', 'x.exe', 'x.mp3.js',
    'JA-EXISTE-levada-de-xote.mp3', 'con.mp3', 'calma/nul.mp3', 'a%2f..mp3', 'manifest.json', '.mp3', 'a--b.mp3', 'a.mp3\0.txt', 'forte/calma/a.mp3'];
  for (const p of ruins) {
    assert.equal(parsePackPath(p), null, p);
    const raw = Buffer.from(JSON.stringify({ schema: 1, voice: 'carla', version: 'v1', files: [{ path: p, size: 1, sha256: 'a'.repeat(64) }] }));
    assert.throws(() => parseManifest(raw, 'carla', 'v1'), /caminho/, p);
  }
  assert.deepEqual(parsePackPath('forte/abre-a-voz.mp3'), { mode: 'forte', id: 'abre-a-voz' });
  assert.deepEqual(parsePackPath('abre.mp3'), { mode: 'normal', id: 'abre' });
});

test('versão da trava com caminho é ignorada e a leitura recusa id malicioso', async () => {
  const srv = await serve({});
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: { version: '../..', sha256: 'a'.repeat(64), size: 10 } } } });
  packs.start();
  await packs.idle();
  assert.equal(srv.log.length, 0);
  assert.equal(await packs.file({ voice: 'will', mode: 'normal', id: '../../segredo' }), null);
  assert.equal(await packs.file({ voice: '../x', mode: 'normal', id: 'abre' }), null);
  assert.equal(await packs.file({ voice: 'will', mode: 'grave', id: 'abre' }), null);
  assert.equal(await packs.file(null), null);
  await srv.close();
});

test('sem espaço em disco: erro e nenhum áudio baixado', async () => {
  const pack = basic();
  const srv = await serve(routesOf('will', pack));
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: async () => ({ bavail: 1, bsize: 4096 }), retryMs: [3_600_000] });
  packs.start();
  await packs.idle();
  packs.stop();
  assert.equal((await stateOf(packs, 'will')).state, 'erro');
  assert.equal(srv.log.filter((r) => r.url.endsWith('.mp3')).length, 0);
  await srv.close();
});

test('música tocando: pausa no meio e retoma quando para', async () => {
  const big = audio(5, 400_000);
  const pack = publish('will', 'v1', { 'abre.mp3': big });
  let holdFirst = true;
  let reachedHold;
  const held = new Promise((r) => { reachedHold = r; });
  const srv = await serve(routesOf('will', pack), (req, res) => {
    if (holdFirst && req.url.endsWith('abre.mp3')) {
      holdFirst = false;
      res.writeHead(200, { 'Content-Length': big.length });
      res.write(big.subarray(0, 100_000), () => setTimeout(reachedHold, 40));
      return true;
    }
    return false;
  });
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy });
  packs.start();
  await held;
  packs.setPaused(true);
  await packs.idle();
  assert.equal((await stateOf(packs, 'will')).state, 'pausado');
  const before = srv.log.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(srv.log.length, before);

  packs.setPaused(false);
  await packs.idle();
  assert.equal((await stateOf(packs, 'will')).state, 'pronto');
  assert.match(srv.log.at(-1).range || '', /^bytes=\d+-$/);
  assert.deepEqual(Buffer.from(await packs.file({ voice: 'will', mode: 'normal', id: 'abre' })), big);
  await srv.close();
});

test('começar com música tocando não acessa a rede', async () => {
  const pack = basic();
  const srv = await serve(routesOf('will', pack));
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy });
  packs.setPaused(true);
  packs.start();
  await packs.idle();
  assert.equal(srv.log.length, 0);
  packs.setPaused(false);
  await packs.idle();
  assert.equal((await stateOf(packs, 'will')).state, 'pronto');
  await srv.close();
});

test('redirecionamento para outro servidor é recusado', async () => {
  const pack = basic();
  const other = await serve(routesOf('will', pack));
  const srv = await serve({}, (_req, res) => { res.writeHead(302, { Location: `${other.url}/will/v1/manifest.json` }); res.end(); return true; });
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy, retryMs: [3_600_000] });
  packs.start();
  await packs.idle();
  packs.stop();
  assert.equal(other.log.length, 0);
  assert.equal((await stateOf(packs, 'will')).state, 'erro');
  await srv.close();
  await other.close();
});

test('versão nova reaproveita o que não mudou, troca inteira e apaga a antiga', async () => {
  const v1 = publish('carla', 'v1', { 'abre.mp3': audio(1), 'fecha.mp3': audio(2) });
  const v2 = publish('carla', 'v2', { 'abre.mp3': audio(1), 'fecha.mp3': audio(8), 'nova.mp3': audio(9) });
  const srv = await serve({ ...routesOf('carla', v1), ...routesOf('carla', v2) });
  const home = tmp();
  const first = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v1.pin } }, statfs: roomy });
  first.start();
  await first.idle();
  srv.log.length = 0;

  const second = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v2.pin } }, statfs: roomy });
  second.start();
  await second.idle();
  assert.equal(srv.log.some((r) => r.url === '/carla/v2/abre.mp3'), false);
  assert.deepEqual(Buffer.from(await second.file({ voice: 'carla', mode: 'normal', id: 'fecha' })), audio(8));
  assert.deepEqual((await stateOf(second, 'carla')).recorded.normal, ['abre', 'fecha', 'nova']);
  assert.equal(fs.existsSync(path.join(home, 'carla', 'v1')), false);
  await srv.close();
});

test('falha na versão nova mantém a voz atual tocando', async () => {
  const v1 = publish('carla', 'v1', { 'abre.mp3': audio(1) });
  const v2 = publish('carla', 'v2', { 'abre.mp3': audio(6) });
  const routes = { ...routesOf('carla', v1), ...routesOf('carla', v2) };
  routes['/carla/v2/abre.mp3'] = audio(0);
  const srv = await serve(routes);
  const home = tmp();
  const first = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v1.pin } }, statfs: roomy });
  first.start();
  await first.idle();
  const second = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v2.pin } }, statfs: roomy, retryMs: [3_600_000] });
  second.start();
  await second.idle();
  second.stop();
  assert.equal((await stateOf(second, 'carla')).state, 'pronto');
  assert.deepEqual(Buffer.from(await second.file({ voice: 'carla', mode: 'normal', id: 'abre' })), audio(1));
  await srv.close();
});

const install = async (voice, pack, extra = {}) => {
  const srv = await serve(routesOf(voice, pack));
  const home = extra.home || tmp();
  const packs = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { [voice]: pack.pin } }, statfs: roomy, retryMs: [3_600_000], ...extra });
  packs.start();
  await packs.idle();
  return { srv, home, packs };
};
const twoFiles = () => publish('carla', 'v1', { 'abre.mp3': audio(1), 'fecha.mp3': audio(2) });

test('maestro-packs.json entra no instalador', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.files.includes('maestro-packs.json'));
});

test('falha passageira ao ler o manifesto não derruba a voz', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async () => {
  const { srv, home, packs } = await install('carla', twoFiles());
  const manifest = path.join(home, 'carla', 'v1', 'manifest.json');
  fs.chmodSync(manifest, 0o000);
  const during = await stateOf(packs, 'carla');
  fs.chmodSync(manifest, 0o644);
  assert.equal(during.state, 'erro');
  assert.ok(await packs.file({ voice: 'carla', mode: 'normal', id: 'abre' }));
  const after = await stateOf(packs, 'carla');
  assert.equal(after.state, 'pronto');
  assert.deepEqual(after.recorded.normal, ['abre', 'fecha']);
  await srv.close();
});

test('manifesto apagado de verdade: volta a indisponível, avisa e refaz', async () => {
  const { srv, home, packs } = await install('carla', twoFiles());
  const seen = [];
  packs.setProgressListener((p) => seen.push(p.state));
  fs.rmSync(path.join(home, 'carla', 'v1', 'manifest.json'));
  await packs.status();
  assert.equal(seen[0], 'indisponivel');
  await packs.idle();
  assert.equal((await stateOf(packs, 'carla')).state, 'pronto');
  await srv.close();
});

test('paradas de música não varrem o disco de novo', async () => {
  const { srv, home, packs } = await install('carla', twoFiles());
  srv.log.length = 0;
  const pointer = path.join(home, 'carla', 'v1', 'manifest.json');
  fs.rmSync(path.join(home, 'carla', 'v1', 'fecha.mp3'));
  for (let i = 0; i < 3; i++) {
    packs.setPaused(true);
    packs.setPaused(false);
    await packs.idle();
  }
  // o arquivo apagado continua faltando: prova de que nenhuma varredura rodou
  assert.equal(fs.existsSync(path.join(home, 'carla', 'v1', 'fecha.mp3')), false);
  assert.equal(srv.log.length, 0);
  assert.ok(fs.existsSync(pointer));
  await srv.close();
});

test('arquivo apagado sai da lista e volta sozinho', async () => {
  const { srv, home, packs } = await install('carla', twoFiles());
  const seen = [];
  packs.setProgressListener((p) => seen.push(p.state));
  fs.rmSync(path.join(home, 'carla', 'v1', 'abre.mp3'));
  assert.equal(await packs.file({ voice: 'carla', mode: 'normal', id: 'abre' }), null);
  assert.ok(seen.length > 0);
  await packs.idle();
  assert.deepEqual(Buffer.from(await packs.file({ voice: 'carla', mode: 'normal', id: 'abre' })), audio(1));
  assert.deepEqual((await stateOf(packs, 'carla')).recorded.normal, ['abre', 'fecha']);
  await srv.close();
});

test('com música tocando o arquivo apagado sai da lista e o reparo espera', async () => {
  const { srv, home, packs } = await install('carla', twoFiles());
  srv.log.length = 0;
  packs.setPaused(true);
  fs.rmSync(path.join(home, 'carla', 'v1', 'abre.mp3'));
  assert.equal(await packs.file({ voice: 'carla', mode: 'normal', id: 'abre' }), null);
  assert.deepEqual((await stateOf(packs, 'carla')).recorded.normal, ['fecha']);
  await packs.idle();
  assert.equal(srv.log.length, 0);
  packs.setPaused(false);
  await packs.idle();
  assert.deepEqual((await stateOf(packs, 'carla')).recorded.normal, ['abre', 'fecha']);
  await srv.close();
});

test('pedir fala que o pacote não tem não dispara reparo', async () => {
  const { srv, packs } = await install('carla', twoFiles());
  srv.log.length = 0;
  for (let i = 0; i < 3; i++) assert.equal(await packs.file({ voice: 'carla', mode: 'forte', id: 'abre' }), null);
  await packs.idle();
  assert.equal(srv.log.length, 0);
  assert.deepEqual((await stateOf(packs, 'carla')).recorded.normal, ['abre', 'fecha']);
  await srv.close();
});

test('arquivo corrompido com o mesmo tamanho é baixado de novo na abertura', async () => {
  const pack = twoFiles();
  const { srv, home } = await install('carla', pack);
  await new Promise((r) => setTimeout(r, 15));
  fs.writeFileSync(path.join(home, 'carla', 'v1', 'abre.mp3'), audio(9));
  srv.log.length = 0;
  const again = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: pack.pin } }, statfs: roomy });
  again.start();
  await again.idle();
  assert.deepEqual(srv.log.map((r) => r.url), ['/carla/v1/abre.mp3']);
  assert.deepEqual(Buffer.from(await again.file({ voice: 'carla', mode: 'normal', id: 'abre' })), audio(1));
  await srv.close();
});

test('abertura normal não recalcula SHA nem acessa a rede', async () => {
  const pack = twoFiles();
  const { srv, home } = await install('carla', pack);
  const stamp = fs.statSync(path.join(home, 'carla', 'v1', 'conferido.json')).mtimeMs;
  srv.log.length = 0;
  await new Promise((r) => setTimeout(r, 15));
  const again = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: pack.pin } }, statfs: roomy });
  again.start();
  await again.idle();
  assert.equal(srv.log.length, 0);
  assert.equal(fs.statSync(path.join(home, 'carla', 'v1', 'conferido.json')).mtimeMs, stamp);
  await srv.close();
});

test('versão anterior corrompida não passa para a nova pelo link', async () => {
  const v1 = twoFiles();
  const v2 = publish('carla', 'v2', { 'abre.mp3': audio(1), 'fecha.mp3': audio(8) });
  const srv = await serve({ ...routesOf('carla', v1), ...routesOf('carla', v2) });
  const home = tmp();
  const first = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v1.pin } }, statfs: roomy });
  first.start();
  await first.idle();
  fs.writeFileSync(path.join(home, 'carla', 'v1', 'abre.mp3'), audio(9));
  const second = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v2.pin } }, statfs: roomy });
  second.start();
  await second.idle();
  assert.deepEqual(Buffer.from(await second.file({ voice: 'carla', mode: 'normal', id: 'abre' })), audio(1));
  await srv.close();
});

test('pausa vale na troca de versão: nada é reaproveitado depois de pausar', async () => {
  const entries = {};
  for (let i = 0; i < 400; i++) entries[`fala-${i}.mp3`] = audio(i % 200 + 1, 500);
  const v1 = publish('carla', 'v1', entries);
  const v2 = publish('carla', 'v2', { ...entries, 'nova.mp3': audio(250, 500) });
  const srv = await serve({ ...routesOf('carla', v1), ...routesOf('carla', v2) });
  const home = tmp();
  const first = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v1.pin } }, statfs: roomy });
  first.start();
  await first.idle();
  const second = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v2.pin } }, statfs: roomy });
  second.start();
  second.setPaused(true);
  await second.idle();
  const dir = path.join(home, 'carla', 'v2');
  const count = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.mp3')).length : 0;
  assert.ok(count < 400, `reaproveitou ${count} com a música tocando`);
  second.setPaused(false);
  await second.idle();
  assert.equal((await stateOf(second, 'carla')).recorded.normal.length, 401);
  await srv.close();
});

test('sem espaço: a atualização não copia nada antes de conferir o disco', async () => {
  const v1 = twoFiles();
  const v2 = publish('carla', 'v2', { 'abre.mp3': audio(1), 'fecha.mp3': audio(2), 'nova.mp3': audio(3) });
  const srv = await serve({ ...routesOf('carla', v1), ...routesOf('carla', v2) });
  const home = tmp();
  const first = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v1.pin } }, statfs: roomy });
  first.start();
  await first.idle();
  const second = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: v2.pin } }, statfs: async () => ({ bavail: 1, bsize: 4096 }), retryMs: [3_600_000] });
  second.start();
  await second.idle();
  second.stop();
  assert.equal(fs.existsSync(path.join(home, 'carla', 'v2', 'abre.mp3')), false);
  assert.deepEqual(Buffer.from(await second.file({ voice: 'carla', mode: 'normal', id: 'abre' })), audio(1));
  await srv.close();
});

test('pausar e voltar logo em seguida não vira erro', async () => {
  const big = audio(5, 400_000);
  const pack = publish('will', 'v1', { 'abre.mp3': big });
  let holdFirst = true;
  let reachedHold;
  const held = new Promise((r) => { reachedHold = r; });
  const srv = await serve(routesOf('will', pack), (req, res) => {
    if (holdFirst && req.url.endsWith('abre.mp3')) {
      holdFirst = false;
      res.writeHead(200, { 'Content-Length': big.length });
      res.write(big.subarray(0, 100_000), () => setTimeout(reachedHold, 40));
      return true;
    }
    return false;
  });
  const states = [];
  const packs = createMaestroPacks({ home: tmp(), baseUrl: srv.url, pins: { voices: { will: pack.pin } }, statfs: roomy, retryMs: [3_600_000] });
  packs.setProgressListener((p) => states.push(p.state));
  packs.start();
  await held;
  packs.setPaused(true);
  packs.setPaused(false);
  await packs.idle();
  assert.equal(states.includes('erro'), false);
  assert.equal((await stateOf(packs, 'will')).state, 'pronto');
  await srv.close();
});

test('pasta antiga que sobrou de um fechamento é limpa na abertura', async () => {
  const pack = twoFiles();
  const { srv, home } = await install('carla', pack);
  fs.mkdirSync(path.join(home, 'carla', 'v0'));
  fs.writeFileSync(path.join(home, 'carla', 'v0', 'abre.mp3'), audio(1));
  const again = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: pack.pin } }, statfs: roomy });
  again.start();
  await again.idle();
  assert.equal(fs.existsSync(path.join(home, 'carla', 'v0')), false);
  assert.ok(fs.existsSync(path.join(home, 'carla', 'v1')));
  await srv.close();
});

test('com música tocando a pasta antiga espera a música parar', async () => {
  const pack = twoFiles();
  const { srv, home } = await install('carla', pack);
  fs.mkdirSync(path.join(home, 'carla', 'v0'));
  const again = createMaestroPacks({ home, baseUrl: srv.url, pins: { voices: { carla: pack.pin } }, statfs: roomy });
  again.setPaused(true);
  again.start();
  await again.idle();
  assert.ok(fs.existsSync(path.join(home, 'carla', 'v0')));
  again.setPaused(false);
  await again.idle();
  assert.equal(fs.existsSync(path.join(home, 'carla', 'v0')), false);
  await srv.close();
});
