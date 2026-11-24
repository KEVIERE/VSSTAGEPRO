// Lote 3: medidores das skins Estúdio, Oficina e Grafite fora do React. O nível chega umas 30
// vezes por segundo tocando; antes cada chegada redesenhava cada medidor e cada caixinha de pico
// pelo React. Agora eles ouvem o meterBus e escrevem no elemento só o que mudou.
// Aqui: o desenho é o mesmo de antes, passo a passo, com o meterBus de verdade; só o que mudou é
// escrito; e o pico segurado apaga 1,5 s depois do Stop (antes ficava preso até o próximo nível).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { meterLevel, publishMeters, resetMeters, subscribeMeters } from '../src/lib/meterBus.ts';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const estudio = read('../src/components/EstudioPieces.tsx');
const grafite = read('../src/components/GrafitePieces.tsx');
const oficina = read('../src/components/OficinaPieces.tsx');

// ---------- funções de verdade, tiradas dos .tsx (TSX não importa direto no node) ----------

/** Um bloco de topo: da cabeça até a primeira linha "}" sozinha. */
function block(src, head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `achei ${head}`);
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, `fim de ${head}`);
  return src.slice(start, end + 2);
}
/** Uma linha de topo (constante). */
function line(src, head) {
  const start = src.indexOf(head);
  assert.ok(start >= 0, `achei ${head}`);
  return src.slice(start, src.indexOf('\n', start) + 1);
}
const js = (parts) => stripTypeScriptTypes(parts.join('\n').replace(/^export /gm, ''));

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    performance: { now: () => now },
    window: {
      setTimeout: (fn, ms) => { seq += 1; timers.set(seq, { at: now + ms, fn }); return seq; },
      clearTimeout: (id) => { timers.delete(id); },
    },
    /** Avança o relógio até `t`, rodando em ordem os timers que vencem no caminho. */
    advance(t) {
      for (;;) {
        let next = null;
        for (const [id, tm] of timers) if (tm.at <= t && (!next || tm.at < next[1].at)) next = [id, tm];
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
      }
      now = Math.max(now, t);
    },
    pending: () => timers.size,
    get now() { return now; },
  };
}

function load(clock) {
  const shared = [
    line(estudio, 'const METER_HOLD_MS = '),
    line(estudio, 'const METER_HOLD_SLACK_MS'),
    block(estudio, 'export function levelDb'),
    block(estudio, 'export function holdStep'),
    block(estudio, 'export function holdDeadline'),
    block(estudio, 'export function bindMeter'),
    block(estudio, 'export function esMeterPct'),
    line(estudio, 'const pctOf = esMeterPct;'),
    block(estudio, 'export function meterBarWriter'),
    block(estudio, 'function esMeterPaint('),
    block(estudio, 'function esPeakBoxView('),
    block(estudio, 'export function meterTextPaint'),
    line(grafite, 'const FM_SEGS = 30;'),
    block(grafite, 'function gfSegClass('),
    block(grafite, 'function gfLitCount('),
    block(grafite, 'function gfFaderMeterPaint('),
    line(oficina, 'const FLOOR = -60;'),
    line(oficina, 'export const ofMeterPct'),
    block(oficina, 'function ofMeterPaint('),
    block(oficina, 'function ofPeakView('),
  ];
  const names = ['METER_HOLD_MS', 'bindMeter', 'esMeterPaint', 'esPeakBoxView', 'meterTextPaint', 'gfSegClass', 'gfFaderMeterPaint', 'ofMeterPaint', 'ofPeakView'];
  const fn = new Function('meterLevel', 'subscribeMeters', 'performance', 'window', `${js(shared)}\nreturn { ${names.join(', ')} };`);
  return fn(meterLevel, subscribeMeters, clock.performance, clock.window);
}

