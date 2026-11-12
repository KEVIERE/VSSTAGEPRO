// App do Mac: salvar só a letra troca só o fim do .vss no próprio arquivo (sem copiar 20 GB).
// Cair no meio do salvar não pode estragar o projeto: o arquivo abre como estava.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readPackageTail } from '../src/lib/vssPackage.ts';

const require = createRequire(import.meta.url);
const pf = require('../desktop/projectFiles.js');

const MAGIC = 'VSSTAGE1';
const audio = (n, seed) => Buffer.from(Uint8Array.from({ length: n }, (_, i) => (i * 13 + seed) % 251));

function makeProject(audios, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-projeto-'));
  const file = path.join(dir, 'Show.vss');
  const assets = [];
  let offset = 0;
  for (const [clipId, bytes] of audios) {
    assets.push({ clipId, path: `Músicas/${clipId}.wav`, offset, size: bytes.length });
    offset += bytes.length;
  }
  const manifest = Buffer.from(JSON.stringify({ projectName: 'Show', ...extra, assets }));
  fs.writeFileSync(file, Buffer.concat([Buffer.from(MAGIC), ...audios.map(([, b]) => b), manifest, pf.trailer(MAGIC.length + offset, manifest.length)]));
  return { dir, file, assets, audios };
}

async function readManifest(file) {
  const blob = new Blob([fs.readFileSync(file)]);
  const tail = await readPackageTail(blob);
  assert.ok(tail, 'o arquivo abre');
  return { tail, manifest: JSON.parse(await blob.slice(tail.manifestStart, tail.manifestStart + tail.manifestLen).text()) };
}

function audioIntact(file, assets, audios) {
  const buf = fs.readFileSync(file);
  for (const a of assets) {
    const original = audios.find(([id]) => id === a.clipId)[1];
    assert.deepEqual(buf.subarray(MAGIC.length + a.offset, MAGIC.length + a.offset + a.size), original, `áudio ${a.clipId} intacto`);
  }
}

test('salvar a letra no Mac: troca só o fim, o arquivo continua do mesmo tamanho de áudio e abre', async () => {
  const p = makeProject([['c1', audio(300_000, 1)], ['c2', audio(200_000, 2)]], { lyricMaps: { s1: [{ text: 'x'.repeat(3000) }] } });
  const before = await pf.info(p.file);
  const lyrics = { s1: [{ id: 'a', time: 1, text: 'Letra nova do produtor', kind: 'refrao' }] };
  const res = await pf.writeTail(p.file, {
    expectedSize: before.size,
    expectedManifestStart: before.manifestStart,
    manifest: Buffer.from(JSON.stringify({ projectName: 'Show', lyricMaps: lyrics, assets: p.assets })),
  });
  assert.equal(res.ok, true);
  assert.equal(res.manifestStart, before.manifestStart, 'o manifest novo ficou logo depois dos áudios');
  assert.equal(fs.statSync(p.file).size, res.size, 'sem sobra no fim');
  const { manifest } = await readManifest(p.file);
  assert.deepEqual(manifest.lyricMaps, lyrics);
  audioIntact(p.file, p.assets, p.audios);
});

test('letra cresceu: o manifest novo vai para o fim e no salvar seguinte volta para o lugar', async () => {
  const p = makeProject([['c1', audio(100_000, 3)]], { lyricMaps: {} });
  let info = await pf.info(p.file);
  const big = (n) => Buffer.from(JSON.stringify({ projectName: 'Show', lyricMaps: { s1: [{ text: 'y'.repeat(n) }] }, assets: p.assets }));
  const r1 = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: big(5000) });
  assert.equal(r1.ok, true);
  assert.ok(r1.manifestStart > info.manifestStart, 'não coube no lugar do antigo: ficou no fim');
  assert.equal((await readManifest(p.file)).manifest.lyricMaps.s1[0].text.length, 5000);

  info = await pf.info(p.file);
  const r2 = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: big(5100) });
  assert.equal(r2.manifestStart, MAGIC.length + 100_000, 'agora coube: voltou para logo depois dos áudios');
  assert.equal(fs.statSync(p.file).size, r2.size);
  assert.equal((await readManifest(p.file)).manifest.lyricMaps.s1[0].text.length, 5100);
  audioIntact(p.file, p.assets, p.audios);
});

