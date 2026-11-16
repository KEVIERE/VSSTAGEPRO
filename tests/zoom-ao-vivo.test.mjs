// Zoom horizontal ao vivo da timeline: cada quadro do gesto muda só a variável do zoom e o scroll
// (sem esticar nada), e mostra exatamente o que a tela vai mostrar depois do zoom de verdade, sem
// salto no começo, no meio, no fim ou com a música cabendo na tela.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  anchoredScroll, clampZoom, MAX_PREVIEW_IN, MAX_PREVIEW_OUT, pastEndReach, previewLow, previewTarget,
  reachWidthFor, thumbGeometry, timelineWidthFor, visibleWindow, zoomOutWindow,
} = await import('../src/lib/zoomPreview.ts');

const CW = 1400; // largura da área das faixas

/**
 * Um gesto: zoom de verdade `base`, scroll `s`, mouse em `mouseX`, quer chegar a `wanted`.
 * Devolve onde cada instante aparece na tela no quadro do zoom ao vivo e depois do zoom de verdade.
 */
function gesture({ contentEnd, base, s, mouseX, wanted }) {
  const W0 = timelineWidthFor(contentEnd, base);
  const scroll = Math.min(s, Math.max(0, W0 - CW));
  const { target } = previewTarget(base, wanted);
  const anchorTime = (scroll + mouseX) / base;
  const finalScroll = anchoredScroll(anchorTime, mouseX, target, timelineWidthFor(contentEnd, target), CW);
  // quadro do zoom ao vivo: o layout já está no zoom do quadro (--vs-zoom) e o scroll é o calculado
  const preview = (t) => t * target - finalScroll;
  // zoom de verdade: o layout effect grava o scroll com a mesma conta e a largura nova
  const committedScroll = anchoredScroll(anchorTime, mouseX, clampZoom(target), timelineWidthFor(contentEnd, clampZoom(target)), CW);
  const after = (t) => t * clampZoom(target) - committedScroll;
  return { preview, after, target, finalScroll, committedScroll, W1: timelineWidthFor(contentEnd, target) };
}

const CASES = [
  { name: 'meio da música, aproximando', contentEnd: 240, base: 50, s: 3000, mouseX: 700, wanted: 150 },
  { name: 'meio da música, afastando', contentEnd: 240, base: 50, s: 3000, mouseX: 700, wanted: 20 },
  { name: 'começo, afastando (antes saltava 250 px)', contentEnd: 240, base: 50, s: 0, mouseX: 500, wanted: 25 },
  { name: 'fim, afastando', contentEnd: 240, base: 50, s: 12000, mouseX: 900, wanted: 20 },
  { name: 'fim, aproximando com o mouse na direita', contentEnd: 240, base: 50, s: 12000, mouseX: 1400, wanted: 190 },
  { name: 'música passa a caber na tela', contentEnd: 240, base: 10, s: 800, mouseX: 300, wanted: 4 },
  { name: 'zoom baixo com arredondamento de 0,01', contentEnd: 1400, base: 1, s: 0, mouseX: 650, wanted: 1.0037 },
  { name: 'zoom alto perto do limite de 500', contentEnd: 240, base: 300, s: 50000, mouseX: 200, wanted: 900 },
];

for (const c of CASES) {
  test(`sem salto no fim do gesto: ${c.name}`, () => {
    const g = gesture(c);
    assert.equal(g.committedScroll, g.finalScroll, 'o scroll do zoom de verdade é o que o quadro mostrou');
    assert.ok(g.finalScroll >= 0 && g.finalScroll <= Math.max(0, g.W1 - CW), 'scroll dentro da área rolável nova');
    for (const t of [0, 0.5, 13.37, 60, 119.9, 180, c.contentEnd]) {
      assert.ok(Math.abs(g.preview(t) - g.after(t)) < 1e-6, `instante ${t}s: ${g.preview(t)} contra ${g.after(t)}`);
    }
  });
}

test('afastar no começo: o instante 0 fica na borda da tela já no quadro do zoom ao vivo', () => {
  const g = gesture({ contentEnd: 240, base: 50, s: 0, mouseX: 500, wanted: 25 });
  assert.equal(g.preview(0), 0);
  // um esticado com origem no mouse mostraria o instante 0 em x = 250
  const oldPreview = 500 * (1 - 0.5);
  assert.equal(oldPreview, 250);
});

test('o zoom ao vivo usa o mesmo arredondamento e os mesmos limites do setZoomH', () => {
  assert.equal(clampZoom(1.0037), 1);
  assert.equal(clampZoom(0.3), 1);
  assert.equal(clampZoom(812), 500);
  assert.equal(clampZoom(37.12345), 37.12);
  const { target } = previewTarget(1, 1.0037);
  assert.equal(target, 1, 'zoom 1 com fator 1,0037: o quadro não muda (e o commit só volta régua e indicadores)');
});

