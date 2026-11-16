// Commit do zoom leve: a geometria da timeline fica em segundos no estilo (var(--vs-zoom)) e a
// régua e a grade são desenhadas em canvas. As contas novas têm de dar o mesmo que as de antes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  canvasSpan, canvasX, canvasXAt, formatRulerTick, MAX_CANVAS_PX, rulerStepFor, rulerTicks,
  spanInView, stepLinesPx, textBaseline, waveScaleX, zoomPx, zoomPxMin, createZoomCanvasHub,
} = await import('../src/lib/zoomGeometry.ts');

const read = (...p) => fs.readFileSync(new URL(`../src/${p.join('/')}`, import.meta.url), 'utf8');

// sorteio fixo (o teste é sempre o mesmo)
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('estilo em segundos: calc com a variável do zoom, e nunca inválido', () => {
  assert.equal(zoomPx(12.5), 'calc(var(--vs-zoom) * 12.5px)');
  assert.equal(zoomPx(-0.25), 'calc(var(--vs-zoom) * -0.25px)');
  assert.equal(zoomPx(NaN), 'calc(var(--vs-zoom) * 0px)');
  assert.equal(zoomPx(Infinity), 'calc(var(--vs-zoom) * 0px)');
  assert.equal(zoomPxMin(8, 3), 'max(8px, calc(var(--vs-zoom) * 3px))');
});

test('o clipe aparece nas mesmas condições do ClipBlock de antes', () => {
  // conta antiga do ClipBlock: left > visible.end || left + fullWidth < visible.start => null
  const old = (start, duration, zoom, v) => {
    const left = start * zoom;
    const fullWidth = Math.max(30, duration * zoom);
    return !(left > v.end || left + fullWidth < v.start);
  };
  for (let i = 0; i < 5000; i++) {
    const zoom = 1 + rnd() * 499;
    const start = rnd() * 600;
    const duration = rnd() < 0.1 ? rnd() * 0.05 : rnd() * 300;
    const s = Math.floor(rnd() * 200) * 256;
    const v = { start: s, end: s + 256 * (1 + Math.floor(rnd() * 20)) };
    assert.equal(spanInView(start, duration, zoom, v), old(start, duration, zoom, v));
  }
  // na borda: encostar conta como dentro, como antes
  assert.equal(spanInView(10, 1, 100, { start: 0, end: 1000 }), true);
  assert.equal(spanInView(10.01, 1, 100, { start: 0, end: 1000 }), false);
});

