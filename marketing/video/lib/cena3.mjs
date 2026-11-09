// A moldura do vídeo: a captura real do programa dentro de um "monitor", com texto por cima.
// O visual do programa vem das capturas; aqui só entra a moldura, o texto e o movimento.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, texto, seg, easeOutCubic, easeOutQuart, easeInOutCubic, clamp } from './core.mjs';
import { textoEm, textoRevelado } from './camadas.mjs';
import { enquadrar } from './capturas.mjs';

// O preto do programa novo, com o verde de ação.
export const V = {
  fundo: '#0a0a0a',
  painel: '#101211',
  borda: '#1e2320',
  texto: '#f2f2f0',
  dim: '#9a9d99',
  muted: '#5f6360',
  verde: '#34d399',
  verdeEscuro: '#059669',
  lcdVerde: '#3ee26e',
  ambar: '#ffab1f',
  vermelho: '#ff4136',
};

export const FONTE = 'SF Pro Text';
export const FONTE_MONO = 'SF Mono';

const cache = new Map();

async function png(corpo, w, h, chave) {
  if (chave && cache.has(chave)) return cache.get(chave);
  const buf = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`))
    .png()
    .toBuffer();
  if (chave) cache.set(chave, buf);
  return buf;
}

/** Fundo do vídeo: o preto do programa, com um brilho verde discreto. */
export async function fundoVideo(t, { indice = 1, total = 7, etiqueta = '', rodape = true } = {}) {
  if (!cache.has('fundo')) {
    const buf = await png(
      `<defs><radialGradient id="b" cx="0.5" cy="0.08" r="0.65">
        <stop offset="0" stop-color="${V.verde}" stop-opacity="0.07"/>
        <stop offset="1" stop-color="${V.verde}" stop-opacity="0"/>
      </radialGradient></defs>
      <rect width="${W}" height="${H}" fill="${V.fundo}"/>
      <rect width="${W}" height="${H}" fill="url(#b)"/>`,
      W,
      H,
      'fundo',
    );
    cache.set('fundo', buf);
  }
  const camadas = [{ input: cache.get('fundo'), left: 0, top: 0 }];
  const op = easeOutCubic(seg(t, 0, 0.5));
  if (etiqueta) {
    const et = await texto(etiqueta, 21, { familia: FONTE, peso: '600', cor: V.muted, espaco: 4.2 });
    const c = await textoEm(et, { x: 56, y: 74, opacidade: op });
    if (c) camadas.push(c);
    const cont = await texto(`${String(indice).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, 21, {
      familia: FONTE, peso: '600', cor: V.muted, espaco: 2,
    });
    const c2 = await textoEm(cont, { x: W - 56, y: 74, opacidade: op, ancora: 'end' });
    if (c2) camadas.push(c2);
  }
  if (rodape) {
    const larg = W - 112;
    const preenchido = Math.round(larg * clamp(t / 60));
    const barra = await png(
      `<rect width="${larg}" height="2" fill="${V.borda}"/>
       <rect width="${preenchido}" height="2" rx="1" fill="${V.verde}"/>`,
      larg,
      2,
      `rod${preenchido}`,
    );
    camadas.push({ input: barra, left: 56, top: 1848 });
  }
  return camadas.filter(Boolean);
}

/**
 * A captura real dentro de uma moldura de janela, com movimento de câmera.
 *
 * `janela` = janela inicial da câmera em fração { fx, fy, fw, fh }, e `janelaFim` a final:
 * o intervalo entre as duas é o que dá o pan/zoom do trecho.
 */
