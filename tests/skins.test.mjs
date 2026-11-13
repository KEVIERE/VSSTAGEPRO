// Skins (Visualizar > Skins): a Analógica é a padrão e fica exatamente como sempre foi; a
// Grafite (mesa digital de palco) e a Estúdio (DAW do Mac) trocam o desenho das peças.
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
const estudioAt = css.indexOf('/* ================= Skin Estúdio');
const analogCss = css.slice(0, grafiteAt);
const grafiteCss = css.slice(grafiteAt, estudioAt);
const oficinaAt = css.indexOf('/* ================= Skin Oficina');
const ambientAt = css.indexOf('/* ================= Ambientação completa das skins');
const estudioCss = css.slice(estudioAt, oficinaAt);
const oficinaCss = css.slice(oficinaAt, ambientAt);
const defaultAt = css.indexOf('/* ================= Skin padrão: VS Stage');
const ambientCss = css.slice(ambientAt, defaultAt);
const defaultCss = css.slice(defaultAt);

/** Cada regra da seção começa por um dos prefixos (presa à marca da skin ou peça só dela). */
function scopedOnly(section, prefixes) {
  const selectors = [...section.matchAll(/^\s*([^@/{}\n][^{}\n]*)\{/gm)].map((m) => m[1].trim());
  assert.ok(selectors.length > 30);
  for (const sel of selectors) {
    for (const part of sel.split(/,(?![^(]*\))/).map((x) => x.trim()).filter(Boolean)) {
      assert.ok(prefixes.some((p) => part.startsWith(p)), `regra solta: ${part}`);
    }
  }
}

function fakePage() {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.document = { documentElement: { dataset: {} } };
  return store;
}

test('quatro skins: Analógica (padrão), Grafite, Estúdio e Oficina', () => {
  assert.deepEqual(SKINS.map((s) => s.id), ['analogica', 'grafite', 'estudio', 'oficina']);
  assert.equal(DEFAULT_SKIN, 'analogica');
  assert.ok(isSkin('grafite') && isSkin('estudio') && !isSkin('azul') && !isSkin(null));
  assert.ok(SKINS.every((s) => !/logic|reaper/i.test(s.label + s.hint)), 'sem nome de marca');
  assert.ok(isSkin('oficina'));
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

test('Grafite e Estúdio só valem com a marca na página: nada delas vaza para a Analógica', () => {
  assert.ok(grafiteAt > 0 && estudioAt > grafiteAt);
  scopedOnly(grafiteCss, [":where([data-skin='grafite'])", ":root[data-skin='grafite']", '.gf-']);
  assert.ok(oficinaAt > estudioAt);
  scopedOnly(estudioCss, [":where([data-skin='estudio'])", ":root[data-skin='estudio']", '.es-']);
  scopedOnly(oficinaCss, [":where([data-skin='oficina'])", ":root[data-skin='oficina']", '.of-']);
  // a ambientação completa (paleta, números, rolagem, playlist...) também só vale com uma skin
  assert.ok(ambientAt > oficinaAt);
  scopedOnly(ambientCss, ['grafite', 'estudio', 'oficina'].flatMap((k) => [`:where([data-skin='${k}'])`, `:root[data-skin='${k}']`]));
  // a padrão (VS Stage) só vale sem skin escolhida
  assert.ok(defaultAt > ambientAt);
  scopedOnly(defaultCss, [':where(:root:not([data-skin]))', ':root:not([data-skin])', '.console-faderfill', '.segment-display.is-tft', '.an-edge-meter']);
  // as classes novas que a Analógica também carrega não têm desenho nela
  for (const cls of ['console-faderbed', 'console-bed', 'console-screws']) {
    assert.doesNotMatch(analogCss, new RegExp(`\\.${cls}\\b`), cls);
  }
});

test('Visualizar > Skins, e a skin escolhida entra antes de desenhar', () => {
  const menu = read('src', 'components', 'MenuBar.tsx');
  assert.match(menu, /\{ label: 'Skins', skins: true \},/, 'uma pasta Skins em Visualizar');
  assert.match(menu, /<SkinMenu current=\{skin\} onPick=\{\(id\) => \{ chooseSkin\(id\); setOpenMenu\(null\); \}\} \/>/, 'abre ao lado a janelinha de escolher');
  assert.match(menu, /\{SKINS\.map\(\(s\) => \{/);
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
  assert.match(read('src', 'components', 'SegmentDisplay.tsx'), /if \(skin\) \{/);
  assert.match(read('src', 'components', 'SamplePadPanel.tsx'), /<GfKnob value=\{pct \* 2 - 1\} bipolar=\{false\} color=\{color\}/);
});

test('Estúdio: peças próprias no mixer, timecode, timeline, clipes e pads', async () => {
  const mixer = read('src', 'components', 'MixerPanel.tsx');
  assert.match(mixer, /if \(estudio\) \{\s*\/\/ Estúdio: régua de risquinhos à esquerda/, 'fader com régua e capa translúcida');
  assert.match(mixer, /<i className="es-ruler-unity" style=\{\{ bottom: `\$\{markY\(0\)\}px` \}\} \/>/, 'traço branco no 0 dB');
  assert.match(mixer, /if \(skin === 'estudio'\) \{\s*\/\/ Estúdio \(DAW do Mac\)/);
  assert.match(mixer, /<EsDbBoxes volume=\{track\.volume\} meterId=\{track\.id\}/, 'caixinhas de dB');
  assert.match(mixer, /<EsName name=\{track\.name\} color=\{color\}/, 'nome embaixo na cor da faixa');
  for (const k of ['M', 'S', 'AC']) assert.match(mixer, new RegExp(`label="${k}"`));
  assert.match(mixer, /<EsName name="Master"/);
  assert.match(read('src', 'components', 'TimecodeMixerChannel.tsx'), /<EsName name="Timecode"/);
  assert.match(read('src', 'components', 'MiniFader.tsx'), /className="es-hslider-fill"/, 'volume da faixa com o verde');
  const tl = read('src', 'components', 'TimelinePanel.tsx');
  assert.match(tl, /color=\{filled && !isMuted \? shade\(routingColor, oficina \? 0\.7 : 0\.62\) : routingColor\}/, 'onda escura no clipe colorido');
  assert.match(tl, /color-mix\(in srgb, \$\{routingColor\} \$\{isSelected \? 82 : 66\}%, #2a2b2e\)/, 'Oficina: clipe na cor, em tom médio');
  assert.match(tl, /\(estudio \? esTrackColor : ofTrackColor\)\(clipTrack\.color, esChannelOrder\(useStore\.getState\(\)\.tracks, ROUTABLE_TRACKS, clipTrack\.id\)\)/, 'clipe na mesma cor do canal');
  assert.match(mixer, /const color = esTrackColor\(track\.color, index\);/);
  assert.match(mixer, /\{skin === 'estudio' && <EsRowLabels \/>\}/, 'nomes das linhas na lateral do mixer');
  assert.match(read('src', 'components', 'SamplePadPanel.tsx'), /<EsKnob value=\{pct \* 2 - 1\} bipolar=\{false\}/);
  assert.match(read('src', 'components', 'SegmentDisplay.tsx'), /if \(skin\) \{/);
  // cores: a da faixa fica viva; a onda é a mesma cor bem mais escura
  const pieces = read('src', 'components', 'EstudioPieces.tsx');
  assert.match(pieces, /const DEFAULT_TRACK_COLORS = new Set\(\['#5b8db8', '#5bb87a', '#8e9097'\]\);/, 'só a cor de fábrica vira degradê');
  assert.match(pieces, /if \(!DEFAULT_TRACK_COLORS\.has\(color\.trim\(\)\.toLowerCase\(\)\)\) return vivid\(color\);/, 'cor escolhida pelo usuário continua');
});

test('Estúdio: os números da escala do medidor não ficam um em cima do outro', async () => {
  const src = read('src', 'components', 'EstudioPieces.tsx');
  const marks = JSON.parse(src.match(/ES_METER_MARKS = (\[[^\]]+\])/)[1]);
  const pct = (db) => (db >= 0 ? 1 : db >= -24 ? 1 - (-db / 24) * 0.6 : Math.max(0, 0.4 * ((db + 60) / 36)));
  assert.match(src, /return db >= -24 \? 1 - \(-db \/ 24\) \* 0\.6 : 0\.4 \* \(\(db \+ 60\) \/ 36\);/);
  const meterPx = 128 - 32; // altura do medidor no mixer
  for (let i = 1; i < marks.length; i++) {
    const gap = (pct(marks[i - 1]) - pct(marks[i])) * meterPx;
    assert.ok(gap >= 9, `${marks[i - 1]} e ${marks[i]} a ${gap.toFixed(1)} px`);
  }
});

test('Oficina: canal tingido, botões quadrados, medidor com marcas e nome com número', () => {
  const mixer = read('src', 'components', 'MixerPanel.tsx');
  assert.match(mixer, /if \(oficina\) \{\s*\/\/ Oficina: só a fenda escura e a capa clara de frisos/);
  assert.match(mixer, /const color = ofTrackColor\(track\.color, index\);/);
  assert.match(mixer, /<OfName name=\{track\.name\} number=\{index \+ 1\} color=\{color\}/);
  assert.match(mixer, /<OfName name="MASTER" number="M"/);
  assert.match(read('src', 'components', 'TimecodeMixerChannel.tsx'), /<OfName name="Timecode" number="TC"/);
  const pieces = read('src', 'components', 'OficinaPieces.tsx');
  assert.match(pieces, /const hot = !off && db > -6;/, 'medidor avermelha acima de -6 dB');
  assert.match(pieces, /export const OF_METER_MARKS = \[-6, -18, -30, -42, -54\];/);
  const tl = read('src', 'components', 'TimelinePanel.tsx');
  assert.match(tl, /style=\{\{ height: `\$\{trackHeight\}px`, '--ch': rowColor \} as React\.CSSProperties\}/, 'faixa tingida na cor');
  assert.match(read('src', 'components', 'SamplePadPanel.tsx'), /<OfKnob value=\{pct \* 2 - 1\}/);
});

test('Oficina: nome da faixa com o ícone do instrumento, escrito normal', () => {
  const tl = read('src', 'components', 'TimelinePanel.tsx');
  assert.match(tl, /<OfTrackLabel name=\{track\.name\} color=\{rowColor\} compact=\{compact\} \/>/);
  assert.doesNotMatch(tl, /childClipCount/, 'sem o número de áudios no nome da faixa');
  const pieces = read('src', 'components', 'OficinaPieces.tsx');
  assert.match(pieces, /\[\/maestro\/i, Megaphone\]/);
  assert.match(pieces, /\[\/bateria\|drum\|perc/);
  assert.match(pieces, /return ICONS\.find\(\(\[re\]\) => re\.test\(name\)\)\?\.\[1\] \?\? AudioLines;/);
});

test('Oficina: pan fora do centro acende o arco verde', () => {
  const pieces = read('src', 'components', 'OficinaPieces.tsx');
  assert.match(pieces, /const off = Math\.abs\(v\) > 0\.01;/);
  assert.match(pieces, /\{off && \(\s*<path[\s\S]*?stroke="#3ddc84"/);
});

test('Analógica: o nome do canal num visor âmbar no lugar da fita crepe (mixer e timeline)', () => {
  assert.match(analogCss, /:root:not\(\[data-skin\]\) \.console-lcdname \{/, 'só na Analógica');
  const mixer = read('src', 'components', 'MixerPanel.tsx');
  assert.equal((mixer.match(/console-tape console-lcdname/g) ?? []).length, 2, 'canais e master');
  assert.match(read('src', 'components', 'TimelinePanel.tsx'), /console-tape console-lcdname/);
  assert.match(read('src', 'components', 'TimecodeMixerChannel.tsx'), /console-tape console-lcdname/);
});

test('Analógica: faixas da timeline com knob de volume depois do visor e medidor na borda direita', () => {
  const tl = read('src', 'components', 'TimelinePanel.tsx');
  assert.match(tl, /\{showFader && analogica && \(\s*\/\/ Analógica: knob de volume moderno logo depois do visor/);
  assert.match(tl, /\{showFader && !analogica && \(/, 'as outras skins seguem com o fader deitado');
  assert.match(tl, /<AnEdgeMeter\s+id=\{isRecording \? 'input-maestro' : track\.id\}/);
  const pieces = read('src', 'components', 'AnalogPieces.tsx');
  assert.match(pieces, /onDoubleClick=\{\(e\) => \{ e\.stopPropagation\(\); if \(!disabled\) onReset\(\); \}\}/, 'duplo clique volta ao 0 dB');
});

test('padrão (VS Stage): mesa digital, com medidor estéreo e rastro de luz no fader', () => {
  assert.equal(SKINS[0].label, 'VS Stage (padrão)');
  const mixer = read('src', 'components', 'MixerPanel.tsx');
  assert.match(mixer, /<LedMeter\s+stereo\s+id=\{track\.id\}/, 'medidor estéreo nos canais');
  assert.match(mixer, /<LedMeter\s+stereo\s+id="master"/, 'e no master');
  assert.match(mixer, /className="console-faderfill absolute/);
  const meter = read('src', 'components', 'MeterMask.tsx');
  assert.match(meter, /<MeterMask id=\{`\$\{id\}:\$\{side\}`\}/, 'cada lado lê o seu nível (ID:L e ID:R)');
  const engine = read('src', 'lib', 'audioEngine.ts');
  assert.match(engine, /if \(lr\) \{ levels\.set\(`\$\{t\.id\}:L`, lr\[0\]\); levels\.set\(`\$\{t\.id\}:R`, lr\[1\]\); \}/, 'o motor publica L e R');
  assert.match(engine, /ch\.analyser\.connect\(ch\.meterSplit\);/, 'o medidor estéreo continua ligado ao trocar a saída');
});

test('as faixas nascem cinza neutro; as cores de fábrica antigas aparecem cinza', async () => {
  const { NEUTRAL_TRACK_COLOR, shownTrackColor, isFactoryTrackColor } = await import('../src/lib/trackColors.ts');
  assert.equal(NEUTRAL_TRACK_COLOR, '#8e9097');
  assert.equal(shownTrackColor('#5b8db8'), NEUTRAL_TRACK_COLOR);
  assert.equal(shownTrackColor('#5BB87A'), NEUTRAL_TRACK_COLOR);
  assert.equal(shownTrackColor('#e06c75'), '#e06c75', 'a cor escolhida pelo usuário fica');
  assert.ok(isFactoryTrackColor(undefined));
  const store = read('src', 'store.ts');
  assert.doesNotMatch(store, /color: '#5b8db8'|color: '#5bb87a'|\?\? '#5b8db8'/, 'nenhuma faixa nasce azul ou verde');
  assert.ok((store.match(/color: NEUTRAL_TRACK_COLOR/g) ?? []).length >= 12, 'as faixas de fábrica nascem cinza');
});

