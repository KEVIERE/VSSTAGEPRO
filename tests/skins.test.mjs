// Skins (Visualizar > Skins): a Analógica é a padrão e fica exatamente como sempre foi; a
// Grafite troca o desenho das peças (aço, visor azul, knob, teclas claras, fader cromado).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SKIN, SKINS, applySkin, chooseSkin, currentSkin, isSkin, savedSkin, subscribeSkin } from '../src/lib/skins.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const css = read('src', 'index.css');
const grafiteAt = css.indexOf('/* ================= Skin Grafite');
const analogCss = css.slice(0, grafiteAt);
const grafiteCss = css.slice(grafiteAt);

function fakePage() {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.document = { documentElement: { dataset: {} } };
  return store;
}

test('duas skins: Analógica (padrão) e Grafite', () => {
  assert.deepEqual(SKINS.map((s) => s.id), ['analogica', 'grafite']);
  assert.equal(DEFAULT_SKIN, 'analogica');
  assert.ok(isSkin('grafite') && !isSkin('azul') && !isSkin(null));
});

test('a escolha fica guardada; sem escolha (ou com lixo guardado) abre na Analógica', () => {
  const store = fakePage();
  assert.equal(savedSkin(), 'analogica');
  store.set('vsstage.skin', 'qualquer');
  assert.equal(savedSkin(), 'analogica');
  chooseSkin('grafite');
  assert.equal(store.get('vsstage.skin'), 'grafite');
  assert.equal(savedSkin(), 'grafite');
});

test('vestir a Grafite marca a página; a Analógica tira a marca (fica igual a antes das skins)', () => {
  fakePage();
  let calls = 0;
  const off = subscribeSkin(() => { calls += 1; });
  applySkin('grafite');
  assert.equal(document.documentElement.dataset.skin, 'grafite');
  assert.equal(currentSkin(), 'grafite');
  applySkin('analogica');
  assert.equal('skin' in document.documentElement.dataset, false);
  assert.equal(currentSkin(), 'analogica');
  off();
  applySkin('grafite');
  assert.equal(calls, 2, 'avisa a tela a cada troca, até desligar o aviso');
  applySkin('analogica');
});

test('as cores da Analógica são as mesmas de antes (hex antigos do tailwind.config.js)', () => {
  const old = {
    'bg': '#1b1e22', 'bg-deep': '#111316', 'bg-panel': '#24282d', 'bg-panel-light': '#2d3238', 'bg-elevated': '#383d44',
    'border': '#3b4148', 'border-light': '#4b525a', 'border-dark': '#0b0d0f',
    'text': '#e7e2d6', 'text-dim': '#a7a297', 'text-muted': '#6f6c66',
    'accent': '#0a84ff', 'accent-hover': '#3d9bff', 'accent-dim': '#0066cc',
    'lcd-bg': '#0c0e0d', 'lcd-text': '#d8d3c6', 'lcd-amber': '#ffab1f', 'lcd-green': '#3ee26e', 'lcd-red': '#ff4136', 'lcd-yellow': '#ffd83d',
  };
  const rootBlock = analogCss.match(/:root \{([\s\S]*?)\}/)[1];
  for (const [name, hex] of Object.entries(old)) {
    const m = rootBlock.match(new RegExp(`--lg-${name}: (\\d+) (\\d+) (\\d+);`));
    assert.ok(m, `falta --lg-${name}`);
    const got = '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    assert.equal(got, hex, name);
  }
  const tw = read('tailwind.config.js');
  assert.match(tw, /bg: 'rgb\(var\(--lg-bg\) \/ <alpha-value>\)'/);
  assert.match(tw, /amber: 'rgb\(var\(--lg-lcd-amber\) \/ <alpha-value>\)'/);
});

test('a Grafite só vale com a marca na página: nada dela vaza para a Analógica', () => {
  // toda regra da seção da Grafite é presa à marca ou é peça que só existe nela (gf-*)
  const selectors = [...grafiteCss.matchAll(/^\s*([^@/{}\n][^{}\n]*)\{/gm)].map((m) => m[1].trim());
  assert.ok(selectors.length > 40);
  for (const sel of selectors) {
    for (const part of sel.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean)) {
      assert.ok(
        part.startsWith(":where([data-skin='grafite'])") || part.startsWith(":root[data-skin='grafite']") || part.startsWith('.gf-') || part.startsWith('.segment-display.is-tft'),
        `regra solta na Grafite: ${part}`,
      );
    }
  }
  // as classes novas que a Analógica também carrega não têm desenho nela
  for (const cls of ['console-faderbed', 'console-bed', 'console-screws']) {
    assert.doesNotMatch(analogCss, new RegExp(`\\.${cls}\\b`), cls);
  }
});

test('Visualizar > Skins, e a skin escolhida entra antes de desenhar', () => {
  const menu = read('src', 'components', 'MenuBar.tsx');
  assert.match(menu, /\.\.\.SKINS\.map\(\(s\): MenuItem => \(\{\s*label: `Skin: \$\{s\.label\}`,\s*checked: skin === s\.id,\s*action: \(\) => \{ chooseSkin\(s\.id\); setOpenMenu\(null\); \},/);
  const main = read('src', 'main.tsx');
  assert.ok(main.indexOf('applySkin(savedSkin());') < main.indexOf('createRoot('));
});

test('Grafite tem peças próprias no mixer, no timecode, nos visores e nos pads', () => {
  const mixer = read('src', 'components', 'MixerPanel.tsx');
  assert.match(mixer, /if \(grafite\) \{\s*\/\/ Grafite: escala fina à esquerda, fenda escura e a capa preta fosca com a linha acesa/);
  assert.match(mixer, /<GfScreen\s+number=\{index \+ 1\}/, 'tela do canal com o número e a cor');
  assert.match(mixer, /<GfKnob value=\{track\.pan\} color=\{track\.color\}/, 'encoder com anel na cor do canal');
  assert.match(mixer, /<GfFaderMeter\s+id=\{track\.id\}/, 'medidor fino ao lado do fader');
  for (const k of ['SOLO', 'MUTE', 'CLIP']) assert.match(mixer, new RegExp(`label="${k}"`));
  assert.match(mixer, /name="MASTER"/);
  assert.match(read('src', 'components', 'TimecodeMixerChannel.tsx'), /<GfCap\s+tone="tc"/);
  assert.match(read('src', 'components', 'SegmentDisplay.tsx'), /if \(skin === 'grafite'\) \{/);
  assert.match(read('src', 'components', 'SamplePadPanel.tsx'), /<GfKnob value=\{pct \* 2 - 1\} bipolar=\{false\} color=\{color\}/);
});
