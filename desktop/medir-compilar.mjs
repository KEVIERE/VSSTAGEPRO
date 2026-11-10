// Mede o custo de o V8 compilar (parse + bytecode) o bundle principal de cada build, sem
// executar. É a parte da abertura que o bundle menor ataca, e não depende de abrir janela
// (por isso não tem o ruído da medição de ponta a ponta).
// Uso: node --experimental-vm-modules desktop/medir-compilar.mjs <build1> <build2> ...
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const builds = process.argv.slice(2);
const RODADAS = 7;

function entryOf(dir) {
  const assets = path.join(dir, 'assets');
  const f = fs.readdirSync(assets).find((n) => /^index-.*\.js$/.test(n));
  return f ? path.join(assets, f) : null;
}

const resultado = [];
for (const dir of builds) {
  const file = entryOf(dir);
  if (!file) { resultado.push({ build: path.basename(dir), erro: 'sem index-*.js' }); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const tempos = [];
  for (let i = 0; i < RODADAS; i++) {
    const t0 = performance.now();
    // compila como módulo (o bundle é ESM), sem executar nada
    new vm.SourceTextModule(src, { identifier: file });
    tempos.push(performance.now() - t0);
  }
  const s = [...tempos].sort((a, b) => a - b);
  resultado.push({
    build: path.basename(dir),
    arquivo: path.basename(file),
    KB: Math.round((src.length / 1024) * 10) / 10,
    compilar_ms_mediana: Math.round(s[Math.floor(s.length / 2)] * 10) / 10,
    compilar_ms_min: Math.round(s[0] * 10) / 10,
    compilar_ms_max: Math.round(s[s.length - 1] * 10) / 10,
  });
}
console.log(JSON.stringify(resultado, null, 2));
