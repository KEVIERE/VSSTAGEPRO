// Cena 1 (0,0 a 4,6 s): a marca e o programa de verdade, entrando.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { W, H, seg, easeOutCubic, easeOutExpo, easeInOutCubic, texto, clamp } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { logo } from '../lib/assets.mjs';
import { fundoVideo, escurecer, telaDoPrograma, esmaecerTodas, V, FONTE } from '../lib/cena3.mjs';

export const inicio = 0;
export const fim = 4.6;

export async function desenhar(t) {
  const camadas = await fundoVideo(t, { rodape: false });
  const saida = seg(t, fim - 0.55, fim);

  // Logo.
  const pLogo = easeOutExpo(seg(t, 0.08, 1.1));
  if (pLogo > 0.01) {
    const lado = Math.round(230 * (0.88 + 0.12 * pLogo));
    const logoBuf = await logo(230);
    const red = await sharp(logoBuf).resize(lado, lado).png().toBuffer();
    const { data, info } = await sharp(red).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let k = 3; k < data.length; k += 4) data[k] = Math.round(data[k] * pLogo);
    const buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    camadas.push({ input: buf, left: Math.round(W / 2 - lado / 2), top: Math.round(230 - lado / 2) });
  }

  // Marca.
  const pNome = seg(t, 0.5, 1.1);
  const nome = await texto('VS Stage Pro', 86, { familia: FONTE, peso: '700', cor: V.texto });
  const cNome = await textoEm(nome, { x: W / 2, y: 390 + (1 - easeOutCubic(pNome)) * 20, opacidade: easeOutCubic(pNome), ancora: 'middle' });
  if (cNome) camadas.push(cNome);

  const pSub = easeOutCubic(seg(t, 0.9, 1.5));
  const sub = await texto('O palco inteiro na mesma tela', 34, { familia: FONTE, peso: '500', cor: V.dim });
  const cSub = await textoEm(sub, { x: W / 2, y: 500, opacidade: pSub, ancora: 'middle' });
  if (cSub) camadas.push(cSub);

  // A tela real do programa, entrando com zoom-out lento.
  const pTela = easeOutCubic(seg(t, 1.35, 2.35));
  if (pTela > 0.01) {
    const tw = 960;
    const th = 640;
    const zoom = 0.94 + 0.06 * pTela;
    const telas = await telaDoPrograma({
      captura: 'modoShow',
      x: W / 2 - (tw * zoom) / 2,
      y: 640,
      w: Math.round(tw * zoom),
      h: Math.round(th * zoom),
      janela: { fx: 0.5, fy: 0.45, fw: 0.9, fh: 1 },
      janelaFim: { fx: 0.52, fy: 0.5, fw: 0.82, fh: 0.9 },
      progresso: clamp((t - 2.0) / 2.2),
    });
    for (const c of await esmaecerTodas(telas, pTela)) camadas.push(c);
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }
  return camadas;
}
