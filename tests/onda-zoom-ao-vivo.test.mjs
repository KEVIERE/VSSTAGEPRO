// Onda no zoom ao vivo: a cada quadro do gesto a onda é redesenhada nítida no zoom do quadro, com
// as mesmas contas do desenho normal (a forma não muda no fim do gesto), poucas leituras por coluna
// (pirâmide de máximos) e um orçamento de tempo por quadro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  buildPyramid, pyramidMax, pyramidOf, hasPyramid, trimPyramids, pyramidBytes, peaksColumnsInto, fineColumnsInto, sampleColumnsInto,
  pickLiveKind, liveSpan, liveHeightsInto, nextLiveLimit, orderByDistance, LIVE_BUDGET_MS, DIRECT_MAX_RUN,
} = await import('../src/lib/liveWave.ts');
const { waveColumns, fineColumns, sampleColumns, encodeFineChunk, FINE_FRAMES_PER_PEAK } = await import('../src/lib/waveColumns.ts');

const read = (...p) => fs.readFileSync(new URL(`../src/${p.join('/')}`, import.meta.url), 'utf8');

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('pirâmide: o máximo de qualquer trecho é igual ao cálculo direto', () => {
  for (const len of [1, 2, 3, 7, 64, 1000, 4097]) {
    const bytes = new Uint8Array(len).map(() => Math.floor(rnd() * 256));
    const floats = Float32Array.from({ length: len }, () => rnd());
    for (const data of [bytes, floats]) {
      const p = buildPyramid(data);
      // cada nível é o maior de cada par do nível de baixo
      for (let k = 1; k < p.levels.length; k++) {
        const lo = p.levels[k - 1];
        for (let i = 0; i < p.levels[k].length; i++) assert.equal(p.levels[k][i], Math.max(lo[2 * i], lo[2 * i + 1] ?? 0));
      }
      for (let t = 0; t < 400; t++) {
        const a = Math.floor(rnd() * len);
        const b = Math.min(len, a + 1 + Math.floor(rnd() * len));
        let m = 0;
        for (let i = a; i < b; i++) if (data[i] > m) m = data[i];
        assert.equal(pyramidMax(p, a, b), m);
      }
    }
  }
});

test('pirâmide: montada uma vez por resumo e poucas leituras por coluna', () => {
  const peaks = Array.from({ length: 24000 }, () => rnd());
  assert.equal(hasPyramid(peaks), false);
  const p1 = pyramidOf(peaks);
  // montada uma vez, e os dados não são copiados (o resumo é do clipe)
  assert.equal(pyramidOf(peaks).levels[1], p1.levels[1]);
  assert.equal(p1.levels[0], peaks);
  assert.equal(hasPyramid(peaks), true);
  // memória: os níveis de cima somam o mesmo que os dados (metade, um quarto...)
  const extra = p1.levels.slice(1).reduce((n, l) => n + l.length, 0);
  assert.ok(extra <= 24000 + p1.levels.length, String(extra));
  // leituras de um trecho de 1000 pontos: no máximo 2 por nível e um resto curto
  let reads = 0;
  const counting = { levels: p1.levels.map((l) => new Proxy(l, { get: (t, k) => { if (typeof k === 'string' && /^\d+$/.test(k)) reads++; return Reflect.get(t, k); } })) };
  pyramidMax(counting, 123, 1123);
  assert.ok(reads <= 2 * Math.ceil(Math.log2(1000)) + 4, `leituras ${reads}`);
});

test('pirâmide: no fim do gesto as menos usadas saem até caber no limite', () => {
  const a = Array.from({ length: 20000 }, () => rnd());
  const b = Array.from({ length: 20000 }, () => rnd());
  trimPyramids(0);
  pyramidOf(a);
  pyramidOf(b);
  pyramidOf(a);
  const before = pyramidBytes();
  trimPyramids(before - 1);
  // b foi a menos usada: sai; a continua
  assert.equal(hasPyramid(b), false);
  assert.equal(hasPyramid(a), true);
  assert.ok(pyramidBytes() < before);
  // usada de novo: monta outra vez, com o mesmo resultado
  const p = pyramidOf(b);
  let m = 0;
  for (let i = 100; i < 9000; i++) if (b[i] > m) m = b[i];
  assert.equal(Math.fround(pyramidMax(p, 100, 9000)), Math.fround(m));
  trimPyramids(0);
  assert.equal(pyramidBytes(), 0);
});

