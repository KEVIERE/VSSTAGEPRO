// Salvar o projeto sem ter mudado o áudio (ex.: o produtor salvou as letras): o .vss troca só o
// fim (letras, mixagem) e os áudios continuam no lugar, sem regravar centenas de megabytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptAssetIndex, packageTrailer, readPackageTail, TRAILER_SIZE, VSC_MAGIC, writePackageTail } from '../src/lib/vssPackage.ts';

const enc = new TextEncoder();

// Monta um .vss como o programa grava: [magic][áudios][manifest][rodapé]
function buildPackage(audios, manifest) {
  const parts = [enc.encode(VSC_MAGIC)];
  const assets = [];
  let offset = 0;
  for (const [clipId, bytes] of audios) {
    assets.push({ clipId, path: `Músicas/${clipId}.wav`, offset, size: bytes.length });
    parts.push(bytes);
    offset += bytes.length;
  }
  const manifestBytes = enc.encode(JSON.stringify({ ...manifest, assets }));
  parts.push(manifestBytes, new Uint8Array(packageTrailer(VSC_MAGIC.length + offset, manifestBytes.length)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return { bytes: out, assets };
}

// Arquivo aberto para gravar por cima, como o do disco: escreve numa posição e corta o tamanho.
function memWriter(initial) {
  let buf = initial.slice();
  let written = 0;
  return {
    async write({ position, data }) {
      const d = new Uint8Array(data);
      written += d.length;
      if (position + d.length > buf.length) {
        const nb = new Uint8Array(position + d.length);
        nb.set(buf);
        buf = nb;
      }
      buf.set(d, position);
    },
    async truncate(n) {
      if (n <= buf.length) buf = buf.slice(0, n);
      else { const nb = new Uint8Array(n); nb.set(buf); buf = nb; }
    },
    get bytes() { return buf; },
    get written() { return written; },
  };
}

const audio = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) % 251);

async function readManifest(bytes) {
  const blob = new Blob([bytes]);
  const tail = await readPackageTail(blob);
  assert.ok(tail, 'o arquivo continua sendo um .vss válido');
  return { tail, manifest: JSON.parse(await blob.slice(tail.manifestStart, tail.manifestStart + tail.manifestLen).text()) };
}

test('salvar só as letras: os áudios ficam onde estavam e só o fim do arquivo é gravado', async () => {
  const a = audio(5000, 1);
  const b = audio(7000, 2);
  const { bytes, assets } = buildPackage([['c1', a], ['c2', b]], { projectName: 'Show', lyricMaps: {} });
  const { tail } = await readManifest(bytes);
  const begin = (x) => VSC_MAGIC.length + x.offset;
  const index = keptAssetIndex(assets.map((x) => ({ clipId: x.clipId, path: x.path, begin: begin(x), size: x.size })), tail);
  assert.ok(index, 'nenhum áudio mudou: dá para gravar só o fim');

  const lyrics = { s1: [{ id: 'p1', time: 2, text: 'Letra corrigida pelo produtor', kind: 'refrao' }] };
  const w = memWriter(bytes);
  const json = JSON.stringify({ projectName: 'Show', lyricMaps: lyrics, assets: index });
  const size = await writePackageTail(w, tail.manifestStart, json);

  assert.equal(size, w.bytes.length);
  assert.equal(w.written, enc.encode(json).length + TRAILER_SIZE, 'gravou só o manifest e o rodapé, nenhum byte de áudio');
  const again = await readManifest(w.bytes);
  assert.deepEqual(again.manifest.lyricMaps, lyrics, 'a letra nova está no arquivo');
  for (const x of again.manifest.assets) {
    const original = x.clipId === 'c1' ? a : b;
    assert.deepEqual(w.bytes.slice(begin(x), begin(x) + x.size), original, `áudio ${x.clipId} intacto`);
  }
});

test('o fim novo pode ficar menor que o antigo: o arquivo é cortado e continua válido', async () => {
  const { bytes, assets } = buildPackage([['c1', audio(3000, 3)]], { projectName: 'Show', lyricMaps: { s1: [{ text: 'x'.repeat(4000) }] } });
  const { tail } = await readManifest(bytes);
  const index = keptAssetIndex(assets.map((x) => ({ ...x, begin: VSC_MAGIC.length + x.offset })), tail);
  const w = memWriter(bytes);
  await writePackageTail(w, tail.manifestStart, JSON.stringify({ projectName: 'Show', lyricMaps: {}, assets: index }));
  assert.ok(w.bytes.length < bytes.length);
  const again = await readManifest(w.bytes);
  assert.deepEqual(again.manifest.lyricMaps, {});
});

test('clipe copiado aponta para o mesmo áudio e não conta como áudio sobrando', async () => {
  const { bytes, assets } = buildPackage([['c1', audio(20_000_000, 4)]], { projectName: 'Show' });
  const { tail } = await readManifest(bytes);
  const k = { ...assets[0], begin: VSC_MAGIC.length };
  const index = keptAssetIndex([k, { ...k, clipId: 'c1-copia' }], tail);
  assert.equal(index?.length, 2);
  assert.equal(index[1].offset, index[0].offset);
});

test('muito áudio de clipes apagados sobrando: regrava o arquivo inteiro para não crescer à toa', async () => {
  const { bytes, assets } = buildPackage([['c1', audio(1000, 5)], ['apagado', audio(20_000_000, 6)]], { projectName: 'Show' });
  const { tail } = await readManifest(bytes);
  const keep = assets.filter((x) => x.clipId === 'c1').map((x) => ({ ...x, begin: VSC_MAGIC.length + x.offset }));
  assert.equal(keptAssetIndex(keep, tail), null);
});

test('pouco áudio sobrando (um clipe pequeno apagado): continua gravando só o fim', async () => {
  const { bytes, assets } = buildPackage([['c1', audio(30_000, 7)], ['apagado', audio(500, 8)]], { projectName: 'Show' });
  const { tail } = await readManifest(bytes);
  const keep = assets.filter((x) => x.clipId === 'c1').map((x) => ({ ...x, begin: VSC_MAGIC.length + x.offset }));
  assert.ok(keptAssetIndex(keep, tail));
});

test('áudio fora da área de áudios ou vazio: não arrisca, regrava inteiro', async () => {
  const { bytes } = buildPackage([['c1', audio(1000, 9)]], { projectName: 'Show' });
  const { tail } = await readManifest(bytes);
  assert.equal(keptAssetIndex([{ clipId: 'c1', path: 'x', begin: tail.manifestStart - 10, size: 100 }], tail), null);
  assert.equal(keptAssetIndex([{ clipId: 'c1', path: 'x', begin: 2, size: 100 }], tail), null);
  assert.equal(keptAssetIndex([{ clipId: 'c1', path: 'x', begin: VSC_MAGIC.length, size: 0 }], tail), null);
});

test('arquivo que não é .vss ou está cortado no meio: não é reconhecido', async () => {
  assert.equal(await readPackageTail(new Blob([enc.encode('qualquer coisa que não é projeto')])), null);
  const { bytes } = buildPackage([['c1', audio(1000, 10)]], { projectName: 'Show' });
  assert.equal(await readPackageTail(new Blob([bytes.slice(0, bytes.length - 5)])), null);
});
