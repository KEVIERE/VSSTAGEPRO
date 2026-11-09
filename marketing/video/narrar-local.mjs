// Narração de reserva com a voz do próprio macOS (Luciana, pt-BR).
// Serve para montar o vídeo com áudio AGORA, sem depender de rede nem de chave.
// A versão final continua sendo a da ElevenLabs (gerar-narracao.command), que sai melhor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(DIR, 'narracao');
fs.mkdirSync(SAIDA, { recursive: true });

const config = JSON.parse(fs.readFileSync(path.join(DIR, 'narracao-texto.json'), 'utf8'));
const voz = process.env.VOZ_LOCAL || 'Luciana';
const ritmo = process.env.RITMO || '165';

console.log(`Voz: ${voz} · ritmo ${ritmo} palavras/min\n`);

function duracao(arquivo) {
  const saida = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', arquivo], {
    encoding: 'utf8',
  });
  return Number(saida.trim());
}

const tempos = {};
for (const fala of config.falas) {
  const aiff = path.join(SAIDA, `${fala.id}.aiff`);
  const mp3 = path.join(SAIDA, `${fala.id}.mp3`);
  execFileSync('say', ['-v', voz, '-r', ritmo, '-o', aiff, fala.texto]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-c:a', 'libmp3lame', '-q:a', '3', mp3]);
  fs.unlinkSync(aiff);
  tempos[fala.id] = { arquivo: `${fala.id}.mp3`, duracao: duracao(mp3), texto: fala.texto, pausaDepois: fala.pausaDepois ?? 0.4 };
  console.log(`${fala.id}: ${tempos[fala.id].duracao.toFixed(2)} s`);
}

fs.writeFileSync(path.join(SAIDA, 'tempos.json'), JSON.stringify(tempos, null, 2));

// Junta com as pausas do roteiro.
const entrada = [];
const filtros = [];
let i = 0;
for (const fala of config.falas) {
  const t = tempos[fala.id];
  entrada.push('-i', path.join(SAIDA, t.arquivo));
  filtros.push(`[${i}:a]apad=pad_dur=${(t.pausaDepois || 0).toFixed(2)},aresample=48000,pan=stereo|c0=c0|c1=c0[a${i}]`);
  i++;
}
filtros.push(`${config.falas.map((_, k) => `[a${k}]`).join('')}concat=n=${config.falas.length}:v=0:a=1[saida]`);

execFileSync('ffmpeg', [
  '-y', '-v', 'error', ...entrada,
  '-filter_complex', filtros.join(';'),
  '-map', '[saida]', '-c:a', 'libmp3lame', '-q:a', '2',
  path.join(SAIDA, 'narracao.mp3'),
]);

const total = duracao(path.join(SAIDA, 'narracao.mp3'));
console.log(`\nPronto: narracao/narracao.mp3 (${total.toFixed(2)} s)`);
if (total > 61.5) console.log('Passou de 61,5 s: encurte as pausas em narracao-texto.json ou aumente RITMO.');
