// Junta os quadros num MP4 e acrescenta o áudio (narração da ElevenLabs e/ou trilha).
// Uso: node montar.mjs [--sem-audio]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const QUADROS = path.join(DIR, 'quadros');
const SAIDA = path.join(DIR, 'vs-stage-pro-9x16.mp4');
const FPS = 30;

if (!fs.existsSync(QUADROS)) {
  console.error('Faltam os quadros. Rode antes:  node render.mjs --todos --out quadros');
  process.exit(1);
}

const total = fs.readdirSync(QUADROS).filter((f) => f.endsWith('.png')).length;
console.log(`Quadros: ${total} (${(total / FPS).toFixed(1)} s a ${FPS} fps)`);

// Áudio: narração se já existir; senão, trilha; senão, mudo.
const narracao = path.join(DIR, 'narracao', 'narracao.mp3');
const trilha = path.join(DIR, 'trilha.wav');
const semAudio = process.argv.includes('--sem-audio');

let audio = null;
if (!semAudio) {
  if (fs.existsSync(narracao)) audio = narracao;
  else if (fs.existsSync(trilha)) audio = trilha;
}

const args = [
  '-y',
  '-v', 'error',
  '-framerate', String(FPS),
  '-i', path.join(QUADROS, 'f%05d.png'),
];

if (audio) {
  args.push('-i', audio);
  // A narração começa no quadro zero; o loudnorm deixa o volume no padrão de web.
  // O apad completa o áudio até o fim do vídeo, para o -shortest não cortar o vídeo
  // quando a narração é mais curta que ele.
  args.push('-af', 'apad,loudnorm=I=-16:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k');
}

args.push(
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-profile:v', 'high',
  '-level', '4.2',
  '-movflags', '+faststart',
  '-shortest',
  SAIDA,
);

console.log(audio ? `Áudio: ${path.basename(audio)}` : 'Sem áudio.');
execFileSync('ffmpeg', args, { stdio: 'inherit' });

const tamanho = (fs.statSync(SAIDA).size / 1024 / 1024).toFixed(1);
console.log(`\nPronto: ${path.relative(process.cwd(), SAIDA)} (${tamanho} MB)`);

// A capa (primeiro quadro) também serve para o anúncio.
const capa = path.join(DIR, 'capa.jpg');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(QUADROS, 'f00090.png'), '-frames:v', '1', '-q:v', '3', capa]);
console.log('Capa: capa.jpg');
