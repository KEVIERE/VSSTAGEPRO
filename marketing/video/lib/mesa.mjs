// As peças do visual atual do VS Stage (mesa analógica), desenhadas em SVG.
// Fonte da verdade: src/index.css (console-face, console-rail, console-strip, console-tape,
// console-well, console-cap, console-key, console-display) e SegmentDisplay.tsx.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C } from './core.mjs';

// Aço pintado, luz de cima, tinta a pó.
export const FACE = '#24282d';
export const RAIL = '#171a1d';
export const WELL = '#0b0c0e';
export const SLOT = '#050607';
export const KEY = '#30353b';
export const KEY_TEXT = '#9c988e';
export const LEGEND = '#8f8b81';
export const CREAM = '#e7e2d6';
export const LCD_BG = '#0c0e0d';

// Cores de display (do tailwind do projeto).
export const LCD = {
  green: '#3ee26e',
  amber: '#ffab1f',
  red: '#ff4136',
  text: '#e7e2d6',
  dim: '#a7a297',
  muted: '#8d897f',
};

/** Fundo de painel de aço com grão (equivale a .console-face). */
export function fundoAco(x, y, w, h, { cor = FACE, raio = 0 } = {}) {
  const id = 'ac' + Math.abs(Math.round(x + y + w + h));
  return `<defs>
    <pattern id="grao${id}" width="3" height="3" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="none"/>
      <rect width="3" height="1" fill="#fff" opacity="0.028"/>
      <rect x="1" width="1" height="1" fill="#000" opacity="0.05"/>
    </pattern>
    <linearGradient id="luz${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.035"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.14"/>
    </linearGradient>
  </defs>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="${cor}"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="url(#luz${id})"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="url(#grao${id})"/>`;
}

/** Trilho de cima do mixer (.console-rail). */
export function trilho(x, y, w, h) {
  return `<defs><linearGradient id="rl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.04"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.2"/>
    </linearGradient></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${RAIL}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#rl)"/>
    <rect x="${x}" y="${y + h - 1}" width="${w}" height="1" fill="#000" opacity="0.8"/>
    <rect x="${x}" y="${y}" width="${w}" height="1" fill="#fff" opacity="0.04"/>`;
}

/** Módulo de canal (.console-strip). Selecionado acende a faixa azul em cima. */
export function moduloCanal(x, y, w, h, { selecionado = false, corFaixa = '#0a84ff' } = {}) {
  const base = selecionado ? '#31363c' : 'transparent';
  return `${selecionado ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${base}"/>` : ''}
    ${selecionado ? `<rect x="${x}" y="${y}" width="${w}" height="2" fill="${corFaixa}"/>` : ''}
    <rect x="${x}" y="${y}" width="1" height="${h}" fill="#fff" opacity="0.05"/>
    <rect x="${x + w - 1}" y="${y}" width="1" height="${h}" fill="#000" opacity="0.55"/>`;
}

/** Fita crepe com o nome do canal (pontas rasgadas). */
export function fita(nome, x, y, w, h = 14) {
  const d = `M${x} ${y} L${x + w} ${y} L${x + w - 2} ${y + h * 0.22} L${x + w} ${y + h * 0.44} L${x + w - 1.5} ${y + h * 0.66} L${x + w} ${y + h * 0.84} L${x + w - 2} ${y + h} L${x} ${y + h} L${x + 2} ${y + h * 0.8} L${x} ${y + h * 0.58} L${x + 1.5} ${y + h * 0.38} L${x} ${y + h * 0.18} Z`;
  return `<defs><linearGradient id="tp" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2e9d0"/><stop offset="1" stop-color="#e4d9bb"/></linearGradient></defs>
    <path d="${d}" fill="url(#tp)"/>`;
}

/** Rebaixo escuro (.console-well). */
export function rebaixo(x, y, w, h, raio = 2) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="${WELL}"/>
    <rect x="${x}" y="${y}" width="${w}" height="1" fill="#000" opacity="0.9"/>
    <rect x="${x}" y="${y + h - 1}" width="${w}" height="1" fill="#fff" opacity="0.06"/>`;
}

/** Fenda do fader. */
export function fenda(x, y, h) {
  return `<rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${SLOT}"/>`;
}

