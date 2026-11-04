// Gera o fundo da janela do instalador (1x e @2x) com a versão do package.json.
// Visual do site e do programa: palco escuro com feixes de luz, trilho de mesa em cima e embaixo,
// a contagem 1-2-3-4 em LEDs levando ao play (como a abertura do site) e o aviso num visor âmbar.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const layout = JSON.parse(readFileSync(`${root}build/dmg-layout.json`, 'utf8'));
const [W, H] = layout.window;
const [ax, ay] = layout.app;
const [bx] = layout.applications;
const labelY = ay + layout.iconSize / 2 + 16;
const STAGE = 'Barlow Semi Condensed';

// mesmas cores do site (src/components/sales/sales.css)
const CREAM = '#e7e2d6';
const CREAM_DIM = '#a7a297';
const MUTED = '#77736b';
const LEGEND = '#8f8b81';
const AMBER = '#ffab1f';
const GREEN = '#3ee26e';

const RAIL = 30;
const FOOT_Y = H - RAIL;

// Logo real do app: embute o próprio build/icon.png, para o fundo nunca ficar diferente do ícone.
const iconBase64 = readFileSync(`${root}build/icon.png`).toString('base64');
const LOGO = 76;
const LOGO_CY = RAIL + 62;

// Feixe de luz que desce do teto, como no começo do site
const beam = (x, deg, grad) => `
  <g transform="translate(${x} -24) rotate(${deg})" filter="url(#beamBlur)">
    <polygon points="-14,0 14,0 140,${H + 60} -140,${H + 60}" fill="url(#${grad})"/>
  </g>`;

// Mancha de luz no chão, embaixo de cada ícone
const pool = (x) => `<ellipse cx="${x}" cy="${ay + 60}" rx="118" ry="20" fill="url(#pool)"/>`;

// O Finder pinta o nome dos ícones de preto (modo claro) ou branco (modo escuro): a plaquinha de
// aço em tom médio deixa os dois legíveis.
const plate = (x) => `
  <rect x="${x - 62}" y="${labelY - 11.5}" width="124" height="23" rx="5" fill="url(#plate)" stroke="#0b0d0f" stroke-width="1"/>
  <rect x="${x - 61}" y="${labelY - 10.5}" width="122" height="1" rx="0.5" fill="#ffffff" opacity="0.28"/>`;

// Contagem 1-2-3-4 até o play: os três primeiros LEDs em âmbar, o quarto verde
const from = ax + 92;
const to = bx - 118;
const leds = [1, 2, 3, 4].map((n, i) => {
  const x = from + ((to - from) * i) / 3;
  const color = n === 4 ? GREEN : AMBER;
  const glow = n === 4 ? 'ledGlowGreen' : 'ledGlowAmber';
  return `
    <circle cx="${x}" cy="${ay}" r="15" fill="url(#${glow})" opacity="${0.55 + i * 0.15}"/>
    <circle cx="${x}" cy="${ay}" r="7" fill="#0b0c0e" stroke="#2d3238" stroke-width="1"/>
    <circle cx="${x}" cy="${ay}" r="5.4" fill="${color}" opacity="${0.7 + i * 0.1}"/>
    <circle cx="${x - 1.6}" cy="${ay - 1.7}" r="1.6" fill="#ffffff" opacity="0.55"/>
    <text x="${x}" y="${ay + 27}" text-anchor="middle" font-family="${STAGE}" font-size="10" font-weight="600" fill="${MUTED}">${n}</text>`;
}).join('');
const playX = to + 26;
const play = `<path d="M ${playX - 8} ${ay - 12} L ${playX + 11} ${ay} L ${playX - 8} ${ay + 12} Z" fill="${GREEN}" stroke="${GREEN}" stroke-width="3" stroke-linejoin="round" filter="url(#glowGreen)"/>`;

// Texto espaçado centralizado: o espaçamento do fim é descontado para não puxar para a esquerda
const spaced = (y, text, size, weight, fill, spacing, extra = '') =>
  `<text x="${W / 2 + spacing / 2}" y="${y}" text-anchor="middle" font-family="${STAGE}" font-size="${size}" font-weight="${weight}" fill="${fill}" letter-spacing="${spacing}" ${extra}>${text}</text>`;

