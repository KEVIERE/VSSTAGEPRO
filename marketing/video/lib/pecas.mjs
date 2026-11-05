// Peças montadas do programa (timeline, canal do mixer, displays). Sem <text> em SVG: todo texto
// é Pango (rápido) e entra como camada própria na posição certa.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import {
  DEFS_MESA, fundoAco, trilho, rebaixo, fenda, capa, tecla, display7, vidro, aro, fita, moduloCanal,
  LCD, CREAM, LEGEND,
} from './mesa.mjs';
import { C, texto, svg } from './core.mjs';
import { textoEm } from './camadas.mjs';

const cache = new Map();

async function png(corpo, w, h, chave) {
  if (chave && cache.has(chave)) return cache.get(chave);
  const buf = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${DEFS_MESA}${corpo}</svg>`))
    .png()
    .toBuffer();
  if (chave) cache.set(chave, buf);
  return buf;
}

const rot = (txt, px, cor, peso = '600', espaco = 0.4) =>
  texto(txt, px, { familia: 'Barlow Semi Condensed', peso, cor, espaco });

/**
 * Uma faixa da timeline: fita crepe com o nome, clipes e a forma de onda.
 * Devolve { camadas: [...] } com a arte e o nome.
 */
export async function faixaTimeline({ nome, cor, w, h = 66, clipes = 3, forma = 0, selecionada = false, x = 0, y = 0 }) {
  const fitaW = Math.min(w * 0.6, 200);
  const p = [
    `<rect width="${w}" height="${h}" fill="${selecionada ? '#31363c' : '#24282d'}"/>`,
    `<rect x="0" y="0" width="${w}" height="1" fill="#fff" opacity="0.05"/>`,
    `<rect x="0" y="${h - 1}" width="${w}" height="1" fill="#000" opacity="0.55"/>`,
    fita(nome, 10, h / 2 - 9, fitaW, 18),
  ];
  const inicio = fitaW + 26;
  const espaco = (w - inicio - 10) / clipes;
  for (let i = 0; i < clipes; i++) {
    const cx = inicio + i * espaco + 3;
    const cw = espaco - 8;
    const alt = (h - 20) * (0.6 + forma * 0.32);
    p.push(`<rect x="${cx}" y="${(h - alt) / 2}" width="${cw}" height="${alt}" rx="3" fill="${cor}" opacity="0.2"/>`);
    p.push(`<rect x="${cx}" y="${(h - alt) / 2}" width="${cw}" height="${alt}" rx="3" fill="none" stroke="${cor}" stroke-width="1" opacity="0.45"/>`);
    const pontos = [];
    const n = Math.max(8, Math.round(cw / 7));
    for (let k = 0; k <= n; k++) {
      const px = cx + (cw * k) / n;
      const v = Math.sin(k * 0.85 + i * 2.1 + forma * 3.4) * 0.5 + Math.sin(k * 2.2 + i * 1.3) * 0.3;
      pontos.push(`${px.toFixed(1)},${(h / 2 + v * (alt / 2 - 4)).toFixed(1)}`);
    }
    p.push(`<polyline points="${pontos.join(' ')}" fill="none" stroke="${cor}" stroke-width="1.7" opacity="0.9"/>`);
  }
  const camadas = [{ input: await png(p.join(''), w, h), left: x, top: y }];
  const t = await rot(nome, 13, '#27231c', '700', 0.2);
  const c = await textoEm(t, { x: x + 10 + fitaW / 2, y: y + h / 2 - 8, ancora: 'middle' });
  if (c) camadas.push(c);
  return camadas;
}

/**
 * Canal do mixer: fita, medidor de LEDs, fenda, capa e visor em dB.
 * `nivel` 0..1 anima o medidor; `posicao` 0..1 é a altura do fader.
 */
export async function canalMixer({ nome, cor, w = 130, h = 560, nivel = 0.6, posicao = 0.35, capaTipo = 'band', selecionado = false, db = '-6.0', x = 0, y = 0 }) {
  const p = [];
  p.push(`<rect width="${w}" height="${h}" fill="#24282d"/>`);
  p.push(moduloCanal(0, 0, w, h, { selecionado }));
  p.push(fita(nome, 8, 16, w - 16, 17));

  const mx = 14;
  const my = 50;
  const mh = 250;
  p.push(rebaixo(mx, my, 20, mh, 2));
  const segs = 22;
  const acesos = Math.round(Math.min(1, Math.max(0, nivel)) * segs);
  for (let s = 0; s < segs; s++) {
    const lit = s < acesos;
    const corSeg = s >= segs - 2 ? '#ff4136' : s >= segs - 5 ? '#ffab1f' : cor;
    const segH = (mh - 8) / segs - 2;
    p.push(
      `<rect x="${mx + 2}" y="${(my + mh - 6 - s * ((mh - 8) / segs)).toFixed(1)}" width="16" height="${segH.toFixed(1)}" fill="${corSeg}" opacity="${lit ? 0.95 : 0.07}"/>`,
    );
  }

  const sx = w / 2 + 8;
  const sy = 50;
  const sh = 260;
  p.push(fenda(sx - 2, sy, sh));
  const capY = sy + Math.min(1, Math.max(0, posicao)) * (sh - 24);
  p.push(capa(sx - 20, capY, 40, 24, capaTipo));

  p.push(vidro(8, h - 42, w - 16, 26, { raio: 2 }));

  const camadas = [{ input: await png(p.join(''), w, h), left: x, top: y }];
  const nomeT = await rot(nome, 12, '#27231c', '700', 0.2);
  const cn = await textoEm(nomeT, { x: x + 8 + (w - 16) / 2, y: y + 18, ancora: 'middle' });
  if (cn) camadas.push(cn);
  const dbT = await rot(db, 14, LCD.dim, '600', 0);
  const cd = await textoEm(dbT, { x: x + w / 2, y: y + h - 36, ancora: 'middle' });
  if (cd) camadas.push(cd);
  return camadas;
}

/** Display grande: aro, vidro, 7 segmentos e o nome da música. */
export async function displayRestante({ w = 440, h = 306, tempo = '-3:12', nome = 'Oceanos', cor = LCD.green, x = 0, y = 0 }) {
  const p = [aro(0, 0, w, h), vidro(5, 5, w - 10, h - 10, { raio: 3 })];
  const dispH = h * 0.34;
  const unidades = String(tempo).length * 13.6 + 2;
  const dispW = unidades * (dispH / 21);
  p.push(display7(String(tempo), (w - dispW) / 2 + 6, h * 0.24, dispH, cor));

  const camadas = [{ input: await png(p.join(''), w, h), left: x, top: y }];
  const lab = await rot('RESTANTE DA MÚSICA', 12, LEGEND, '600', 1.4);
  const cl = await textoEm(lab, { x: x + w / 2, y: y + 26, ancora: 'middle' });
  if (cl) camadas.push(cl);
  const no = await rot(nome, 30, CREAM, '600', 0.2);
  const cn = await textoEm(no, { x: x + w / 2, y: y + h - 58, ancora: 'middle' });
  if (cn) camadas.push(cn);
  return camadas;
}

/** Cartão de música (Tocando / Próxima) com tom, BPM e barra de progresso. */
export async function cartaoMusica({ w = 440, h = 180, etiqueta = 'TOCANDO', nome = 'Oceanos', tom = 'D', bpm = '72', cor = LCD.green, progresso = 0, medley = null, x = 0, y = 0 }) {
  const p = [vidro(0, 0, w, h, { raio: 3 })];
  const by = h - 18;
  p.push(`<rect x="0" y="${by}" width="${w}" height="8" fill="#fff" opacity="0.06"/>`);
  p.push(`<rect x="0" y="${by}" width="${Math.round(w * Math.min(1, Math.max(0, progresso)))}" height="8" fill="${cor}"/>`);
  p.push(`<g opacity="0.9">${Array.from({ length: Math.floor(w / 7) }, (_, i) => `<rect x="${i * 7 + 5}" y="${by}" width="2" height="8" fill="#0c0e0d"/>`).join('')}</g>`);

  const camadas = [{ input: await png(p.join(''), w, h), left: x, top: y }];
  const et = await rot(etiqueta, 12, cor, '600', 1.2);
  const ce = await textoEm(et, { x: x + 14, y: y + 14 });
  if (ce) camadas.push(ce);

  if (medley) {
    const mw = 72;
    const buf = await png(`<rect x="0" y="0" width="${mw}" height="17" rx="2" fill="none" stroke="${cor}" stroke-width="1"/>`, mw, 17);
    camadas.push({ input: buf, left: x + 14 + Math.round(etiqueta.length * 8.4) + 10, top: y + 12 });
    const mt = await rot('MEDLEY', 10, cor, '700', 1.2);
    const cm = await textoEm(mt, { x: x + 14 + Math.round(etiqueta.length * 8.4) + 10 + mw / 2, y: y + 16, ancora: 'middle' });
    if (cm) camadas.push(cm);
  }

  const no = await rot(nome, 29, cor, '600', 0.1);
  const cn = await textoEm(no, { x: x + 14, y: y + h * 0.42 });
  if (cn) camadas.push(cn);

  const tomL = await rot('Tom', 12, LEGEND, '600', 0.6);
  const ct1 = await textoEm(tomL, { x: x + 14, y: y + h - 52 });
  if (ct1) camadas.push(ct1);
  const tomV = await rot(tom, 15, LCD.amber, '700', 0.4);
  const ct2 = await textoEm(tomV, { x: x + 44, y: y + h - 55 });
  if (ct2) camadas.push(ct2);
  const bpmL = await rot('BPM', 12, LEGEND, '600', 0.6);
  const cb1 = await textoEm(bpmL, { x: x + 96, y: y + h - 52 });
  if (cb1) camadas.push(cb1);
  const bpmV = await rot(bpm, 15, CREAM, '700', 0.4);
  const cb2 = await textoEm(bpmV, { x: x + 134, y: y + h - 55 });
  if (cb2) camadas.push(cb2);
  return camadas;
}

/** Trilho de cima com título. */
export async function barraTitulo({ w = 968, h = 56, titulo = 'MIXER', extra = '', x = 0, y = 0 }) {
  const camadas = [{ input: await png(trilho(0, 0, w, h), w, h), left: x, top: y }];
  const tt = await rot(titulo, 20, CREAM, '600', 0.4);
  const ct = await textoEm(tt, { x: x + 18, y: y + h / 2 - 13 });
  if (ct) camadas.push(ct);
  if (extra) {
    const ex = await rot(extra, 14, LEGEND, '600', 0.2);
    const ce = await textoEm(ex, { x: x + w - 18, y: y + h / 2 - 10, ancora: 'end' });
    if (ce) camadas.push(ce);
  }
  return camadas;
}

/** Painel de aço com borda. */
export function painel(w, h) {
  return png(fundoAco(0, 0, w, h, { raio: 4 }), w, h, `painel${w}x${h}`);
}

/** Tecla de mesa com rótulo. */
export async function teclaRotulo({ w = 200, h = 62, rotulo: textoBotao = 'PLAY', acesa = null, x = 0, y = 0 }) {
  const coresTexto = { green: '#062b12', amber: '#2b1800', red: '#2d0703', blue: '#031a33' };
  const cor = acesa ? coresTexto[acesa] : '#9c988e';
  const camadas = [{ input: await png(tecla(0, 0, w, h, { acesa, grande: true }), w, h), left: x, top: y }];
  const t = await rot(textoBotao, 21, cor, '700', 0.6);
  const c = await textoEm(t, { x: x + w / 2, y: y + h / 2 - 15, ancora: 'middle' });
  if (c) camadas.push(c);
  return camadas;
}
