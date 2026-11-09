// Cena 4 (22,6 a 32,6 s): Modo Show no palco. A tela real, com a câmera indo no display
// do restante, nos cartões de Tocando/Próxima e nos modos de condução.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, seg, easeOutCubic, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, V, FONTE } from '../lib/cena3.mjs';

export const inicio = 22.6;
export const fim = 32.6;

// Pontos de interesse na captura do Modo Show (em fração da imagem).
// A captura 3-modo-show.png é o painel: display grande em cima, cartões no meio.
const PLANOS = [
  { janela: { fx: 0.5, fy: 0.42, fw: 1.0, fh: 1.0 }, legenda: 'O show inteiro numa tela' },
  { janela: { fx: 0.42, fy: 0.3, fw: 0.55, fh: 0.55 }, legenda: 'Quanto falta para acabar' },
  { janela: { fx: 0.55, fy: 0.55, fw: 0.6, fh: 0.6 }, legenda: 'Tocando e próxima' },
  { janela: { fx: 0.5, fy: 0.75, fw: 0.75, fh: 0.55 }, legenda: 'Contínuo, por bloco ou uma a uma' },
];

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { etiqueta: 'MODO SHOW', indice: 4 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);
  const dur = fim - inicio;

  // Título.
  const p1 = easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7));
  const l1 = await texto('Todo o show', 72, { familia: FONTE, peso: '700', cor: V.texto });
  const c1 = await textoEm(l1, { x: 56, y: 150 + (1 - p1) * 16, opacidade: p1 });
  if (c1) camadas.push(c1);

  const p2 = easeOutCubic(seg(t, inicio + 0.3, inicio + 0.9));
  const l2 = await texto('em uma única tela.', 72, { familia: FONTE, peso: '700', cor: V.verde });
  const c2 = await textoEm(l2, { x: 56, y: 240 + (1 - p2) * 16, opacidade: p2 });
  if (c2) camadas.push(c2);

  // A tela real, com a câmera passando por quatro enquadramentos.
  const pTela = easeOutCubic(seg(t, inicio + 0.5, inicio + 1.2));
  if (pTela > 0.01) {
    // qual trecho está no ar e quanto dele já passou
    const porPlano = (dur - 1.4) / PLANOS.length;
    const idx = clamp(Math.floor((local - 0.6) / porPlano), 0, PLANOS.length - 1);
    const dentro = clamp(((local - 0.6) - idx * porPlano) / porPlano);
    const atual = PLANOS[idx];
    const proximo = PLANOS[Math.min(PLANOS.length - 1, idx + 1)];

    const tw = 992;
    const th = 860;
    const telas = await telaDoPrograma({
      captura: 'modoShow',
      x: 44,
      y: 400,
      w: tw,
      h: th,
      janela: atual.janela,
      janelaFim: proximo.janela,
      // a câmera só se move na segunda metade do trecho (a primeira mostra parada)
      progresso: clamp((dentro - 0.35) / 0.65),
    });
    for (const c of await esmaecerTodas(telas, pTela)) camadas.push(c);

    // A legenda do enquadramento no ar.
    const pLeg = easeOutCubic(seg(t, inicio + 1.2, inicio + 1.8));
    if (pLeg > 0.01) {
      const leg = await texto(atual.legenda, 30, { familia: FONTE, peso: '600', cor: V.texto });
      const cl = await textoEm(leg, { x: 44, y: 1300, opacidade: pLeg });
      if (cl) camadas.push(cl);
      const barra = await sharp(
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="36"><rect width="4" height="36" rx="2" fill="${V.verde}"/></svg>`),
      )
        .png()
        .toBuffer();
      camadas.push({ input: barra, left: 26, top: 1304 });
    }
  }

  // Os quatro pontos que o Modo Show resolve.
  const itens = [
    'O que está tocando, aceso',
    'O que vem depois, antes da hora',
    'Quanto falta para acabar',
    'Trava de segurança contra corte errado',
  ];
  for (let i = 0; i < itens.length; i++) {
    const ap = easeOutCubic(seg(t, inicio + 3.4 + i * 0.16, inicio + 3.9 + i * 0.16));
    if (ap <= 0.01) continue;
    const y = 1380 + i * 78;
    const bol = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="4" fill="${V.verde}" opacity="${ap.toFixed(2)}"/></svg>`),
    )
      .png()
      .toBuffer();
    camadas.push({ input: bol, left: 44, top: y + 12 });
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
