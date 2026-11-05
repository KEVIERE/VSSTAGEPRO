// Base do renderizador do vídeo: texto (Pango), formas (SVG), câmera sobre fotos e utilidades.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';

export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const DUR = 60;

// Cores da mesa de som (as mesmas do programa e do site).
export const C = {
  ink: '#0c0e0d',
  steel: '#1b1e22',
  steel2: '#24282d',
  steel3: '#2d3238',
  line: 'rgba(231,226,214,0.10)',
  lineStrong: '#3b4148',
  cream: '#e7e2d6',
  dim: '#a7a297',
  muted: '#8d897f',
  amber: '#ffab1f',
  green: '#3ee26e',
  red: '#ff4136',
  cyan: '#64d2ff',
  violet: '#b79cff',
  coral: '#ff7a59',
  lcd: '#0c0e0d',
};

// Faixas do VS criado pela IA, na ordem que o dono do projeto exige.
export const STEMS = [
  { nome: 'Voz', cor: '#e7e2d6' },
  { nome: 'Click', cor: '#3ee26e' },
  { nome: 'Bateria', cor: '#ff7a59' },
  { nome: 'Baixo', cor: '#ffab1f' },
  { nome: 'Guitarra/Violão', cor: '#64d2ff' },
  { nome: 'Teclado', cor: '#b79cff' },
  { nome: 'Outros', cor: '#a7a297' },
];

// ---------------------------------------------------------------- tempo e curvas

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
export const easeInCubic = (p) => p * p * p;
export const easeOutQuart = (p) => 1 - Math.pow(1 - p, 4);
export const easeOutExpo = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p));
export const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const easeOutBack = (p) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2);
export const smooth = (p) => p * p * (3 - 2 * p);

/** Sobe e desce: 0 no começo e no fim, 1 no meio. */
export function pulse(t, a, b, entrada = 0.35) {
  const p = seg(t, a, b);
  if (p <= 0 || p >= 1) return 0;
  return p < entrada ? easeOutCubic(p / entrada) : 1 - easeInOutCubic((p - entrada) / (1 - entrada));
}

