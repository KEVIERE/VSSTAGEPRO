// Lote 5 (salvar e abrir), passos 3, 4 e 6:
// - o app do Mac não analisa mais o manifest grande inteiro a cada ⌘S (só o índice do fim) e não
//   copia o manifest nem os pedaços de áudio de novo na memória;
// - as mensagens de progresso do salvar saem no máximo uma a cada 100 ms, a última sempre chega;
// - o endereço blob: do áudio gerado pelo programa sai depois de salvo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, register } from 'node:module';

const require = createRequire(import.meta.url);
const pf = require('../desktop/projectFiles.js');

globalThis.__lib = { sources: new Map(), registered: [] };
const SRC = new URL('../src/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
const stubs = {
  '@/lib/audioLibrary': [
    'export const ensureSongLoaded = async () => {};',
    'export const getClipAudio = () => null;',
    'export const putClipAudio = () => {};',
    'export const getClipSource = (id) => globalThis.__lib.sources.get(id) ?? null;',
    'export const registerClipSource = (id, songId, src) => { globalThis.__lib.registered.push([id, src]); globalThis.__lib.sources.set(id, src); };',
  ].join('\\n'),
  '@/store': 'export const useStore = { getState: () => globalThis.__store };',
};
export async function resolve(spec, ctx, next) {
  if (stubs[spec]) return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(stubs[spec]) };
  if (spec.startsWith('@/')) return next(SRC + spec.slice(2) + '.ts', ctx);
  return next(spec, ctx);
}
`));

const saver = await import('../src/lib/projectSaver.ts');

const MAGIC = 'VSSTAGE1';
const audio = (n, seed) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Conta as análises de texto grande (mais de 100 KB) feitas durante `fn`.
async function countingBigParses(fn) {
  const realParse = JSON.parse;
  let n = 0;
  JSON.parse = function (text, reviver) {
    if (typeof text === 'string' && text.length > 100_000) n++;
    return realParse.call(JSON, text, reviver);
  };
  try {
    await fn();
  } finally {
    JSON.parse = realParse;
  }
  return n;
}

// Projeto no disco com manifest grande (picos de onda como o programa grava: 4 casas, sem espaço).
function makeBigProject({ peaks = 120_000, indent = false, assetsFirst = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-'));
  const file = path.join(dir, 'Show.vss');
  const audios = [['c1', audio(90_000, 1)], ['c2', audio(60_000, 2)]];
  const assets = [];
  let offset = 0;
  for (const [clipId, bytes] of audios) {
    assets.push({ clipId, path: `Músicas/Música "1"/${clipId} "assets":[x].wav`, offset, size: bytes.length });
    offset += bytes.length;
  }
  const clips = audios.map(([id], k) => ({ id, songId: 's1', trackId: 't1', fileName: `${id}.wav`, waveformPeaks: Array.from({ length: peaks }, (_, i) => Math.round(Math.abs(Math.sin(i * 0.01 + k)) * 8000) / 10000) }));
  const body = assetsFirst
    ? { assets, projectName: 'Show', clips, lyricMaps: { s1: [{ text: 'fim "assets":[1] {' }] } }
    : { projectName: 'Show', clips, lyricMaps: { s1: [{ text: 'letra com "assets":[1] no meio }' }] }, assets };
  const manifest = Buffer.from(indent ? JSON.stringify(body, null, 2) : JSON.stringify(body));
  fs.writeFileSync(file, Buffer.concat([Buffer.from(MAGIC), ...audios.map(([, b]) => b), manifest, pf.trailer(MAGIC.length + offset, manifest.length)]));
  return { dir, file, assets, audios, clips, manifestLen: manifest.length };
}

function readManifest(file, info) {
  const buf = fs.readFileSync(file);
  return JSON.parse(buf.subarray(info.manifestStart, info.manifestStart + info.manifestLen).toString('utf8'));
}

function audioIntact(file, assets, audios) {
  const buf = fs.readFileSync(file);
  for (const a of assets) {
    const original = audios.find(([id]) => id === a.clipId)[1];
    assert.deepEqual(buf.subarray(MAGIC.length + a.offset, MAGIC.length + a.offset + a.size), original, `áudio ${a.clipId} intacto`);
  }
}

// ---------- passo 3: app do Mac ----------

test('índice do fim: só a chave de fora, e só quando o texto é como o programa grava', () => {
  const idx = [{ clipId: 'a', path: 'Músicas/x "assets":[y].wav', offset: 0, size: 10 }];
  const tail = (o) => pf.tailAssets(Buffer.from(JSON.stringify(o)));
  assert.deepEqual(tail({ projectName: 'Show', assets: idx }), idx);
  assert.deepEqual(tail({ assets: idx }), idx, 'manifest só com o índice');
  assert.deepEqual(tail({ projectName: 'Show', clips: [{ assets: [9] }], assets: [] }), []);
  assert.equal(tail({ assets: idx, lyricMaps: { s1: { assets: [1] } } }), null, 'índice no começo e outra chave "assets" no fim: não confia');
  assert.equal(tail({ assets: idx, notas: [{ assets: [1] }] }), null);
  assert.equal(tail({ assets: idx, letra: 'x' }), null, 'índice que não é a última chave');
  assert.equal(tail({ projectName: 'Show' }), null, 'sem índice');
  assert.equal(tail({ assets: { a: 1 } }), null, 'índice que não é lista');
  assert.equal(pf.tailAssets(Buffer.from(JSON.stringify({ assets: idx }, null, 2))), null, 'com espaços (versão antiga): analisa inteiro');
  const s = JSON.stringify({ projectName: 'Show', assets: idx });
  assert.equal(pf.tailAssets(Buffer.from(s.slice(0, -1))), null, 'cortado no fim');
  assert.equal(pf.tailAssets(Buffer.from(s.slice(0, -3) + '}')), null, 'índice quebrado');
});

test('⌘S de show grande no Mac: o app não analisa o manifest inteiro (nem o novo, nem o antigo do disco)', async () => {
  const p = makeBigProject();
  assert.ok(p.manifestLen > 1024 * 1024, 'manifest antigo grande');
  let info = await pf.info(p.file);
  const lyrics = (t) => ({ s1: [{ id: 'a', time: 1, text: t }] });
  const big = (t) => Buffer.from(JSON.stringify({ projectName: 'Show', clips: p.clips, lyricMaps: lyrics(t), assets: p.assets }));
  let res;
  const first = await countingBigParses(async () => {
    res = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: big('primeira') });
  });
  assert.equal(res.ok, true);
  assert.equal(first, 0, 'nem o manifest novo nem o antigo foram analisados inteiros');
  info = await pf.info(p.file);
  assert.equal(readManifest(p.file, info).lyricMaps.s1[0].text, 'primeira');
  audioIntact(p.file, p.assets, p.audios);

  const second = await countingBigParses(async () => {
    res = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: big('segunda') });
  });
  assert.equal(res.ok, true);
  assert.equal(second, 0);
  info = await pf.info(p.file);
  assert.equal(res.manifestStart, MAGIC.length + 150_000, 'manifest logo depois dos áudios');
  assert.equal(fs.statSync(p.file).size, res.size, 'sem sobra no fim');
  assert.equal(readManifest(p.file, info).lyricMaps.s1[0].text, 'segunda');
  audioIntact(p.file, p.assets, p.audios);

  // o manifest novo apontando para áudio que não está no arquivo continua recusado
  const longe = Buffer.from(JSON.stringify({ projectName: 'Show', clips: p.clips, assets: [...p.assets, { clipId: 'x', path: 'x', offset: 150_000, size: 10 }] }));
  assert.ok(longe.length > 512 * 1024);
  assert.deepEqual(await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: longe }), { ok: false, reason: 'assets' });
  // texto quebrado continua recusado
  const quebrado = big('x').subarray(0, 700_000);
  await assert.rejects(pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: quebrado }), /Projeto inválido/);
});

test('manifest antigo com espaços ou com o índice no começo (versões antigas): analisa inteiro, como antes', async () => {
  for (const variant of [{ indent: true }, { assetsFirst: true }]) {
    const p = makeBigProject(variant);
    const info = await pf.info(p.file);
    const novo = Buffer.from(JSON.stringify({ projectName: 'Show', clips: p.clips, assets: p.assets }));
    let res;
    const parses = await countingBigParses(async () => {
      res = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: novo });
    });
    assert.equal(res.ok, true, JSON.stringify(variant));
    assert.equal(parses, 1, 'só o antigo do disco, uma vez');
    audioIntact(p.file, p.assets, p.audios);
    // novo também com o índice no começo: analisa inteiro e confere do mesmo jeito
    const after = await pf.info(p.file);
    const novoComeco = Buffer.from(JSON.stringify({ assets: [...p.assets, { clipId: 'x', path: 'x', offset: 150_000, size: 10 }], projectName: 'Show', clips: p.clips }));
    assert.deepEqual(await pf.writeTail(p.file, { expectedSize: after.size, expectedManifestStart: after.manifestStart, manifest: novoComeco }), { ok: false, reason: 'assets' });
  }
});

test('salvar do que mudou com manifest grande: sem análise inteira e com a mesma conferência do índice', async () => {
  const p = makeBigProject();
  const before = await pf.info(p.file);
  const novo = audio(40_000, 9);
  const open = await pf.appendOpen(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart });
  // pedaço de áudio vindo como ArrayBuffer e como pedaço de um buffer maior (sem cópia, bytes certos)
  const ab = new Uint8Array(novo.subarray(0, 25_000)).buffer;
  await pf.appendData(open.id, ab);
  const host = Buffer.concat([Buffer.alloc(7, 0xee), novo.subarray(25_000), Buffer.alloc(5, 0xdd)]);
  await pf.appendData(open.id, new Uint8Array(host.buffer, host.byteOffset + 7, novo.length - 25_000));
  const added = { clipId: 'c3', path: 'Músicas/c3.wav', offset: open.start - MAGIC.length, size: novo.length };
  const assets = [...p.assets, added];
  const m = Buffer.from(JSON.stringify({ projectName: 'Show', clips: p.clips, assets }));
  let res;
  const parses = await countingBigParses(async () => { res = await pf.appendClose(open.id, new Uint8Array(m).buffer); });
  assert.equal(parses, 0);
  assert.equal(res.size, before.size + novo.length + m.length + 20);
  audioIntact(p.file, assets, [...p.audios, ['c3', novo]]);
  const info = await pf.info(p.file);
  assert.deepEqual(readManifest(p.file, info).assets, assets);

  // índice para áudio não gravado: recusa, também com manifest grande
  const again = await pf.appendOpen(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart });
  await pf.appendData(again.id, audio(100, 1));
  const longe = Buffer.from(JSON.stringify({ projectName: 'Show', clips: p.clips, assets: [...assets, { clipId: 'x', path: 'x', offset: info.size + 999_999, size: 10 }] }));
  await assert.rejects(pf.appendClose(again.id, longe), /não foi gravado/);
  await pf.appendAbort(again.id);
  assert.equal((await pf.info(p.file)).size, info.size);
});

test('gravar manifest e rodapé juntos: o que a gravação deixar de fora é completado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-writev-'));
  const file = path.join(dir, 'x.bin');
  fs.writeFileSync(file, Buffer.alloc(10));
  const fh = await fs.promises.open(file, 'r+');
  try {
    const parts = [Buffer.from('manifest-'), Buffer.from('grande-'), Buffer.from('rodape')];
    // gravação pela metade: só 11 bytes entram de uma vez
    const partial = {
      writev: async (bufs, pos) => {
        const all = Buffer.concat(bufs).subarray(0, 11);
        await fh.write(all, 0, all.length, pos);
        return { bytesWritten: all.length };
      },
      write: (...a) => fh.write(...a),
    };
    await pf.writeAllv(partial, parts, 4);
    assert.equal(fs.readFileSync(file).toString('latin1', 4), 'manifest-grande-rodape');
    await pf.writeAllv(fh, [Buffer.from('AB'), Buffer.from('CD')], 0);
    assert.equal(fs.readFileSync(file).toString('latin1', 0, 4), 'ABCD');
  } finally {
    await fh.close();
  }
});

test('gravar inteiro: pedaço de áudio vindo como ArrayBuffer ou pedaço de buffer maior sai com os bytes certos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-inteiro-'));
  const out = path.join(dir, 'Novo.vss');
  const a = audio(30_000, 3);
  const id = await pf.writeOpen(out);
  await pf.writeData(id, new TextEncoder().encode(MAGIC).buffer);
  const host = Buffer.concat([Buffer.alloc(3, 1), a, Buffer.alloc(9, 2)]);
  await pf.writeData(id, host.subarray(3, 3 + a.length));
  const m = Buffer.from(JSON.stringify({ assets: [{ clipId: 'c1', path: 'x', offset: 0, size: a.length }] }));
  await pf.writeData(id, new Uint8Array(m).buffer);
  await pf.writeData(id, pf.trailer(MAGIC.length + a.length, m.length));
  await pf.writeClose(id);
  const buf = fs.readFileSync(out);
  assert.equal(buf.toString('latin1', 0, 8), MAGIC);
  assert.deepEqual(buf.subarray(8, 8 + a.length), a);
  const info = await pf.info(out);
  assert.equal(info.manifestLen, m.length);
});

// ---------- programa + app (arquivo de verdade) ----------

function fakeDesktop(opts = {}) {
  const elements = new Map();
  globalThis.document = {
    createElement: () => { const el = { style: {}, id: '', files: null, remove() { elements.delete(el.id); } }; return el; },
    body: { appendChild: (el) => { elements.set(el.id, el); } },
  };
  globalThis.window = {
    vsDesktop: {
      projectGiveFile: async (filePath, selector) => {
        if (opts.giveFileFails?.()) throw new Error('campo não encontrado');
        const el = elements.get(selector.slice(1));
        el.files = [new File([fs.readFileSync(filePath)], path.basename(filePath), { lastModified: fs.statSync(filePath).mtimeMs })];
        return true;
      },
      projectPickSave: async () => ({ path: opts.file, name: path.basename(opts.file) }),
      projectInfo: (p) => pf.info(p),
      projectWriteTail: (p, o) => pf.writeTail(p, o),
      projectWriteOpen: (p) => pf.writeOpen(p),
      projectWriteData: async (id, d) => { await opts.beforeWrite?.(d); return pf.writeData(id, d); },
      projectWriteCopy: (id, s, b, n) => pf.writeCopy(id, s, b, n),
      projectWriteClose: (id) => pf.writeClose(id),
      projectWriteAbort: (id) => pf.writeAbort(id),
      projectAppendOpen: (p, o) => pf.appendOpen(p, o),
      projectAppendData: (id, d) => pf.appendData(id, d),
      projectAppendCopy: (id, s, b, n) => pf.appendCopy(id, s, b, n),
      projectAppendClose: (id, m) => pf.appendClose(id, m),
      projectAppendAbort: (id) => pf.appendAbort(id),
    },
  };
}

function baseState(extra = {}) {
  return {
    projectName: 'Show',
    tracks: [{ id: 't1', name: 'Click' }, { id: 't2', name: 'Baixo' }],
    songs: [{ id: 's1', name: 'Música 1' }],
    clips: [],
    blocks: [], playlist: [], shows: [], activeShowId: null, defaultPlaylist: null, timelineOrder: [],
    mixerVisible: true, playlistVisible: true, playlistMaximized: false, timelineVisible: true,
    mixerHeight: 200, zoomH: 50, zoomV: 1, lrMasterActive: false,
    lyricMaps: {}, lyricStyle: null, musicianBook: null,
    ...extra,
  };
}

function spyRevoke() {
  const real = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = (u) => { revoked.push(u); };
  return { revoked, restore: () => { URL.revokeObjectURL = real; } };
}

test('depois de salvar, o endereço blob: do áudio gerado sai (só dos clipes que ficaram no arquivo)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-blob-'));
  const file = path.join(dir, 'Show.vss');
  fakeDesktop({ file });
  const stem = audio(40_000, 5);
  const imported = audio(20_000, 6);
  globalThis.__lib.sources = new Map([['voz', new Blob([stem])], ['baixo', new Blob([imported])]]);
  globalThis.__lib.registered = [];
  const clips = [
    { id: 'voz', songId: 's1', trackId: 't1', startTime: 0, duration: 10, fileName: 'Voz (separada).wav', filePath: 'blob:vsstage://app/voz' },
    { id: 'baixo', songId: 's1', trackId: 't2', startTime: 0, duration: 10, fileName: 'baixo.wav', filePath: 'Músicas/Música 1/02 - Baixo.wav' },
    // sem áudio nenhum (ausente): não vai para o arquivo, o endereço fica
    { id: 'sumiu', songId: 's1', trackId: 't2', startTime: 20, duration: 10, fileName: 'sumiu.wav', filePath: 'blob:vsstage://app/sumiu' },
  ];
  const state = baseState({ clips });
  const frozen = JSON.stringify(state);
  const spy = spyRevoke();
  try {
    const res = await saver.saveProjectAsPackage(state, 'Show', () => {});
    assert.equal(res.missingCount, 1);
    assert.deepEqual(spy.revoked, ['blob:vsstage://app/voz']);
    assert.equal(JSON.stringify(state), frozen, 'o estado do projeto não muda (nada no Desfazer)');
    // o áudio do clipe agora vem do pedaço do arquivo, certo
    const voz = globalThis.__lib.sources.get('voz');
    assert.deepEqual(Buffer.from(await voz.arrayBuffer()), stem);

    // ⌘S de novo com a letra mudada (só o fim): liberar de novo não faz mal
    spy.revoked.length = 0;
    const target = { kind: 'path', path: file, name: 'Show.vss' };
    await saver.quickSave({ ...state, lyricMaps: { s1: [{ id: 'a', time: 1, text: 'nova' }] } }, target, () => {});
    assert.deepEqual(spy.revoked, ['blob:vsstage://app/voz']);
  } finally {
    spy.restore();
  }
});

test('religar os áudios depois de salvar falhou: o endereço blob: fica (o áudio continua na memória)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-blob2-'));
  const file = path.join(dir, 'Show.vss');
  let fail = false;
  fakeDesktop({ file, giveFileFails: () => fail });
  const stem = audio(10_000, 7);
  globalThis.__lib.sources = new Map([['voz', new Blob([stem])]]);
  globalThis.__lib.registered = [];
  const state = baseState({ clips: [{ id: 'voz', songId: 's1', trackId: 't1', startTime: 0, duration: 10, fileName: 'Voz.wav', filePath: 'blob:vsstage://app/voz2' }] });
  const spy = spyRevoke();
  const warn = console.warn;
  console.warn = () => {};
  try {
    fail = true;
    await saver.saveProjectAsPackage(state, 'Show', () => {});
    assert.deepEqual(spy.revoked, []);
    assert.deepEqual(globalThis.__lib.registered, [], 'o áudio continua sendo o da memória');
  } finally {
    console.warn = warn;
    spy.restore();
  }
});

// ---------- passo 4: progresso ----------

test('progresso: no máximo uma mensagem por intervalo, a guardada sai quando dá o tempo e no fim', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = { t: 1000 };
  const advance = (ms) => { clock.t += ms; t.mock.timers.tick(ms); };
  const got = [];
  const p = saver.throttledProgress((m) => got.push(m), 100, () => clock.t);
  p.report('1');
  p.report('2');
  advance(30);
  p.report('3');
  assert.deepEqual(got, ['1'], 'a primeira sai na hora, as seguintes esperam');
  advance(69);
  assert.deepEqual(got, ['1']);
  advance(1);
  assert.deepEqual(got, ['1', '3'], 'só a mais nova das guardadas, quando deu o tempo');
  advance(150);
  p.report('4');
  assert.deepEqual(got, ['1', '3', '4'], 'passou o intervalo: sai na hora');
  advance(10);
  p.report('5');
  p.flush();
  assert.deepEqual(got, ['1', '3', '4', '5'], 'fim do laço: a guardada sai');
  p.flush();
  advance(500);
  assert.equal(got.length, 4, 'nada guardado: nada sai');
  p.report('6');
  p.report('7');
  p.cancel();
  advance(500);
  assert.deepEqual(got, ['1', '3', '4', '5', '6'], 'cancelado (erro): a guardada não sai depois');
});

test('salvar inteiro com muitos áudios: poucas mensagens, a do áudio demorado aparece e a última chega antes de gravar o pacote', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-prog-'));
  const file = path.join(dir, 'Show.vss');
  const N = 60;
  const SLOW = 40;
  const slowSize = 3_333;
  let slowSeen = null;
  const messages = [];
  fakeDesktop({
    file,
    beforeWrite: async (d) => {
      if (d.byteLength === slowSize) {
        await sleep(250);
        slowSeen = messages.at(-1);
      }
    },
  });
  globalThis.__lib.sources = new Map();
  globalThis.__lib.registered = [];
  const clips = [];
  for (let i = 1; i <= N; i++) {
    clips.push({ id: `c${i}`, songId: 's1', trackId: 't1', startTime: i, duration: 1, fileName: `f${i}.wav`, filePath: `Músicas/${i}.wav` });
    globalThis.__lib.sources.set(`c${i}`, new Blob([audio(i === SLOW ? slowSize : 1000 + i, i)]));
  }
  await saver.saveProjectAsPackage(baseState({ clips }), 'Show', (m) => messages.push(m));
  const perAsset = messages.filter((m) => m.startsWith('Salvando os áudios'));
  assert.ok(perAsset.length <= 20, `poucas mensagens (${perAsset.length} para ${N} áudios)`);
  assert.match(slowSeen ?? '', new RegExp(`^Salvando os áudios: ${SLOW} de ${N} arquivos`), 'durante o áudio demorado, a barra mostra ele');
  const last = messages.indexOf('Gravando pacote...');
  assert.ok(last > 0);
  assert.match(messages[last - 1], new RegExp(`^Salvando os áudios: ${N} de ${N} arquivos`), 'a última sai antes de gravar o pacote');
});

// ---------- passo 5: depurador da janela ----------

function fakeDebugger({ attached = false, delay = 0, failOn = null } = {}) {
  const log = [];
  const dbg = {
    attachedNow: attached,
    isAttached: () => dbg.attachedNow,
    attach: (v) => { if (dbg.attachedNow) throw new Error('já ligado'); dbg.attachedNow = true; log.push(`attach ${v}`); },
    detach: () => { if (!dbg.attachedNow) throw new Error('não ligado'); dbg.attachedNow = false; log.push('detach'); },
    sendCommand: async (method) => {
      if (!dbg.attachedNow) throw new Error('Debugger is not attached');
      log.push(method);
      if (delay) await sleep(delay);
      if (!dbg.attachedNow) throw new Error('Debugger is not attached');
      if (method === failOn) throw new Error('falhou');
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (method === 'DOM.querySelector') return { nodeId: 7 };
      return {};
    },
  };
  return { dbg, log };
}

function projectOnDisk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-lote5-dbg-'));
  const file = path.join(dir, 'Show.vss');
  const m = Buffer.from(JSON.stringify({ assets: [] }));
  fs.writeFileSync(file, Buffer.concat([Buffer.from(MAGIC), m, pf.trailer(MAGIC.length, m.length)]));
  return file;
}

test('entregar o arquivo: liga o depurador, entrega e solta; o seguinte liga de novo', async () => {
  const file = projectOnDisk();
  const { dbg, log } = fakeDebugger();
  const wc = { debugger: dbg };
  assert.equal(await pf.giveFile(wc, file, '#vs-project-file-abc'), true);
  assert.equal(dbg.isAttached(), false, 'solto depois de entregar');
  assert.deepEqual(log, ['attach 1.3', 'DOM.getDocument', 'DOM.querySelector', 'DOM.setFileInputFiles', 'DOM.disable', 'detach']);
  log.length = 0;
  assert.equal(await pf.giveFile(wc, file, '#vs-project-file-def'), true, 'segundo projeto');
  assert.equal(log[0], 'attach 1.3');
  assert.equal(dbg.isAttached(), false);
});

test('depurador que outro já tinha ligado (ferramenta de medição): usa e não solta', async () => {
  const file = projectOnDisk();
  const { dbg, log } = fakeDebugger({ attached: true });
  await pf.giveFile({ debugger: dbg }, file, '#vs-project-file-abc');
  assert.equal(dbg.isAttached(), true);
  assert.ok(!log.includes('detach') && !log.includes('DOM.disable') && !log.some((l) => l.startsWith('attach')));
});

test('duas entregas ao mesmo tempo: uma de cada vez (o getDocument de uma não estraga o campo da outra); erro no meio também solta', async () => {
  const file = projectOnDisk();
  const { dbg, log } = fakeDebugger({ delay: 15 });
  const wc = { debugger: dbg };
  const [a, b] = await Promise.all([
    pf.giveFile(wc, file, '#vs-project-file-aaa'),
    (async () => { await sleep(5); return pf.giveFile(wc, file, '#vs-project-file-bbb'); })(),
  ]);
  assert.equal(a && b, true, 'as duas entregaram (nenhuma perdeu o depurador no meio)');
  const one = ['attach 1.3', 'DOM.getDocument', 'DOM.querySelector', 'DOM.setFileInputFiles', 'DOM.disable', 'detach'];
  assert.deepEqual(log, [...one, ...one], 'sem mistura: a segunda só começa depois da primeira soltar');
  assert.equal(dbg.isAttached(), false);

  const bad = fakeDebugger({ failOn: 'DOM.setFileInputFiles' });
  await assert.rejects(pf.giveFile({ debugger: bad.dbg }, file, '#vs-project-file-ccc'), /falhou/);
  assert.equal(bad.dbg.isAttached(), false, 'erro: solta do mesmo jeito');
  // campo inválido nem liga
  const none = fakeDebugger();
  await assert.rejects(pf.giveFile({ debugger: none.dbg }, file, '#outro'), /Campo inválido/);
  assert.deepEqual(none.log, []);
});
