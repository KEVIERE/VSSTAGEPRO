// Ajudas comuns às cenas: fundo, cabeçalho, rodapé, blocos de texto e transições.
// Tudo devolve camadas prontas (PNG pequeno + posição), para o quadro montar rápido.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, numero, seg, easeOutCubic, easeInOutCubic, clamp } from './core.mjs';
import { textoEm, textoRevelado } from './camadas.mjs';
import { fundoPadrao, camadaCabecalho, camadaRodape } from './chrome.mjs';

export { fundoPadrao };

/** Fundo + acabamento (cabeçalho e rodapé). */
export async function fundo(t, { etiqueta = '', indice = 1, total = 7, cor = C.amber, haloCor = C.amber, forca = 0.12, chip = true, rodape = true } = {}) {
  const camadas = [{ input: await fundoPadrao({ haloCor, forca }), left: 0, top: 0 }];
  const op = easeOutCubic(seg(t, 0, 0.6));
  if (chip && etiqueta) {
    const c = await camadaCabecalho({ etiqueta, indice, total, cor, opacidade: op });
    if (c) camadas.push(...c);
  }
  if (rodape) {
    const r = await camadaRodape({ progresso: t / 60, opacidade: op });
    if (r) camadas.push(...r);
  }
  return camadas.filter(Boolean);
}

/** Escurece a cena inteira (transição entre cenas). */
export async function escurecer(valor) {
  const a = clamp(valor);
  if (a <= 0.004) return null;
  const buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 4, g: 6, b: 5, alpha: a } } })
    .png()
    .toBuffer();
  return { input: buf, left: 0, top: 0 };
}

/**
 * Bloco de texto: título com entrada por máscara e linha de apoio logo abaixo.
 */
export async function bloco({
  tituloTxt,
  apoioTxt,
  y,
  t,
  inicio,
  tamanhoTitulo = 84,
  tamanhoApoio = 38,
  corTitulo = C.cream,
  corApoio = C.dim,
  x = 56,
  largura = W - 112,
  ancora = 'start',
  familia = 'Oswald',
}) {
  const camadas = [];
  const p1 = seg(t, inicio, inicio + 0.55);
  if (p1 > 0.002) {
    const tl = await (familia === 'Oswald' ? titulo(tituloTxt, tamanhoTitulo, corTitulo) : texto(tituloTxt, tamanhoTitulo, { familia, peso: 'bold', cor: corTitulo }));
    const esc = tl.w > largura ? largura / tl.w : 1;
    const c = await textoRevelado(tl, {
      x: ancora === 'middle' ? W / 2 : x,
      y: y + (1 - easeOutCubic(p1)) * 24,
      progresso: easeOutCubic(p1),
      escala: esc,
      ancora,
    });
    if (c) camadas.push(c);
  }
  if (apoioTxt) {
    const p2 = seg(t, inicio + 0.25, inicio + 0.85);
    if (p2 > 0.002) {
      const ap = await apoio(apoioTxt, tamanhoApoio, corApoio);
      const esc = ap.w > largura ? largura / ap.w : 1;
      const c = await textoEm(ap, {
        x: ancora === 'middle' ? W / 2 : x,
        y: y + tamanhoTitulo * 1.05 + (1 - easeOutCubic(p2)) * 14,
        opacidade: easeOutCubic(p2),
        escala: esc,
        ancora,
      });
      if (c) camadas.push(c);
    }
  }
  return camadas;
}

/** Fita fina que se abre (divisor). */
export async function divisor(x, y, largura, t, inicio, cor = C.amber) {
  const p = easeInOutCubic(seg(t, inicio, inicio + 0.55));
  if (p <= 0.001) return null;
  const l = Math.max(2, Math.round(largura * p));
  const buf = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${l}" height="4"><rect width="${l}" height="4" fill="${cor}"/></svg>`))
    .png()
    .toBuffer();
  return { input: buf, left: Math.round(x), top: Math.round(y) };
}

/** Encolhe/posiciona um PNG pronto (para peças que entram crescendo). */
export async function encaixar(buf, { x = 0, y = 0, w, h, opacidade = 1, chave } = {}) {
  let b = buf;
  if (w && h) b = await sharp(buf).resize(Math.round(w), Math.round(h)).png().toBuffer();
  if (opacidade < 0.996) {
    const { data, info } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const a = Math.max(0, Math.min(1, opacidade));
    for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * a);
    b = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }
  return { input: b, left: Math.round(x), top: Math.round(y) };
}