test('o zoom ao vivo não passa de 16x nem de 1/3 por passo', () => {
  assert.deepEqual(previewTarget(20, 400), { target: 320, limited: true });
  assert.deepEqual(previewTarget(30, 1), { target: 10, limited: true });
  assert.deepEqual(previewTarget(20, 60), { target: 60, limited: false });
  for (const base of [1, 3.7, 20, 123.45, 499]) {
    for (const wanted of [0.2, base / 10, base / 2, base * 2, base * 9, 1000]) {
      const { target } = previewTarget(base, wanted);
      assert.ok(target / base <= MAX_PREVIEW_IN + 1e-9, `${base} -> ${target}`);
      assert.ok(target / base >= MAX_PREVIEW_OUT - 1e-9 || target === 1, `${base} -> ${target}`);
      assert.equal(target, clampZoom(target));
    }
  }
});

test('gesto contínuo de 20 para 400 px/s: passos de até 16x e termina no zoom pedido', () => {
  let zoom = 20;
  let rest = 400 / 20;
  let steps = 0;
  while (rest !== 1 && steps < 20) {
    const { target, limited } = previewTarget(zoom, zoom * rest);
    assert.ok(target / zoom <= MAX_PREVIEW_IN + 1e-9);
    rest = (zoom * rest) / target;
    zoom = target;
    steps++;
    if (!limited) break;
  }
  assert.equal(zoom, 400);
  assert.equal(steps, 2);
});

test('afastando, a janela visível (zoom de verdade) cobre tudo o que o zoom ao vivo traz para a tela', () => {
  const margin = 600;
  for (const contentEnd of [240, 30]) {
    for (const mouseX of [0, 300, 700, 1400]) {
      for (const s of [0, 2000, 9000]) {
        const base = 50;
        const W0 = timelineWidthFor(contentEnd, base);
        const scroll = Math.min(s, Math.max(0, W0 - CW));
        const anchorTime = (scroll + mouseX) / base;
        const low = previewLow(base);
        const win = zoomOutWindow(base, low, anchorTime, CW, margin);
        assert.equal(win.start % 256, 0);
        assert.equal(win.end % 256, 0);
        // todos os quadros possíveis entre o zoom de verdade e o limite de 1/3
        for (let target = base; target >= low; target = clampZoom(target * 0.93)) {
          const { target: t } = previewTarget(base, target);
          const finalScroll = anchoredScroll(anchorTime, mouseX, t, timelineWidthFor(contentEnd, t), CW);
          // trecho da música (em px do zoom de verdade) que aparece na tela nesse quadro
          const left = (finalScroll / t) * base;
          const right = Math.min(W0, ((finalScroll + CW) / t) * base);
          assert.ok(win.start <= left + 1e-6, `começo ${win.start} > ${left}`);
          assert.ok(win.end >= right - 1e-6, `fim ${win.end} < ${right}`);
          if (target === low) break;
        }
      }
    }
  }
  assert.equal(previewLow(30), 10);
  assert.equal(previewLow(50), 16.67);
});

test('aproximando, a janela visível de antes do gesto já cobre a tela de cada quadro', () => {
  const margin = 600;
  for (const mouseX of [0, 300, 700, 1400]) {
    for (const s of [0, 2000, 10600]) {
      const contentEnd = 240;
      const base = 50;
      const W0 = timelineWidthFor(contentEnd, base);
      const scroll = Math.min(s, Math.max(0, W0 - CW));
      const win = visibleWindow(scroll, CW, margin);
      const anchorTime = (scroll + mouseX) / base;
      for (const f of [1.01, 1.3, 2, 3.99]) {
        const { target } = previewTarget(base, base * f);
        const finalScroll = anchoredScroll(anchorTime, mouseX, target, timelineWidthFor(contentEnd, target), CW);
        const left = (finalScroll / target) * base;
        const right = ((finalScroll + CW) / target) * base;
        assert.ok(win.start <= left + 1e-6 && win.end >= right - 1e-6, `${mouseX} ${s} ${f}`);
        // e o instante sob o mouse não sai do lugar
        assert.ok(Math.abs(anchorTime * target - finalScroll - mouseX) <= 0.5);
      }
    }
  }
});

test('a janela visível normal é a mesma conta de antes', () => {
  assert.deepEqual(visibleWindow(3000, 1400, 600), { start: 2304, end: 5120 });
  assert.deepEqual(visibleWindow(0, 1400, 600), { start: 0, end: 2048 });
});

