// Gera o ícone dos arquivos de projeto (.vss/.vsc) a partir da logo do programa.
//
// O SVG da logo (public/logo-nova.svg) tem o símbolo separado do fundo: o grupo #squircle-base
// é o quadrado escuro. Removendo só ele, o ícone fica apenas com a onda neon e o play, com
// transparência de verdade — nada de recortar imagem achatada.
//
// Uso: node scripts/makeFileIcon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, '..');
const svgPath = path.join(desktopDir, '..', 'public', 'logo-nova.svg');
const outDir = path.join(desktopDir, 'build');

/** Tira o grupo do quadrado de fundo, mantendo defs, onda e play. */
function symbolOnlySvg(svg) {
  const start = svg.indexOf('<g id="squircle-base">');
  if (start === -1) throw new Error('logo-nova.svg sem o grupo squircle-base');
  // Fecha o grupo até a camada seguinte (a onda neon).
  const next = svg.indexOf('2. ONDA NEON', start);
  const groupEnd = svg.lastIndexOf('</g>', next) + '</g>'.length;
  return svg.slice(0, start) + svg.slice(groupEnd);
}

/** Ícone quadrado com o símbolo ocupando o centro, na margem que o Finder espera. */
function render(svg, px) {
  const img = new Resvg(svg, {
    fitTo: { mode: 'width', value: px },
    background: 'rgba(0,0,0,0)',
  }).render().asPng();
  return img;
}

const ICNS = [
  ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128],
  ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024],
];

const svg = symbolOnlySvg(fs.readFileSync(svgPath, 'utf8'));
fs.writeFileSync(path.join(outDir, 'logo-simbolo.svg'), svg);

const master = render(svg, 1024);
fs.writeFileSync(path.join(outDir, 'project-file-transparent.png'), master);

const chunks = [];
for (const [type, px] of ICNS) {
  const png = render(svg, px);
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(png.length + 8, 4);
  chunks.push(head, png);
}
const total = 8 + chunks.reduce((n, b) => n + b.length, 0);
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(total, 4);
fs.writeFileSync(path.join(outDir, 'project-file.icns'), Buffer.concat([header, ...chunks]));

// O cabeçalho do PNG mostra se ele tem canal alfa (6 = RGBA). Sem alfa, o fundo voltou opaco.
const colorType = master[25];
if (colorType !== 6) throw new Error(`ícone do projeto saiu sem transparência (color type ${colorType})`);
console.log('✓ project-file.icns (logo sem fundo, 16 a 1024 px)');
