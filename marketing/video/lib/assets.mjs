// Material do vídeo: capturas do programa e fotos do site, já tratadas e em cache.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H } from './core.mjs';
import { tela } from './tela.mjs';

export const RAIZ = '/Users/jonatha/Documents/VS STAGE PROJECT/project';
export const SHOTS = RAIZ + '/public/shots/';
export const SITE = RAIZ + '/public/site/';

const cache = new Map();

async function memo(chave, fab) {
  if (!cache.has(chave)) cache.set(chave, fab());
  return cache.get(chave);
}

/** Uma captura do programa dentro da moldura de tela. */
export function captura(nome, w, h, { raio = 30 } = {}) {
  return memo(`cap:${nome}:${w}x${h}:${raio}`, () => tela(SHOTS + nome, { w, h, raio }));
}

/** Uma foto do site, cortada no tamanho pedido. */
export function imagem(nome, w, h, { encaixe = 'cover', posicao = 'centre' } = {}) {
  return memo(`img:${nome}:${w}x${h}:${encaixe}:${posicao}`, () =>
    sharp(SITE + nome).resize(w, h, { fit: encaixe, position: posicao }).jpeg({ quality: 92 }).toBuffer(),
  );
}

/**
 * A logo em PNG quadrado. Usa o ícone 512 (o mesmo símbolo, já rasterizado pelo projeto): o SVG
 * da logo não sai certo pelo librsvg, que não desenha os filtros dele.
 */
export function logo(tamanho = 500) {
  return memo(`logo:${tamanho}`, () => sharp(RAIZ + '/public/icon-512.png').resize(tamanho, tamanho).png().toBuffer());
}

/** Fundo com a mesa de som desfocada e escurecida (para as cenas de texto). */
export function fundoMesa(desfoque = 0) {
  return memo(`mesa:${desfoque}`, async () => {
    let img = sharp(SITE + 'mesa.jpg').resize(W, H, { fit: 'cover' });
    if (desfoque) img = img.blur(desfoque);
    return img.modulate({ brightness: 0.32, saturation: 0.55 }).jpeg({ quality: 90 }).toBuffer();
  });
}

/** Fundo com a foto do show, escurecida. */
export function fundoShow(desfoque = 0) {
  return memo(`show:${desfoque}`, async () => {
    let img = sharp(SITE + 'show.jpg').resize(W, H, { fit: 'cover' });
    if (desfoque) img = img.blur(desfoque);
    return img.modulate({ brightness: 0.4, saturation: 0.6 }).jpeg({ quality: 90 }).toBuffer();
  });
}
