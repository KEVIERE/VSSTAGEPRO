// Gera o fundo da janela do instalador (1x e @2x) com a versão do package.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const layout = JSON.parse(readFileSync(`${root}build/dmg-layout.json`, 'utf8'));
const [W, H] = layout.window;
const [ax, ay] = layout.app;
const [bx, by] = layout.applications;
const labelY = ay + layout.iconSize / 2 + 16;
const FONT = 'Inter';

// Logo real do app: embute o próprio build/icon.png (squircle com onda neon + play de vidro,
// cantos já transparentes) em vez de redesenhar o logo à mão — assim o fundo do instalador nunca
// mais fica desatualizado em relação ao ícone de verdade.
const iconBase64 = readFileSync(`${root}build/icon.png`).toString('base64');
const LOGO_SIZE = 80;
const logo = `
  <image x="${W / 2 - LOGO_SIZE / 2}" y="${78 - LOGO_SIZE / 2}" width="${LOGO_SIZE}" height="${LOGO_SIZE}"
         href="data:image/png;base64,${iconBase64}" filter="url(#shadow)"/>`;

const spot = (x, y, color) => `
  <circle cx="${x}" cy="${y}" r="92" fill="url(#spot-${color})"/>
  <circle cx="${x}" cy="${y}" r="78" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;

// O Finder pinta o nome dos ícones de preto (modo claro) ou branco (modo escuro): a plaquinha média deixa os dois legíveis.
const plate = (x) => `
  <rect x="${x - 62}" y="${labelY - 12}" width="124" height="24" rx="12" fill="url(#plate)" stroke="rgba(255,255,255,0.14)" stroke-width="1"/>`;

const dots = [];
const from = ax + 92;
const to = bx - 104;
for (let i = 0, n = 9; i < n; i++) {
  const x = from + ((to - from) * i) / (n - 1);
  dots.push(`<circle cx="${x.toFixed(1)}" cy="${ay}" r="${(2.2 + i * 0.25).toFixed(2)}" fill="#4ade80" opacity="${(0.25 + i * 0.09).toFixed(2)}"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1e23"/><stop offset="1" stop-color="#0b0c0f"/></linearGradient>
    <radialGradient id="glowGreen" cx="0.12" cy="0.95" r="0.6"><stop offset="0" stop-color="#22c55e" stop-opacity="0.20"/><stop offset="1" stop-color="#22c55e" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowAmber" cx="0.9" cy="0.02" r="0.55"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.16"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
    <radialGradient id="spot-green" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#4ade80" stop-opacity="0.13"/><stop offset="0.7" stop-color="#4ade80" stop-opacity="0.03"/><stop offset="1" stop-color="#4ade80" stop-opacity="0"/></radialGradient>
    <radialGradient id="spot-amber" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.12"/><stop offset="0.7" stop-color="#f59e0b" stop-opacity="0.03"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a909a"/><stop offset="1" stop-color="#727780"/></linearGradient>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.7"/></filter>
    <filter id="glow" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glowGreen)"/>
  <rect width="${W}" height="${H}" fill="url(#glowAmber)"/>
  <g transform="translate(${W / 2}, ${ay})" fill="none" stroke-width="1">
    <ellipse transform="rotate(-8)" rx="330" ry="70" stroke="#22c55e" opacity="0.07"/>
    <ellipse transform="rotate(7)" rx="300" ry="58" stroke="#f59e0b" opacity="0.06"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="rgba(255,255,255,0.05)"/>

  ${logo}
  <text x="${W / 2}" y="152" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="800" fill="#ffffff" letter-spacing="4">VS STAGE</text>
  <text x="${W / 2}" y="174" text-anchor="middle" font-family="${FONT}" font-size="10.5" font-weight="600" fill="#9ca3af" letter-spacing="5">LIVE PERFORMANCE ENGINE</text>

  ${spot(ax, ay, 'green')}
  ${spot(bx, by, 'amber')}
  <g filter="url(#glow)">
    ${dots.join('\n    ')}
    <path d="M ${to + 2} ${ay - 13} L ${to + 22} ${ay} L ${to + 2} ${ay + 13} Z" fill="#4ade80" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"/>
  </g>
  ${plate(ax)}
  ${plate(bx)}

  <text x="${W / 2}" y="${H - 52}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="500" fill="#a1a8b3">Arraste o VS Stage para a pasta Aplicativos para instalar</text>
  <line x1="24" y1="${H - 36}" x2="${W - 24}" y2="${H - 36}" stroke="rgba(255,255,255,0.06)"/>
  <text x="24" y="${H - 16}" font-family="${FONT}" font-size="10" font-weight="500" fill="#71717a">© 2026 VS Stage</text>
  <text x="${W - 24}" y="${H - 16}" text-anchor="end" font-family="${FONT}" font-size="10" font-weight="600" fill="#f59e0b">v${version} PRO</text>
</svg>`;

const fontFiles = ['Inter-Medium.ttf', 'Inter-SemiBold.ttf', 'Inter-ExtraBold.ttf'].map((f) => `${root}build/fonts/${f}`);
for (const [scale, file] of [[1, 'dmg-background.png'], [2, 'dmg-background@2x.png']]) {
  const png = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: FONT },
  }).render().asPng();
  writeFileSync(`${root}build/${file}`, png);
}
console.log(`Fundo do instalador gerado para a versão ${version}`);