test('programa caiu no meio do salvar: o arquivo abre como estava antes', async () => {
  const p = makeProject([['c1', audio(150_000, 4)]], { lyricMaps: { s1: [{ text: 'antes' }] } });
  const half = Buffer.from(JSON.stringify({ projectName: 'Show', lyricMaps: { s1: [{ text: 'depois' }] }, assets: p.assets }));
  // só metade do manifest novo chegou ao disco, sem rodapé
  fs.appendFileSync(p.file, half.subarray(0, half.length >> 1));
  const { manifest } = await readManifest(p.file);
  assert.equal(manifest.lyricMaps.s1[0].text, 'antes', 'o programa da tela acha o rodapé antigo');
  const info = await pf.info(p.file);
  assert.ok(info.manifestStart, 'o app do Mac também acha');
  // e o salvar seguinte funciona normalmente por cima
  const r = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: half });
  assert.equal(r.ok, true);
  assert.equal((await readManifest(p.file)).manifest.lyricMaps.s1[0].text, 'depois');
  audioIntact(p.file, p.assets, p.audios);
});

test('arquivo mudou no disco depois de aberto: não grava por cima (o programa salva inteiro)', async () => {
  const p = makeProject([['c1', audio(10_000, 5)]]);
  const info = await pf.info(p.file);
  const m = Buffer.from(JSON.stringify({ projectName: 'Show', assets: p.assets }));
  assert.deepEqual(await pf.writeTail(p.file, { expectedSize: info.size + 1, expectedManifestStart: info.manifestStart, manifest: m }), { ok: false, reason: 'changed' });
  assert.deepEqual(await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart + 1, manifest: m }), { ok: false, reason: 'changed' });
});

test('manifest apontando para áudio que não está no arquivo: recusa', async () => {
  const p = makeProject([['c1', audio(10_000, 6)]]);
  const info = await pf.info(p.file);
  const m = Buffer.from(JSON.stringify({ projectName: 'Show', assets: [{ clipId: 'novo', path: 'x', offset: 10_000, size: 500 }] }));
  const r = await pf.writeTail(p.file, { expectedSize: info.size, expectedManifestStart: info.manifestStart, manifest: m });
  assert.equal(r.ok, false);
});

test('salvar inteiro: copia os áudios do arquivo antigo direto no disco e troca no fim', async () => {
  const p = makeProject([['c1', audio(64_000, 7)], ['c2', audio(32_000, 8)]]);
  const out = path.join(p.dir, 'Cópia.vss');
  const id = await pf.writeOpen(out);
  await pf.writeData(id, Buffer.from(MAGIC));
  await pf.writeCopy(id, p.file, MAGIC.length + p.assets[1].offset, p.assets[1].size);
  await pf.writeCopy(id, p.file, MAGIC.length + p.assets[0].offset, p.assets[0].size);
  const assets = [{ ...p.assets[1], offset: 0 }, { ...p.assets[0], offset: p.assets[1].size }];
  const m = Buffer.from(JSON.stringify({ projectName: 'Cópia', assets }));
  await pf.writeData(id, m);
  await pf.writeData(id, pf.trailer(MAGIC.length + 96_000, m.length));
  assert.equal(fs.existsSync(out), false, 'até fechar, o projeto não aparece');
  await pf.writeClose(id);
  assert.equal((await readManifest(out)).manifest.projectName, 'Cópia');
  audioIntact(out, assets, p.audios);
  assert.deepEqual(fs.readdirSync(p.dir).filter((n) => n.endsWith('.salvando')), [], 'sem arquivo escondido sobrando');
});

test('cancelar o salvar inteiro: o projeto antigo fica intacto e o arquivo escondido some', async () => {
  const p = makeProject([['c1', audio(20_000, 9)]]);
  const original = fs.readFileSync(p.file);
  const id = await pf.writeOpen(p.file);
  await pf.writeData(id, Buffer.from('lixo pela metade'));
  await pf.writeAbort(id);
  assert.deepEqual(fs.readFileSync(p.file), original);
  assert.deepEqual(fs.readdirSync(p.dir).filter((n) => n.endsWith('.salvando')), []);
});

test('só aceita arquivo de projeto (.vss ou .vsc) com caminho completo', async () => {
  await assert.rejects(pf.info('relativo.vss'));
  await assert.rejects(pf.info('/etc/passwd'));
  await assert.rejects(pf.writeOpen('/tmp/x.txt'));
});

// ---------- Salvar só o que mudou (entrou áudio novo) ----------

/** Manifest com os áudios antigos no lugar e os novos depois de `start` (fim do arquivo antigo). */
function appendManifest(p, start, fresh, extra = {}) {
  let pos = start;
  const added = fresh.map(([clipId, bytes]) => {
    const a = { clipId, path: `Músicas/${clipId}.wav`, offset: pos - MAGIC.length, size: bytes.length };
    pos += bytes.length;
    return a;
  });
  return { assets: [...p.assets, ...added], added, buf: Buffer.from(JSON.stringify({ projectName: 'Show', ...extra, assets: [...p.assets, ...added] })) };
}