export async function telaDoPrograma({
  captura,
  x, y, w, h,
  janela = { fx: 0.5, fy: 0.5, fw: 1, fh: 1 },
  janelaFim = null,
  progresso = 0,
  raio = 14,
  sombra = true,
  borda = true,
} = {}) {
  const p = clamp(progresso);
  const j = janelaFim
    ? {
        fx: janela.fx + (janelaFim.fx - janela.fx) * p,
        fy: janela.fy + (janelaFim.fy - janela.fy) * p,
        fw: janela.fw + (janelaFim.fw - janela.fw) * p,
        fh: janela.fh + (janelaFim.fh - janela.fh) * p,
      }
    : janela;

  const conteudo = await enquadrar(captura, j, w, h);

  // máscara de cantos arredondados
  const mascara = await png(
    `<rect width="${w}" height="${h}" rx="${raio}" fill="#fff"/>`,
    w,
    h,
    `mascara${w}x${h}r${raio}`,
  );
  const recortado = await sharp(conteudo)
    .ensureAlpha()
    .composite([{ input: mascara, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const camadas = [];
  if (sombra) {
    // sombra macia embaixo da janela
    const sombraBuf = await png(
      `<defs><filter id="s" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="26"/></filter></defs>
       <rect x="24" y="30" width="${w - 48}" height="${h - 40}" rx="${raio}" fill="#000" opacity="0.75" filter="url(#s)"/>`,
      w + 60,
      h + 60,
      `sombra${w}x${h}`,
    );
    camadas.push({ input: sombraBuf, left: Math.round(x - 30), top: Math.round(y - 30) });
  }
  camadas.push({ input: recortado, left: Math.round(x), top: Math.round(y) });

  if (borda) {
    const linha = await png(
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${raio}" fill="none" stroke="${V.borda}" stroke-width="1"/>`,
      w,
      h,
      `borda${w}x${h}r${raio}`,
    );
    camadas.push({ input: linha, left: Math.round(x), top: Math.round(y) });
  }
  return camadas;
}

/** Esmaece uma camada (para entradas). */
export async function esmaecer(camada, p) {
  if (!camada || p >= 0.995) return camada;
  const { data, info } = await sharp(camada.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = clamp(p);
  for (let k = 3; k < data.length; k += 4) data[k] = Math.round(data[k] * a);
  const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { input: buf, left: camada.left, top: camada.top };
}

export async function esmaecerTodas(lista, p) {
  const out = [];
  for (const c of lista) {
    const e = await esmaecer(c, p);
    if (e) out.push(e);
  }
  return out;
}

/** Escurece a cena inteira (transição). */
export async function escurecer(valor) {
  const a = clamp(valor);
  if (a <= 0.004) return null;
  const buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 10, g: 10, b: 10, alpha: a } } })
    .png()
    .toBuffer();
  return { input: buf, left: 0, top: 0 };
}

/** Título grande. */
export async function titulo(txt, px = 76, cor = V.texto, opacidade = 1) {
  const t = await texto(txt, px, { familia: FONTE, peso: '700', cor });
  return t;
}

/** Bloco de título + apoio. */
export async function bloco({ tituloTxt, apoioTxt, y, t, inicio, tamanho = 76, x = 56, largura = W - 112, ancora = 'start', cor = V.texto }) {
  const camadas = [];
  const p1 = seg(t, inicio, inicio + 0.55);
  if (p1 > 0.002) {
    const tl = await texto(tituloTxt, tamanho, { familia: FONTE, peso: '700', cor });
    const esc = tl.w > largura ? largura / tl.w : 1;
    const c = await textoRevelado(tl, {
      x: ancora === 'middle' ? W / 2 : x,
      y: y + (1 - easeOutCubic(p1)) * 20,
      progresso: easeOutCubic(p1),
      escala: esc,
      ancora,
    });
    if (c) camadas.push(c);
  }
  if (apoioTxt) {
    const p2 = seg(t, inicio + 0.22, inicio + 0.8);
    if (p2 > 0.002) {
      const ap = await texto(apoioTxt, 30, { familia: FONTE, peso: '500', cor: V.dim });
      const esc = ap.w > largura ? largura / ap.w : 1;
      const c = await textoEm(ap, {
        x: ancora === 'middle' ? W / 2 : x,
        y: y + tamanho * 1.16 + (1 - easeOutCubic(p2)) * 10,
        opacidade: easeOutCubic(p2),
        escala: esc,
        ancora,
      });
      if (c) camadas.push(c);
    }
  }
  return camadas;
}

/** Etiqueta do programa (chip) que entra junto com a tela. */
export async function chip({ x, y, txt, cor = V.verde, opacidade = 1 }) {
  const t = await texto(txt, 20, { familia: FONTE, peso: '600', cor, espaco: 1.4 });
  const larg = Math.round(t.w + 34);
  const alt = 42;
  const corpo = `<rect x="0" y="0" width="${larg}" height="${alt}" rx="21" fill="${cor}" fill-opacity="0.12" stroke="${cor}" stroke-opacity="0.45" stroke-width="1"/>
    <circle cx="18" cy="${alt / 2}" r="4" fill="${cor}"/>`;
  const camadas = [{ input: await png(corpo, larg, alt), left: Math.round(x), top: Math.round(y) }];
  const c = await textoEm(t, { x: Math.round(x + 32), y: Math.round(y + 10), opacidade });
  if (c) camadas.push(c);
  return camadas;
}
