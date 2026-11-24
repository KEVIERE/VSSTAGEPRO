// Lote 9 (leitura do disco), cliente dos workers de WAV:
//  - quantos workers de trecho conforme os núcleos (2 até 6 núcleos, 4 com 8 ou mais);
//  - cada trecho vai ao worker de trecho mais livre (não fica atrás de outro num worker cheio);
//  - toda mensagem leva a chave estável do arquivo (o worker guarda o cabeçalho por ela).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const criados = [];
class FakeWorker {
  constructor() {
    this.msgs = [];
    this.onmessage = null;
    this.onerror = null;
    criados.push(this);
  }
  postMessage(m) { this.msgs.push(m); }
  terminate() { this.terminated = true; }
  // responde ao pedido mais antigo ainda sem resposta
  responder() {
    const m = this.msgs.find((x) => !x.respondido);
    m.respondido = true;
    this.onmessage({ data: { id: m.id, ok: true, sampleRate: 48000, sourceRate: 48000, totalFrames: 480000, channels: [new Int16Array(m.maxFrames)] } });
  }
}
globalThis.Worker = FakeWorker;
globalThis.window = globalThis;
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 8 }, configurable: true, writable: true });

const { rangePoolSize, readWavRange, readWavRangeBackground } = await import('../src/lib/wavReader.ts');
let rangeWs = [];

test('workers de trecho: min(4, max(2, núcleos - 4))', () => {
  assert.equal(rangePoolSize(2), 2);
  assert.equal(rangePoolSize(4), 2, '4 núcleos: igual a antes');
  assert.equal(rangePoolSize(6), 2);
  assert.equal(rangePoolSize(7), 3);
  assert.equal(rangePoolSize(8), 4);
  assert.equal(rangePoolSize(12), 4);
  assert.equal(rangePoolSize(24), 4);
  assert.equal(rangePoolSize(undefined), 2, 'sem a informação: 2, como antes');
  assert.equal(rangePoolSize(0), 2);
  assert.equal(rangePoolSize(Number.NaN), 2);
});

test('trechos vão ao worker mais livre e levam a chave estável do arquivo', async () => {
  const a = new Blob([new Uint8Array(100)]);
  const b = new Blob([new Uint8Array(100)]);
  const promessas = [];
  for (let i = 0; i < 8; i++) promessas.push(readWavRange(i % 2 ? b : a, 48000, i * 1000, 100));
  const trecho = criados.filter((w) => w.msgs.some((m) => typeof m.startFrame === 'number'));
  rangeWs = trecho;
  assert.equal(trecho.length, 4, '8 núcleos: 4 workers de trecho');
  for (const w of trecho) assert.equal(w.msgs.length, 2, 'dois por worker');
  // chave: o mesmo Blob dá sempre a mesma; Blobs diferentes, chaves diferentes
  const todas = trecho.flatMap((w) => w.msgs);
  const chaveA = new Set(todas.filter((m) => m.blob === a).map((m) => m.key));
  const chaveB = new Set(todas.filter((m) => m.blob === b).map((m) => m.key));
  assert.equal(chaveA.size, 1);
  assert.equal(chaveB.size, 1);
  assert.notEqual([...chaveA][0], [...chaveB][0]);
  assert.ok([...chaveA][0]);
  // o primeiro worker termina os dois dele: os próximos dois pedidos vão para ele
  const [w0] = trecho;
  w0.responder();
  w0.responder();
  await promessas[0];
  readWavRange(a, 48000, 50000, 100);
  readWavRange(b, 48000, 60000, 100);
  assert.equal(w0.msgs.length, 4, 'o mais livre recebe');
  for (const w of trecho.slice(1)) assert.equal(w.msgs.length, 2);
  // a resposta chega e o resultado é o do worker
  const r = await promessas[0];
  assert.equal(r[0].length, 100);
});

test('leitura para desenhar não usa os workers de trecho; falha de um worker libera as vagas dele', async () => {
  readWavRangeBackground(new Blob([new Uint8Array(10)]), 48000, 0, 10);
  for (const w of rangeWs) assert.ok(!w.msgs.some((m) => m.maxFrames === 10), 'desenho vai aos workers gerais');
  // todos os de trecho com 2 pedidos esperando; um deles cai
  const caido = rangeWs[2];
  const espera = readWavRange(new Blob([new Uint8Array(4)]), 48000, 7, 3);
  const foiPara = rangeWs.find((w) => w.msgs.some((m) => m.startFrame === 7));
  foiPara.onerror();
  assert.equal(await espera, null, 'pedido do worker que caiu volta como falha');
  if (foiPara !== caido) caido.onerror();
  // os dois sem nada esperando recebem os próximos
  readWavRange(new Blob([new Uint8Array(4)]), 48000, 99, 1);
  readWavRange(new Blob([new Uint8Array(4)]), 48000, 98, 1);
  const receberam = rangeWs.filter((w) => w.msgs.some((m) => m.startFrame === 99 || m.startFrame === 98));
  assert.deepEqual(new Set(receberam), new Set(foiPara === caido ? [caido] : [caido, foiPara]));
});
