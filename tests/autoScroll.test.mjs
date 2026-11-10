// "Rolar sozinho" do Modo show da Área do Músico: a cifra anda com a música, na velocidade
// escolhida, e continua de onde o músico deixou quando ele rola com o dedo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCROLL_SPEED, READ_LEAD, SCROLL_SPEEDS, directorJumped, easeToward, offsetFor, parseScrollSpeed, respeedOffset,
  scrollSpeedLabel, scrollTarget, stepScrollSpeed, zoomedOffset, zoomedPosition,
} from '../src/lib/autoScroll.ts';

// cifra de 3000 px numa tela de 600 px: dá para rolar 2400 px
const C = 3000;
const V = 600;
const MAX = C - V;

test('no começo da música a cifra fica no topo', () => {
  assert.equal(scrollTarget(0, C, V, 1), 0);
  assert.equal(scrollTarget(0.05, C, V, 1), 0); // 150 px de música, menos o terço da tela
});

test('em 1x a cifra anda junto com a música e chega ao fim antes de a música acabar', () => {
  const meio = scrollTarget(0.5, C, V, 1);
  assert.equal(meio, 0.5 * C - V * READ_LEAD); // linha tocando a um terço da tela
  assert.ok(scrollTarget(0.3, C, V, 1) < meio && meio < scrollTarget(0.7, C, V, 1));
  assert.equal(scrollTarget(1, C, V, 1), MAX);
  // a linha "tocando" (progresso × altura) fica sempre dentro da tela
  for (let p = 0; p <= 1; p += 0.05) {
    const top = scrollTarget(p, C, V, 1);
    const linha = p * C;
    assert.ok(linha >= top && linha <= top + V, `p=${p.toFixed(2)}`);
  }
});

test('mais rápido chega antes; mais devagar fica para trás', () => {
  assert.ok(scrollTarget(0.4, C, V, 2) > scrollTarget(0.4, C, V, 1));
  assert.ok(scrollTarget(0.4, C, V, 0.5) < scrollTarget(0.4, C, V, 1));
  assert.equal(scrollTarget(0.5, C, V, 2), MAX);
});

test('cifra que cabe na tela não rola; progresso estranho não quebra', () => {
  assert.equal(scrollTarget(0.8, 500, 600, 1), 0);
  assert.equal(scrollTarget(Number.NaN, C, V, 1), 0);
  assert.equal(scrollTarget(5, C, V, 1), MAX);
  assert.equal(scrollTarget(-1, C, V, 1), 0);
});

test('o músico rola com o dedo: a rolagem continua dali, sem voltar', () => {
  const p = 0.4;
  const off = offsetFor(1500, p, C, V, 1);
  assert.equal(scrollTarget(p, C, V, 1, off), 1500);
  // e segue andando no mesmo ritmo a partir dali
  assert.equal(scrollTarget(0.45, C, V, 1, off) - 1500, 0.05 * C);
});

test('trocar a velocidade no meio não faz a cifra pular', () => {
  const p = 0.4;
  const antes = scrollTarget(p, C, V, 1, 0);
  const off = respeedOffset(0, p, C, 1, 1.5);
  assert.equal(scrollTarget(p, C, V, 1.5, off), antes);
  // depois anda 1,5 vez mais rápido
  assert.ok(Math.abs((scrollTarget(0.5, C, V, 1.5, off) - antes) - 0.1 * C * 1.5) < 1e-9);
});

test('o movimento é suave e chega ao alvo', () => {
  let cur = 0;
  for (let i = 0; i < 200; i++) cur = easeToward(cur, 300, 16);
  assert.equal(cur, 300);
  const um = easeToward(0, 300, 16);
  assert.ok(um > 0 && um < 30, 'um quadro anda pouco');
  assert.equal(easeToward(10, 300, 0), 10);
});

