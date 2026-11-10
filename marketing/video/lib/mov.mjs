// O motor de movimento do vídeo: cortes, chicotes, zooms de soco, tipografia cinética
// e os acentos de interface (caixas e anéis que se desenham).
//
// A régua é o BPM do próprio programa: 72 BPM → pulso de 0,8333 s, compasso de 3,333 s.
// Todo corte cai no pulso. É isso que faz o vídeo "respirar" em vez de arrastar.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';

export const BPM = 72;
export const PULSO = 60 / BPM; // 0,8333 s
export const COMPASSO = PULSO * 4; // 3,333 s

// ---------------------------------------------------------------- curvas

export const linear = (p) => Math.max(0, Math.min(1, p));
export const easeOutExpo = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * Math.max(0, p)));
export const easeOutQuint = (p) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 5);
export const easeOutCubic = (p) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
export const easeInCubic = (p) => Math.pow(Math.max(0, Math.min(1, p)), 3);
export const easeInExpo = (p) => (p <= 0 ? 0 : Math.pow(2, 10 * Math.max(0, Math.min(1, p)) - 10));
export const easeInOutQuart = (p) => {
  const x = Math.max(0, Math.min(1, p));
  return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
};
/** Passa um pouco do ponto e volta: o "soco" que dá peso ao texto. */
export const easeOutBack = (p, forca = 1.9) => {
  const x = Math.max(0, Math.min(1, p));
  const c = forca;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Fatia normalizada de um trecho. */
export const fatia = (t, de, ate) => linear((t - de) / Math.max(0.0001, ate - de));

/** Interpola uma janela de câmera { fx, fy, fw, fh }. */
export function janela(de, para, p) {
  const q = linear(p);
  return {
    fx: de.fx + (para.fx - de.fx) * q,
    fy: de.fy + (para.fy - de.fy) * q,
    fw: de.fw + (para.fw - de.fw) * q,
    fh: de.fh + (para.fh - de.fh) * q,
  };
}

// ---------------------------------------------------------------- desfoque de movimento

const cacheDesfoque = new Map();

/** Borra uma camada (usado no chicote: quanto mais rápido, mais borra). */
export async function desfocar(buf, raio) {
  const r = Math.max(0, Math.min(40, Math.round(raio)));
  if (r < 1) return buf;
  const chave = `${buf.length}|${r}|${buf[0]}${buf[1]}${buf[2]}`;
  // o buffer muda a cada quadro, então só o raio é reaproveitável: sem cache de conteúdo
  return sharp(buf).blur(r).png().toBuffer();
}

/** Desfoque horizontal puro (o rastro de um chicote). */
export async function desfocarH(buf, raio) {
  const r = Math.max(0, Math.min(40, raio));
  if (r < 0.6) return buf;
  const meta = await sharp(buf).metadata();
  // estica na horizontal e volta: vira um borrão de arrasto
  return sharp(buf).resize(Math.round(meta.width * (1 + r / 240)), meta.height, { fit: 'fill' }).blur(r / 3).resize(meta.width, meta.height, { fit: 'fill' }).png().toBuffer();
}

// ---------------------------------------------------------------- grão e vinheta

let graos = null;

/** Três chapas de grão, alternadas por quadro: dá textura de película sem custo. */
export async function grão(indice) {
  if (!graos) {
    graos = [];
    for (let k = 0; k < 3; k++) {
      const w = 540;
      const h = 960;
      const px = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const v = 118 + Math.random() * 70;
        px[i * 4] = v;
        px[i * 4 + 1] = v;
        px[i * 4 + 2] = v;
        px[i * 4 + 3] = 26;
      }
      const buf = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).resize(1080, 1920, { kernel: 'nearest' }).png().toBuffer();
      graos.push(buf);
    }
  }
  return graos[Math.abs(Math.round(indice)) % graos.length];
}