/** Ruído determinístico por semente (para formas que parecem medidas de áudio). */
export function ruido(i, semente = 1) {
  const x = Math.sin(i * 127.1 + semente * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------- texto (Pango)

const cacheTexto = new Map();

function esc(m) {
  return String(m).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Texto como PNG transparente, já no tamanho pedido. O Pango acha as fontes do sistema e é
 * rápido (~4 ms), então dá até para animar texto número a número.
 * `px` é a altura da fonte em pixels.
 */
export async function texto(conteudo, px, { familia = 'Avenir Next', peso = 'normal', cor = C.cream, espaco = 0, dpi = 72 } = {}) {
  const markup = `<span font_family="${esc(familia)}" font_weight="${peso}" foreground="${cor}" size="${Math.round(px * 1024)}"${
    espaco ? ` letter_spacing="${Math.round(espaco * 1024)}"` : ''
  }>${esc(conteudo)}</span>`;
  const chave = `${markup}|${dpi}`;
  const guardado = cacheTexto.get(chave);
  if (guardado) return guardado;
  const buf = await sharp({ text: { text: markup, rgba: true, dpi } }).png().toBuffer();
  const m = await sharp(buf).metadata();
  const item = { buf, w: m.width, h: m.height };
  cacheTexto.set(chave, item);
  return item;
}

/** Texto com o tamanho ajustado para caber numa largura (para títulos grandes). */
export async function textoNaLargura(conteudo, largura, opts = {}) {
  const base = await texto(conteudo, opts.px || 100, opts);
  if (base.w <= largura) return base;
  const escala = largura / base.w;
  const buf = await sharp(base.buf).resize(Math.round(base.w * escala), null).png().toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width, h: m.height };
}

export const titulo = (t, px = 96, cor = C.cream) => texto(t, px, { familia: 'Oswald', peso: 'bold', cor });
export const apoio = (t, px = 34, cor = C.dim, peso = 'normal') => texto(t, px, { familia: 'Avenir Next', peso, cor });
export const numero = (t, px = 44, cor = C.cream, peso = 'bold') => texto(t, px, { familia: 'Menlo', peso, cor });

// ---------------------------------------------------------------- formas (SVG)

const cacheSvg = new Map();

/** Um SVG virado PNG, com cache. Use só para formas estáticas. */
export async function forma(corpo, w = W, h = H, chave) {
  if (chave && cacheSvg.has(chave)) return cacheSvg.get(chave);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  if (chave) cacheSvg.set(chave, buf);
  return buf;
}

/** Um SVG desenhado no tamanho exato (sem cache: para coisas que mudam por frame). */
export async function svg(corpo, w = W, h = H) {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${corpo}</svg>`)).png().toBuffer();
}

// ---------------------------------------------------------------- foto com câmera

const placas = new Map();

/**
 * Prepara uma foto maior que o quadro, para a câmera poder entrar e passear dentro dela.
 * `largura`/`altura` é o tamanho final que a foto vai ocupar na tela (antes do zoom).
 */
export async function placa(arquivo, { margem = 1.18, encaixe = 'cover', posicao = 'centre' } = {}) {
  const chave = `${arquivo}|${margem}|${encaixe}|${posicao}`;
  if (placas.has(chave)) return placas.get(chave);
  const pw = Math.round(W * margem);
  const ph = Math.round(H * margem);
  const buf = await sharp(arquivo).resize(pw, ph, { fit: encaixe, position: posicao }).jpeg({ quality: 92 }).toBuffer();
  const item = { buf, w: pw, h: ph };
  placas.set(chave, item);
  return item;
}

/** Uma foto já recortada e reduzida, para colocar num retângulo qualquer. */
export async function foto(arquivo, w, h, { encaixe = 'cover', posicao = 'centre', qualidade = 92 } = {}) {
  return sharp(arquivo).resize(w, h, { fit: encaixe, position: posicao }).jpeg({ quality: qualidade }).toBuffer();
}

/**
 * Janela de câmera dentro de uma placa: zoom (1 = placa inteira) e deslocamento.
 * Devolve o recorte já no tamanho do quadro.
 */
export async function camera(placa, { zoom = 1, x = 0.5, y = 0.5, giro = 0 } = {}) {
  const cw = Math.max(8, Math.round(placa.w / zoom));
  const ch = Math.max(8, Math.round(placa.h / zoom));
  const left = Math.round(clamp(x, 0, 1) * (placa.w - cw));
  const top = Math.round(clamp(y, 0, 1) * (placa.h - ch));
  let img = sharp(placa.buf).extract({ left, top, width: cw, height: ch });
  if (giro) img = img.rotate(giro, { background: C.ink });
  return img.resize(W, H, { fit: 'cover' }).toBuffer();
}

// ---------------------------------------------------------------- montagem do quadro

/**
 * Monta um quadro: fundo chapado + camadas + textura.
 * Cada camada: { input, left, top } ou { input, esmaecer } para cobrir tudo.
 */
export async function quadro({ bg = C.ink, camadas = [], textura = true } = {}) {
  const base = sharp({ create: { width: W, height: H, channels: 4, background: bg } });
  const lista = camadas.filter(Boolean);
  const composto = await base.composite(lista).png().toBuffer();
  return composto;
}

// Texturas fixas (feitas uma vez).
let vinhetaBuf = null;
let graoBuf = null;

export async function vinheta() {
  if (!vinhetaBuf) {
    vinhetaBuf = await svg(
      `<defs><radialGradient id="v" cx="0.5" cy="0.46" r="0.72">
        <stop offset="0.35" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#v)"/>`,
    );
  }
  return vinhetaBuf;
}

export async function grao(opacidade = 0.05) {
  if (!graoBuf) {
    // Grão fino: pontos de 1 px espalhados. Custa uma vez só.
    const pontos = [];
    for (let i = 0; i < 26000; i++) {
      const x = Math.round(ruido(i, 3) * W);
      const y = Math.round(ruido(i, 9) * H);
      const a = (0.25 + ruido(i, 17) * 0.75).toFixed(2);
      pontos.push(`<rect x="${x}" y="${y}" width="1.6" height="1.6" fill="#fff" opacity="${a}"/>`);
    }
    graoBuf = await svg(`<g>${pontos.join('')}</g>`);
  }
  return sharp(graoBuf).ensureAlpha(opacidade).png().toBuffer();
}

/** Painel escuro com degradê, para o texto ficar legível sobre foto. */
export async function painel(y, altura, { cor = '#0c0e0d', de = 0, para = 0.92, chave } = {}) {
  return forma(
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${cor}" stop-opacity="${de}"/>
      <stop offset="0.55" stop-color="${cor}" stop-opacity="${para}"/>
      <stop offset="1" stop-color="${cor}" stop-opacity="${para}"/></linearGradient></defs>
     <rect x="0" y="${y}" width="${W}" height="${altura}" fill="url(#p)"/>`,
    W,
    H,
    chave || `painel-${y}-${altura}-${de}-${para}-${cor}`,
  );
}