// Elemento de mentira que conta as escritas (className, texto e estilo).
function fakeEl(className = '') {
  const el = { writes: 0, _class: className, _text: '' };
  Object.defineProperty(el, 'className', { get: () => el._class, set: (v) => { el._class = v; el.writes += 1; } });
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: (v) => { el._text = v; el.writes += 1; } });
  const style = {};
  for (const k of ['clipPath', 'bottom', 'display']) {
    let v = '';
    Object.defineProperty(style, k, { get: () => v, set: (x) => { v = x; el.writes += 1; } });
  }
  el.style = style;
  return el;
}
const totalWrites = (els) => els.reduce((s, e) => s + e.writes, 0);

// ---------- como era (o corpo dos componentes antigos, que rodava a cada render do React) ----------

const oldDb = (level) => (level > 1e-5 ? 20 * Math.log10(level) : -Infinity);
// quantas vezes o pico segurado venceu por tempo (para a comparação não ser trivial)
const expired = { count: 0 };
const countExpiry = (v, held, now, at) => { if (v < held && now - at > 1500) expired.count += 1; };
function oldGf(level, off, hold, now) {
  const db = oldDb(level);
  const lit = off ? 0 : Math.max(0, Math.min(30, Math.round(((db + 54) / 54) * 30)));
  countExpiry(lit, hold.current.n, now, hold.current.at);
  if (lit >= hold.current.n || now - hold.current.at > 1500) hold.current = { n: lit, at: now };
  const peak = hold.current.n;
  return Array.from({ length: 30 }, (_, k) => {
    const n = 30 - k;
    const zone = n > 30 - 2 ? 'is-red' : n > 30 - 7 ? 'is-yellow' : 'is-green';
    const on = n <= lit || (n === peak && peak > 0);
    return `${zone} ${on ? 'is-on' : ''}`;
  });
}
function oldEsPct(db) {
  if (!(db > -60)) return 0;
  if (db >= 0) return 1;
  return db >= -24 ? 1 - (-db / 24) * 0.6 : 0.4 * ((db + 60) / 36);
}
function oldEs(level, off, hold, now) {
  const p = off ? 0 : oldEsPct(oldDb(level));
  countExpiry(p, hold.current.p, now, hold.current.at);
  if (p >= hold.current.p || now - hold.current.at > 1500) hold.current = { p, at: now };
  return { clip: `inset(${(1 - p) * 100}% 0 0 0)`, peak: hold.current.p > 0.02 ? `${hold.current.p * 100}%` : null };
}
function oldDbBox(level, hold, now) {
  const db = oldDb(level);
  countExpiry(db, hold.current.db, now, hold.current.at);
  if (db >= hold.current.db || now - hold.current.at > 1500) hold.current = { db, at: now };
  const peak = hold.current.db;
  const live = peak > -60;
  const tone = peak >= 0 ? 'is-red' : peak >= -6 ? 'is-yellow' : 'is-green';
  return { className: `es-dbbox ${live ? tone : ''}`, text: live ? peak.toFixed(1) : ' ' };
}
const oldOfPct = (db) => (!(db > -60) ? 0 : db >= 0 ? 1 : (db - -60) / 60);
function oldOf(level, off, hold, now) {
  const db = oldDb(level);
  const p = off ? 0 : oldOfPct(db);
  countExpiry(p, hold.current.p, now, hold.current.at);
  if (p >= hold.current.p || now - hold.current.at > 1500) hold.current = { p, at: now };
  const hot = !off && db > -6;
  return {
    root: `of-meter ${hot ? 'is-hot' : ''}`,
    clip: `inset(${(1 - p) * 100}% 0 0 0)`,
    peak: hold.current.p > 0.02 ? `${hold.current.p * 100}%` : null,
  };
}
function oldOfPeak(level, hold, now) {
  const db = oldDb(level);
  countExpiry(db, hold.current.db, now, hold.current.at);
  if (db >= hold.current.db || now - hold.current.at > 1500) hold.current = { db, at: now };
  const peak = hold.current.db;
  return { className: `of-peak ${peak >= 0 ? 'is-red' : ''}`, text: peak > -60 ? peak.toFixed(1) : '-inf' };
}

