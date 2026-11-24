// Lote 9 (leitura do disco), worker do WAV:
//  1. o atalho do miolo em resampleRange dá exatamente as mesmas amostras da conta antiga
//     (que confere os limites em todo coeficiente) e da conversão do arquivo inteiro;
//  2. o cabeçalho fica guardado por chave: o trecho seguinte do mesmo arquivo não relê os 64 KB
//     do começo, e o resultado não muda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const workerSrc = fs.readFileSync(new URL('../src/workers/wavReader.worker.ts', import.meta.url), 'utf8');

// O worker inteiro num contexto isolado, para chamar as funções de conversão direto.
const box = { self: {}, Map, Float32Array, Int16Array, Uint8Array, DataView, Math, String, Promise, Number, Array };
vm.createContext(box);
vm.runInContext(`${stripTypeScriptTypes(workerSrc)}
this.resampleRange = resampleRange; this.resample = resample; this.HALF_TAPS = HALF_TAPS; this.kernelFor = kernelFor; this.clamp16 = clamp16; this.PHASES = PHASES; this.TAPS = TAPS;`, box);

// A conta de antes deste lote, copiada como referência (confere os limites em todo coeficiente).
function resampleRangeAntigo(src, s0, srcTotal, srcRate, dstRate, from, count) {
  const table = box.kernelFor(srcRate, dstRate);
  const out = new Int16Array(count);
  const ratio = srcRate / dstRate;
  const have = src.length;
  for (let o = 0; o < count; o++) {
    const t = (from + o) * ratio;
    const base = Math.floor(t);
    const ph = Math.round((t - base) * box.PHASES);
    const row = ph * box.TAPS;
    const first = base - box.HALF_TAPS + 1;
    let acc = 0;
    for (let k = 0; k < box.TAPS; k++) {
      const j = first + k;
      const l = j - s0;
      if (j >= 0 && j < srcTotal && l >= 0 && l < have) acc += src[l] * table[row + k];
    }
    out[o] = box.clamp16(acc);
  }
  return out;
}

function sinal(n, seed) {
  const a = new Float32Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    a[i] = Math.sin(i * 0.013 * (1 + (seed % 7))) * 0.7 + ((x / 4294967296) - 0.5) * 0.25;
  }
  return a;
}