/** Capa de fader por função. `tipo`: band | cue | master | tc. */
export const CAPAS = {
  band: { hi: '#555a62', lo: '#24272b', linha: '#f2eee4' },
  cue: { hi: '#f0eee8', lo: '#b6b2a9', linha: '#1b1b1b' },
  master: { hi: '#e5503f', lo: '#9a2218', linha: '#fff3ea' },
  tc: { hi: '#ffbb45', lo: '#c27709', linha: '#2a1a03' },
};

export function capa(x, y, w, h, tipo = 'band') {
  const c = CAPAS[tipo] || CAPAS.band;
  const id = 'cp' + Math.abs(Math.round(x + y));
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.hi}"/><stop offset="1" stop-color="${c.lo}"/></linearGradient></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="url(#${id})"/>
    <rect x="${x}" y="${y}" width="${w}" height="1" fill="#fff" opacity="0.28"/>
    <rect x="${x}" y="${y + Math.round(h / 2)}" width="${w}" height="1.4" fill="${c.linha}"/>`;
}

/** Tecla de mesa. `acesa`: null, 'amber', 'green', 'red', 'blue'. */
export function tecla(x, y, w, h, { acesa = null, raio = 3, grande = false } = {}) {
  const cores = {
    amber: { bg: '#ffab1f', borda: '#6b4300', brilho: 'rgba(255,171,31,0.55)' },
    green: { bg: '#3ee26e', borda: '#0f5a26', brilho: 'rgba(62,226,110,0.5)' },
    red: { bg: '#ff4136', borda: '#6e130d', brilho: 'rgba(255,65,54,0.6)' },
    blue: { bg: '#5aaaff', borda: '#0b3b70', brilho: 'rgba(90,170,255,0.5)' },
  };
  const c = acesa ? cores[acesa] : null;
  const r = grande ? 6 : raio;
  const sombra = grande
    ? `0 3px 5px rgba(0,0,0,0.6), 0 1px 0 rgba(0,0,0,0.9)`
    : `0 1px 1.5px rgba(0,0,0,0.7)`;
  return `<g filter="url(#sombraTecla)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c ? c.bg : KEY}" stroke="${c ? c.borda : '#08090b'}" stroke-width="1"/>
      <rect x="${x}" y="${y}" width="${w}" height="${Math.max(2, h * 0.45)}" rx="${r}" fill="#fff" opacity="${c ? 0.3 : 0.1}"/>
    </g>`;
  }

/** LED pequeno. `cor`: 'green', 'amber' ou null (apagado). */
export function ledPequeno(cx, cy, cor) {
  if (!cor) return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="#2a1a1a"/>`;
  const mapa = { green: '#3ee26e', amber: '#ffab1f', red: '#ff4136' };
  return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${mapa[cor]}"/>`;
}

/** Lâmpada grande "no ar". */
export function lampada(cx, cy, aceso) {
  return aceso
    ? `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#ff4136"/>`
    : `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#3a1a17"/>`;
}

/** Máscara de definições usadas várias vezes (sombra de tecla e brilho de display). */
export const DEFS_MESA = `<defs>
  <filter id="sombraTecla" x="-20%" y="-40%" width="140%" height="200%">
    <feDropShadow dx="0" dy="1" stdDeviation="0.8" flood-color="#000" flood-opacity="0.55"/>
  </filter>
  <filter id="brilhoDisplay" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="2.4"/>
  </filter>
</defs>`;

// ------------------------------------------------------------ display de 7 segmentos

// Geometria copiada de SegmentDisplay.tsx (12 x 20 unidades por dígito, inclinação -6°).
const THICK = 2.2;
const L = 1.4;
const R = 10.6;
const TOP = 1.4;
const MID = 10;
const BOT = 18.6;
const GAP = 0.55;
const DIGIT_W = 12;
const COLON_W = 4.5;
const ESPACO = 1.6;
const SKEW = -6;
const PAD = 20 * Math.tan((Math.abs(SKEW) * Math.PI) / 180);