test('velocidades: guardada no aparelho, − e + andam pela lista e param nas pontas', () => {
  assert.equal(parseScrollSpeed('1.5'), 1.5);
  assert.equal(parseScrollSpeed(null), DEFAULT_SCROLL_SPEED);
  assert.equal(parseScrollSpeed('7'), DEFAULT_SCROLL_SPEED);
  assert.equal(parseScrollSpeed('abc'), DEFAULT_SCROLL_SPEED);
  assert.equal(stepScrollSpeed(1, 1), 1.25);
  assert.equal(stepScrollSpeed(1, -1), 0.75);
  assert.equal(stepScrollSpeed(SCROLL_SPEEDS[0], -1), SCROLL_SPEEDS[0]);
  assert.equal(stepScrollSpeed(SCROLL_SPEEDS.at(-1), 1), SCROLL_SPEEDS.at(-1));
  assert.equal(stepScrollSpeed(1.1, 1), 1.25); // valor fora da lista volta para o 1x e anda
  assert.equal(scrollSpeedLabel(1.25), '1,25x');
  assert.equal(scrollSpeedLabel(1), '1x');
});

test('o diretor pula para outro ponto da música: a rolagem volta a seguir a música', () => {
  assert.equal(directorJumped(null, 0.5), false); // primeira leitura
  assert.equal(directorJumped(0.40, 0.403), false); // relógio andando normal
  assert.equal(directorJumped(0.98, 0.01), true); // música recomeçou (repetição)
  assert.equal(directorJumped(0.2, 0.6), true); // avançou
});

// Letra maior ou menor: a mesma cifra fica mais alta ou mais baixa (zoom).
const LEAD = V * READ_LEAD;
/** Ponto da cifra (0 a 1) que está na linha de leitura com a rolagem em `pos`. */
const pontoLido = (pos, content) => (pos + LEAD) / content;

test('aumentar a letra deixa na linha de leitura o mesmo trecho da cifra (sem pular)', () => {
  const pos = 1200;
  for (const novo of [C * 1.5, C * 0.6, C * 2.5]) {
    const p2 = zoomedPosition(pos, C, novo, V);
    assert.ok(Math.abs(pontoLido(p2, novo) - pontoLido(pos, C)) < 1e-9, `altura ${novo}`);
  }
});

test('zoom no começo da cifra continua no topo; no fim não passa do limite', () => {
  assert.equal(zoomedPosition(0, C, C * 1.5, V), 0);
  assert.equal(zoomedPosition(MAX, C, C * 0.5, V), C * 0.5 - V);
  // cifra que passa a caber na tela não rola
  assert.equal(zoomedPosition(900, C, 500, V), 0);
  // altura estranha não quebra
  assert.equal(zoomedPosition(300, 0, C, V), 300);
});

test('rolando sozinho: depois do zoom continua do mesmo ponto e no mesmo andamento', () => {
  for (const speed of [0.5, 1, 1.75, 3]) {
    // no meio da cifra em qualquer velocidade (no fim ela já está parada no limite)
    const p = 0.4 / speed;
    // o músico rolou com o dedo antes: há um ajuste
    const off = offsetFor(scrollTarget(p, C, V, speed) + 200, p, C, V, speed);
    const antes = scrollTarget(p, C, V, speed, off);
    const novo = C * 1.4;
    const off2 = zoomedOffset(off, C, novo);
    const depois = scrollTarget(p, novo, V, speed, off2);
    // sem pulo: a posição nova é a que segura o ponto de leitura
    assert.ok(Math.abs(depois - zoomedPosition(antes, C, novo, V)) < 1e-6, `${speed}x sem pulo`);
    // mesmo andamento: em fração da cifra, anda o mesmo tanto no mesmo trecho da música
    const andouAntes = (scrollTarget(p + 0.02, C, V, speed, off) - antes) / C;
    const andouDepois = (scrollTarget(p + 0.02, novo, V, speed, off2) - depois) / novo;
    assert.ok(andouAntes > 0, `${speed}x está andando`);
    assert.ok(Math.abs(andouAntes - andouDepois) < 1e-9, `${speed}x mesmo andamento`);
  }
});