/** O React de antes: useSyncExternalStore redesenhava quando o nível deste canal mudava. */
function oldReact(clock, id, render) {
  let out;
  let last = meterLevel(id);
  const run = () => { out = render(meterLevel(id), clock.now); };
  run();
  const off = subscribeMeters(() => {
    const l = meterLevel(id);
    if (!Object.is(l, last)) { last = l; run(); }
  });
  return { get out() { return out; }, rerender: run, off };
}

/** O efeito de agora: liga, e religa quando o mudo muda (o pico segue no mesmo ref). */
function newEffect(m, id, makePaint) {
  let off = m.bindMeter(id, makePaint());
  return { rebind() { off(); off = m.bindMeter(id, makePaint()); }, off: () => off() };
}

// Sinal parecido com música: trechos fortes (com picos acima de 0 dBFS e silêncio no meio) e
// trechos baixos e caindo, longos o bastante para o pico segurado vencer. O nível deste canal muda
// a cada publicação (mais que o mínimo do meterBus), como tocando.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function nextLevel(rnd, prev, loud) {
  for (;;) {
    const r = rnd();
    let v;
    if (loud) {
      if (r < 0.05) v = 0;
      else if (r < 0.08) v = 1e-6;
      else if (r < 0.14) v = 1 + rnd() * 0.4;
      else v = 10 ** ((-30 + rnd() * 30) / 20);
    } else {
      v = r < 0.6 ? prev * (0.7 + rnd() * 0.25) : 10 ** ((-66 + rnd() * 40) / 20);
    }
    if (Math.abs(v - prev) > 0.003) return v;
  }
}

/**
 * Toca `steps` publicações (30 a 36 ms entre elas) em dois canais e, depois de cada uma, compara o
 * desenho de agora com o de antes. Às vezes muda o mudo (o React redesenhava; o efeito religa).
 */
function playAndCompare({ seed, steps, oldRender, newPaint, readNew }) {
  const clock = fakeClock();
  const m = load(clock);
  const id = `lote3-${seed}`;
  const other = `${id}-outro`;
  const rnd = mulberry32(seed);
  const expiredBefore = expired.count;
  let off = false;
  const oldHold = { current: null };
  const old = oldReact(clock, id, (level, now) => oldRender(level, off, oldHold, now));
  const neu = newEffect(m, id, () => newPaint(m, off));
  assert.deepEqual(readNew(), old.out, 'primeiro desenho');
  let t = 0;
  let level = 0;
  let otherLevel = 0;
  let toggles = 0;
  for (let i = 0; i < steps; i += 1) {
    t += 30 + Math.floor(rnd() * 7);
    clock.advance(t);
    const loud = i % 150 < 50;
    level = nextLevel(rnd, level, loud);
    // o outro canal às vezes muda sozinho (publicação sem mudança neste canal)
    if (rnd() < 0.3) {
      otherLevel = otherLevel > 0.5 ? 0.1 : 0.9;
      publishMeters(new Map([[other, otherLevel]]));
      assert.deepEqual(readNew(), old.out, `passo ${i}: publicação de outro canal`);
    }
    publishMeters(new Map([[id, level], [other, otherLevel]]));
    assert.deepEqual(readNew(), old.out, `passo ${i} (t=${t}, nível ${level})`);
    if (rnd() < 0.01) {
      off = !off;
      toggles += 1;
      old.rerender();
      neu.rebind();
      assert.deepEqual(readNew(), old.out, `passo ${i}: mudo ${off}`);
    }
  }
  assert.ok(toggles > 0, 'o mudo mudou no caminho');
  assert.ok(expired.count - expiredBefore >= 10, `o pico venceu por tempo ${expired.count - expiredBefore} vezes no caminho`);
  old.off();
  neu.off();
  resetMeters();
  return clock;
}

// ---------- o desenho é o mesmo ----------

test('Grafite: os 30 LEDs acendem igual a antes, com o pico segurando 1,5 s', () => {
  for (const seed of [11, 12, 13]) {
    let segs; // os 30 LEDs como o JSX monta (todos apagados)
    const hold = { v: 0, at: 0 };
    playAndCompare({
      seed,
      steps: 3000,
      oldRender: (level, off, h, now) => { h.current ??= { n: 0, at: 0 }; return oldGf(level, off, h, now); },
      newPaint: (m, off) => {
        segs ??= Array.from({ length: 30 }, (_, k) => fakeEl(m.gfSegClass(30 - k, false)));
        return m.gfFaderMeterPaint(segs, off, hold);
      },
      readNew: () => segs.map((s) => s.className),
    });
  }
});

