// Cena 1 (0,0 a 4,6 s): a marca, no visual de mesa analógica.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, svg, seg, easeOutCubic, easeOutExpo, easeInOutCubic } from '../lib/core.mjs';
import { textoEm } from '../lib/camadas.mjs';
import { logo } from '../lib/assets.mjs';
import { fundo, escurecer, encaixar } from '../lib/cena.mjs';
import { display7, LCD, vidro } from '../lib/mesa.mjs';

export const inicio = 0;
export const fim = 4.6;

export async function desenhar(t) {
  const camadas = await fundo(t, { indice: 1, chip: false, forca: 0.16 });
  const saida = seg(t, fim - 0.55, fim);

  // Sinal de áudio: barrinhas acesas numa faixa (desenhadas só na faixa).
  const BW = 960;
  const BH = 140;
  const barras = [];
  for (let i = 0; i < 38; i++) {
    const fase = i * 0.6;
    const n = Math.abs(Math.sin(t * 2.6 + fase)) * 0.6 + Math.abs(Math.sin(t * 1.1 + fase * 0.7)) * 0.4;
    const altura = Math.round(12 + n * 118);
    barras.push(`<rect x="${i * 25}" y="${BH - altura}" width="10" height="${altura}" rx="2" fill="${C.amber}" opacity="${(0.06 + n * 0.12).toFixed(3)}"/>`);
  }
  camadas.push({ input: await svg(`<g>${barras.join('')}</g>`, BW, BH), left: 60, top: 1130 });

  // Logo com anel se fechando.
  const pLogo = easeOutExpo(seg(t, 0.1, 1.2));
  const lado = Math.round(420 * (0.86 + 0.14 * pLogo));
  const centroY = 700;
  const logoBuf = await logo(420);
  const logoRed = lado === 420 ? logoBuf : await sharp(logoBuf).resize(lado, lado).png().toBuffer();
  const camadaLogo = await encaixar(logoRed, { x: W / 2 - lado / 2, y: centroY - lado / 2 + (1 - pLogo) * 22, opacidade: pLogo });
  if (camadaLogo) camadas.push(camadaLogo);

  const pAnel = easeInOutCubic(seg(t, 0.55, 1.75));
  if (pAnel > 0.01) {
    const raio = 252;
    const lado2 = (raio + 20) * 2;
    const circ = 2 * Math.PI * raio;
    const meio = lado2 / 2;
    camadas.push({
      input: await svg(
        `<circle cx="${meio}" cy="${meio}" r="${raio}" fill="none" stroke="${C.amber}" stroke-width="2" stroke-opacity="0.55"
           stroke-dasharray="${circ.toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pAnel)).toFixed(1)}"
           transform="rotate(-90 ${meio} ${meio})"/>
         <circle cx="${meio}" cy="${meio}" r="${raio + 14}" fill="none" stroke="${C.cream}" stroke-width="1" stroke-opacity="0.1"/>`,
        lado2,
        lado2,
      ),
      left: Math.round(W / 2 - meio),
      top: Math.round(centroY - meio),
    });
  }

  const nome = await titulo('VS STAGE', 118, C.cream);
  const pNome = seg(t, 1.0, 1.6);
  const camadaNome = await textoEm(nome, { x: W / 2, y: 990 + (1 - easeOutCubic(pNome)) * 24, opacidade: easeOutCubic(pNome), ancora: 'middle' });
  if (camadaNome) camadas.push(camadaNome);

  const pro = await titulo('PRO', 118, C.amber);
  const pPro = seg(t, 1.22, 1.82);
  const camadaPro = await textoEm(pro, { x: W / 2, y: 1132 + (1 - easeOutCubic(pPro)) * 24, opacidade: easeOutCubic(pPro), ancora: 'middle' });
  if (camadaPro) camadas.push(camadaPro);

  const sub = await apoio('O palco inteiro na mesma tela', 40, C.dim);
  const pSub = easeOutCubic(seg(t, 1.8, 2.45));
  const camadaSub = await textoEm(sub, { x: W / 2, y: 1292 + (1 - pSub) * 14, opacidade: pSub, ancora: 'middle' });
  if (camadaSub) camadas.push(camadaSub);

  // Mini visor de mesa com a hora do show (sem texto em SVG: 7 segmentos são desenho).
  const pVisor = easeOutCubic(seg(t, 2.35, 2.95));
  if (pVisor > 0.01) {
    const vw = 420;
    const vh = 108;
    const corpo = `<defs><linearGradient id="aroL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f46"/><stop offset="1" stop-color="#1a1d21"/></linearGradient></defs>
      <g opacity="${pVisor.toFixed(3)}">
      <rect x="0" y="0" width="${vw}" height="${vh}" rx="6" fill="url(#aroL)"/>
      ${vidro(5, 5, vw - 10, vh - 10, { raio: 3 })}
      ${display7('20:47', 130, 34, 46, LCD.amber)}
      </g>`;
    camadas.push({ input: await svg(corpo, vw, vh), left: Math.round(W / 2 - vw / 2), top: 1392 });
  }

  if (saida > 0) {
    const c = await escurecer(easeInOutCubic(saida));
    if (c) camadas.push(c);
  }

  return camadas;
}
