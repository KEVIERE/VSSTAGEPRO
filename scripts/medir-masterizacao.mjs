// Mede a masterização em músicas de verdade (ferramenta de desenvolvimento, não vai no app).
//
//   node scripts/medir-masterizacao.mjs [opções] musica1.mp3 musica2.wav ...
//
// Opções:
//   --modulo <arquivo.ts>   cadeia a medir (padrão: src/lib/mastering.ts)
//   --perfil <nome>         perfil de loudness da cadeia nova (equilibrado, show, streaming)
//   --papel <mix|voz|instrumento>
//   --saida <pasta>         grava o resultado em WAV float para ouvir/conferir
//   --so-medir              só mede os arquivos, sem masterizar
//   --json                  imprime o resultado em JSON
//
// Decodifica com o ffmpeg e confere o loudness e o true peak do resultado também com o filtro
// ebur128 do ffmpeg (medida independente da do app). Nenhuma música fica no repositório.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measureAudio } from '../src/lib/masterAnalysis.ts';

const args = process.argv.slice(2);
const opt = { modulo: resolve('src/lib/mastering.ts'), perfil: undefined, papel: 'mix', saida: null, soMedir: false, json: false };
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--modulo') opt.modulo = resolve(args[++i]);
  else if (a === '--perfil') opt.perfil = args[++i];
  else if (a === '--papel') opt.papel = args[++i];
  else if (a === '--instrumento') opt.instrumento = args[++i];
  else if (a === '--saida') opt.saida = resolve(args[++i]);
  else if (a === '--so-medir') opt.soMedir = true;
  else if (a === '--json') opt.json = true;
  else files.push(a);
}

function decode(file) {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const sr = Number(probe.stdout.trim()) || 48000;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-'], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  const all = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
  const n = all.length / 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }
  return { channels: [L, R], sr };
}

function wavFloat(channels, sr) {
  const n = channels[0].length, c = channels.length;
  const buf = Buffer.alloc(44 + n * c * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * c * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(c, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * c * 4, 28); buf.writeUInt16LE(c * 4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * c * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) { buf.writeFloatLE(channels[k][i], o); o += 4; }
  return buf;
}

function ffmpegEbu(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary'));
  const num = (re) => Number((s.match(re) ?? [])[1]);
  return { lufs: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-inf');
const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
function tonalLine(m) {
  // terços de oitava mais perto das oitavas acima
  const idx = (f) => Math.round(17 + 3 * Math.log2(f / 1000));
  return BANDS.map((f) => `${f >= 1000 ? `${f / 1000}k` : f}:${f1(m.tonal[idx(f)])}`).join(' ');
}
function line(tag, m) {
  return `${tag.padEnd(7)} LUFS ${f1(m.lufs).padStart(6)} | TP ${f1(m.truePeakDbtp).padStart(5)} dBTP | LRA ${f1(m.lra).padStart(4)} | PLR ${f1(m.plr).padStart(4)} | PSR ${f1(m.psr).padStart(4)} | corr ${m.correlation.toFixed(2)} | grave fora do centro ${f1(m.lowSideToMidDb)} dB | overs ${m.overs}\n        tonal ${tonalLine(m)}`;
}

const mod = opt.soMedir ? null : await import(pathToFileURL(opt.modulo).href);
const out = [];
for (const file of files) {
  const { channels, sr } = decode(file);
  const before = measureAudio(channels, sr);
  const row = { arquivo: basename(file), sr, antes: before };
  if (!opt.json) console.log(`\n== ${basename(file)} (${sr} Hz, ${(channels[0].length / sr).toFixed(0)} s)\n${line('antes', before)}`);
  if (mod) {
    const t0 = performance.now();
    const role = { mix: 'mix', voz: 'voice', instrumento: 'instrument' }[opt.papel] ?? 'mix';
    const res = mod.masterChannels(channels, sr, { vocal: role === 'voice', role, profile: opt.perfil, instrument: opt.instrumento });
    const ms = performance.now() - t0;
    const after = measureAudio(res.channels, sr);
    row.depois = after; row.relatorio = res.report; row.ms = ms;
    if (!opt.json) {
      const r = res.report;
      const extra = r.notes ? `\n        notas: ${r.notes.join(' | ')}` : '';
      const tonal = r.tonalDistanceBefore ? ` | distância tonal da referência ${f1(r.tonalDistanceBefore)} -> ${f1(r.tonalDistanceAfter)} dB` : '';
      console.log(`${line('depois', after)}\n        compressão máx ${f1(-r.compressionDb)} dB (média ${f1(r.compressionAvgDb ?? 0)}) | limitador ${f1(-r.limiterDb)} dB${tonal} | tempo ${(ms / 1000).toFixed(1)} s${extra}`);
    }
    if (opt.saida) {
      mkdirSync(opt.saida, { recursive: true });
      const path = join(opt.saida, `${basename(file).replace(/\.[^.]+$/, '')}.master.wav`);
      writeFileSync(path, wavFloat(res.channels, sr));
      const ebu = ffmpegEbu(path);
      row.ffmpeg = ebu;
      if (!opt.json) console.log(`        ffmpeg ebur128: ${f1(ebu.lufs)} LUFS, TP ${f1(ebu.tp)} dBTP, LRA ${f1(ebu.lra)}`);
    }
  }
  out.push(row);
}
if (opt.json) console.log(JSON.stringify(out));