test('Estúdio: as duas barrinhas e o traço do pico iguais a antes', () => {
  for (const seed of [21, 22, 23]) {
    const fills = [fakeEl('es-meter-fill'), fakeEl('es-meter-fill')];
    const peaks = [fakeEl('es-meter-peak'), fakeEl('es-meter-peak')];
    const hold = { v: 0, at: 0 };
    playAndCompare({
      seed,
      steps: 3000,
      oldRender: (level, off, h, now) => { h.current ??= { p: 0, at: 0 }; return oldEs(level, off, h, now); },
      newPaint: (m, off) => m.esMeterPaint(fills, peaks, off, hold),
      readNew: () => {
        assert.equal(fills[1].style.clipPath, fills[0].style.clipPath, 'as duas barras iguais');
        assert.equal(peaks[1].style.display, peaks[0].style.display);
        return { clip: fills[0].style.clipPath, peak: peaks[0].style.display === 'none' ? null : peaks[0].style.bottom };
      },
    });
  }
});

test('Estúdio: a caixinha do pico em dB igual a antes (texto e cor)', () => {
  for (const seed of [31, 32]) {
    const box = fakeEl('es-dbbox ');
    const hold = { v: -Infinity, at: 0 };
    playAndCompare({
      seed,
      steps: 3000,
      oldRender: (level, _off, h, now) => { h.current ??= { db: -Infinity, at: 0 }; return oldDbBox(level, h, now); },
      newPaint: (m) => m.meterTextPaint(box, hold, m.esPeakBoxView),
      readNew: () => ({ className: box.className, text: box.textContent }),
    });
  }
});

test('Oficina: medidor (recorte, pico e coluna avermelhada) e pico em texto iguais a antes', () => {
  for (const seed of [41, 42]) {
    const root = fakeEl('of-meter ');
    const fill = [fakeEl('of-meter-fill')];
    const peak = [fakeEl('of-meter-peak')];
    const hold = { v: 0, at: 0 };
    playAndCompare({
      seed,
      steps: 3000,
      oldRender: (level, off, h, now) => { h.current ??= { p: 0, at: 0 }; return oldOf(level, off, h, now); },
      newPaint: (m, off) => m.ofMeterPaint(root, fill, peak, off, hold),
      readNew: () => ({ root: root.className, clip: fill[0].style.clipPath, peak: peak[0].style.display === 'none' ? null : peak[0].style.bottom }),
    });
  }
  for (const seed of [43, 44]) {
    const span = fakeEl('of-peak ');
    const hold = { v: -Infinity, at: 0 };
    playAndCompare({
      seed,
      steps: 3000,
      oldRender: (level, _off, h, now) => { h.current ??= { db: -Infinity, at: 0 }; return oldOfPeak(level, h, now); },
      newPaint: (m) => m.meterTextPaint(span, hold, m.ofPeakView),
      readNew: () => ({ className: span.className, text: span.textContent }),
    });
  }
});

// ---------- só o que mudou é escrito ----------