function iguais(a, b, msg) {
  assert.equal(a.length, b.length, `${msg}: tamanho`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${msg}: amostra ${i}: ${a[i]} ≠ ${b[i]}`);
}

const PARES = [[44100, 48000], [48000, 44100], [96000, 48000], [22050, 48000], [88200, 44100], [32000, 48000]];

test('resampleRange com atalho = conta antiga, amostra por amostra (miolo, bordas e pedaço curto)', () => {
  for (const [srcRate, dstRate] of PARES) {
    const srcTotal = Math.round(srcRate * 1.7);
    const full = sinal(srcTotal, srcRate % 97);
    const outTotal = Math.floor((srcTotal * dstRate) / srcRate);
    const ratio = srcRate / dstRate;
    const casos = [[0, 3000], [0, 1], [1, 17], [outTotal - 2500, 2500], [outTotal - 1, 1], [Math.floor(outTotal / 2), 30011], [12345, 4096]];
    for (const [from, count0] of casos) {
      const count = Math.max(0, Math.min(count0, outTotal - from));
      // janela que o worker lê para o trecho
      const s0 = Math.max(0, Math.floor(from * ratio) - box.HALF_TAPS + 1);
      const s1 = Math.min(srcTotal, Math.floor((from + count) * ratio) + box.HALF_TAPS + 2);
      const win = full.subarray(s0, s1);
      iguais(box.resampleRange(win, s0, srcTotal, srcRate, dstRate, from, count), resampleRangeAntigo(win, s0, srcTotal, srcRate, dstRate, from, count), `${srcRate}>${dstRate} [${from},+${count})`);
      // pedaço lido menor que o pedido (fim do arquivo cortado, leitura curta): cai no laço com conferência
      for (const corte of [1, 5, 13, 40]) {
        const curto = win.subarray(0, Math.max(0, win.length - corte));
        iguais(box.resampleRange(curto, s0, srcTotal, srcRate, dstRate, from, count), resampleRangeAntigo(curto, s0, srcTotal, srcRate, dstRate, from, count), `${srcRate}>${dstRate} curto ${corte}`);
      }
      // origem deslocada (s0 > 0 com começo faltando)
      if (s0 > 30) {
        const desl = full.subarray(s0 + 7, s1);
        iguais(box.resampleRange(desl, s0 + 7, srcTotal, srcRate, dstRate, from, count), resampleRangeAntigo(desl, s0 + 7, srcTotal, srcRate, dstRate, from, count), `${srcRate}>${dstRate} deslocado`);
      }
    }
  }
});

test('resampleRange com atalho = conversão do arquivo inteiro (resample), em trechos tortos', () => {
  for (const [srcRate, dstRate] of PARES) {
    const srcTotal = Math.round(srcRate * 2.3);
    const full = sinal(srcTotal, 11 + (srcRate % 13));
    const outTotal = Math.floor((srcTotal * dstRate) / srcRate);
    const inteiro = box.resample(full, srcTotal, srcRate, dstRate, outTotal);
    const ratio = srcRate / dstRate;
    const chunk = 7919;
    for (let from = 0; from < outTotal; from += chunk) {
      const count = Math.min(chunk, outTotal - from);
      const s0 = Math.max(0, Math.floor(from * ratio) - box.HALF_TAPS + 1);
      const s1 = Math.min(srcTotal, Math.floor((from + count) * ratio) + box.HALF_TAPS + 2);
      const part = box.resampleRange(full.subarray(s0, s1), s0, srcTotal, srcRate, dstRate, from, count);
      iguais(part, inteiro.subarray(from, from + count), `${srcRate}>${dstRate} trecho ${from}`);
    }
  }
});

// ---------- cabeçalho guardado por chave (o worker de verdade, como nos testes do disco) ----------

const replies = [];
globalThis.self = { postMessage: (m) => replies.push(m) };
await import('../src/workers/wavReader.worker.ts');
const onmessage = globalThis.self.onmessage;

function wavBytes({ rate, channels, bits, frames }) {
  const block = channels * (bits / 8);
  const buf = new ArrayBuffer(44 + frames * block);
  const v = new DataView(buf);
  const w = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * block, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * block, true); v.setUint16(32, block, true); v.setUint16(34, bits, true);
  w(36, 'data'); v.setUint32(40, frames * block, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.sin((2 * Math.PI * (220 + c * 77) * i) / rate) * 0.5;
      v.setInt16(p, Math.round(x * 32767), true); p += 2;
    }
  }
  return buf;
}

// Blob que conta as leituras: o worker só usa size e slice().arrayBuffer()
function contado(buf) {
  const real = new Blob([buf]);
  const lidos = [];
  return {
    lidos,
    blob: { size: real.size, slice: (a, b) => { lidos.push([a, b]); return real.slice(a, b); } },
  };
}

async function ask(msg) {
  replies.length = 0;
  await onmessage({ data: { id: 1, probeOnly: false, maxFrames: 0, ...msg } });
  return replies[0];
}

const cabecalhos = (lidos) => lidos.filter(([a, b]) => a === 0 && b === 1 << 16).length;

for (const rate of [48000, 44100]) {
  test(`cabeçalho guardado (${rate} Hz para 48 kHz): trecho seguinte não relê o começo e sai igual`, async () => {
    const buf = wavBytes({ rate, channels: 2, bits: 16, frames: Math.round(rate * 2.2) });
    const semChave = contado(buf);
    const comChave = contado(buf);
    const chave = `teste-${rate}`;
    const sem = [];
    const com = [];
    for (let start = 0; start < 96000; start += 24000) {
      sem.push(await ask({ blob: semChave.blob, targetRate: 48000, startFrame: start, maxFrames: 24000 }));
      com.push(await ask({ blob: comChave.blob, targetRate: 48000, startFrame: start, maxFrames: 24000, key: chave }));
    }
    assert.equal(cabecalhos(semChave.lidos), 4, 'sem chave: lê o cabeçalho em todo trecho, como antes');
    assert.equal(cabecalhos(comChave.lidos), 1, 'com chave: só a primeira vez');
    for (let i = 0; i < sem.length; i++) {
      assert.ok(sem[i].ok && com[i].ok);
      assert.equal(com[i].totalFrames, sem[i].totalFrames);
      for (let c = 0; c < 2; c++) iguais(com[i].channels[c], sem[i].channels[c], `trecho ${i} canal ${c}`);
    }
  });
}

test('cabeçalho: a sondagem já guarda; outro tamanho com a mesma chave lê de novo; falha não fica guardada', async () => {
  const buf = wavBytes({ rate: 48000, channels: 1, bits: 16, frames: 48000 });
  const a = contado(buf);
  const probe = await ask({ blob: a.blob, targetRate: 48000, probeOnly: true, key: 'k-sonda' });
  assert.ok(probe.ok);
  await ask({ blob: a.blob, targetRate: 48000, startFrame: 1000, maxFrames: 500, key: 'k-sonda' });
  assert.equal(cabecalhos(a.lidos), 1);
  // mesmo nome de chave, arquivo de outro tamanho: não confunde
  const menor = contado(wavBytes({ rate: 48000, channels: 1, bits: 16, frames: 24000 }));
  const r = await ask({ blob: menor.blob, targetRate: 48000, probeOnly: true, key: 'k-sonda' });
  assert.equal(r.totalFrames, 24000);
  assert.equal(cabecalhos(menor.lidos), 1);
  // primeira leitura do cabeçalho falha (bytes inválidos), a segunda funciona
  const bom = new Blob([buf]);
  let vez = 0;
  const instavel = { size: bom.size, slice: (x, y) => (x === 0 && vez++ === 0 ? new Blob([new Uint8Array(y - x)]) : bom.slice(x, y)) };
  assert.equal((await ask({ blob: instavel, targetRate: 48000, probeOnly: true, key: 'k-falha' })).ok, false);
  assert.equal((await ask({ blob: instavel, targetRate: 48000, probeOnly: true, key: 'k-falha' })).ok, true);
});

test('o worker continua sem importações (roda também nos testes do node)', () => {
  assert.doesNotMatch(workerSrc, /^\s*import\s/m);
  assert.match(workerSrc, /if \(first >= 0 && first \+ TAPS <= srcTotal && l0 >= 0 && l0 \+ TAPS <= have\)/);
});
