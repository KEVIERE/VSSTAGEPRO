// Renderiza o vídeo: chama as cenas quadro a quadro e guarda PNGs (que o ffmpeg junta depois).
// Uso:
//   node render.mjs --cena 3 --start 0 --end 90 --out t3      (teste de uma cena, em segundos)
//   node render.mjs --todos --out quadros                     (vídeo inteiro)
import sharp from '/Users/jonatha/Documents/VS STAGE PROJECT/project/node_modules/sharp/lib/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { W, H, FPS, C } from './lib/core.mjs';
import { vinheta } from './lib/core.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const CENAS = [1, 2, 3, 4, 5, 6, 7];

const soCena = Number(arg('cena', '0'));
const quais = soCena ? [soCena] : CENAS;

const NOMES = ['abertura', 'problema', 'ia', 'modoshow', 'banda', 'mixer', 'fechamento'];

const carregadas = [];
for (const id of quais) {
  const m = await import(`./cenas/c${id}_${NOMES[id - 1]}.mjs`);
  carregadas.push({ id, inicio: m.inicio ?? 0, fim: m.fim, desenhar: m.desenhar });
}

const inicioSeg = Number(arg('start', '0'));
const fimSeg = soCena ? Number(arg('end', String(carregadas[0].fim))) : 60;
const saida = arg('out', 'quadros');
fs.mkdirSync(saida, { recursive: true });

const paralelismo = Number(arg('paralelo', '5'));
let vinh = null;
try {
  vinh = await vinheta();
} catch {
  vinh = null;
}

const primeiro = Math.round(inicioSeg * FPS);
const ultimo = Math.round(fimSeg * FPS);

let total = 0;
const t0 = Date.now();
let i = primeiro;

async function umFrame(f) {
  const t = f / FPS;
  const cena = carregadas.find((c) => t >= c.inicio && t < c.fim) || carregadas[carregadas.length - 1];
  const camadas = (await cena.desenhar(t)).filter(Boolean);
  await sharp({ create: { width: W, height: H, channels: 3, background: C.ink } })
    .composite([...camadas, ...(vinh ? [{ input: vinh, left: 0, top: 0 }] : [])])
    .png({ compressionLevel: 2 })
    .toFile(path.join(saida, `f${String(f).padStart(5, '0')}.png`));
  total++;
  if (total % 60 === 0) {
    const s = (Date.now() - t0) / 1000;
    console.log(`${total} quadros · ${(total / s).toFixed(1)}/s · ${s.toFixed(0)} s`);
  }
}

async function operario() {
  while (i < ultimo) {
    const f = i++;
    try {
      await umFrame(f);
    } catch (e) {
      console.error(`erro no quadro ${f}:`, e.message);
      throw e;
    }
  }
}

await Promise.all(Array.from({ length: paralelismo }, operario));
console.log(`pronto: ${total} quadros em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
