// Cena 2 (4,6 a 12,4 s): o problema. A tela lotada de faixas, com a câmera passeando.
import { W, H, seg, easeOutCubic, easeOutQuart, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, bloco, V, FONTE } from '../lib/cena3.mjs';

export const inicio = 4.6;
export const fim = 12.4;

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { etiqueta: 'O PROBLEMA', indice: 2 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título: duas linhas, cada uma no seu lugar.
  const p1 = easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7));
  const l1 = await texto('Trocar de música', 74, { familia: FONTE, peso: '700', cor: V.texto });
  const c1 = await textoEm(l1, { x: 56, y: 170 + (1 - p1) * 16, opacidade: p1 });
  if (c1) camadas.push(c1);

  const p2 = easeOutCubic(seg(t, inicio + 0.28, inicio + 0.9));
  const l2 = await texto('não pode ser um sufoco.', 74, { familia: FONTE, peso: '700', cor: V.vermelho });
  const c2 = await textoEm(l2, { x: 56, y: 262 + (1 - p2) * 16, opacidade: p2 });
  if (c2) camadas.push(c2);

  const pApoio = easeOutCubic(seg(t, inicio + 0.7, inicio + 1.3));
  const apoio = await texto('Projetos imensos, papel impresso, botões pequenos.', 28, { familia: FONTE, peso: '500', cor: V.dim });
  const cAp = await textoEm(apoio, { x: 56, y: 372, opacidade: pApoio });
  if (cAp) camadas.push(cAp);

  // A tela real com a grade cheia, a câmera subindo pelas faixas.
  const pTela = easeOutCubic(seg(t, inicio + 0.5, inicio + 1.2));
  if (pTela > 0.01) {
    const tw = 992;
    const th = 800;
    const telas = await telaDoPrograma({
      captura: 'ferramentas',
      x: 44,
      y: 470,
      w: tw,
      h: th,
      janela: { fx: 0.45, fy: 0.62, fw: 0.72, fh: 0.9 },
      janelaFim: { fx: 0.55, fy: 0.36, fw: 0.6, fh: 0.78 },
      progresso: clamp(local / (fim - inicio - 0.6)),
    });
    for (const c of await esmaecerTodas(telas, pTela)) camadas.push(c);
  }

  // O aviso, piscando.
  const pAviso = easeOutCubic(seg(t, inicio + 2.0, inicio + 2.6));
  if (pAviso > 0.01) {
    const pisca = Math.sin(local * 7) > 0.2 ? 1 : 0.4;
    const aw = 720;
    const ah = 84;
    const ax = 44;
    const ay = 1320;
    const corpo = `<rect width="${aw}" height="${ah}" rx="12" fill="${V.vermelho}" fill-opacity="0.1" stroke="${V.vermelho}" stroke-opacity="0.5"/>
      <circle cx="36" cy="${ah / 2}" r="9" fill="${V.vermelho}" opacity="${pisca.toFixed(2)}"/>`;
    const buf = await (await import('sharp')).default(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${aw}" height="${ah}">${corpo}</svg>`)).png().toBuffer();
    camadas.push({ input: buf, left: ax, top: ay });
    const av = await texto('Música errada no meio do show', 28, { familia: FONTE, peso: '600', cor: V.vermelho });
    const ca = await textoEm(av, { x: ax + 62, y: ay + 26, opacidade: pAviso });
    if (ca) camadas.push(ca);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }
  return camadas;
}
