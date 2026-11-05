// Cena 5 (32,6 a 41,6 s): a banda. Partitura no celular, letra na TV.
// Layout: título no topo, celular grande à esquerda, TV à direita em cima, avisos embaixo.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, svg, texto, seg, easeOutCubic, easeOutExpo, easeInOutCubic, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundo, escurecer } from '../lib/cena.mjs';

export const inicio = 32.6;
export const fim = 41.6;

const CIFRA = [
  { acorde: 'D', verso: 'Quando o mar se abriu' },
  { acorde: 'A', verso: 'e o povo atravessou' },
  { acorde: 'Bm', verso: 'a tua mão me sustentou' },
  { acorde: 'G', verso: 'e o meu medo se calou' },
];

const LETRA_TV = ['Quando o mar se abriu', 'e o povo atravessou', 'a tua mão me sustentou'];

export async function desenhar(t) {
  const camadas = await fundo(t, { etiqueta: 'A BANDA E O CANTOR', indice: 5, cor: C.cyan, haloCor: C.cyan, forca: 0.1 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título.
  const p1 = easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7));
  const tl = await titulo('A banda inteira', 74, C.cream);
  const c1 = await textoEm(tl, { x: 56, y: 168 + (1 - p1) * 16, opacidade: p1 });
  if (c1) camadas.push(c1);
  const p2 = easeOutCubic(seg(t, inicio + 0.28, inicio + 0.9));
  const tl2 = await titulo('na mesma página.', 74, C.cyan);
  const c2 = await textoEm(tl2, { x: 56, y: 254 + (1 - p2) * 16, opacidade: p2 });
  if (c2) camadas.push(c2);

  // ---------------------------------------------------------------- celular
  const pCel = easeOutExpo(seg(t, inicio + 0.55, inicio + 1.35));
  const cw = 420;
  const chh = 700;
  const cx = 56;
  const cy = 380;
  if (pCel > 0.01) {
    const corpo = `<defs>
        <linearGradient id="corpo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3f46"/><stop offset="1" stop-color="#101315"/></linearGradient>
        <clipPath id="tela"><rect x="13" y="13" width="${cw - 26}" height="${chh - 26}" rx="24"/></clipPath>
        <linearGradient id="topoCel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22262b"/><stop offset="1" stop-color="#181b1f"/></linearGradient>
      </defs>
      <g opacity="${pCel.toFixed(3)}">
      <rect x="0" y="0" width="${cw}" height="${chh}" rx="36" fill="url(#corpo)"/>
      <rect x="6" y="6" width="${cw - 12}" height="${chh - 12}" rx="31" fill="#000" opacity="0.6"/>
      <g clip-path="url(#tela)">
        <rect x="13" y="13" width="${cw - 26}" height="${chh - 26}" fill="#0c0e0d"/>
        <rect x="13" y="13" width="${cw - 26}" height="104" fill="url(#topoCel)"/>
        <rect x="13" y="116" width="${cw - 26}" height="1" fill="#000"/>
      </g></g>`;
    camadas.push({ input: await svg(corpo, cw, chh), left: cx, top: cy });

    // Topo do app.
    const topo = await texto('ÁREA DO MÚSICO', 13, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81', espaco: 1.6 });
    const ct = await textoEm(topo, { x: cx + 34, y: cy + 32, opacidade: pCel });
    if (ct) camadas.push(ct);
    const musica = await texto('Oceanos', 30, { familia: 'Barlow Semi Condensed', peso: '700', cor: C.green });
    const cm = await textoEm(musica, { x: cx + 34, y: cy + 56, opacidade: pCel });
    if (cm) camadas.push(cm);
    const meta = await texto('Tom D · BPM 72', 17, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81' });
    const cme = await textoEm(meta, { x: cx + 34, y: cy + 94, opacidade: pCel });
    if (cme) camadas.push(cme);

    // Cifra, bloco por bloco.
    for (let i = 0; i < CIFRA.length; i++) {
      const y = cy + 160 + i * 124;
      const aparece = clamp((local - 1.05 - i * 0.13) * 4, 0, 1);
      if (aparece <= 0.01) continue;
      const ac = await texto(CIFRA[i].acorde, 27, { familia: 'Menlo', peso: 'bold', cor: C.amber });
      const ca = await textoEm(ac, { x: cx + 34, y, opacidade: aparece });
      if (ca) camadas.push(ca);
      const vr = await texto(CIFRA[i].verso, 24, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#d8d3c7' });
      const cv = await textoEm(vr, { x: cx + 34, y: y + 36, opacidade: aparece });
      if (cv) camadas.push(cv);
    }
  }

  // ---------------------------------------------------------------- TV
  const pTv = easeOutExpo(seg(t, inicio + 0.9, inicio + 1.7));
  const tw = 520;
  const th = 300;
  const tx = 508;
  const ty = 400;
  if (pTv > 0.01) {
    const corpo = `<defs><linearGradient id="tv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b3037"/><stop offset="1" stop-color="#0e1113"/></linearGradient></defs>
      <g opacity="${pTv.toFixed(3)}">
      <rect x="0" y="0" width="${tw}" height="${th}" rx="10" fill="url(#tv)"/>
      <rect x="8" y="8" width="${tw - 16}" height="${th - 16}" rx="5" fill="#08090a"/>
      </g>`;
    camadas.push({ input: await svg(corpo, tw, th), left: tx, top: ty });

    // Letra: a linha no ar fica branca, as outras apagadas.
    const atual = Math.floor(local / 2.2) % LETRA_TV.length;
    for (let i = 0; i < LETRA_TV.length; i++) {
      const destaque = i === atual;
      const letra = await texto(LETRA_TV[i], destaque ? 31 : 28, {
        familia: 'Barlow Semi Condensed',
        peso: '600',
        cor: destaque ? '#ffffff' : '#57544e',
      });
      const cl = await textoEm(letra, { x: tx + tw / 2, y: ty + 66 + i * 68, opacidade: pTv, ancora: 'middle' });
      if (cl) camadas.push(cl);
    }
  }

  // Aviso do produtor na TV.
  const pAviso = easeOutCubic(seg(t, inicio + 3.6, inicio + 4.3));
  if (pAviso > 0.01) {
    const aw = 340;
    const ah = 62;
    const ax = tx + (tw - aw) / 2;
    const ay = ty + th + 26;
    camadas.push({
      input: await svg(
        `<rect x="0" y="0" width="${aw}" height="${ah}" rx="4" fill="#0c0e0d" stroke="${C.amber}" stroke-width="2" opacity="${pAviso.toFixed(3)}"/>`,
        aw,
        ah,
      ),
      left: ax,
      top: ay,
    });
    const av = await texto('ÚLTIMAS 2 MÚSICAS', 21, { familia: 'Barlow Semi Condensed', peso: '700', cor: C.amber, espaco: 1.2 });
    const ca = await textoEm(av, { x: ax + aw / 2, y: ay + 20, opacidade: pAviso, ancora: 'middle' });
    if (ca) camadas.push(ca);
  }

  // QR code de entrada do músico.
  const pQr = easeOutCubic(seg(t, inicio + 4.4, inicio + 5.1));
  if (pQr > 0.01) {
    const mod = 21;
    const tam = 140;
    const qx = 508;
    const qy = 810;
    const cel = tam / mod;
    const celulas = [];
    for (let yy = 0; yy < mod; yy++) {
      for (let xx = 0; xx < mod; xx++) {
        const canto = (xx < 7 && yy < 7) || (xx > 13 && yy < 7) || (xx < 7 && yy > 13);
        const v = canto ? (xx % 6 === 0 || yy % 6 === 0 || (xx > 1 && xx < 5 && yy > 1 && yy < 5)) : (xx * 7 + yy * 13 + ((xx * yy) % 11)) % 3 === 0;
        if (!v) continue;
        celulas.push(`<rect x="${(xx * cel).toFixed(1)}" y="${(yy * cel).toFixed(1)}" width="${(cel + 0.3).toFixed(1)}" height="${(cel + 0.3).toFixed(1)}" fill="${C.cream}"/>`);
      }
    }
    camadas.push({
      input: await svg(`<g opacity="${pQr.toFixed(3)}"><rect width="${tam}" height="${tam}" fill="#0c0e0d"/>${celulas.join('')}</g>`, tam, tam),
      left: qx,
      top: qy,
    });
    const qr1 = await texto('Entra pelo QR code', 26, { familia: 'Barlow Semi Condensed', peso: '600', cor: C.cream });
    const cq = await textoEm(qr1, { x: qx + tam + 22, y: qy + 30, opacidade: pQr });
    if (cq) camadas.push(cq);
    const qr2 = await texto('e a partitura cai no celular.', 23, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81' });
    const cq2 = await textoEm(qr2, { x: qx + tam + 22, y: qy + 66, opacidade: pQr });
    if (cq2) camadas.push(cq2);
    const qr3 = await texto('Sem papel, sem folhear.', 23, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81' });
    const cq3 = await textoEm(qr3, { x: qx + tam + 22, y: qy + 102, opacidade: pQr });
    if (cq3) camadas.push(cq3);
  }

  // Três garantias embaixo.
  const pItens = easeOutCubic(seg(t, inicio + 2.0, inicio + 2.7));
  if (pItens > 0.01) {
    const itens = ['Troca sozinha a cada música', 'Cifra, pincel e marca-texto', 'Foto do caderno em tela cheia'];
    for (let i = 0; i < itens.length; i++) {
      const y = 1160 + i * 96;
      const ap = pItens * clamp((local - 2.0 - i * 0.14) * 4, 0, 1);
      if (ap <= 0.01) continue;
      camadas.push({
        input: await svg(`<rect width="4" height="44" fill="${C.cyan}" opacity="${ap.toFixed(3)}"/>`, 4, 44),
        left: 56,
        top: y + 4,
      });
      const it = await texto(itens[i], 38, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#d8d3c7' });
      const ci = await textoEm(it, { x: 82, y, opacidade: ap });
      if (ci) camadas.push(ci);
    }
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }

  return camadas;
}
