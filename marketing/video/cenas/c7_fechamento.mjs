// Cena 7 (51,4 a 60 s): fechamento. A tela real dos aparelhos, a promessa e o endereço.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, seg, easeOutCubic, easeOutExpo, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm, textoRevelado } from '../lib/camadas.mjs';
import { logo } from '../lib/assets.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, V, FONTE, FONTE_MONO } from '../lib/cena3.mjs';

export const inicio = 51.4;
export const fim = 60;

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { rodape: false });
  const local = t - inicio;

  // Logo.
  const pLogo = easeOutExpo(seg(t, inicio + 0.1, inicio + 0.9));
  if (pLogo > 0.01) {
    const lado = Math.round(150 * (0.9 + 0.1 * pLogo));
    const logoBuf = await logo(150);
    const red = await sharp(logoBuf).resize(lado, lado).png().toBuffer();
    const { data, info } = await sharp(red).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let k = 3; k < data.length; k += 4) data[k] = Math.round(data[k] * pLogo);
    const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    camadas.push({ input: buf, left: Math.round(W / 2 - lado / 2), top: Math.round(140 - lado / 2) });
  }

  const pMarca = seg(t, inicio + 0.4, inicio + 1.0);
  const marca = await texto('VS Stage Pro', 76, { familia: FONTE, peso: '700', cor: V.texto });
  const cM = await textoRevelado(marca, {
    x: W / 2, y: 240 + (1 - easeOutCubic(pMarca)) * 16, progresso: easeOutCubic(pMarca), ancora: 'middle',
  });
  if (cM) camadas.push(cM);

  // A tela real dos aparelhos: a banda toda conectada.
  const pTela = easeOutCubic(seg(t, inicio + 0.7, inicio + 1.5));
  if (pTela > 0.01) {
    const telas = await telaDoPrograma({
      captura: 'aparelhos',
      x: 60,
      y: 360,
      w: 960,
      h: 420,
      janela: { fx: 0.5, fy: 0.5, fw: 0.96, fh: 0.96 },
      janelaFim: { fx: 0.5, fy: 0.5, fw: 1.0, fh: 1.0 },
      progresso: clamp(local / 6),
      raio: 12,
    });
    for (const c of await esmaecerTodas(telas, pTela)) camadas.push(c);
  }

  // A promessa.
  const p1 = easeOutCubic(seg(t, inicio + 1.6, inicio + 2.2));
  const l1 = await texto('Faça o seu próximo show com', 32, { familia: FONTE, peso: '500', cor: V.dim });
  const c1 = await textoEm(l1, { x: W / 2, y: 830 + (1 - p1) * 12, opacidade: p1, ancora: 'middle' });
  if (c1) camadas.push(c1);
  const p2 = easeOutCubic(seg(t, inicio + 1.8, inicio + 2.4));
  const l2 = await texto('a banda inteira na mesma página.', 42, { familia: FONTE, peso: '700', cor: V.verde });
  const c2 = await textoEm(l2, { x: W / 2, y: 888 + (1 - p2) * 12, opacidade: p2, ancora: 'middle' });
  if (c2) camadas.push(c2);

  // Cartão das 48 horas.
  const pCartao = easeOutExpo(seg(t, inicio + 2.4, inicio + 3.0));
  if (pCartao > 0.01) {
    const cw = 700;
    const chh = 300;
    const cx = (W - cw) / 2;
    const cy = 1010 + (1 - pCartao) * 30;
    const corpo = `<rect width="${cw}" height="${chh}" rx="18" fill="${V.painel}" stroke="${V.borda}"/>
      <rect x="34" y="198" width="${cw - 68}" height="1" fill="${V.borda}"/>`;
    camadas.push({ input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chh}">${corpo}</svg>`)).png().toBuffer(), left: Math.round(cx), top: Math.round(cy) });

    const num = await texto('48', 130, { familia: FONTE_MONO, peso: '700', cor: V.verde });
    const cn = await textoEm(num, { x: cx + 40, y: cy + 32, opacidade: pCartao });
    if (cn) camadas.push(cn);

    const horas = await texto('HORAS', 36, { familia: FONTE, peso: '700', cor: V.texto, espaco: 3 });
    const ch2 = await textoEm(horas, { x: cx + 300, y: cy + 74, opacidade: pCartao });
    if (ch2) camadas.push(ch2);
    const gratis = await texto('DE TESTE GRÁTIS', 23, { familia: FONTE, peso: '600', cor: V.verde, espaco: 2 });
    const cg = await textoEm(gratis, { x: cx + 300, y: cy + 124, opacidade: pCartao });
    if (cg) camadas.push(cg);
    const sem = await texto('sem cartão de crédito', 21, { familia: FONTE, peso: '500', cor: V.muted });
    const cs = await textoEm(sem, { x: cx + 36, y: cy + 220, opacidade: pCartao });
    if (cs) camadas.push(cs);
  }

  // Endereço.
  const pEnd = easeOutCubic(seg(t, inicio + 3.2, inicio + 3.8));
  if (pEnd > 0.01) {
    const end = await texto('vsstagepro.com.br', 46, { familia: FONTE, peso: '600', cor: V.texto });
    const ce = await textoEm(end, { x: W / 2, y: 1440, opacidade: pEnd, ancora: 'middle' });
    if (ce) camadas.push(ce);
    const lw = Math.round(400 * pEnd);
    const buf = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, lw)}" height="3"><rect width="${lw}" height="3" rx="1.5" fill="${V.verde}"/></svg>`)).png().toBuffer();
    camadas.push({ input: buf, left: Math.round(W / 2 - lw / 2), top: 1508 });
  }

  const fimFade = seg(t, fim - 0.6, fim);
  if (fimFade > 0) {
    const c = await escurecer(easeInOutCubic(fimFade));
    if (c) camadas.push(c);
  }
  return camadas;
}
