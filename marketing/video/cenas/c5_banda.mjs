// Cena 5 (32,6 a 41,6 s): a banda. A tela real do celular e a TV do palco.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, seg, easeOutCubic, easeOutExpo, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, V, FONTE } from '../lib/cena3.mjs';

export const inicio = 32.6;
export const fim = 41.6;

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { etiqueta: 'A BANDA E O CANTOR', indice: 5 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título.
  const p1 = easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7));
  const l1 = await texto('A banda inteira', 70, { familia: FONTE, peso: '700', cor: V.texto });
  const c1 = await textoEm(l1, { x: 56, y: 150 + (1 - p1) * 16, opacidade: p1 });
  if (c1) camadas.push(c1);
  const p2 = easeOutCubic(seg(t, inicio + 0.3, inicio + 0.9));
  const l2 = await texto('na mesma página.', 70, { familia: FONTE, peso: '700', cor: V.verde });
  const c2 = await textoEm(l2, { x: 56, y: 238 + (1 - p2) * 16, opacidade: p2 });
  if (c2) camadas.push(c2);

  // Celular do músico: a captura real, em pé.
  const pCel = easeOutExpo(seg(t, inicio + 0.6, inicio + 1.4));
  if (pCel > 0.01) {
    const tw = 440;
    const th = 900;
    const telas = await telaDoPrograma({
      captura: 'celular',
      x: 52,
      y: 400,
      w: tw,
      h: th,
      janela: { fx: 0.5, fy: 0.42, fw: 0.86, fh: 0.72 },
      janelaFim: { fx: 0.5, fy: 0.5, fw: 0.78, fh: 0.66 },
      progresso: clamp(local / 7),
      raio: 26,
    });
    for (const c of await esmaecerTodas(telas, pCel)) camadas.push(c);
  }

  // TV do palco (teleprompter), a captura real.
  const pTv = easeOutExpo(seg(t, inicio + 1.0, inicio + 1.8));
  if (pTv > 0.01) {
    const tw = 500;
    const th = 420;
    const telas = await telaDoPrograma({
      captura: 'teleprompter',
      x: 520,
      y: 420,
      w: tw,
      h: th,
      janela: { fx: 0.5, fy: 0.45, fw: 0.7, fh: 0.62 },
      janelaFim: { fx: 0.5, fy: 0.55, fw: 0.62, fh: 0.56 },
      progresso: clamp(local / 7),
    });
    for (const c of await esmaecerTodas(telas, pTv)) camadas.push(c);
  }

  // QR do músico.
  const pQr = easeOutCubic(seg(t, inicio + 3.4, inicio + 4.1));
  if (pQr > 0.01) {
    const mod = 21;
    const tam = 150;
    const qx = 520;
    const qy = 880;
    const cel = tam / mod;
    const celulas = [];
    for (let yy = 0; yy < mod; yy++) {
      for (let xx = 0; xx < mod; xx++) {
        const canto = (xx < 7 && yy < 7) || (xx > 13 && yy < 7) || (xx < 7 && yy > 13);
        const v = canto ? (xx % 6 === 0 || yy % 6 === 0 || (xx > 1 && xx < 5 && yy > 1 && yy < 5)) : (xx * 7 + yy * 13 + ((xx * yy) % 11)) % 3 === 0;
        if (!v) continue;
        celulas.push(`<rect x="${(xx * cel).toFixed(1)}" y="${(yy * cel).toFixed(1)}" width="${(cel + 0.3).toFixed(1)}" height="${(cel + 0.3).toFixed(1)}" fill="${V.texto}"/>`);
      }
    }
    camadas.push({
      input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tam}" height="${tam}"><g opacity="${pQr.toFixed(3)}"><rect width="${tam}" height="${tam}" rx="10" fill="${V.painel}"/>${celulas.join('')}</g></svg>`)).png().toBuffer(),
      left: qx,
      top: qy,
    });
    const l1q = await texto('Entra pelo QR code', 28, { familia: FONTE, peso: '600', cor: V.texto });
    const cq1 = await textoEm(l1q, { x: qx + tam + 22, y: qy + 24, opacidade: pQr });
    if (cq1) camadas.push(cq1);
    const l2q = await texto('a partitura cai no celular.', 22, { familia: FONTE, peso: '500', cor: V.dim });
    const cq2 = await textoEm(l2q, { x: qx + tam + 22, y: qy + 66, opacidade: pQr });
    if (cq2) camadas.push(cq2);
    const l3q = await texto('Sem papel, sem folhear.', 22, { familia: FONTE, peso: '500', cor: V.muted });
    const cq3 = await textoEm(l3q, { x: qx + tam + 22, y: qy + 102, opacidade: pQr });
    if (cq3) camadas.push(cq3);
  }

  // As três garantias.
  const itens = ['Troca sozinha a cada música', 'Cifra, pincel e marca-texto', 'Foto do caderno em tela cheia'];
  for (let i = 0; i < itens.length; i++) {
    const ap = easeOutCubic(seg(t, inicio + 2.2 + i * 0.16, inicio + 2.7 + i * 0.16));
    if (ap <= 0.01) continue;
    const y = 1340 + i * 82;
    camadas.push({
      input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="40"><rect width="4" height="40" rx="2" fill="${V.verde}" opacity="${ap.toFixed(3)}"/></svg>`)).png().toBuffer(),
      left: 52,
      top: y + 4,
    });
    const it = await texto(itens[i], 30, { familia: FONTE, peso: '500', cor: V.texto });
    const ci = await textoEm(it, { x: 76, y, opacidade: ap });
    if (ci) camadas.push(ci);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }
  return camadas;
}
