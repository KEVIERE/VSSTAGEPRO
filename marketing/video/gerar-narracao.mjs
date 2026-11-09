// Gera as falas da narração na ElevenLabs, mede o tempo de cada uma e monta o áudio final.
// Roda a partir de gerar-narracao.command, que confere a chave antes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(DIR, 'narracao');
fs.mkdirSync(SAIDA, { recursive: true });

const config = JSON.parse(fs.readFileSync(path.join(DIR, 'narracao-texto.json'), 'utf8'));
const chave = process.env.ELEVENLABS_API_KEY || fs.readFileSync(path.join(process.env.HOME, '.elevenlabs-key'), 'utf8').trim();

if (!config.voz?.voice_id || config.voz.voice_id === 'COLE_AQUI_O_VOICE_ID') {
  console.error('\nFalta o voice_id em narracao-texto.json.');
  console.error('Rode primeiro:  ./gerar-narracao.command --listar-vozes');
  console.error('E cole o id da voz que você quer no lugar de COLE_AQUI_O_VOICE_ID.\n');
  process.exit(1);
}

async function falar(fala) {
  const destino = path.join(SAIDA, `${fala.id}.mp3`);
  if (fs.existsSync(destino) && !process.argv.includes('--refazer')) {
    console.log(`  ${fala.id}: já existe, aproveitando`);
    return destino;
  }
  const resposta = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voz.voice_id}`, {
    method: 'POST',
    headers: {
      'xi-api-key': chave,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: fala.texto,
      model_id: config.voz.modelo || 'eleven_multilingual_v2',
      voice_settings: {
        stability: config.voz.stability ?? 0.42,
        similarity_boost: config.voz.similarity_boost ?? 0.85,
        style: config.voz.style ?? 0.3,
        use_speaker_boost: config.voz.use_speaker_boost ?? true,
      },
    }),
  });
  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(`${fala.id}: ${resposta.status} ${erro.slice(0, 300)}`);
  }
  fs.writeFileSync(destino, Buffer.from(await resposta.arrayBuffer()));
  console.log(`  ${fala.id}: gerado`);
  return destino;
}

function duracao(arquivo) {
  const saida = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', arquivo], {
    encoding: 'utf8',
  });
  return Number(saida.trim());
}

console.log('\nGerando as falas...');
const tempos = {};
for (const fala of config.falas) {
  const arquivo = await falar(fala);
  tempos[fala.id] = { arquivo: path.basename(arquivo), duracao: duracao(arquivo), texto: fala.texto, pausaDepois: fala.pausaDepois ?? 0.4 };
  console.log(`  ${fala.id}: ${tempos[fala.id].duracao.toFixed(2)} s`);
  await new Promise((r) => setTimeout(r, 350)); // não estourar o limite da API
}

fs.writeFileSync(path.join(SAIDA, 'tempos.json'), JSON.stringify(tempos, null, 2));

// Áudio final: cada fala mais a pausa do roteiro, e uma sobra no fim.
console.log('\nMontando o áudio final...');
const entrada = [];
const filtros = [];
let indice = 0;
for (const fala of config.falas) {
  const t = tempos[fala.id];
  entrada.push('-i', path.join(SAIDA, t.arquivo));
  filtros.push(`[${indice}:a]apad=pad_dur=${(t.pausaDepois || 0).toFixed(2)},aresample=48000,pan=stereo|c0=c0|c1=c0[a${indice}]`);
  indice++;
}
const soma = config.falas.map((_, i) => `[a${i}]`).join('');
filtros.push(`${soma}concat=n=${config.falas.length}:v=0:a=1[saida]`);

execFileSync('ffmpeg', [
  '-y',
  '-v', 'error',
  ...entrada,
  '-filter_complex', filtros.join(';'),
  '-map', '[saida]',
  '-c:a', 'libmp3lame',
  '-q:a', '2',
  path.join(SAIDA, 'narracao.mp3'),
]);

const total = duracao(path.join(SAIDA, 'narracao.mp3'));
console.log(`\nPronto: narracao/narracao.mp3 (${total.toFixed(2)} s)`);
console.log('Os tempos de cada fala estão em narracao/tempos.json.');
if (total > 62) console.log('Atenção: passou de 62 s. Dá para encurtar as pausas em narracao-texto.json.');
