#!/bin/zsh
# Roda a medição de abertura várias vezes em cada build e mostra o resumo.
# Uso: ./medir-rodadas.command [quantidade]
cd "$(dirname "$0")" || exit 1
N=${1:-5}
ELEC=./desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron

for build in .medir-antes dist; do
  : > ".resumo-${build#.}.txt"
  for i in $(seq "$N"); do
    $ELEC ./desktop/medir-boot.js "./$build" 1 2>/dev/null | grep '^{' >> ".resumo-${build#.}.txt"
  done
done

node - <<'EOF'
const fs = require('fs');
const med = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l));
const est = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const mediana = s[Math.floor(s.length / 2)];
  return { mediana, min: s[0], max: s[s.length - 1], n: s.length };
};
for (const [nome, f] of [['ANTES', '.resumo-medir-antes.txt'], ['DEPOIS', '.resumo-dist.txt']]) {
  const r = med(f);
  if (!r.length) { console.log(`${nome}: sem dados`); continue; }
  const col = (k) => est(r.map((x) => x[k]).filter((x) => typeof x === 'number'));
  const a = col('readyAt'), d = col('domReady'), p = col('firstPaint');
  console.log(`${nome} (${r.length} rodadas)`);
  console.log(`  processo pronto   ${a.mediana} ms  (${a.min}-${a.max})`);
  console.log(`  DOM pronto        ${d.mediana} ms  (${d.min}-${d.max})`);
  console.log(`  primeiro desenho  ${p.mediana} ms  (${p.min}-${p.max})`);
}
EOF
