// Procura imagens do PROGRAMA (não do site) no disco.
// Interessa: a janela do app rodando, com as faixas, o mixer, o Modo Show.
const fs = require('fs');
const path = require('path');

const raizes = [
  '/Users/jonatha/Desktop',
  '/Users/jonatha/Downloads',
  '/Users/jonatha/Documents',
  '/Users/jonatha/Pictures',
];

const achados = [];
function andar(dir, nivel) {
  if (nivel > 3) return;
  let itens;
  try {
    itens = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of itens) {
    if (it.name.startsWith('.') || it.name === 'node_modules') continue;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      andar(p, nivel + 1);
    } else if (/\.(png|jpg|jpeg)$/i.test(it.name)) {
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.size < 60000) continue;
      const nome = it.name.toLowerCase();
      // pistas de que é o programa: nomes com faixa, mixer, show, tela, programa, ensaio
      const pista = /(programa|app|tela|mixer|faixa|timeline|show|modoshow|ensaio|vs-?stage|print|screenshot|captura)/.test(nome);
      const pasta = path.dirname(p).toLowerCase();
      const pistaPasta = /(programa|app|captura|print|screenshot|shot)/.test(pasta);
      if (pista || pistaPasta) achados.push({ p, kb: Math.round(st.size / 1024), mtime: st.mtime.toISOString().slice(0, 10) });
    }
  }
}

for (const r of raizes) andar(r, 0);
achados.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
for (const a of achados.slice(0, 60)) console.log(`${a.mtime} ${String(a.kb).padStart(6)} KB  ${a.p}`);
console.log(`\n${achados.length} imagens com pinta de programa`);