test('colunas do resumo do projeto iguais a waveColumns (aproximado e afastado)', () => {
  for (let t = 0; t < 300; t++) {
    const n = 8000 + Math.floor(rnd() * 16000);
    const peaks = Array.from({ length: n }, () => rnd());
    const duration = 60 + rnd() * 400;
    const zoom = rnd() < 0.5 ? 0.5 + rnd() * 20 : 20 + rnd() * 480;
    const total = Math.max(30, duration * zoom);
    const width = 1 + Math.floor(rnd() * 1600);
    const offset = Math.floor(rnd() * Math.max(1, total - width)) + (rnd() < 0.5 ? 0.37 : 0);
    const out = new Float32Array(width + 8).fill(9);
    peaksColumnsInto(peaks, total, offset, width, out);
    const want = waveColumns(peaks, null, duration, total, offset, width, null);
    assert.deepEqual(out.subarray(0, width + 1), want);
  }
});

const SR = 48000;
function fineOf(frames) {
  const audio = new Int16Array(frames);
  for (let i = 0; i < frames; i++) audio[i] = rnd() < 0.002 ? Math.floor((rnd() - 0.5) * 65000) : Math.floor((rnd() - 0.5) * 2000);
  const data = new Uint8Array(Math.ceil(frames / FINE_FRAMES_PER_PEAK));
  encodeFineChunk([audio], 0, FINE_FRAMES_PER_PEAK, data);
  return { audio, fine: { sampleRate: SR, framesPer: FINE_FRAMES_PER_PEAK, frames, data } };
}

test('colunas do resumo detalhado iguais a fineColumns (com e sem pirâmide)', () => {
  const dur = 40;
  const { fine } = fineOf(dur * SR);
  for (let t = 0; t < 300; t++) {
    const zoom = rnd() < 0.3 ? 1 + rnd() * 10 : 10 + rnd() * 490;
    const total = Math.max(30, dur * zoom);
    const width = 1 + Math.floor(rnd() * 1500);
    const offset = Math.floor(rnd() * Math.max(1, total - width / 2));
    const out = new Float32Array(width + 1);
    fineColumnsInto(fine, dur, total, offset, width, out);
    assert.deepEqual(out, fineColumns(fine, dur, total, offset, width));
  }
  // afastado de verdade: a pirâmide entra (trecho longo por coluna)
  assert.ok((dur * SR) / 100 / FINE_FRAMES_PER_PEAK > DIRECT_MAX_RUN);
  assert.equal(hasPyramid(fine.data), true);
});

test('colunas das amostras iguais a sampleColumns', () => {
  const frames = 5 * SR;
  const { audio } = fineOf(frames);
  const right = audio.map((v) => -v);
  for (let t = 0; t < 100; t++) {
    const total = 5 * (50 + rnd() * 450);
    const perPx = (5 / total) * SR;
    const width = 1 + Math.floor(rnd() * 900);
    const offset = Math.floor(rnd() * total);
    const out = new Float32Array(width + 1);
    sampleColumnsInto([audio, right], frames, perPx, offset, width, out);
    assert.deepEqual(out, sampleColumns([audio, right], 0, frames, perPx, offset, width));
  }
});

test('fonte do quadro na mesma ordem do desenho normal', () => {
  const base = { peakCount: 24000, hasFine: true, hasAudio: false, framesPerPx: Infinity };
  // afastado: resumo do projeto, como o desenho normal
  assert.equal(pickLiveKind({ ...base, total: 12000 }), 'peaks');
  // aproximado: resumo detalhado
  assert.equal(pickLiveKind({ ...base, total: 30000 }), 'fine');
  assert.equal(pickLiveKind({ ...base, total: 30000, hasAudio: true, framesPerPx: 90 }), 'fine');
  // sem resumo detalhado: amostras só quando são poucas por pixel
  assert.equal(pickLiveKind({ ...base, total: 30000, hasFine: false, hasAudio: true, framesPerPx: 90 }), 'samples');
  assert.equal(pickLiveKind({ ...base, total: 30000, hasFine: false, hasAudio: true, framesPerPx: 900 }), 'peaks');
  assert.equal(pickLiveKind({ ...base, total: 30000, hasFine: false }), 'peaks');
  // áudio curto (fala do Maestro IA): o canvas inteiro lê poucas amostras, então usa elas como o desenho normal
  assert.equal(pickLiveKind({ peakCount: 400, total: 1000, hasFine: false, hasAudio: true, framesPerPx: 240, cols: 1001 }), 'samples');
  assert.equal(pickLiveKind({ ...base, total: 30000, hasFine: false, hasAudio: true, framesPerPx: 900, cols: 1433 }), 'peaks');
  assert.equal(pickLiveKind({ peakCount: 0, total: 300, hasFine: false, hasAudio: false, framesPerPx: Infinity }), 'none');
});

