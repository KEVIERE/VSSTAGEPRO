// Cena 4 (22,6 a 32,6 s): Modo Show. Displays grandes: tocando, próxima e o relógio.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, svg, texto, seg, easeOutCubic, easeOutExpo, easeInOutCubic, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundo, escurecer } from '../lib/cena.mjs';
import { displayRestante, cartaoMusica, teclaRotulo, painel } from '../lib/pecas.mjs';
import { LCD, trilho } from '../lib/mesa.mjs';

export const inicio = 22.6;
export const fim = 32.6;

export async function desenhar(t) {
  const camadas = await fundo(t, { etiqueta: 'MODO SHOW', indice: 4, cor: C.green, haloCor: C.green, forca: 0.12 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título.
  const tl = await titulo('Todo o show', 84, C.cream);
  const c1 = await textoEm(tl, { x: 56, y: 200 + (1 - easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7))) * 20, opacidade: easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7)) });
  if (c1) camadas.push(c1);
  const tl2 = await titulo('em uma única tela.', 84, C.green);
  const c2 = await textoEm(tl2, { x: 56, y: 296 + (1 - easeOutCubic(seg(t, inicio + 0.3, inicio + 0.9))) * 20, opacidade: easeOutCubic(seg(t, inicio + 0.3, inicio + 0.9)) });
  if (c2) camadas.push(c2);

  // Painel do Modo Show (o de verdade, na proporção do programa).
  const px = 40;
  const py = 470;
  const pw = 1000;
  const ph = 1180;

  camadas.push({ input: await painel(pw, ph), left: px, top: py });
  camadas.push({
    input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="52">${trilho(0, 0, pw, 52)}</svg>`)).png().toBuffer(),
    left: px,
    top: py,
  });

  // Lâmpada "no ar" piscando devagar.
  const lamp = Math.sin(local * 3) > -0.3 ? 1 : 0.35;
  camadas.push({
    input: await svg(`<circle cx="6" cy="6" r="6" fill="${C.red}" opacity="${lamp}"/>`, 12, 12),
    left: px + 18,
    top: py + 20,
  });
  const tm = await texto('Modo show', 21, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#e7e2d6' });
  const c3 = await textoEm(tm, { x: px + 34, y: py + 13 });
  if (c3) camadas.push(c3);

  // Relógio do show, andando (mm:ss).
  const segundos = Math.floor(local * 1.6);
  const relogio = `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;
  const tr = await texto(relogio, 20, { familia: 'Menlo', peso: 'bold', cor: C.amber });
  const c4 = await textoEm(tr, { x: px + pw - 18, y: py + 14, ancora: 'end' });
  if (c4) camadas.push(c4);

  // Display do restante (conta para baixo).
  const restante = Math.max(0, 192 - Math.floor(local * 4));
  const tempoTxt = `-${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, '0')}`;
  const pDisp = easeOutCubic(seg(t, inicio + 0.55, inicio + 1.25));
  if (pDisp > 0.01) {
    const camadasDisp = await displayRestante({
      w: pw - 60,
      h: 320,
      tempo: restante <= 15 ? tempoTxt : tempoTxt,
      nome: 'Oceanos',
      cor: restante <= 15 ? LCD.red : LCD.green,
      x: px + 30,
      y: py + 80,
    });
    for (const c of camadasDisp) camadas.push(await fade(c, pDisp));
  }

  // Cartões Tocando e Próxima.
  const pCards = easeOutCubic(seg(t, inicio + 1.5, inicio + 2.2));
  if (pCards > 0.01) {
    const cTocando = await cartaoMusica({
      w: pw - 60,
      h: 190,
      etiqueta: 'TOCANDO',
      nome: 'Oceanos',
      tom: 'D',
      bpm: '72',
      cor: LCD.green,
      progresso: clamp(local / 14),
      x: px + 30,
      y: py + 430,
    });
    for (const c of cTocando) camadas.push(await fade(c, pCards));

    const cProx = await cartaoMusica({
      w: pw - 60,
      h: 190,
      etiqueta: 'PRÓXIMA',
      nome: 'Nada Além do Sangue',
      tom: 'B',
      bpm: '68',
      cor: LCD.amber,
      progresso: 0,
      x: px + 30,
      y: py + 646,
    });
    for (const c of cProx) camadas.push(await fade(c, pCards));
  }

  // Três modos de conduzir, com a trava de segurança.
  const pTeclas = easeOutCubic(seg(t, inicio + 2.4, inicio + 3.1));
  if (pTeclas > 0.01) {
    const larguras = [300, 300, 300];
    const rotulos = ['CONTÍNUO', 'POR BLOCO', 'UMA A UMA'];
    const acesa = ['green', null, null];
    let x = px + 30;
    for (let i = 0; i < 3; i++) {
      const camadasTecla = await teclaRotulo({ w: larguras[i], h: 70, rotulo: rotulos[i], acesa: acesa[i], x, y: py + 880 });
      for (const c of camadasTecla) camadas.push(await fade(c, pTeclas));
      x += larguras[i] + 14;
    }
    const trava = await teclaRotulo({ w: 952, h: 70, rotulo: 'TRAVA DE SEGURANÇA LIGADA', acesa: 'amber', x: px + 30, y: py + 970 });
    for (const c of trava) camadas.push(await fade(c, pTeclas));
  }

  // Nota: nada de internet.
  const pNota = easeOutCubic(seg(t, inicio + 3.4, inicio + 4.1));
  if (pNota > 0.01) {
    const nota = await apoio('Funciona sem internet, pela rede do palco.', 30, C.dim);
    const c = await textoEm(nota, { x: W / 2, y: py + ph - 96, opacidade: pNota, ancora: 'middle' });
    if (c) camadas.push(c);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }

  return camadas;
}

/** Aplica opacidade numa camada pronta (para cuidar da entrada dos blocos). */
async function fade(camada, p) {
  if (!camada || p >= 0.995) return camada;
  const meta = await sharp(camada.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = Math.max(0, Math.min(1, p));
  for (let k = 3; k < meta.data.length; k += 4) meta.data[k] = Math.round(meta.data[k] * a);
  const buf = await sharp(meta.data, { raw: { width: meta.info.width, height: meta.info.height, channels: 4 } }).png().toBuffer();
  return { input: buf, left: camada.left, top: camada.top };
}