test('entrou áudio novo: só ele vai para o fim; os antigos ficam no lugar e o arquivo abre', async () => {
  const p = makeProject([['c1', audio(400_000, 1)], ['c2', audio(300_000, 2)]]);
  const before = await pf.info(p.file);
  const novo = audio(50_000, 9);
  const open = await pf.appendOpen(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart });
  assert.equal(open.ok, true);
  assert.equal(open.start, before.size, 'o novo entra no fim do arquivo');
  assert.ok(fs.existsSync(path.join(p.dir, '.Show.vss.anexando')), 'marca de segurança enquanto grava');
  await pf.appendData(open.id, novo);
  const m = appendManifest(p, open.start, [['c3', novo]], { versao: 2 });
  const res = await pf.appendClose(open.id, m.buf);
  assert.equal(res.size, before.size + novo.length + m.buf.length + 20, 'cresce só o tamanho do áudio novo e do manifest');
  const { manifest } = await readManifest(p.file);
  assert.equal(manifest.versao, 2);
  audioIntact(p.file, m.assets, [...p.audios, ['c3', novo]]);
  assert.equal(fs.existsSync(path.join(p.dir, '.Show.vss.anexando')), false, 'a marca some no fim');
  // e salvar de novo só a letra continua funcionando depois
  const again = await pf.info(p.file);
  const tailRes = await pf.writeTail(p.file, { expectedSize: again.size, expectedManifestStart: again.manifestStart, manifest: Buffer.from(JSON.stringify({ projectName: 'Show', letra: 'nova', assets: m.assets })) });
  assert.equal(tailRes.ok, true);
  audioIntact(p.file, m.assets, [...p.audios, ['c3', novo]]);
});

test('cancelar o salvar do que mudou: o arquivo volta a ser o de antes', async () => {
  const p = makeProject([['c1', audio(100_000, 3)]]);
  const original = fs.readFileSync(p.file);
  const before = await pf.info(p.file);
  const open = await pf.appendOpen(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart });
  await pf.appendData(open.id, audio(80_000, 4));
  await pf.appendAbort(open.id);
  assert.deepEqual(fs.readFileSync(p.file), original);
  assert.equal(fs.existsSync(path.join(p.dir, '.Show.vss.anexando')), false);
});

test('programa caiu no meio do salvar do que mudou: ao abrir, o arquivo volta a ser o de antes', async () => {
  const p = makeProject([['c1', audio(200_000, 5)]]);
  const original = fs.readFileSync(p.file);
  // o que fica no disco quando cai: marca com o tamanho antigo e áudio pela metade no fim (maior que a busca de 64 MB não importa)
  fs.writeFileSync(path.join(p.dir, '.Show.vss.anexando'), JSON.stringify({ oldEnd: original.length }));
  fs.appendFileSync(p.file, audio(150_000, 6));
  const info = await pf.info(p.file);
  assert.equal(info.size, original.length, 'voltou ao tamanho de antes');
  assert.deepEqual(fs.readFileSync(p.file), original);
  assert.equal(fs.existsSync(path.join(p.dir, '.Show.vss.anexando')), false);
});

test('salvar do que mudou: arquivo mexido por fora não é tocado; índice para áudio não gravado é recusado', async () => {
  const p = makeProject([['c1', audio(50_000, 7)]]);
  const before = await pf.info(p.file);
  assert.equal((await pf.appendOpen(p.file, { expectedSize: before.size + 1, expectedManifestStart: before.manifestStart })).ok, false);
  const open = await pf.appendOpen(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart });
  await pf.appendData(open.id, audio(10_000, 8));
  const longe = Buffer.from(JSON.stringify({ assets: [{ clipId: 'x', path: 'x', offset: before.size + 999_999, size: 10 }] }));
  await assert.rejects(pf.appendClose(open.id, longe), /não foi gravado/);
  await pf.appendAbort(open.id);
  assert.equal((await pf.info(p.file)).size, before.size);
});

test('enquanto anexa, o salvar só do fim não mexe no arquivo', async () => {
  const p = makeProject([['c1', audio(30_000, 9)]]);
  const before = await pf.info(p.file);
  const open = await pf.appendOpen(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart });
  const res = await pf.writeTail(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart, manifest: Buffer.from(JSON.stringify({ assets: p.assets })) });
  assert.deepEqual(res, { ok: false, reason: 'busy' });
  await pf.appendAbort(open.id);
});