const LCD_W = 444;
const LCD_H = 32;
const LCD_X = (W - LCD_W) / 2;
const LCD_Y = labelY + 30;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="stage" cx="0.5" cy="0" r="1" gradientTransform="translate(0.5 0) scale(1.2 0.75) translate(-0.5 0)">
      <stop offset="0" stop-color="#1a1c20"/><stop offset="0.55" stop-color="#060607"/><stop offset="1" stop-color="#000"/>
    </radialGradient>
    <radialGradient id="floorGlow" cx="0.5" cy="1" r="0.6"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.08"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>
    <linearGradient id="beamCream" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6ecd2" stop-opacity="0.16"/><stop offset="0.55" stop-color="#f6ecd2" stop-opacity="0.035"/><stop offset="0.85" stop-color="#f6ecd2" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="beamAmber" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${AMBER}" stop-opacity="0.15"/><stop offset="0.55" stop-color="${AMBER}" stop-opacity="0.03"/><stop offset="0.85" stop-color="${AMBER}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f6ecd2" stop-opacity="0.09"/><stop offset="1" stop-color="#f6ecd2" stop-opacity="0"/></radialGradient>
    <radialGradient id="ledGlowAmber" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.5"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>
    <radialGradient id="ledGlowGreen" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${GREEN}" stop-opacity="0.55"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/></radialGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2024"/><stop offset="1" stop-color="#131518"/></linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e939b"/><stop offset="1" stop-color="#6e737b"/></linearGradient>
    <linearGradient id="lcdShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.75"/><stop offset="0.3" stop-color="#000" stop-opacity="0"/></linearGradient>
    <pattern id="scan" width="4" height="3" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#ffffff" opacity="0.025"/></pattern>
    <filter id="beamBlur" x="-50%" y="-10%" width="200%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000" flood-opacity="0.8"/></filter>
    <filter id="glowGreen" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="${GREEN}" flood-opacity="0.7"/></filter>
    <filter id="lcdGlow" x="-5%" y="-60%" width="110%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${AMBER}" flood-opacity="0.45"/></filter>
    <filter id="noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#stage)"/>
  <rect width="${W}" height="${H}" fill="url(#floorGlow)"/>
  ${beam(W * 0.16, -16, 'beamCream')}
  ${beam(W * 0.5, 0, 'beamAmber')}
  ${beam(W * 0.84, 16, 'beamCream')}
  ${pool(ax)}
  ${pool(bx)}

  <!-- trilho de cima, como o dos módulos da mesa -->
  <rect width="${W}" height="${RAIL}" fill="url(#rail)"/>
  <rect width="${W}" height="${RAIL}" filter="url(#noise)"/>
  <rect y="${RAIL - 1}" width="${W}" height="1" fill="#000" opacity="0.85"/>
  <rect y="${RAIL}" width="${W}" height="1" fill="#ffffff" opacity="0.04"/>
  <text x="20" y="${RAIL / 2 + 4}" font-family="${STAGE}" font-size="11" font-weight="600" fill="${LEGEND}" letter-spacing="1.6">VS STAGE PRO</text>
  <text x="${W - 34}" y="${RAIL / 2 + 4}" text-anchor="end" font-family="${STAGE}" font-size="11" font-weight="600" fill="${LEGEND}" letter-spacing="1.4">INSTALADOR</text>
  <circle cx="${W - 22}" cy="${RAIL / 2}" r="5" fill="url(#ledGlowGreen)"/>
  <circle cx="${W - 22}" cy="${RAIL / 2}" r="2.6" fill="${GREEN}"/>

  <!-- logo e nome, como no fim da abertura do site -->
  <image x="${W / 2 - LOGO / 2}" y="${LOGO_CY - LOGO / 2}" width="${LOGO}" height="${LOGO}" href="data:image/png;base64,${iconBase64}" filter="url(#shadow)"/>
  <text x="${W / 2}" y="${LOGO_CY + LOGO / 2 + 31}" text-anchor="middle" font-family="Outfit" font-size="20" font-weight="600" fill="${CREAM}" letter-spacing="-0.2">VS Stage Pro</text>

  <!-- contagem até o play: do programa para a pasta Aplicativos -->
  ${leds}
  ${play}
  ${plate(ax)}
  ${plate(bx)}

  <!-- visor âmbar com o aviso -->
  <rect x="${LCD_X - 1}" y="${LCD_Y - 1}" width="${LCD_W + 2}" height="${LCD_H + 2}" rx="7" fill="#2d3238"/>
  <rect x="${LCD_X}" y="${LCD_Y}" width="${LCD_W}" height="${LCD_H}" rx="6" fill="#0c0e0d"/>
  <rect x="${LCD_X}" y="${LCD_Y}" width="${LCD_W}" height="${LCD_H}" rx="6" fill="url(#scan)"/>
  <rect x="${LCD_X}" y="${LCD_Y}" width="${LCD_W}" height="${LCD_H}" rx="6" fill="url(#lcdShade)"/>
  <rect x="${LCD_X + 6}" y="${LCD_Y + LCD_H + 1}" width="${LCD_W - 12}" height="1" fill="#ffffff" opacity="0.05"/>
  ${spaced(LCD_Y + LCD_H / 2 + 4.5, 'ARRASTE O VS STAGE PARA A PASTA APLICATIVOS', 12.5, 600, AMBER, 1.3, 'filter="url(#lcdGlow)"')}

  <!-- trilho de baixo -->
  <rect y="${FOOT_Y}" width="${W}" height="${RAIL}" fill="url(#rail)"/>
  <rect y="${FOOT_Y}" width="${W}" height="${RAIL}" filter="url(#noise)"/>
  <rect y="${FOOT_Y}" width="${W}" height="1" fill="#000" opacity="0.85"/>
  <rect y="${FOOT_Y + 1}" width="${W}" height="1" fill="#ffffff" opacity="0.04"/>
  <text x="20" y="${FOOT_Y + RAIL / 2 + 4}" font-family="${STAGE}" font-size="11" font-weight="500" fill="${MUTED}" letter-spacing="0.4">© 2026 VS Stage Pro</text>
  <text x="${W - 34}" y="${FOOT_Y + RAIL / 2 + 4}" text-anchor="end" font-family="${STAGE}" font-size="12" font-weight="700" fill="${AMBER}" letter-spacing="0.6">v${version} PRO</text>
  <circle cx="${W - 22}" cy="${FOOT_Y + RAIL / 2}" r="5" fill="url(#ledGlowAmber)"/>
  <circle cx="${W - 22}" cy="${FOOT_Y + RAIL / 2}" r="2.6" fill="${AMBER}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#ffffff" stroke-opacity="0.04"/>
</svg>`;

const fontFiles = [
  'BarlowSemiCondensed-Medium.ttf', 'BarlowSemiCondensed-SemiBold.ttf', 'BarlowSemiCondensed-Bold.ttf', 'Outfit-SemiBold.ttf',
].map((f) => `${root}build/fonts/${f}`);
for (const [scale, file] of [[1, 'dmg-background.png'], [2, 'dmg-background@2x.png']]) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: STAGE },
  }).render().asPng();
  writeFileSync(`${root}build/${file}`, png);
}
console.log(`Fundo do instalador gerado para a versão ${version}`);
