// Cena 2 (4,6 a 12,4 s): o problema. Projetos imensos, papel, tela cheia de botões pequenos.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, svg, texto, seg, easeOutCubic, easeOutExpo, easeInOutCubic } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundo, escurecer, bloco, divisor } from '../lib/cena.mjs';
import { fundoAco, trilho, fita, DEFS_MESA, LCD, vidro, rotulo } from '../lib/mesa.mjs';

export const inicio = 4.6;
export const fim = 12.4;

export async function desenhar(t) {
  const camadas = await fundo(t, { etiqueta: 'O PROBLEMA', indice: 2, cor: C.red, haloCor: C.red, forca: 0.1 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Uma timeline de estúdio: dezenas de faixas apertadas, rolando sem fim (o "projeto imenso").
  const painelW = 968;
  const painelH = 760;
  const painelX = 56;
  const painelY = 620;
  camadas.push({
    input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${painelW}" height="${painelH}">${DEFS_MESA}${fundoAco(0, 0, painelW, painelH, { raio: 4 })}${trilho(0, 0, painelW, 40)}</svg>`))
      .png()
      .toBuffer(),
    left: painelX,
    top: painelY,
  });

  const rolagem = Math.round((local * 46) % 200);
  const alt = 21;
  const faixas = 34;
  const nomes = ['Voz', 'Voz dobro', 'Guia', 'Guia 2', 'Bateria', 'Bateria room', 'Kick', 'Snare', 'Hihat', 'Baixo', 'Baixo DI', 'Guitarra 1', 'Guitarra 2', 'Violão', 'Teclado', 'Pad', 'Strings', 'Click', 'Maestro', 'Timecode', 'FX 1', 'FX 2', 'Voz 3', 'Coro', 'Coro L', 'Coro R', 'Brass', 'Organ', 'Solo', 'Sax', 'Perc', 'Shaker', 'Referência', 'Print'];
  const linhas = [];
  for (let i = 0; i < faixas; i++) {
    const y = 40 + i * alt - rolagem;
    if (y < 30 || y > painelH - 20) continue;
    const nome = nomes[i % nomes.length];
    linhas.push(`<rect x="0" y="${y}" width="${painelW}" height="${alt}" fill="${i % 2 ? '#24282d' : '#212429'}"/>`);
    linhas.push(`<rect x="0" y="${y + alt - 1}" width="${painelW}" height="1" fill="#000" opacity="0.45"/>`);
    linhas.push(`<rect x="0" y="${y}" width="150" height="${alt}" fill="#1d2024"/>`);
    linhas.push(`<rect x="0" y="${y}" width="3" height="${alt}" fill="${['#3ee26e', '#ffab1f', '#64d2ff', '#b79cff', '#ff7a59'][i % 5]}" opacity="0.5"/>`);
    // clipes apertados
    const cw = 60 + ((i * 37) % 190);
    linhas.push(`<rect x="${160 + ((i * 53) % 240)}" y="${y + 5}" width="${cw}" height="${alt - 10}" rx="2" fill="${['#3ee26e', '#ffab1f', '#64d2ff', '#b79cff', '#ff7a59'][i % 5]}" opacity="0.2"/>`);
    linhas.push(`<rect x="${420 + ((i * 31) % 200)}" y="${y + 5}" width="${80 + ((i * 61) % 240)}" height="${alt - 10}" rx="2" fill="${['#3ee26e', '#ffab1f', '#64d2ff', '#b79cff', '#ff7a59'][(i + 2) % 5]}" opacity="0.16"/>`);
  }
  camadas.push({
    input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${painelW}" height="${painelH}">${linhas.join('')}</svg>`))
      .png()
      .toBuffer(),
    left: painelX,
    top: painelY,
  });

  // Textos das faixas (Pango, para não custar 1 s por frame).
  const nomesVisiveis = [];
  for (let i = 0; i < faixas; i++) {
    const y = 40 + i * alt - rolagem;
    if (y < 30 || y > painelH - 24) continue;
    nomesVisiveis.push({ nome: nomes[i % nomes.length], y });
  }
  for (const nv of nomesVisiveis.slice(0, 34)) {
    const tt = await texto(nv.nome, 10.5, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#9c988e' });
    const c = await textoEm(tt, { x: painelX + 12, y: painelY + nv.y + 5 });
    if (c) camadas.push(c);
  }

  // Cursor, papel e avisos: o estresse.
  const pTit = seg(t, inicio + 0.15, inicio + 1.1);
  if (pTit > 0.01) {
    const tl = await titulo('Trocar de música', 88, C.cream);
    const c = await textoEm(tl, { x: 56, y: 240, opacidade: easeOutCubic(pTit) });
    if (c) camadas.push(c);
    const tl2 = await titulo('não pode ser um sufoco.', 88, C.cream);
    const c2 = await textoEm(tl2, { x: 56, y: 336, opacidade: easeOutCubic(pT2(seg(t, inicio + 0.3, inicio + 1.25))) });
    if (c2) camadas.push(c2);
    const ap = await apoio('Projetos imensos, papel impresso, botões pequenos.', 34, C.dim);
    const c3 = await textoEm(ap, { x: 56, y: 470, opacidade: easeOutCubic(seg(t, inicio + 0.8, inicio + 1.5)) });
    if (c3) camadas.push(c3);
  }

  // Um marcador vermelho de "erro" piscando sobre a timeline.
  const pisca = Math.sin(local * 7) > 0.2 ? 1 : 0.35;
  const aviso = await sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="470" height="58"><rect x="0" y="0" width="470" height="58" rx="3" fill="#0c0e0d" stroke="${C.red}" stroke-width="2" opacity="0.95"/>
       <rect x="12" y="20" width="18" height="18" rx="9" fill="${C.red}" opacity="${pisca.toFixed(2)}"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
  const pAviso = easeOutCubic(seg(t, inicio + 1.6, inicio + 2.2));
  if (pAviso > 0.01) {
    const layer = await sharp(aviso)
      .composite([{ input: await sharp({ create: { width: 470, height: 58, channels: 4, background: { r: 0, g: 0, b: 0, alpha: pAviso } } }).png().toBuffer(), blend: 'dest-in' }])
      .png()
      .toBuffer();
    camadas.push({ input: layer, left: 56, top: 1480 });
    const av = await apoio('Música errada no meio do show', 26, C.red);
    const ca = await textoEm(av, { x: 96, y: 1480 + 14, opacidade: pAviso });
    if (ca) camadas.push(ca);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }

  return camadas;
}

const pT2 = (p) => p;
