// Cena 6 (41,6 a 51,4 s): o mixer. Faders, medidores, anti-clip e o master com IA.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, svg, texto, seg, easeOutCubic, easeOutExpo, easeInOutCubic, clamp, ruido } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundo, escurecer } from '../lib/cena.mjs';
import { canalMixer, barraTitulo, painel, teclaRotulo } from '../lib/pecas.mjs';
import { LCD } from '../lib/mesa.mjs';
import { STEMS } from '../lib/core.mjs';

export const inicio = 41.6;
export const fim = 51.4;

const CORES = ['#e7e2d6', '#3ee26e', '#ff7a59', '#ffab1f', '#64d2ff', '#b79cff', '#a7a297'];

export async function desenhar(t) {
  const camadas = await fundo(t, { etiqueta: 'MESA DE SOM', indice: 6, cor: C.amber, haloCor: C.amber, forca: 0.1 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título.
  const p1 = easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7));
  const tl = await titulo('Uma mesa de som', 76, C.cream);
  const c1 = await textoEm(tl, { x: 56, y: 172 + (1 - p1) * 16, opacidade: p1 });
  if (c1) camadas.push(c1);
  const p2 = easeOutCubic(seg(t, inicio + 0.28, inicio + 0.9));
  const tl2 = await titulo('de verdade.', 76, C.amber);
  const c2 = await textoEm(tl2, { x: 56, y: 260 + (1 - p2) * 16, opacidade: p2 });
  if (c2) camadas.push(c2);

  // Painel do mixer.
  const px = 40;
  const py = 400;
  const pw = 1000;
  const ph = 900;
  camadas.push({ input: await painel(pw, ph), left: px, top: py });

  const pTrilho = easeOutCubic(seg(t, inicio + 0.5, inicio + 1.1));
  if (pTrilho > 0.01) {
    const trilhos = await barraTitulo({ w: pw, h: 58, titulo: 'MIXER', extra: '7 canais · master', x: px, y: py });
    for (const c of trilhos) {
      camadas.push(await fade(c, pTrilho));
    }
  }

  // Sete canais, entrando da esquerda para a direita.
  const canalW = 128;
  const canalH = 800;
  for (let i = 0; i < STEMS.length; i++) {
    const p = easeOutExpo(seg(t, inicio + 0.8 + i * 0.1, inicio + 1.5 + i * 0.1));
    if (p <= 0.01) continue;

    // o medidor pulsa como áudio de verdade
    const base = 0.25 + i * 0.06;
    const pulso = Math.abs(Math.sin(t * 3.1 + i * 1.7)) * 0.35 + Math.abs(Math.sin(t * 7.3 + i)) * 0.12;
    const nivel = clamp(base + pulso);

    const camadasCanal = await canalMixer({
      nome: STEMS[i].nome,
      cor: CORES[i],
      w: canalW,
      h: canalH,
      nivel,
      posicao: 0.24 + ((i * 13) % 40) / 200,
      capaTipo: i === 1 || i === 0 ? 'cue' : 'band',
      selecionado: i === 1,
      db: `-${(3 + i * 1.4).toFixed(1)}`,
      x: px + 14 + i * (canalW + 6),
      y: py + 72 + Math.round((1 - p) * 40),
    });
    for (const c of camadasCanal) camadas.push(await fade(c, p));
  }

  // Master à direita: capa vermelha e o botão IGUALAR (a IA que nivela os VS).
  const pMaster = easeOutExpo(seg(t, inicio + 1.8, inicio + 2.4));
  if (pMaster > 0.01) {
    const mx = px + 14 + 7 * (canalW + 6);
    const camadasMaster = await canalMixer({
      nome: 'MASTER',
      cor: '#ff4136',
      w: 128,
      h: canalH,
      nivel: 0.55 + Math.abs(Math.sin(t * 2.4)) * 0.25,
      posicao: 0.5,
      capaTipo: 'master',
      db: '-0.1',
      x: mx,
      y: py + 72,
    });
    for (const c of camadasMaster) camadas.push(await fade(c, pMaster));

    const igualar = await teclaRotulo({ w: 128, h: 52, rotulo: 'IGUALAR', acesa: 'amber', x: mx, y: py + 72 + canalH - 90 });
    for (const c of igualar) camadas.push(await fade(c, pMaster));
  }

  // Etiquetas do que o mixer faz, aparecendo embaixo.
  const itens = [
    { titulo: 'Anti-clip em cada canal', texto: 'Não passa de −0,1 dBFS nem no pico.' },
    { titulo: 'LR mágico', texto: 'Click e guia num lado, a banda no outro.' },
    { titulo: 'Master com IA', texto: 'Um toque e todos os VS no mesmo nível.' },
  ];
  for (let i = 0; i < itens.length; i++) {
    const ap = easeOutCubic(seg(t, inicio + 3.0 + i * 0.28, inicio + 3.6 + i * 0.28));
    if (ap <= 0.01) continue;
    const y = 1340 + i * 128;
    const cor = [C.amber, C.cyan, C.green][i];
    camadas.push({
      input: await svg(`<rect width="4" height="76" fill="${cor}" opacity="${ap.toFixed(3)}"/>`, 4, 76),
      left: 56,
      top: y + 4,
    });
    const ti = await texto(itens[i].titulo, 36, { familia: 'Barlow Semi Condensed', peso: '700', cor: '#e7e2d6' });
    const ct = await textoEm(ti, { x: 84, y, opacidade: ap });
    if (ct) camadas.push(ct);
    const tx = await texto(itens[i].texto, 28, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#8f8b81' });
    const cx = await textoEm(tx, { x: 84, y: y + 42, opacidade: ap });
    if (cx) camadas.push(cx);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }

  return camadas;
}

async function fade(camada, p) {
  if (!camada || p >= 0.995) return camada;
  const { data, info } = await sharp(camada.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = Math.max(0, Math.min(1, p));
  for (let k = 3; k < data.length; k += 4) data[k] = Math.round(data[k] * a);
  const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { input: buf, left: camada.left, top: camada.top };
}