test('Grafite: só troca a classe do LED que mudou; nível parado e outro canal não escrevem nada', () => {
  const clock = fakeClock();
  const m = load(clock);
  const id = 'lote3-escritas';
  const segs = Array.from({ length: 30 }, (_, k) => fakeEl(m.gfSegClass(30 - k, false)));
  const db = (x) => 10 ** (x / 20);
  const off = m.bindMeter(id, m.gfFaderMeterPaint(segs, false, { v: 0, at: 0 }));
  assert.equal(totalWrites(segs), 0, 'silêncio: os 30 apagados do JSX já estão certos');
  clock.advance(33);
  publishMeters(new Map([[id, db(-36)]])); // 10 LEDs
  assert.equal(segs.filter((s) => s.className.endsWith('is-on')).length, 10);
  assert.equal(totalWrites(segs), 10, 'acendeu 10: 10 escritas');
  clock.advance(66);
  publishMeters(new Map([[id, db(-32.4)]])); // 12 LEDs
  assert.equal(totalWrites(segs), 12, 'mais 2 LEDs: só 2 escritas');
  clock.advance(99);
  publishMeters(new Map([[id, db(-36)]])); // volta a 10, o 12 fica como pico
  assert.equal(totalWrites(segs), 13, 'o 11 apaga e o 12 fica segurado: 1 escrita');
  assert.ok(segs[30 - 12].className.endsWith('is-on') && !segs[30 - 11].className.endsWith('is-on'));
  clock.advance(132);
  publishMeters(new Map([['lote3-outro-canal', 0.5]]));
  publishMeters(new Map([[id, db(-36) + 0.0005]])); // mudança mínima: o meterBus nem avisa
  assert.equal(totalWrites(segs), 13, 'nada mudou neste canal: nenhuma escrita');
  off();
  resetMeters();
});

test('Estúdio: recorte e traço escritos só quando mudam', () => {
  const clock = fakeClock();
  const m = load(clock);
  const id = 'lote3-es-escritas';
  const fills = [fakeEl(), fakeEl()];
  const peaks = [fakeEl(), fakeEl()];
  const off = m.bindMeter(id, m.esMeterPaint(fills, peaks, false, { v: 0, at: 0 }));
  // primeiro desenho: recorte todo (silêncio) e traço escondido, nas duas barras
  assert.equal(fills[0].style.clipPath, 'inset(100% 0 0 0)');
  assert.equal(peaks[0].style.display, 'none');
  const first = totalWrites([...fills, ...peaks]);
  assert.equal(first, 4);
  publishMeters(new Map([['lote3-es-outro', 0.7]]));
  assert.equal(totalWrites([...fills, ...peaks]), first, 'outro canal: nada escrito');
  off();
  resetMeters();
});

// ---------- o pico segurado apaga 1,5 s depois do Stop ----------

test('Stop: o pico segurado apaga 1,5 s depois, sem timer sobrando (antes ficava preso)', () => {
  const clock = fakeClock();
  const m = load(clock);
  const id = 'lote3-stop';
  const fills = [fakeEl(), fakeEl()];
  const peaks = [fakeEl(), fakeEl()];
  const segs = Array.from({ length: 30 }, (_, k) => fakeEl(m.gfSegClass(30 - k, false)));
  const box = fakeEl('es-dbbox ');
  const offs = [
    m.bindMeter(id, m.esMeterPaint(fills, peaks, false, { v: 0, at: 0 })),
    m.bindMeter(id, m.gfFaderMeterPaint(segs, false, { v: 0, at: 0 })),
    m.bindMeter(id, m.meterTextPaint(box, { v: -Infinity, at: 0 }, m.esPeakBoxView)),
  ];
  const oldHold = { current: { p: 0, at: 0 } };
  const old = oldReact(clock, id, (level, now) => oldEs(level, false, oldHold, now));

  clock.advance(100);
  publishMeters(new Map([[id, 1]])); // 0 dBFS: pico no topo
  clock.advance(133);
  publishMeters(new Map([[id, 0.1]])); // -20 dB
  clock.advance(166);
  resetMeters(); // Stop: o motor zera os medidores e para de publicar
  assert.equal(fills[0].style.clipPath, 'inset(100% 0 0 0)', 'a barra apaga na hora');
  assert.equal(peaks[0].style.display, '', 'o pico continua segurado');
  assert.equal(peaks[0].style.bottom, '100%');
  assert.ok(segs[0].className.endsWith('is-on'), 'o LED de cima segurado');
  assert.equal(box.textContent, '0.0');

  clock.advance(100 + m.METER_HOLD_MS); // ainda não venceu (1,5 s exatos)
  assert.equal(peaks[0].style.display, '');
  clock.advance(100 + m.METER_HOLD_MS + 60);
  assert.equal(peaks[0].style.display, 'none', 'o traço do pico apagou');
  assert.ok(segs.every((s) => !s.className.endsWith('is-on')), 'nenhum LED aceso');
  assert.equal(box.textContent, ' ', 'a caixinha esvaziou');
  assert.equal(box.className, 'es-dbbox ');
  assert.equal(clock.pending(), 0, 'nenhum timer ficou rodando');
  clock.advance(100000);
  assert.equal(clock.pending(), 0);

  // antes: sem publicação nova o React não redesenhava, e o traço ficava lá
  assert.equal(old.out.peak, '100%');
  old.off();
  for (const off of offs) off();
  resetMeters();
});

