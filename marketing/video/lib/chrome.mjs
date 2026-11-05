// O acabamento do vídeo: grade, cabeçalho, rodapé.
// IMPORTANTE: nenhum <text> em SVG. O librsvg leva ~1 s por rasterização com fonte nomeada.
// Todo texto vem do Pango (texto() do core), que é ~4 ms, e entra como camada.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, texto, svg, seg } from './core.mjs';
import { textoEm, imagemEm } from './camadas.mjs';

const cache = new Map();

async function png(corpo, w, h, chave) {
  if (chave && cache.has(chave)) return cache.get(chave);
  const buf = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`))
    .png()
    .toBuffer();
  if (chave) cache.set(chave, buf);
  return buf;
}

/** Grade técnica de fundo (bem discreta). */
export async function grade(opacidade = 0.05, passo = 60) {
  const lines = [];
  for (let x = 0; x <= W; x += passo) lines.push(`<rect x="${x}" y="0" width="1" height="${H}"/>`);
  for (let y = 0; y <= H; y += passo) lines.push(`<rect x="0" y="${y}" width="${W}" height="1"/>`);
  return png(`<g fill="${C.cream}" opacity="${opacidade}">${lines.join('')}</g>`, W, H, `grade${opacidade}${passo}`);
}

/** Brilho radial de fundo (dá profundidade ao preto). */
export async function halo(cor = C.amber, { cx = 0.5, cy = 0.4, raio = 0.5, forca = 0.14 } = {}) {
  const corpo = `<defs><radialGradient id="halo" cx="${cx}" cy="${cy}" r="${raio}">
      <stop offset="0" stop-color="${cor}" stop-opacity="${forca}"/>
      <stop offset="0.55" stop-color="${cor}" stop-opacity="${(forca * 0.3).toFixed(3)}"/>
      <stop offset="1" stop-color="${cor}" stop-opacity="0"/>
    </radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#halo)"/>`;
  return png(corpo, W, H, `halo${cor}${cx}${cy}${raio}${forca}`);
}

/** Cabeçalho: barra âmbar, etiqueta (Pango) e a contagem de cena (Pango). */
export async function camadaCabecalho({ etiqueta = '', indice = 1, total = 7, opacidade = 1, cor = C.amber, x = 56, y = 66 }) {
  if (opacidade <= 0.004) return null;
  const camadas = [];
  const barra = await png(`<rect x="0" y="0" width="5" height="38" fill="${cor}"/>`, 5, 38, `barraCab${cor}`);
  camadas.push(await imagemEm(barra, { x, y: y + 4, opacidade, w: 5, h: 38 }));
  if (etiqueta) {
    const et = await texto(etiqueta, 27, { familia: 'Oswald', peso: '600', cor, espaco: 3.2 });
    const c = await textoEm(et, { x: x + 18, y: y + 32, opacidade, escala: 1 });
    if (c) camadas.push(c);
  }
  const cont = await texto(`${String(indice).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, 25, {
    familia: 'Barlow Semi Condensed',
    peso: '600',
    cor: C.muted,
  });
  const c2 = await textoEm(cont, { x: 1024, y: y + 12, opacidade, ancora: 'end' });
  if (c2) camadas.push(c2);
  return camadas.filter(Boolean);
}

/** Rodapé: marca (Pango) e a barra de progresso do vídeo (SVG de 2 px de altura). */
export async function camadaRodape({ progresso = 0, opacidade = 1, textoRodape = 'VS STAGE PRO', x = 56, y = 1836, largura = 968 }) {
  if (opacidade <= 0.004) return null;
  const camadas = [];
  const marca = await texto(textoRodape, 21, { familia: 'Oswald', peso: '600', cor: C.muted, espaco: 2.6 });
  const c = await textoEm(marca, { x, y, opacidade });
  if (c) camadas.push(c);

  const preenchido = Math.max(1, Math.round(largura * Math.min(1, Math.max(0.001, progresso))));
  const barra = await png(
    `<rect x="0" y="0" width="${largura}" height="2" fill="${C.cream}" opacity="0.10"/>
     <rect x="0" y="0" width="${preenchido}" height="2" fill="${C.amber}"/>`,
    largura,
    2,
    `barraRod${preenchido}`,
  );
  const cb = await imagemEm(barra, { x, y: y + 14, opacidade, w: largura, h: 2 });
  if (cb) camadas.push(cb);
  return camadas.filter(Boolean);
}

/** Fundo padrão da cena (já com halo e grade), feito uma vez por combinação. */
const fundos = new Map();
export async function fundoPadrao({ haloCor = C.amber, forca = 0.12, cy = 0.38 } = {}) {
  const chave = `${haloCor}|${forca}|${cy}`;
  if (fundos.has(chave)) return fundos.get(chave);
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: C.ink } })
    .composite([
      { input: await halo(haloCor, { cy, forca }), left: 0, top: 0 },
      { input: await grade(0.04), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  fundos.set(chave, base);
  return base;
}

/** Cantos em L, o motivo das mesas de som. */
export function cantos({ x, y, w, h, tam = 26, cor = C.cream, opacidade = 0.35, espessura = 2 }) {
  const c = (px, py, dx, dy) =>
    `<path d="M${px + dx * tam} ${py} L${px} ${py} L${px} ${py + dy * tam}" fill="none" stroke="${cor}" stroke-width="${espessura}" opacity="${opacidade}"/>`;
  return [c(x, y, 1, 1), c(x + w, y, -1, 1), c(x, y + h, 1, -1), c(x + w, y + h, -1, -1)].join('');
}