let vinhetaBuf = null;
export async function vinheta() {
  if (!vinhetaBuf) {
    vinhetaBuf = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
        <defs><radialGradient id="v" cx="0.5" cy="0.46" r="0.78">
          <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
          <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
        </radialGradient></defs>
        <rect width="1080" height="1920" fill="url(#v)"/></svg>`),
    )
      .png()
      .toBuffer();
  }
  return vinhetaBuf;
}

// ---------------------------------------------------------------- texto cinético

/**
 * Palavra que "bate" na tela: entra grande e borrada, assenta encolhendo.
 * `p` vai de 0 a 1 no primeiro quarto de segundo; depois fica parada.
 */
export async function bater(txt, { px = 110, cor = '#f2f2f0', x, y, p = 1, ancora = 'start', peso = '800', desfoque = 26 } = {}) {
  const texto = await import('./core.mjs').then((m) => m.texto);
  const T = await texto(txt, px, { familia: 'SF Pro Display', peso, cor });
  const q = linear(p);
  if (q <= 0.001) return null;
  const escala = 1 + (1 - easeOutQuint(q)) * 0.42;
  const borrao = (1 - easeOutCubic(q)) * desfoque;
  const opacidade = easeOutCubic(Math.min(1, q * 2.6));
  return camadaTexto(T, {
    x, y, ancora, escala,
    about: (buf) => (borrao > 0.7 ? desfocarH(buf, borrao) : Promise.resolve(buf)),
    opacidade,
  });
}

/**
 * Monta a camada de um texto já rasterizado (objeto { buf, w, h } de core.texto).
 * `escala`, `opacidade` e um `about` para transformar o buffer (borrão, cor).
 */
export async function camadaTexto(T, { x = 0, y = 0, ancora = 'start', escala = 1, opacidade = 1, about = null, rotacao = 0 } = {}) {
  if (opacidade <= 0.004) return null;
  let buf = T.buf;
  let w = T.w;
  let h = T.h;

  if (escala !== 1) {
    w = Math.max(1, Math.round(T.w * escala));
    h = Math.max(1, Math.round(T.h * escala));
    buf = await sharp(buf).resize(w, h, { fit: 'fill' }).png().toBuffer();
  }
  if (about) buf = await about(buf);

  if (opacidade < 0.996) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const a = Math.max(0, Math.min(1, opacidade));
    for (let k = 3; k < data.length; k += 4) data[k] = Math.round(data[k] * a);
    buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }
  const left = ancora === 'middle' ? Math.round(x - w / 2) : ancora === 'end' ? Math.round(x - w) : Math.round(x);
  return { input: buf, left, top: Math.round(y) };
}

// ---------------------------------------------------------------- acentos de interface

/** Caixa que se desenha em volta de um elemento (4 traços que crescem). */
export async function caixaDestaque({ x, y, w, h, p = 1, cor = '#34d399', espessura = 4, raio = 8 }) {
  const q = easeOutQuint(p);
  if (q <= 0.001) return null;
  const larg = Math.max(2, Math.round(w * q));
  const alt = Math.max(2, Math.round(h * q));
  const buf = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + espessura * 2}" height="${h + espessura * 2}">
      <rect x="${espessura}" y="${espessura}" width="${larg}" height="${alt}" rx="${raio}" fill="none" stroke="${cor}" stroke-width="${espessura}"/>
    </svg>`),
  )
    .png()
    .toBuffer();
  return { input: buf, left: Math.round(x - espessura), top: Math.round(y - espessura) };
}