test('desligar o medidor para de ouvir o meterBus e cancela o timer', () => {
  const clock = fakeClock();
  const m = load(clock);
  const id = 'lote3-desliga';
  const fills = [fakeEl()];
  const peaks = [fakeEl()];
  const off = m.bindMeter(id, m.esMeterPaint(fills, peaks, false, { v: 0, at: 0 }));
  clock.advance(10);
  publishMeters(new Map([[id, 1]]));
  clock.advance(43);
  publishMeters(new Map([[id, 0.2]]));
  assert.equal(clock.pending(), 1, 'pico segurado: um timer só');
  clock.advance(76);
  publishMeters(new Map([[id, 0.3]]));
  publishMeters(new Map([[id, 0.25]]));
  assert.equal(clock.pending(), 1, 'novas publicações não empilham timers');
  off();
  assert.equal(clock.pending(), 0);
  const before = totalWrites([...fills, ...peaks]);
  publishMeters(new Map([[id, 0.9]]));
  clock.advance(100000);
  assert.equal(totalWrites([...fills, ...peaks]), before, 'desligado não escreve');
  resetMeters();
});

// ---------- o código ----------

test('os três arquivos de skin não redesenham pelo React a cada nível', () => {
  for (const [name, src] of [['Estúdio', estudio], ['Grafite', grafite], ['Oficina', oficina]]) {
    assert.doesNotMatch(src, /useMeterLevel/, `${name}: sem useMeterLevel`);
    assert.match(src, /useLayoutEffect\(/, `${name}: escreve antes de pintar`);
  }
  assert.match(estudio, /const off = subscribeMeters\(\(\) => apply\(false\)\);/);
  assert.match(estudio, /return bindMeter\(id, esMeterPaint\(fills, peaks, isOff, hold\.current\)\);/);
  assert.match(estudio, /return bindMeter\(meterId, meterTextPaint\(el, hold\.current, esPeakBoxView\)\);/);
  assert.match(grafite, /return bindMeter\(id, gfFaderMeterPaint\(segs, isOff, hold\.current\)\);/);
  assert.match(oficina, /return bindMeter\(id, ofMeterPaint\(el, fill, peak, isOff, hold\.current\)\);/);
  assert.match(oficina, /return bindMeter\(meterId, meterTextPaint\(el, hold\.current, ofPeakView\)\);/);
  // o que o efeito escreve não tem estilo nem texto no JSX (o React não desfaz a escrita)
  assert.match(estudio, /<div className="es-meter-fill" \/>\s*<div className="es-meter-peak" \/>/);
  assert.match(oficina, /<div className="of-meter-fill" \/>\s*<div className="of-meter-peak" \/>/);
  assert.match(estudio, /<span ref=\{ref\} className="es-dbbox " \/>/);
  assert.match(oficina, /<span ref=\{ref\} className="of-peak " title=\{title\} \/>/);
  assert.match(oficina, /<div ref=\{ref\} className="of-meter " style=\{\{ height \}\}/);
  assert.match(grafite, /<i key=\{k\} className=\{gfSegClass\(FM_SEGS - k, false\)\} \/>/);
  // o tempo do pico é o mesmo do mostrador de dB do mixer
  assert.match(read('../src/components/MixerPanel.tsx'), /const READOUT_HOLD_MS = 1500;/);
  assert.match(estudio, /^const METER_HOLD_MS = 1500;/m);
});
