// Folha de contato do vídeo renderizado: um quadro a cada N segundos, lado a lado.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import fs from 'node:fs';

const pasta = 'quadros';
const segundos = [1.5, 3.5, 6, 9, 13, 17, 20.5, 24, 27, 30, 34, 37.5, 40.5, 44, 48, 52, 55, 57.5];
const cols = 6;
const larg = 300;
const alt = 533;

const tiles = [];
for (let i = 0; i < segundos.length; i++) {
  const f = Math.round(segundos[i] * 30);
  const arq = `${pasta}/f${String(f).padStart(5, '0')}.png`;
  if (!fs.existsSync(arq)) continue;
  tiles.push({
    input: await sharp(arq).resize(larg, alt).toBuffer(),
    left: (i % cols) * larg,
    top: Math.floor(i / cols) * alt,
  });
}

const linhas = Math.ceil(segundos.length / cols);
await sharp({ create: { width: larg * cols, height: alt * linhas, channels: 3, background: '#000' } })
  .composite(tiles)
  .jpeg({ quality: 86 })
  .toFile('contato_video.jpg');
console.log('ok', larg * cols, alt * linhas);