test('canvas do gesto: só a parte do clipe que está na tela, e nada fora dela', () => {
  const view = { zoom: 100, scrollLeft: 5000, clientWidth: 1400 };
  // clipe de 2 min começando em 10 s: na tela de 50 s a 64 s
  const s = liveSpan({ ...view, startSec: 10, duration: 120, minPx: 30 });
  assert.deepEqual(s, { left: 4000, width: 1400, total: 12000 });
  // com folga dos lados
  assert.deepEqual(liveSpan({ ...view, startSec: 10, duration: 120, minPx: 30, pad: 16 }), { left: 3984, width: 1432, total: 12000 });
  // fora da tela
  assert.equal(liveSpan({ ...view, startSec: 100, duration: 5, minPx: 30 }), null);
  assert.equal(liveSpan({ ...view, startSec: 0, duration: 20, minPx: 30 }), null);
  // corte: o arquivo inteiro fica deslocado, o canvas cobre só o que toca
  const cut = liveSpan({ ...view, startSec: 45, duration: 60, minPx: 30, from: 8, to: 12 });
  assert.deepEqual(cut, { left: 800, width: 400, total: 6000 });
  // largura mínima do clipe (zoom muito afastado)
  assert.deepEqual(liveSpan({ zoom: 1, scrollLeft: 0, clientWidth: 1400, startSec: 3, duration: 0.5, minPx: 30 }), { left: 0, width: 30, total: 30 });
  // nunca mais largo que a tela com a folga
  for (let t = 0; t < 2000; t++) {
    const z = 0.5 + rnd() * 500;
    const v = { zoom: z, scrollLeft: rnd() * 100000, clientWidth: 400 + rnd() * 2000, startSec: rnd() * 600, duration: rnd() * 600, minPx: 30, pad: 16 };
    const sp = liveSpan(v);
    if (!sp) continue;
    assert.ok(sp.width <= v.clientWidth + 2 * 16 + 2);
    assert.ok(sp.left >= 0 && sp.left + sp.width <= Math.ceil(sp.total));
  }
});

test('altura de cada coluna igual à do desenho normal (ganho, pow 0,68, silêncio)', () => {
  const cols = Float32Array.from({ length: 501 }, (_, i) => (i % 50 === 0 ? 0 : rnd() * 1.3));
  for (const gain of [1, 0.5, 2, 0, undefined]) {
    const amp = 38;
    const out = new Float32Array(501);
    liveHeightsInto(cols, 500, gain, amp, out);
    const g = Math.max(0.01, gain || 1);
    for (let x = 0; x <= 500; x++) {
      const v = Math.pow(Math.max(0, Math.min(1, cols[x] * g)), 0.68);
      assert.equal(out[x], Math.fround(v < 0.003 ? 0 : Math.max(0.5, v * amp)));
    }
  }
});

test('orçamento: passou de 6 ms desenha menos no próximo quadro; sobrou, volta aos poucos', () => {
  assert.equal(LIVE_BUDGET_MS, 6);
  // 20 ondas em 12 ms: no próximo quadro cabem umas 8
  const cut = nextLiveLimit(Infinity, 20, 20, 12);
  assert.ok(cut >= 1 && cut <= 10, String(cut));
  // muito pesado: nunca menos de uma
  assert.equal(nextLiveLimit(Infinity, 3, 20, 500), 1);
  // dentro do orçamento com todas: fica
  assert.equal(nextLiveLimit(Infinity, 20, 20, 3), Infinity);
  // sobrou bastante com o limite: sobe aos poucos
  assert.equal(nextLiveLimit(8, 8, 20, 2), 10);
  // perto do orçamento: não sobe (não fica indo e voltando)
  assert.equal(nextLiveLimit(8, 8, 20, 4), 8);
  // simulação: custo fixo por onda, o limite assenta dentro do orçamento
  let limit = Infinity;
  for (let f = 0; f < 60; f++) {
    const drawn = Math.min(limit, 30);
    limit = nextLiveLimit(limit, drawn, 30, drawn * 0.5);
  }
  assert.ok(Math.min(limit, 30) * 0.5 <= LIVE_BUDGET_MS);
});

test('as faixas mais próximas do mouse vêm primeiro', () => {
  assert.deepEqual(orderByDistance([100, 300, 200, 500], 260), [1, 2, 0, 3]);
});

test('o painel liga as ondas ao vivo no quadro do gesto e as solta no fim', () => {
  const panel = read('components', 'TimelinePanel.tsx');
  assert.match(panel, /liveWavePrepare\(!lp\)/);
  assert.match(panel, /liveWaveFrame\(\{ zoom: target, scrollLeft: live\.scroll, clientWidth: cw \}\)/);
  assert.match(panel, /liveWaveSettle\(/);
  assert.match(panel, /startSec=\{preview\.start\}/);
  const wave = read('components', 'ClipWaveform.tsx');
  // o canvas do gesto só existe enquanto há gesto (ou até o desenho normal assumir)
  assert.match(wave, /canvas\.remove\(\)/);
  assert.match(wave, /vs-wave-layer/);
  assert.match(read('components', 'NarrationLane.tsx'), /startSec=\{clip\.startTime \+ shift/);
  assert.match(read('index.css'), /\[data-vs-live\] > \.vs-wave-layer/);
});