test('áudio novo que veio de outro projeto: copiado direto do disco para o fim', async () => {
  const other = makeProject([['o1', audio(70_000, 10)]]);
  const p = makeProject([['c1', audio(40_000, 11)]]);
  const before = await pf.info(p.file);
  const open = await pf.appendOpen(p.file, { expectedSize: before.size, expectedManifestStart: before.manifestStart });
  await pf.appendCopy(open.id, other.file, MAGIC.length + other.assets[0].offset, other.assets[0].size);
  const m = appendManifest(p, open.start, [['o1', other.audios[0][1]]]);
  await pf.appendClose(open.id, m.buf);
  audioIntact(p.file, m.assets, [...p.audios, ['o1', other.audios[0][1]]]);
});

test('gravar inteiro depois de um salvar interrompido: a marca antiga não corta o arquivo novo', async () => {
  const p = makeProject([['c1', audio(30_000, 12)]]);
  fs.writeFileSync(path.join(p.dir, '.Show.vss.anexando'), JSON.stringify({ oldEnd: 100 }));
  const id = await pf.writeOpen(p.file);
  const a = audio(30_000, 12);
  await pf.writeData(id, Buffer.from(MAGIC));
  await pf.writeData(id, a);
  const m = Buffer.from(JSON.stringify({ assets: p.assets }));
  await pf.writeData(id, m);
  await pf.writeData(id, pf.trailer(MAGIC.length + a.length, m.length));
  await pf.writeClose(id);
  const size = fs.statSync(p.file).size;
  assert.equal((await pf.info(p.file)).size, size, 'continua inteiro');
  assert.equal(fs.existsSync(path.join(p.dir, '.Show.vss.anexando')), false);
});

test('o salvar do programa tenta: só o fim → só o que mudou → inteiro', () => {
  const saver = fs.readFileSync(new URL('../src/lib/projectSaver.ts', import.meta.url), 'utf8');
  const quick = saver.slice(saver.indexOf('export async function quickSave'));
  const tailAt = quick.indexOf('writeTailToPath(');
  const appendAt = quick.indexOf('writeAppendToPath(');
  const fullAt = quick.indexOf('writePackageToPath(');
  assert.ok(tailAt > 0 && appendAt > tailAt && fullAt > appendAt);
  assert.match(saver, /if \(split\.fresh\.length === 0\) return false;/, 'sem áudio novo: só o fim');
  assert.match(saver, /const keptIndex = keptAssetIndex\(split\.kept, tail\);\s*if \(!keptIndex\) return false;/, 'muito áudio apagado sobrando: regrava inteiro');
  assert.match(saver, /await api\.projectAppendAbort\(open\.id\)/, 'erro ou cancelar volta o arquivo');
  const preload = fs.readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');
  for (const n of ['projectAppendOpen', 'projectAppendData', 'projectAppendCopy', 'projectAppendClose', 'projectAppendAbort']) {
    assert.match(preload, new RegExp(`${n}: call\\('${n}'\\)`));
    assert.match(main, new RegExp(`handle\\('${n}'`));
  }
});

test('projeto aberto pela janela do navegador no app do Mac: o salvar descobre o caminho e grava só o que mudou', () => {
  const saver = fs.readFileSync(new URL('../src/lib/projectSaver.ts', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../desktop/preload.js', import.meta.url), 'utf8');
  const files = fs.readFileSync(new URL('../src/lib/desktopProjectFiles.ts', import.meta.url), 'utf8');
  const quick = fs.readFileSync(new URL('../src/lib/projectQuickSave.ts', import.meta.url), 'utf8');
  assert.match(preload, /pathForFile: \(file\) => \{\s*try \{ return webUtils\.getPathForFile\(file\) \|\| ''; \}/, 'o app diz onde o arquivo está');
  assert.match(files, /vsDesktop\?\.pathForFile\?\.\(file\)/, 'áudios desse arquivo contam como já salvos');
  // salvar: o caminho do navegador (que copia os 20 GB num .crswap) vira o caminho do disco
  const pkg = saver.slice(saver.indexOf("if (target.kind === 'package') {\n    // App do Mac"));
  assert.match(pkg, /const asPath = desktopProjects\(\) \? desktopFilePath\(await target\.handle\.getFile\(\)\) : null;/);
  assert.match(pkg, /return \{ \.\.\.\(await quickSave\(state, pathTarget, onProgress, signal\)\), target: pathTarget \};/);
  assert.match(quick, /if \(res\.target\) useStore\.getState\(\)\.setSaveTarget\(res\.target\);/, 'daqui em diante salva pelo caminho do disco');
  assert.match(quick, /abra este projeto por Arquivo > Abrir Projeto/, 'sem o caminho: avisa como deixar rápido');
  // reabrir pelos recentes um projeto antigo: já abre pelo caminho do disco
  assert.match(saver, /if \(asPath\) return \{ \.\.\.\(await readDesktopPackage\(asPath, onProgress\)\), target: \{ kind: 'path', path: asPath, name: target\.handle\.name \} \};/);
});
