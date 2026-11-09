// Material do vídeo: o logo do projeto e fotos do site, já tratadas e em cache.
// As capturas de public/shots ficaram de fora de propósito: são de antes do visual atual.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';

export const RAIZ = '/Users/jonatha/Documents/VS STAGE PROJECT/project';
export const SITE = RAIZ + '/public/site/';

const cache = new Map();

async function memo(chave, fab) {
  if (!cache.has(chave)) cache.set(chave, fab());
  return cache.get(chave);
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
