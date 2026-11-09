// Camadas reutilizáveis. Cada uma devolve { input, left, top } para a montagem do quadro.
// Regra de ouro: o SVG por quadro tem que ser minúsculo. Texto vai como PNG do Pango (barato) e
// recorte/opacidade são feitos no próprio sharp, não em SVG grande.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';

// ---------------------------------------------------------------- opacidade em PNG

const cacheOpaco = new Map();

/** O mesmo PNG com opacidade, emendado no alfa (sharp puro, sem SVG). */
export async function pngEm(txt, opacidade = 1) {
  const a = Math.max(0, Math.min(1, opacidade));
  if (a >= 0.995 || a <= 0.004) return txt.buf;
  const chave = `${txt.w}x${txt.h}|${a.toFixed(3)}|${txt.chave ?? ''}`;
  if (txt.chave && cacheOpaco.has(chave)) return cacheOpaco.get(chave);
  const { data, info } = await sharp(txt.buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * a);
  const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  if (txt.chave) cacheOpaco.set(chave, buf);
  return buf;
}

/**
 * Texto na tela. `ancora` posiciona: start, middle ou end (em x).
 * Devolve a camada pronta, ou null se estiver invisível.
 */
export async function textoEm(txt, { x = 0, y = 0, opacidade = 1, escala = 1, ancora = 'start' } = {}) {
  if (!txt || opacidade <= 0.004) return null;
  const w = Math.round(txt.w * escala);
  const h = Math.round(txt.h * escala);
  const left = Math.round(ancora === 'middle' ? x - w / 2 : ancora === 'end' ? x - w : x);
  let buf = await pngEm(txt, opacidade);
  if (escala !== 1) buf = await sharp(buf).resize(w, h).png().toBuffer();
  return { input: buf, left, top: Math.round(y) };
}

/**
 * Texto que sobe de dentro de uma máscara. `progresso` 0 a 1.
 * O recorte é feito no sharp: pega-se a fatia de baixo do PNG do texto.
 */
export async function textoRevelado(txt, { x = 0, y = 0, progresso = 1, opacidade = 1, escala = 1, ancora = 'start' } = {}) {
  if (!txt || progresso <= 0.002 || opacidade <= 0.004) return null;
  const w = Math.round(txt.w * escala);
  const h = Math.round(txt.h * escala);
  const left = Math.round(ancora === 'middle' ? x - w / 2 : ancora === 'end' ? x - w : x);
  let buf = await pngEm(txt, opacidade);
  if (escala !== 1) buf = await sharp(buf).resize(w, h).png().toBuffer();
  if (progresso >= 0.995) return { input: buf, left, top: Math.round(y) };

  const recorte = Math.max(1, Math.round(h * Math.min(1, progresso)));
  const meta = await sharp(buf).metadata();
  const fatia = await sharp(buf)
    .extract({ left: 0, top: meta.height - recorte, width: meta.width, height: recorte })
    .png()
    .toBuffer();
  return { input: fatia, left, top: Math.round(y + h - recorte) };
}

/** Uma foto/PNG já pronto como camada, com opacidade opcional. */
export async function imagemEm(buf, { x = 0, y = 0, opacidade = 1, w, h, chave } = {}) {
  if (opacidade <= 0.004) return null;
  let input = buf;
  if (opacidade < 0.996) {
    const meta = w && h ? { w, h } : await sharp(buf).metadata();
    input = await pngEm({ buf, w: w || meta.width, h: h || meta.height, chave }, opacidade);
  }
  return { input, left: Math.round(x), top: Math.round(y) };
}

/** Escurece/reduz um PNG inteiro (para transições), emendando o alfa direto. */
export async function escurecerQuadro(valor) {
  const a = Math.max(0, Math.min(1, valor));
  if (a <= 0.004) return null;
  const buf = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: a } } })
    .png()
    .toBuffer();
  return { input: buf, left: 0, top: 0 };
}
