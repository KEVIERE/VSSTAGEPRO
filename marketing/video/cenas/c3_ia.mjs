// Cena 3 (12,4 a 22,6 s): a IA monta o VS. Uma música pronta entra e vira sete faixas na grade.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, svg, texto, seg, easeOutCubic, easeOutQuart, easeOutExpo, easeInOutCubic, clamp } from '../lib/core.mjs';
import { textoEm, imagemEm } from '../lib/camadas.mjs';
import { fundo, escurecer } from '../lib/cena.mjs';
import { faixaTimeline, painel } from '../lib/pecas.mjs';
import { STEMS } from '../lib/core.mjs';
import { DEFS_MESA, LCD, trilho, display7, rotulo } from '../lib/mesa.mjs';

export const inicio = 12.4;
export const fim = 22.6;

const CENA_CORES = ['#e7e2d6', '#3ee26e', '#ff7a59', '#ffab1f', '#64d2ff', '#b79cff', '#a7a297'];

export async function desenhar(t) {
  const camadas = await fundo(t, { etiqueta: 'INTELIGÊNCIA ARTIFICIAL', indice: 3, cor: C.green, haloCor: C.green, forca: 0.1 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título.
  const pTit = seg(t, inicio + 0.1, inicio + 1.0);
  if (pTit > 0.01) {
    for (const [i, linha] of ['Uma música pronta', 'entra. Sete faixas', 'saem prontas.'].entries()) {
      const tl = await titulo(linha, 74, i === 2 ? C.green : C.cream);
      const p = easeOutCubic(seg(t, inicio + 0.1 + i * 0.22, inicio + 0.8 + i * 0.22));
      const c = await textoEm(tl, { x: 56, y: 210 + i * 84 + (1 - p) * 18, opacidade: p });
      if (c) camadas.push(c);
    }
  }

  // O arquivo de música entrando (a "música pronta").
  const painelX = 56;
  const painelY = 640;
  const painelW = 968;
  const painelAlt = 780;

  camadas.push({ input: await painel(painelW, painelAlt), left: painelX, top: painelY });
  camadas.push({
    input: await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${painelW}" height="44">${trilho(0, 0, painelW, 44)}</svg>`),
    )
      .png()
      .toBuffer(),
    left: painelX,
    top: painelY,
  });

  const cab = await texto('Oceanos — master.wav', 18, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#e7e2d6' });
  const c1 = await textoEm(cab, { x: painelX + 16, y: painelY + 10 });
  if (c1) camadas.push(c1);
  const info = await texto('4:52 · 48 kHz · estéreo', 14, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81' });
  const c2 = await textoEm(info, { x: painelX + painelW - 16, y: painelY + 14, ancora: 'end' });
  if (c2) camadas.push(c2);

  // As sete faixas entrando uma a uma, de baixo para cima, com o nome certo.
  const baseY = painelY + 64;
  for (let i = 0; i < STEMS.length; i++) {
    const atraso = inicio + 1.4 + i * 0.52;
    const p = easeOutQuart(seg(t, atraso, atraso + 0.75));
    if (p <= 0.01) continue;
    const y = baseY + i * 96 + (1 - p) * 46;
    const camadasFaixa = await faixaTimeline({
      nome: STEMS[i].nome,
      cor: CENA_CORES[i],
      w: painelW - 32,
      h: 88,
      clipes: 3,
      forma: (i * 0.27) % 1,
      selecionada: i === 1,
      x: painelX + 16,
      y: Math.round(y),
    });
    // a faixa entra com opacidade (o alfa é emendado direto no PNG)
    const camada = await imagemEm(
      camadasFaixa[0].input,
      { x: camadasFaixa[0].left, y: camadasFaixa[0].top, opacidade: p, w: painelW - 32, h: 88 },
    );
    if (camada) camadas.push(camada);
    if (p > 0.4) {
      for (const c of camadasFaixa.slice(1)) camadas.push(c);
    }
  }

  // Etiquetas de IA: BPM detectado e click criado, aparecendo como leituras de mesa.
  const pBpm = easeOutCubic(seg(t, inicio + 5.4, inicio + 6.2));
  if (pBpm > 0.01) {
    const bw = 300;
    const bh = 96;
    const bx = painelX + painelW - bw - 24;
    const by = painelY - bh - 26;
    const corpo = `<defs><linearGradient id="aroB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f46"/><stop offset="1" stop-color="#1a1d21"/></linearGradient></defs>
      <g opacity="${pBpm.toFixed(3)}"><rect width="${bw}" height="${bh}" rx="6" fill="url(#aroB)"/>
      <rect x="5" y="5" width="${bw - 10}" height="${bh - 10}" rx="3" fill="#0c0e0d"/>
      ${display7('72', 40, 26, 48, LCD.green)}</g>`;
    camadas.push({ input: await svg(corpo, bw, bh), left: bx, top: by });
    const lb = await texto('BPM DETECTADO', 13, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81', espaco: 1.4 });
    const cl = await textoEm(lb, { x: bx + bw / 2, y: by + 12, opacidade: pBpm, ancora: 'middle' });
    if (cl) camadas.push(cl);
  }

  const pClick = easeOutCubic(seg(t, inicio + 6.6, inicio + 7.4));
  if (pClick > 0.01) {
    const et = await texto('CLICK', 15, { familia: 'Barlow Semi Condensed', peso: '700', cor: '#062b12' });
    const cw = 132;
    const buf = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="40" rx="3"><rect width="${cw}" height="40" rx="3" fill="${C.green}" opacity="${pClick.toFixed(3)}"/></svg>`),
    )
      .png()
      .toBuffer();
    camadas.push({ input: buf, left: painelX + 24, top: painelY + painelAlt - 62 });
    const c = await textoEm(et, { x: painelX + 24 + cw / 2, y: painelY + painelAlt - 54, opacidade: pClick, ancora: 'middle' });
    if (c) camadas.push(c);
  }

  // Linha do playhead correndo pela grade.
  const pPlay = clamp((t - inicio - 1.2) / (fim - inicio - 1.4));
  if (pPlay > 0.01 && pPlay < 1) {
    camadas.push({
      input: await svg(`<rect width="2" height="${painelAlt - 50}" fill="${C.green}" opacity="0.75"/>`, 2, painelAlt - 50),
      left: painelX + 190 + Math.round(pPlay * (painelW - 260)),
      top: painelY + 48,
    });
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }

  return camadas;
}