/** Anel que se fecha (o círculo de destaque do produto). */
export async function anel({ cx, cy, r, p = 1, cor = '#34d399', espessura = 5 }) {
  const q = easeInOutQuart(p);
  if (q <= 0.001) return null;
  const circ = 2 * Math.PI * r;
  const lado = (r + espessura) * 2;
  const buf = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}">
      <circle cx="${lado / 2}" cy="${lado / 2}" r="${r}" fill="none" stroke="${cor}" stroke-width="${espessura}"
        stroke-linecap="round" stroke-dasharray="${circ.toFixed(1)} ${circ.toFixed(1)}"
        stroke-dashoffset="${(circ * (1 - q)).toFixed(1)}" transform="rotate(-90 ${lado / 2} ${lado / 2})"/>
    </svg>`),
  )
    .png()
    .toBuffer();
  return { input: buf, left: Math.round(cx - lado / 2), top: Math.round(cy - lado / 2) };
}

/** Barra que se enche (medidor, progresso). */
export async function barra({ x, y, w, h, p = 1, cor = '#34d399', raio = null }) {
  const q = linear(p);
  const larg = Math.max(1, Math.round(w * q));
  const r = raio ?? h / 2;
  const buf = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${larg}" height="${h}" rx="${r}" fill="${cor}"/></svg>`),
  )
    .png()
    .toBuffer();
  return { input: buf, left: Math.round(x), top: Math.round(y) };
}

/** Seta que aponta para um ponto, desenhando-se. */
export async function seta({ de, para, p = 1, cor = '#34d399', espessura = 5 }) {
  const q = easeOutQuint(p);
  if (q <= 0.001) return null;
  const comp = Math.hypot(para.x - de.x, para.y - de.y);
  const circ = comp * 1.08;
  const pad = 30;
  const bx = Math.min(de.x, para.x) - pad;
  const by = Math.min(de.y, para.y) - pad;
  const bw = Math.abs(para.x - de.x) + pad * 2;
  const bh = Math.abs(para.y - de.y) + pad * 2;
  const ang = (Math.atan2(para.y - de.y, para.x - de.x) * 180) / Math.PI;
  const buf = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(bw)}" height="${Math.round(bh)}">
      <defs><marker id="ponta" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 z" fill="${cor}"/>
      </marker></defs>
      <line x1="${de.x - bx}" y1="${de.y - by}" x2="${para.x - bx}" y2="${para.y - by}"
        stroke="${cor}" stroke-width="${espessura}" stroke-linecap="round" marker-end="url(#ponta)"
        stroke-dasharray="${circ.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - q)).toFixed(1)}"/>
    </svg>`),
  )
    .png()
    .toBuffer();
  return { input: buf, left: Math.round(bx), top: Math.round(by) };
}

/** Número que conta (contador animado, sempre tabular). */
export async function contador({ x, y, de = 0, para = 72, t, deT, ateT, px = 150, cor = '#34d399', casas = 0, sufixo = '' }) {
  const p = easeOutQuint(fatia(t, deT, ateT));
  const valor = de + (para - de) * p;
  const txt = casas ? valor.toFixed(casas) : String(Math.round(valor));
  const { texto } = await import('./core.mjs');
  const T = await texto(`${txt}${sufixo}`, px, { familia: 'SF Mono', peso: '700', cor });
  return camadaTexto(T, { x, y });
}

/** Flash de 2 quadros no corte: dá o "estalo" da edição. */
export async function flash(t, corte, dur = 0.07, cor = [255, 255, 255], forca = 0.16) {
  const d = Math.abs(t - corte);
  if (d > dur) return null;
  const a = (1 - d / dur) * forca;
  const buf = await sharp({
    create: { width: 1080, height: 1920, channels: 4, background: { r: cor[0], g: cor[1], b: cor[2], alpha: a } },
  })
    .png()
    .toBuffer();
  return { input: buf, left: 0, top: 0 };
}

/** Vinheta/escurecida rápida nas bordas de um corte (o "respiro" do corte). */
export async function pulso(t, corte, dur = 0.16, forca = 0.3) {
  const d = Math.abs(t - corte);
  if (d > dur) return null;
  const a = (1 - d / dur) * forca;
  const buf = await sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: a } } })
    .png()
    .toBuffer();
  return { input: buf, left: 0, top: 0 };
}