test('régua de tempo: passo, números e texto iguais aos de antes', () => {
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const oldTick = (sec, step) => {
    if (step < 1) {
      const whole = Math.floor(sec);
      const frac = Math.round((sec - whole) * 10);
      return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}.${frac}`;
    }
    return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
  };
  for (let i = 0; i < 2000; i++) {
    const zoom = Math.round((1 + rnd() * 499) * 100) / 100;
    const step = candidates.find((s) => s * zoom >= 60) ?? 600;
    assert.equal(rulerStepFor(zoom), step);
    const stepPx = step * zoom;
    const vs = Math.floor(rnd() * 100) * 256;
    const ve = vs + 256 * (2 + Math.floor(rnd() * 12));
    const tw = Math.max(200, Math.ceil(rnd() * 400 * zoom));
    // visibleTicks de antes
    const first = Math.max(0, Math.floor(vs / stepPx));
    const last = Math.min(Math.ceil(tw / stepPx), Math.ceil(ve / stepPx));
    const want = [];
    for (let k = first; k <= last; k++) want.push(k * step);
    const got = rulerTicks(step, zoom, vs, ve, tw);
    assert.deepEqual(got, want);
    for (const t of got) assert.equal(formatRulerTick(t, step), oldTick(t, step));
  }
  assert.equal(formatRulerTick(65.5, 0.5), '1:05.5');
  assert.equal(formatRulerTick(125, 5), '2:05');
});

test('grade sem andamento: as mesmas colunas do repeating-linear-gradient', () => {
  // o gradiente pinta o último pixel de cada passo (de stepPx - 1 a stepPx), até a largura
  for (const stepPx of [60, 64, 75, 120, 300]) {
    const width = 5000;
    const painted = [];
    for (let x = 0; x < width; x++) if (x % stepPx === stepPx - 1) painted.push(x);
    for (const [a, b] of [[0, 2600], [1024, 3584], [4608, 7680]]) {
      const got = stepLinesPx(stepPx, a, b, width);
      assert.deepEqual(got, painted.filter((x) => x + 1 > a && x < Math.min(b, width)), `${stepPx} ${a}-${b}`);
    }
  }
  assert.deepEqual(stepLinesPx(0, 0, 1000, 1000), []);
});

test('canvas parado: um pixel do canvas por pixel da tela, cobrindo a janela visível', () => {
  for (const dpr of [1, 2, 1.5]) {
    const v = { start: 2048, end: 4864 };
    const span = canvasSpan(100, v, dpr, null);
    assert.equal(span.left, 2048);
    assert.equal(span.pixelWidth, Math.round((v.end - v.start) * dpr));
    assert.equal(span.cssWidth * dpr, span.pixelWidth);
    assert.equal(span.zoom, 100);
    assert.equal(span.from, 20.48);
    assert.ok(Math.abs(span.to - 48.64) < 1e-9);
    // linha do instante t no pixel inteiro mais perto de t * zoom
    for (const t of [20.48, 21, 33.333, 48.6]) assert.equal(canvasXAt(span, t), Math.round((t * 100 - 2048) * dpr));
    assert.equal(canvasX(span, 2048), 0);
  }
  // janela maior que o limite do canvas: corta, não quebra
  assert.equal(canvasSpan(100, { start: 0, end: 100000 }, 2, null).pixelWidth, MAX_CANVAS_PX);
});

test('canvas no zoom ao vivo: cobre a tela no zoom do quadro, um pixel por pixel e tamanho fixo', () => {
  const dpr = 2;
  const cw = 1400;
  const widths = new Set();
  for (const zoom of [27.2, 40, 80, 104, 160, 319.99]) {
    const scrollLeft = 3000;
    const live = { zoom, scrollLeft, clientWidth: cw, timelineWidth: 1e9 };
    // a janela visível do React (zoom de verdade) não entra na conta
    const span = canvasSpan(80, { start: 0, end: 1 }, dpr, live, 32);
    widths.add(span.pixelWidth);
    // a borda esquerda do canvas fica 32 px antes da tela, e a direita 32 px depois
    assert.equal(span.left, scrollLeft - 32);
    assert.equal(span.cssWidth, cw + 64);
    assert.equal(span.scale, dpr);
    assert.equal(span.zoom, zoom);
    assert.ok(Math.abs(span.from - (scrollLeft - 32) / zoom) < 1e-9);
    // cada instante cai a menos de meio pixel do canvas de onde o layout o põe (t * zoom - scroll)
    for (let i = 0; i < 50; i++) {
      const t = span.from + rnd() * (span.to - span.from);
      const want = t * zoom - scrollLeft;
      const got = span.left + canvasXAt(span, t) / span.scale - scrollLeft;
      assert.ok(Math.abs(got - want) <= 0.5 / dpr + 1e-9, `${zoom} ${t}`);
    }
  }
  // o canvas não muda de tamanho a cada quadro do gesto
  assert.equal(widths.size, 1);
  // no começo da música não passa para antes do 0
  assert.equal(canvasSpan(80, { start: 0, end: 1 }, 1, { zoom: 50, scrollLeft: 10, clientWidth: cw, timelineWidth: 1e9 }).left, 0);
  // além do fim da timeline vai só até a borda da tela (a grade não aumenta a área rolável)
  const end = canvasSpan(80, { start: 0, end: 1 }, 1, { zoom: 50, scrollLeft: 5000, clientWidth: cw, timelineWidth: 6000 }, 32, 6000);
  assert.equal(end.left + end.cssWidth, 5000 + cw);
  const inside = canvasSpan(80, { start: 0, end: 1 }, 1, { zoom: 50, scrollLeft: 1000, clientWidth: cw, timelineWidth: 6000 }, 32, 6000);
  assert.equal(inside.left + inside.cssWidth, 1000 + cw + 32);
  const hub = createZoomCanvasHub();
  assert.equal(hub.live, null);
  assert.ok(hub.draws instanceof Set);
});

test('onda no zoom ao vivo: a escala vem da variável e preenche o clipe', () => {
  assert.equal(waveScaleX(12.5, 30, 2000), 'calc(max(30, var(--vs-zoom) * 12.5) / 2000)');
  // nunca inválido
  assert.equal(waveScaleX(NaN, 30, 2000), 'calc(max(30, var(--vs-zoom) * 0) / 2000)');
  assert.equal(waveScaleX(12.5, 30, 0), '1');
  // a conta que o navegador faz: largura do clipe no zoom do quadro / largura desenhada
  const shown = (zoom, sec, min, drawn) => Math.max(min, zoom * sec) / drawn;
  assert.equal(shown(100, 12.5, 30, 1250), 1);
  assert.equal(shown(200, 12.5, 30, 1250), 2);
  assert.equal(shown(1, 12.5, 30, 30), 1);
});

test('linha de base do texto como na caixa de linha do navegador', () => {
  // caixa de 14 px, fonte com 10 de subida e 3 de descida: meia entrelinha 0,5 arredonda para 0
  assert.equal(textBaseline(24, 14, 10, 3), 34);
  // caixa de 10 px (leading-none) com 2 px de padding em cima
  assert.equal(textBaseline(2, 10, 9.6, 2.4), 2 + Math.floor((10 - 12) / 2) + 10);
});

test('no código: o clipe não recebe o zoom e a geometria vai pela variável CSS', () => {
  const panel = read('components', 'TimelinePanel.tsx');
  const props = panel.slice(panel.indexOf('type ClipBlockProps = {'), panel.indexOf('};', panel.indexOf('type ClipBlockProps = {')));
  assert.doesNotMatch(props, /zoomH|visible/);
  const same = panel.slice(panel.indexOf('function sameClipBlockProps('), panel.indexOf('// Cor de cada faixa'));
  assert.doesNotMatch(same, /zoomH|visible/);
  const block = panel.slice(panel.indexOf('const ClipBlock = memo(function ClipBlock('), panel.indexOf('}, sameClipBlockProps);'));
  assert.doesNotMatch(block, /zoomH/);
  assert.match(block, /'--vs-cl': left,/);
  assert.match(block, /<ZoomedClipWaveform clip=\{clip\} startSec=\{effectiveStart - \(trimStart \|\| 0\)\}/);
  // o painel grava as variáveis na hora em que o zoom e a janela mudam (antes da render); no zoom
  // ao vivo quem grava é o quadro
  assert.match(panel, /el\.style\.setProperty\('--vs-zoom', zoom\);\n\s*el\.style\.setProperty\('--vs-tl-w', width\);/);
  assert.match(panel, /useStore\.subscribe\(\(st, prev\) => \{ if \(st\.zoomH !== prev\.zoomH && !liveRef\.current\) writeZoomVars\(st\.zoomH\); \}\)/);
  assert.match(panel, /subscribeTimelineVisible\(\(\) => \{ if \(!liveRef\.current\) writeVisibleVars\(getTimelineVisible\(\)\); \}\)/);
  // e decide quem monta (só o que cruza a janela visível)
  assert.match(panel, /songClips\.filter\(\(c\) => c\.trackId === track\.id && clipShown\(c\)\)/);
  // zoom e janela entram juntos no mesmo flushSync (a onda nunca vê zoom novo com janela velha)
  assert.match(panel, /setTimelineVisible\(win\);\n\s*\}\n\s*setZoomH\(next\);/);
  // régua sem centenas de divs
  assert.doesNotMatch(panel, /visibleTicks/);
  assert.doesNotMatch(panel, /repeating-linear-gradient/);
  assert.match(panel, /<RulerCanvas /);
  assert.match(panel, /<GridLinesCanvas /);
  // os canvas acompanham o zoom ao vivo
  assert.match(panel, /for \(const draw of canvasHub\.draws\) draw\(\);/);

  const fade = panel.slice(panel.indexOf('function FadeHandle('), panel.indexOf('type ClipBlockProps'));
  assert.match(fade, /deltaPx \/ useStore\.getState\(\)\.zoomH/, 'arrastar o fade lê o zoom na hora');
  assert.match(fade, /const showLine = useStore\(\(s\) => fadeSec \* s\.zoomH > 2\);/);

  const wave = read('components', 'ClipWaveform.tsx');
  assert.match(wave, /export const ZoomedClipWaveform = memo\(/);
  assert.match(wave, /const zoomH = useStore\(\(s\) => s\.zoomH\);\n\s*const visible = useTimelineVisible\(\);/);

  const playhead = read('components', 'Playhead.tsx');
  assert.match(playhead, /translateX\(calc\(var\(--vs-zoom\) \* \$\{Math\.max\(0, t\)\}px\)\)/);
  assert.match(playhead, /\}, \[songId\]\);/);

  const grid = read('components', 'TimelineGrid.tsx');
  assert.doesNotMatch(grid, /export function GridLinesOverlay/);
  // cores e fonte da régua vêm das mesmas classes de antes (cada skin)
  for (const cls of ['border-l border-logic-text-muted/60', 'border-l border-logic-border-light/60', 'border-l border-logic-border-dark/60',
    'text-2xs text-logic-text-muted font-mono pl-1 whitespace-nowrap']) assert.ok(grid.includes(cls), cls);
  assert.match(grid, /cv\.style\.left !== left/);
});
