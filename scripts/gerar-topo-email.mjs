// Gera o topo dos e-mails: o console do programa com a marca fundida nele.
//
// Por que um script e não uma arte fixa: o topo combina duas peças que já existem no
// repositório — a captura real do mixer (`public/site/mixer.jpg`) e a logo oficial
// (`public/email-logo.png`). Se qualquer uma mudar, é só rodar de novo:
//
//   node scripts/gerar-topo-email.mjs
//
// O resultado vai para `public/email-topo.jpg`, que o site serve e os e-mails apontam.
// Largura de 960px porque o e-mail tem 480 de coluna: em tela retina a imagem chega nítida.

import sharp from 'sharp';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

// Medidas do cabeçalho. A largura é o dobro da coluna do e-mail; a altura mantém a captura
// na metade de cima e a marca assentada embaixo, sobre a parte fundida no painel.
const LARGURA = 960;
const ALTURA = 360;
const ALTURA_CAPTURA = 256;
const COR_PAINEL = '#1b1e22';

async function principal() {
  // 1) A captura do console, recortada na faixa que mostra as faixas e o mixer.
  const captura = await sharp(join(raiz, 'public/site/mixer.jpg'))
    .extract({ left: 0, top: 0, width: 2040, height: 510 })
    .resize(LARGURA, ALTURA_CAPTURA)
    .toBuffer();

  // 2) O degrau de luz no topo e o degradê que funde a captura no painel embaixo.
  //    Sem o degradê, a imagem termina numa linha reta que parece recorte mal feito.
  const fusao = Buffer.from(
    `<svg width="${LARGURA}" height="${ALTURA}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#111316" stop-opacity="0.45"/>
          <stop offset="0.5" stop-color="#111316" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="baixo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${COR_PAINEL}" stop-opacity="0"/>
          <stop offset="0.55" stop-color="${COR_PAINEL}" stop-opacity="0.55"/>
          <stop offset="1" stop-color="${COR_PAINEL}" stop-opacity="1"/>
        </linearGradient>
      </defs>
      <rect width="${LARGURA}" height="${ALTURA_CAPTURA}" fill="url(#topo)"/>
      <rect y="${ALTURA_CAPTURA - 110}" width="${LARGURA}" height="${ALTURA - ALTURA_CAPTURA + 110}" fill="url(#baixo)"/>
    </svg>`,
  );

  // 3) A marca: logo oficial e o nome em Outfit 600, a mesma fonte do site.
  //    Em SVG para o texto sair vetorial, e não borrado como imagem embutida.
  const logo = readFileSync(join(raiz, 'public/email-logo.png')).toString('base64');
  const marca = Buffer.from(
    `<svg width="${LARGURA}" height="${ALTURA}" xmlns="http://www.w3.org/2000/svg">
      <image href="data:image/png;base64,${logo}" x="319" y="262" width="64" height="64"/>
      <text x="403" y="301" font-family="Outfit, Inter, sans-serif" font-size="27"
            font-weight="600" fill="#e7e2d6" letter-spacing="0.6">VS STAGE PRO</text>
    </svg>`,
  );

  const destino = join(raiz, 'public/email-topo.jpg');
  await sharp({ create: { width: LARGURA, height: ALTURA, channels: 3, background: COR_PAINEL } })
    .composite([
      { input: captura, top: 0, left: 0 },
      { input: fusao, top: 0, left: 0 },
      { input: marca, top: 0, left: 0 },
    ])
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(destino);

  const kb = (statSync(destino).size / 1024).toFixed(0);
  console.log(`public/email-topo.jpg — ${LARGURA}x${ALTURA}, ${kb} KB`);
}

principal().catch((e) => {
  console.error('Falhou:', e.message);
  process.exit(1);
});