const SEGS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
  6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '',
};
const h2 = THICK / 2;
const horiz = (y, x0, x1) => `${x0},${y} ${x0 + h2},${y - h2} ${x1 - h2},${y - h2} ${x1},${y} ${x1 - h2},${y + h2} ${x0 + h2},${y + h2}`;
const vert = (x, y0, y1) => `${x},${y0} ${x + h2},${y0 + h2} ${x + h2},${y1 - h2} ${x},${y1} ${x - h2},${y1 - h2} ${x - h2},${y0 + h2}`;
const PTS = {
  a: horiz(TOP, L + GAP, R - GAP),
  g: horiz(MID, L + GAP, R - GAP),
  d: horiz(BOT, L + GAP, R - GAP),
  f: vert(L, TOP + GAP, MID - GAP),
  b: vert(R, TOP + GAP, MID - GAP),
  e: vert(L, MID + GAP, BOT - GAP),
  c: vert(R, MID + GAP, BOT - GAP),
};

/**
 * Um display de 7 segmentos desenhado como no programa: segmentos apagados bem fracos atrás
 * dos acesos, inclinação leve e brilho. `altura` em unidades de tela (o viewBox tem 21 de altura).
 */
export function display7(texto, x, y, altura, cor = LCD.green) {
  let cx = 0;
  const celulas = [];
  for (const ch of String(texto)) {
    if (ch === ':') {
      celulas.push({ colon: true, x: cx });
      cx += COLON_W;
    } else {
      celulas.push({ ch, x: cx });
      cx += DIGIT_W;
    }
    cx += ESPACO;
  }
  const largura = Math.max(1, cx - ESPACO) + PAD + 1;
  const escala = altura / 21;

  const apagados = celulas
    .filter((c) => !c.colon)
    .map((c) => `<g transform="translate(${c.x} 0)">${[...'abcdefg'].map((s) => `<polygon points="${PTS[s]}"/>`).join('')}</g>`)
    .join('');

  const acesos = celulas
    .map((c) =>
      c.colon
        ? `<g transform="translate(${c.x} 0)"><rect x="${COLON_W / 2 - 1.1}" y="5.6" width="2.2" height="2.2"/><rect x="${COLON_W / 2 - 1.1}" y="12.6" width="2.2" height="2.2"/></g>`
        : `<g transform="translate(${c.x} 0)">${[...(SEGS[c.ch] ?? '')].map((s) => `<polygon points="${PTS[s]}"/>`).join('')}</g>`,
    )
    .join('');

  return `<g transform="translate(${x - PAD * escala} ${y}) scale(${escala})">
    <g transform="skewX(${SKEW})">
      <g fill="${cor}" opacity="0.075">${apagados}</g>
      <g fill="${cor}" filter="url(#brilhoDisplay)">${acesos}</g>
      <g fill="${cor}">${acesos}</g>
    </g>
  </g>`;
}

// ------------------------------------------------------------ partes da tela

/** Rótulo impresso no painel (.console-legend). */
export function rotulo(txt, x, y, { tam = 11, cor = LEGEND, ancora = 'start', espaco = 0.6 } = {}) {
  return `<text x="${x}" y="${y}" font-family="Barlow Semi Condensed" font-weight="600" font-size="${tam}" fill="${cor}" letter-spacing="${espaco}" text-anchor="${ancora}">${txt}</text>`;
}

/** Visor de vidro embutido (.console-display): fundo escuro, linhas finas, brilho no alto. */
export function vidro(x, y, w, h, { raio = 3, cor = LCD_BG } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${raio}" fill="${cor}" stroke="#000" stroke-width="1"/>
    <rect x="${x}" y="${y}" width="${w}" height="${Math.round(h * 0.38)}" rx="${raio}" fill="#fff" opacity="0.055"/>
    <rect x="${x}" y="${y + h - 1}" width="${w}" height="1" fill="#fff" opacity="0.07"/>`;
}

/** Moldura de metal em volta do vidro (.console-bezel). */
export function aro(x, y, w, h, p = 5) {
  return `<defs><linearGradient id="aro" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3f46"/><stop offset="1" stop-color="#1a1d21"/></linearGradient></defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#aro)"/>
    <rect x="${x}" y="${y}" width="${w}" height="1" fill="#fff" opacity="0.12"/>`;
}
