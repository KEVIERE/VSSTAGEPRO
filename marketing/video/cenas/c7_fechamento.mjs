// Cena 7 (51,4 a 60 s): fechamento. Logo, promessa, teste grátis e o endereço.
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import { C, W, H, titulo, apoio, texto, svg, seg, easeOutCubic, easeOutExpo, easeInOutCubic, clamp } from '../lib/core.mjs';
import { textoEm, textoRevelado } from '../lib/camadas.mjs';
import { logo } from '../lib/assets.mjs';
import { fundo, escurecer, encaixar } from '../lib/cena.mjs';
import { teclaRotulo } from '../lib/pecas.mjs';
import { display7, LCD, vidro } from '../lib/mesa.mjs';

export const inicio = 51.4;
export const fim = 60;

export async function desenhar(t) {
  const camadas = await fundo(t, { indice: 7, chip: false, forca: 0.2 });
  const local = t - inicio;

  // Logo com halo pulsando devagar.
  const pLogo = easeOutExpo(seg(t, inicio + 0.1, inicio + 1.0));
  const lado = Math.round(360 * (0.9 + 0.1 * pLogo));
  const logoBuf = await logo(360);
  const logoRed = lado === 360 ? logoBuf : await sharp(logoBuf).resize(lado, lado).png().toBuffer();
  const camLogo = await encaixar(logoRed, { x: W / 2 - lado / 2, y: 380 - lado / 2 + (1 - pLogo) * 20, opacidade: pLogo });
  if (camLogo) camadas.push(camLogo);

  // Marca.
  const pMarca = seg(t, inicio + 0.55, inicio + 1.15);
  const marca = await titulo('VS STAGE PRO', 96, C.cream);
  const cMarca = await textoRevelado(marca, {
    x: W / 2,
    y: 600 + (1 - easeOutCubic(pMarca)) * 20,
    progresso: easeOutCubic(pMarca),
    ancora: 'middle',
  });
  if (cMarca) camadas.push(cMarca);

  // A promessa.
  const p1 = easeOutCubic(seg(t, inicio + 1.1, inicio + 1.7));
  const l1 = await apoio('Faça o seu próximo show com', 40, C.dim);
  const c1 = await textoEm(l1, { x: W / 2, y: 810 + (1 - p1) * 14, opacidade: p1, ancora: 'middle' });
  if (c1) camadas.push(c1);
  const p2 = easeOutCubic(seg(t, inicio + 1.3, inicio + 1.9));
  const l2 = await titulo('a banda inteira na mesma página.', 52, C.amber);
  const c2 = await textoEm(l2, { x: W / 2, y: 880 + (1 - p2) * 14, opacidade: p2, ancora: 'middle' });
  if (c2) camadas.push(c2);

  // Placa do teste grátis (48 horas), com o visor em 7 segmentos.
  const pPlaca = easeOutExpo(seg(t, inicio + 2.0, inicio + 2.7));
  if (pPlaca > 0.01) {
    const pw = 640;
    const ph = 300;
    const px = (W - pw) / 2;
    const py = 1080 + (1 - pPlaca) * 40;
    const corpo = `<defs>
        <linearGradient id="aroP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3f46"/><stop offset="1" stop-color="#1a1d21"/></linearGradient>
      </defs>
      <g opacity="${pPlaca.toFixed(3)}">
      <rect x="0" y="0" width="${pw}" height="${ph}" rx="8" fill="url(#aroP)"/>
      <rect x="6" y="6" width="${pw - 12}" height="${ph - 12}" rx="5" fill="#0c0e0d"/>
      ${display7('48', 74, 74, 120, LCD.amber)}
      </g>`;
    camadas.push({ input: await svg(corpo, pw, ph), left: px, top: Math.round(py) });

    const tHoras = await texto('HORAS', 34, { familia: 'Oswald', peso: '600', cor: C.cream, espaco: 3.2 });
    const ch = await textoEm(tHoras, { x: px + 330, y: Math.round(py) + 92, opacidade: pPlaca });
    if (ch) camadas.push(ch);
    const tGratis = await texto('DE TESTE GRÁTIS', 27, { familia: 'Barlow Semi Condensed', peso: '600', cor: C.amber, espaco: 1.8 });
    const cg = await textoEm(tGratis, { x: px + 330, y: Math.round(py) + 136, opacidade: pPlaca });
    if (cg) camadas.push(cg);
    const tSem = await texto('sem cartão de crédito', 24, { familia: 'Barlow Semi Condensed', peso: '600', cor: '#6f6b63' });
    const cs = await textoEm(tSem, { x: px + 330, y: Math.round(py) + 176, opacidade: pPlaca });
    if (cs) camadas.push(cs);
  }

  // Endereço e o botão final.
  const pEnd = easeOutCubic(seg(t, inicio + 3.0, inicio + 3.6));
  if (pEnd > 0.01) {
    const end = await texto('vsstagepro.com.br', 46, { familia: 'Oswald', peso: '600', cor: C.cream, espaco: 1 });
    const ce = await textoEm(end, { x: W / 2, y: 1490, opacidade: pEnd, ancora: 'middle' });
    if (ce) camadas.push(ce);

    const linhaW = 460;
    camadas.push({
      input: await svg(`<rect width="${Math.round(linhaW * pEnd)}" height="3" fill="${C.amber}"/>`, Math.max(2, Math.round(linhaW * pEnd)), 3),
      left: Math.round(W / 2 - (linhaW * pEnd) / 2),
      top: 1556,
    });
  }

  // O último respiro: o quadro escurece devagar.
  const fimFade = seg(t, fim - 0.6, fim);
  if (fimFade > 0) {
    const c = await escurecer(easeInOutCubic(fimFade));
    if (c) camadas.push(c);
  }

  return camadas;
}