test('controle da barra de rolagem: a mesma conta de antes', () => {
  const old = (scrollLeft, clientWidth, timelineWidth, scrollWidth) => {
    const viewW = Math.max(10, clientWidth);
    const totalW = Math.max(viewW, timelineWidth);
    const maxScroll = Math.max(1, scrollWidth - clientWidth);
    const ratio = Math.min(1, Math.max(0.06, viewW / totalW));
    const w = ratio * 100;
    return { left: Math.max(0, Math.min(1, scrollLeft / maxScroll)) * (100 - w), width: w };
  };
  for (const args of [[0, 1400, 12000, 12000], [3000, 1400, 12000, 12600], [0, 1400, 900, 1400], [50000, 1400, 120000, 120000]]) {
    assert.deepEqual(thumbGeometry(...args), old(...args));
  }
});

test('no painel: o pendente entra antes do commit, o quadro não renderiza e o Safari vai até 500', () => {
  const src = fs.readFileSync(new URL('../src/components/TimelinePanel.tsx', import.meta.url), 'utf8');
  // corrida entre o temporizador e o quadro: o commit aplica o quadro pendente primeiro
  assert.match(src, /for \(let i = 0; pendingZoom && i < \(sync \? 8 : 1\); i\+\+\) applyPending\(sync\);/);
  // zoom, janela visível e scroll numa render só
  assert.match(src, /if \(sync\) flushSync\(run\);/);
  // zoom que não muda não deixa âncora guardada
  assert.match(src, /if \(next === current\) return false;\n(?:[^\n]*\n){0,3}\s*zoomAnchorRef\.current = /);
  // no layout effect do zoom novo, régua e indicadores voltam antes de gravar o scrollLeft
  const effect = src.slice(src.indexOf('if (!liveRef.current) settleLiveVisuals(false);'));
  assert.ok(effect.indexOf('settleLiveVisuals(false)') < effect.indexOf('el.scrollLeft = anchoredScroll('));
  // o quadro do zoom ao vivo: variáveis, canvas e scroll, sem render nem esticado
  const frame = src.slice(src.indexOf('const applyPending = (sync: boolean) => {'), src.indexOf('const commit = (sync: boolean) => {'));
  assert.match(frame, /writeZoomVars\(target\);/);
  assert.match(frame, /writeVisibleVars\(visibleWindow\(finalScroll, cw, VIEW_MARGIN_PX\)\);/);
  assert.match(frame, /canvasHub\.live = \{ zoom: target, scrollLeft: finalScroll, clientWidth: cw, timelineWidth: width \};/);
  assert.match(frame, /sc\.scrollLeft = finalScroll;/);
  assert.ok(frame.indexOf('for (const draw of canvasHub.draws) draw();') < frame.indexOf('sc.scrollLeft = finalScroll;'), 'estilo antes do scroll: um layout só');
  assert.doesNotMatch(frame, /setZoomH|flushSync|style\.transform|scaleX/);
  // setState só uma vez por gesto, ao começar a afastar
  assert.equal(frame.match(/setTimelineVisible\(/g).length, 1);
  assert.match(frame, /if \(\(target < base \|\| moved\) && !limited && !live\.widened\) \{/);
  // o mouse andou no meio do gesto: o ponto parado passa a ser o instante sob o mouse no zoom do quadro
  assert.match(frame, /const anchorTime = lp && !moved \? lp\.anchorTime : \(s \+ pending\.mouseX\) \/ \(lp \? lp\.target : base\);/);
  // o commit usa o instante além do fim do começo do gesto (o scroll já é o do quadro)
  assert.match(src, /applyZoom\(p\.target, p\.anchorTime, p\.anchorScreen, sync, p\.reach\)/);
  // rolagem e janela visível ficam paradas durante o gesto (nenhuma render por quadro)
  assert.match(src, /if \(!el \|\| liveRef\.current\) return;\n\s*setTimelineVisible\(visibleWindow\(/);
  assert.match(src, /paused=\{isLiveZoom\}/);
  // rolar ou clicar durante o esticado aplica o pendente antes
  assert.match(src, /el\.addEventListener\('pointerdown', onPointerDownCapture, true\);/);
  assert.match(src, /if \(!\(e\.ctrlKey \|\| e\.metaKey\)\) \{\n[^\n]*\n\s*if \(active\(\)\) commit\(true\);/);
  // pinça do Safari com os mesmos limites
  assert.match(src, /Math\.max\(1, Math\.min\(500, gestureStartZoom \* \(e\.scale \|\| 1\)\)\)/);
  // a largura rolável vem da variável (zoom ao vivo) e o conteúdo não é mais esticado
  assert.match(src, /style=\{\{ width: `var\(--vs-tl-w, \$\{timelineWidth\}px\)` \}\}/);
  assert.doesNotMatch(src, /scaleX\(|setPreviewTransform|zoomClipRef/);
});

test('nada é esticado: cursor, linhas, régua, regiões e falas seguem a variável do zoom', () => {
  const playhead = fs.readFileSync(new URL('../src/components/Playhead.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(playhead, /vs-unzoom/);
  const grid = fs.readFileSync(new URL('../src/components/TimelineGrid.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(grid, /vs-unzoom|hub\.preview/);
  assert.match(grid, /style=\{\{ left: zoomPx\(b\.time\) \}\}/, 'placa de BPM');
  assert.match(grid, /<StepLinesCanvas|export function StepLinesCanvas\(\{ zoomH, visible, timelineWidth, hub \}/);
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /vs-unzoom|data-vs-zooming/);
  for (const file of ['MedleyLane.tsx', 'RegionLane.tsx', 'NarrationLane.tsx']) {
    const src = fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /left: `\$\{[^`]*\* zoomH\}px`/, `${file}: posição em px do zoom de verdade`);
    assert.match(src, /left: zoomPx\(/, file);
  }
  const wave = fs.readFileSync(new URL('../src/components/ClipWaveform.tsx', import.meta.url), 'utf8');
  assert.match(wave, /waveScaleX\(zoomSec, zoomMinPx, base\.w\)/, 'só a onda estica, dentro do clipe');
  assert.match(wave, /zoomSec=\{clip\.duration\}\n\s*zoomMinPx=\{30\}/);
});

test('rolado além do fim da música (a grade aumenta a área rolável): o primeiro quadro não salta', () => {
  const contentEnd = 240;
  const base = 50;
  const W0 = timelineWidthFor(contentEnd, base);
  // 400 px além do fim normal (W0 - CW)
  const s = W0 - CW + 400;
  const reach = pastEndReach(contentEnd, base, s, CW);
  assert.ok(reach > contentEnd);
  for (const mouseX of [0, 700, 1400]) {
    for (const f of [1.0001, 1.02, 1.5, 0.98, 0.5]) {
      const { target } = previewTarget(base, base * f);
      const anchorTime = (s + mouseX) / base;
      const finalScroll = anchoredScroll(anchorTime, mouseX, target, reachWidthFor(contentEnd, target, reach), CW);
      // o instante sob o mouse fica parado (sem o reach, o corte puxava a tela 400 px para trás)
      const shown = anchorTime * target - finalScroll;
      if (f >= 1) assert.ok(Math.abs(shown - mouseX) <= 0.5, `f=${f} mouse=${mouseX}: ${shown}`);
      // afastando, no máximo prende na borda direita o instante que já estava nela (nunca passa dele)
      if (f < 1) assert.ok((finalScroll + CW) / target <= reach + 1e-9);
      assert.ok(finalScroll >= 0);
    }
  }
  // sem passar do fim, nada muda
  assert.equal(pastEndReach(contentEnd, base, W0 - CW, CW), 0);
  assert.equal(pastEndReach(contentEnd, base, 0, CW), 0);
  assert.equal(reachWidthFor(contentEnd, 80, 0), timelineWidthFor(contentEnd, 80));
});

test('mouse andando no meio do gesto: o ponto novo não mexe a tela e a janela cobre o resto', () => {
  // quadro em curso: zoom ao vivo z, scroll s; o mouse vai para x2 e o ponto parado é o instante sob ele
  for (const [contentEnd, base, z, s, x2] of [[300, 40, 90, 9000, 1200], [300, 40, 20, 1800, 100], [600, 10, 30, 4000, 700]]) {
    const W = timelineWidthFor(contentEnd, z);
    const t2 = (s + x2) / z;
    // no mesmo zoom o scroll fica onde estava (nada salta ao trocar o ponto)
    assert.equal(anchoredScroll(t2, x2, z, W, CW), s);
    // qualquer zoom até 1/3 do zoom de verdade com o ponto novo parado cabe na janela refeita em volta dele
    const win = zoomOutWindow(base, previewLow(base), t2, CW, 600);
    for (const zz of [previewLow(base), base, z, base * 4]) {
      const sl = anchoredScroll(t2, x2, zz, timelineWidthFor(contentEnd, zz), CW);
      assert.ok(sl / zz * base >= win.start && (sl + CW) / zz * base <= win.end, `zoom ${zz}`);
    }
  }
});
