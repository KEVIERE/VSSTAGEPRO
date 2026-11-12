// Tela do palco: troca de trecho como karaokê. O atual sobe e some em cima, a prévia de baixo vira
// o trecho do centro (o mesmo elemento, só muda de lugar) e nada fica encavalado no meio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HALF_AREA, karaokeSlots, textHeight } from '../src/lib/karaoke.ts';

const page = (id, text) => ({ id, time: 0, text, kind: 'verso' });
const PAGES = [
  page('a', 'Primeira linha\nSegunda linha'),
  page('b', 'Um trecho com três linhas\nque ocupa mais espaço\nna tela do palco'),
  page('c', 'Curto'),
  page('d', 'Quatro\nlinhas\nbem\ncurtas'),
];

test('no meio da música: o anterior acima (saindo), o atual no centro e o próximo embaixo', () => {
  const s = karaokeSlots(PAGES, 1, 1);
  assert.deepEqual(s.map((x) => [x.page.id, x.slot]), [['a', 'gone'], ['b', 'center'], ['c', 'below']]);
  const [gone, center, below] = s;
  assert.ok(center.offset <= 0, 'com prévia, o atual fica no centro ou um pouco acima');
  assert.equal(center.scale, 1);
  assert.equal(center.opacity, 1);
  assert.ok(gone.offset < 0, 'o que sai vai para cima');
  assert.equal(gone.opacity, 0, 'e some');
  assert.ok(gone.scale < 1, 'diminuindo');
  assert.ok(below.offset > 0, 'a prévia fica embaixo');
  assert.ok(below.scale < 1 && below.opacity < 1, 'pequena e apagada');
});

test('a prévia nunca encosta no trecho do centro, e os dois cabem na área da letra', () => {
  for (let i = 0; i < PAGES.length - 1; i++) {
    for (const fontScale of [0.8, 1, 1.2]) {
      const s = karaokeSlots(PAGES, i, fontScale);
      const center = s.find((x) => x.slot === 'center');
      const below = s.find((x) => x.slot === 'below');
      const hc = textHeight(center.page.text, fontScale);
      const hb = textHeight(below.page.text, fontScale) * below.scale;
      assert.ok(below.offset - hb / 2 > center.offset + hc / 2, `trecho ${i}, letra ${fontScale}: prévia encostou`);
      assert.ok(center.offset - hc / 2 >= -HALF_AREA - 1e-9, `trecho ${i}, letra ${fontScale}: topo do atual saiu da tela`);
      if (hc + 5 + hb <= HALF_AREA * 2) {
        assert.ok(below.offset + hb / 2 <= HALF_AREA + 1e-9, `trecho ${i}, letra ${fontScale}: prévia cortada embaixo`);
      }
    }
  }
});

test('trecho enorme: o atual fica inteiro na tela (a prévia pode ficar cortada)', () => {
  const big = page('g', Array.from({ length: 8 }, (_, i) => `Linha número ${i + 1} desta página`).join('\n'));
  const s = karaokeSlots([big, page('h', 'Próxima\ncom duas')], 0, 1.5);
  const center = s.find((x) => x.slot === 'center');
  assert.ok(center.offset - textHeight(big.text, 1.5) / 2 >= -HALF_AREA - 1e-9);
});

test('último trecho (sem prévia): fica no centro', () => {
  const s = karaokeSlots(PAGES, PAGES.length - 1, 1);
  assert.equal(s.find((x) => x.slot === 'center').offset, 0);
});

test('o que sai fica todo acima do trecho do centro (não cruza com o que chega)', () => {
  for (let i = 1; i < PAGES.length; i++) {
    const s = karaokeSlots(PAGES, i, 1);
    const center = s.find((x) => x.slot === 'center');
    const gone = s.find((x) => x.slot === 'gone');
    const bottomOfGone = gone.offset + (textHeight(gone.page.text, 1) * gone.scale) / 2;
    const topOfCenter = -textHeight(center.page.text, 1) / 2;
    assert.ok(bottomOfGone < topOfCenter, `trecho ${i}`);
  }
});

test('troca de trecho: a prévia é o mesmo trecho que vai para o centro (rolagem contínua)', () => {
  const before = karaokeSlots(PAGES, 1, 1);
  const after = karaokeSlots(PAGES, 2, 1);
  assert.equal(before.find((x) => x.slot === 'below').page.id, after.find((x) => x.slot === 'center').page.id);
  assert.equal(before.find((x) => x.slot === 'center').page.id, after.find((x) => x.slot === 'gone').page.id);
});

test('primeiro e último trecho: sem anterior, sem próximo', () => {
  assert.deepEqual(karaokeSlots(PAGES, 0, 1).map((x) => x.slot), ['center', 'below']);
  assert.deepEqual(karaokeSlots(PAGES, 3, 1).map((x) => x.slot), ['gone', 'center']);
  assert.deepEqual(karaokeSlots([page('x', 'Só')], 0, 1).map((x) => x.slot), ['center']);
});

// Cor e tamanho de uma página só: o resto segue o estilo geral.
import { normalizePages, pageColor, pageScale } from '../src/lib/prompterTypes.ts';

test('página sem ajuste usa a cor e o tamanho gerais; com ajuste, os dela', () => {
  const geral = '#ffffff';
  assert.equal(pageColor(page('a', 'x'), geral), geral);
  assert.equal(pageColor({ ...page('a', 'x'), color: '#ffd60a' }, geral), '#ffd60a');
  assert.equal(pageScale(page('a', 'x'), 1.2), 1.2);
  assert.ok(Math.abs(pageScale({ ...page('a', 'x'), size: 1.5 }, 1.2) - 1.8) < 1e-9);
});

test('a página seguinte não herda a cor nem o tamanho da anterior', () => {
  const pages = normalizePages([
    { id: 'a', time: 1, text: 'Um', kind: 'verso', color: '#ff6482', size: 1.4 },
    { id: 'b', time: 5, text: 'Dois', kind: 'verso' },
  ]);
  assert.equal(pages[0].color, '#ff6482');
  assert.equal(pages[0].size, 1.4);
  assert.equal(pages[1].color, undefined);
  assert.equal(pages[1].size, undefined);
  assert.equal(pageColor(pages[1], '#ffffff'), '#ffffff');
});

test('cor ou tamanho inválidos são ignorados (fica o geral)', () => {
  const [p] = normalizePages([{ id: 'a', time: 1, text: 'x', kind: 'verso', color: 'vermelho', size: 9 }]);
  assert.equal(p.color, undefined);
  assert.equal(p.size, undefined);
});

test('página com letra maior ocupa mais espaço e a prévia continua sem encostar', () => {
  const pages = [{ ...page('a', 'Linha um\nLinha dois'), size: 1.5 }, page('b', 'Próxima\npágina')];
  const s = karaokeSlots(pages, 0, 1);
  const center = s.find((x) => x.slot === 'center');
  const below = s.find((x) => x.slot === 'below');
  const hc = textHeight(pages[0].text, 1.5);
  const hb = textHeight(pages[1].text, 1) * below.scale;
  assert.ok(below.offset - hb / 2 > center.offset + hc / 2);
});
