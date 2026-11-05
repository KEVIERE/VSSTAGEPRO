// Cena 6 (41,6 a 51,4 s): a mesa. A tela real do mixer, com a câmera nos faders e no master.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, seg, easeOutCubic, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, V, FONTE } from '../lib/cena3.mjs';

export const inicio = 41.6;
export const fim = 51.4;

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { etiqueta: 'MESA DE SOM', indice: 6 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  const p1 = easeOutCubic(seg(t, inicio + 0.1, inicio + 0.7));
  const l1 = await texto('Uma mesa de som', 70, { familia: FONTE, peso: '700', cor: V.texto });
  const c1 = await textoEm(l1, { x: 56, y: 150 + (1 - p1) * 16, opacidade: p1 });
  if (c1) camadas.push(c1);
  const p2 = easeOutCubic(seg(t, inicio + 0.3, inicio + 0.9));
  const l2 = await texto('de verdade.', 70, { familia: FONTE, peso: '700', cor: V.verde });
  const c2 = await textoEm(l2, { x: 56, y: 238 + (1 - p2) * 16, opacidade: p2 });
  if (c2) camadas.push(c2);

  // A tela real do mixer, com a câmera indo dos medidores ao master.
  const pTela = easeOutCubic(seg(t, inicio + 0.5, inicio + 1.2));
  if (pTela > 0.01) {
    const tw = 992;
    const th = 800;
    const telas = await telaDoPrograma({
      captura: 'mixer',
      x: 44,
      y: 400,
      w: tw,
      h: th,
      janela: { fx: 0.5, fy: 0.45, fw: 0.95, fh: 0.95 },
      janelaFim: { fx: 0.42, fy: 0.62, fw: 0.55, fh: 0.6 },
      progresso: clamp(local / 7.4),
    });
    for (const c of await esmaecerTodas(telas, pTela)) camadas.push(c);
  }

  // O que a mesa faz.
  const itens = [
    ['Anti-clip em cada canal', 'Não passa de −0,1 dBFS nem no pico.'],
    ['LR mágico', 'Click e guia num lado, a banda no outro.'],
    ['Master com IA', 'Um toque e todos os VS no mesmo nível.'],
  ];
  for (let i = 0; i < itens.length; i++) {
    const ap = easeOutCubic(seg(t, inicio + 3.2 + i * 0.26, inicio + 3.8 + i * 0.26));
    if (ap <= 0.01) continue;
    const y = 1260 + i * 150;
    camadas.push({
      input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="86"><rect width="4" height="86" rx="2" fill="${V.verde}" opacity="${ap.toFixed(3)}"/></svg>`)).png().toBuffer(),
      left: 52,
      top: y + 4,
    });
    const ti = await texto(itens[i][0], 36, { familia: FONTE, peso: '600', cor: V.texto });
    const ct = await textoEm(ti, { x: 80, y, opacidade: ap });
    if (ct) camadas.push(ct);
    const tx = await texto(itens[i][1], 26, { familia: FONTE, peso: '500', cor: V.dim });
    const cx = await textoEm(tx, { x: 80, y: y + 46, opacidade: ap });
    if (cx) camadas.push(cx);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }
  return camadas;
}
