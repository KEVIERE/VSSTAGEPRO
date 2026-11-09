// Cena 3 (12,4 a 22,6 s): a IA. A tela real da separação, com a câmera indo até as faixas.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, seg, easeOutCubic, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, chip, V, FONTE } from '../lib/cena3.mjs';

export const inicio = 12.4;
export const fim = 22.6;

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { etiqueta: 'INTELIGÊNCIA ARTIFICIAL', indice: 3 });
  const local = t - inicio;
  const saida = seg(t, fim - 0.5, fim);

  // Título em três linhas.
  const linhas = [
    ['Uma música pronta', V.texto],
    ['entra. Sete faixas', V.texto],
    ['saem prontas.', V.verde],
  ];
  for (let i = 0; i < linhas.length; i++) {
    const p = easeOutCubic(seg(t, inicio + 0.1 + i * 0.18, inicio + 0.75 + i * 0.18));
    if (p <= 0.01) continue;
    const tl = await texto(linhas[i][0], 68, { familia: FONTE, peso: '700', cor: linhas[i][1] });
    const c = await textoEm(tl, { x: 56, y: 156 + i * 76 + (1 - p) * 14, opacidade: p });
    if (c) camadas.push(c);
  }

  // A tela real da separação de faixas.
  const pTela = easeOutCubic(seg(t, inicio + 0.6, inicio + 1.3));
  if (pTela > 0.01) {
    const tw = 992;
    const th = 820;
    const telas = await telaDoPrograma({
      captura: 'ia',
      x: 44,
      y: 430,
      w: tw,
      h: th,
      janela: { fx: 0.5, fy: 0.3, fw: 0.62, fh: 0.8 },
      janelaFim: { fx: 0.52, fy: 0.55, fw: 0.92, fh: 1.0 },
      progresso: clamp(local / 6.4),
    });
    for (const c of await esmaecerTodas(telas, pTela)) camadas.push(c);
  }

  // Chips do que a IA fez.
  const pChips = easeOutCubic(seg(t, inicio + 5.0, inicio + 5.7));
  if (pChips > 0.01) {
    const chips = [
      ['BPM DETECTADO', '72', V.verde],
      ['CLICK CRIADO', 'na grade', V.verde],
      ['ALINHADO', 'no compasso', V.verde],
    ];
    for (let i = 0; i < chips.length; i++) {
      const bx = 44 + i * 330;
      const bw = 312;
      const bh = 118;
      const corpo = `<rect width="${bw}" height="${bh}" rx="14" fill="${V.painel}" stroke="${V.borda}"/>
        <circle cx="${bw - 28}" cy="30" r="6" fill="${V.verde}"/>`;
      camadas.push({
        input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bw}" height="${bh}">${corpo}</svg>`)).png().toBuffer(),
        left: bx,
        top: 1290,
      });
      const lb = await texto(chips[i][0], 14, { familia: FONTE, peso: '600', cor: V.muted, espaco: 2 });
      const c1 = await textoEm(lb, { x: bx + 22, y: 1306, opacidade: pChips });
      if (c1) camadas.push(c1);
      const vl = await texto(chips[i][1], 38, { familia: FONTE, peso: '700', cor: V.verde });
      const c2 = await textoEm(vl, { x: bx + 22, y: 1338, opacidade: pChips });
      if (c2) camadas.push(c2);
      const sl = await texto(chips[i][2], 18, { familia: FONTE, peso: '500', cor: V.muted });
      const c3 = await textoEm(sl, { x: bx + 22, y: 1386, opacidade: pChips });
      if (c3) camadas.push(c3);
    }
  }

  const pNota = easeOutCubic(seg(t, inicio + 6.4, inicio + 7.1));
  if (pNota > 0.01) {
    const nota = await texto('Voz, click, bateria, baixo, guitarra, teclado e o resto — sem você tocar em nada.', 26, {
      familia: FONTE, peso: '500', cor: V.dim,
    });
    const c = await textoEm(nota, { x: 44, y: 1450, opacidade: pNota });
    if (c) camadas.push(c);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }
  return camadas;
}
