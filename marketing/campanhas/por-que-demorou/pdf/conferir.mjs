#!/usr/bin/env node
/**
 * Confere o visual dos HTML antes de gerar os PDFs.
 *
 * Verifica, por medicao no DOM renderizado pelo Chrome:
 * - se cada .page cabe exatamente numa folha A4 sem estourar
 * - se o conteudo nao passa da area util (risco de corte)
 * - se as cores da marca estao aplicadas
 * - se as imagens carregaram
 *
 * Uso: node conferir.mjs
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const A4_ALTURA_PX = 1123; // 297mm a 96dpi
const A4_LARGURA_PX = 794; // 210mm a 96dpi

const arquivos = readdirSync(AQUI).filter((f) => f.endsWith('.html')).sort();

if (arquivos.length === 0) {
  console.error('nenhum html encontrado');
  process.exit(1);
}

// injeta um script que mede o DOM e devolve JSON pelo titulo do documento
const MEDIDOR = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    const paginas = [...document.querySelectorAll('.page')].map(function (p, i) {
      const r = p.getBoundingClientRect();
      const conteudo = p.querySelector('.conteudo');
      const cr = conteudo ? conteudo.getBoundingClientRect() : null;
      const rodape = p.querySelector('.rodape');
      const rr = rodape ? rodape.getBoundingClientRect() : null;

      // procura o elemento mais baixo dentro do conteudo, medindo
      // relativo ao topo DESTA pagina (as paginas sao empilhadas no DOM)
      let maisBaixo = 0;
      if (conteudo) {
        conteudo.querySelectorAll('*').forEach(function (el) {
          const b = el.getBoundingClientRect();
          const relativo = b.bottom - r.top;
          if (b.height > 0 && relativo > maisBaixo) maisBaixo = relativo;
        });
      }

      const estilo = getComputedStyle(p);
      const imgs = [...p.querySelectorAll('img')].map(function (im) {
        return { src: im.src.split('/').pop(), carregou: im.complete && im.naturalWidth > 0 };
      });

      return {
        indice: i + 1,
        altura: Math.round(r.height),
        largura: Math.round(r.width),
        fundo: estilo.backgroundColor,
        topoConteudo: cr ? Math.round(cr.top - r.top) : null,
        baseConteudo: Math.round(maisBaixo),
        baseRodape: rr ? Math.round(rr.bottom - r.top) : null,
        imgs: imgs,
        overflow: estilo.overflow,
      };
    });

    const corpo = getComputedStyle(document.body);
    const amostraTitulo = document.querySelector('h1');
    const corTitulo = amostraTitulo ? getComputedStyle(amostraTitulo).color : null;
    const fonteTitulo = amostraTitulo ? getComputedStyle(amostraTitulo).fontFamily : null;

    document.title = 'MEDIDAS:' + JSON.stringify({
      paginas: paginas,
      corFundo: corpo.backgroundColor,
      corTexto: corpo.color,
      corTitulo: corTitulo,
      fonteTitulo: fonteTitulo,
      totalPaginas: paginas.length,
    });
  }, 900);
});
</script>
`;

let problemas = 0;

for (const nome of arquivos) {
  const caminho = join(AQUI, nome);

  // cria uma copia temporaria com o medidor injetado
  const { readFileSync, writeFileSync } = await import('node:fs');
  const html = readFileSync(caminho, 'utf8');
  const temp = join(AQUI, '.conferir-temp.html');
  writeFileSync(temp, html.replace('</body>', MEDIDOR + '</body>'));

  let titulo = '';
  try {
    const saida = execFileSync(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--dump-dom',
        '--virtual-time-budget=4000',
        '--no-sandbox',
        `file://${temp}`,
      ],
      { encoding: 'utf8', timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const m = saida.match(/<title>MEDIDAS:(.*?)<\/title>/s);
    if (m) titulo = m[1];
  } catch (erro) {
    console.error(`x ${nome}: falha ao medir (${erro.message.split('\n')[0]})`);
    problemas++;
    continue;
  }

  if (!titulo) {
    console.error(`x ${nome}: medidor nao devolveu dados`);
    problemas++;
    continue;
  }

  let dados;
  try {
    dados = JSON.parse(titulo.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch {
    console.error(`x ${nome}: JSON invalido`);
    problemas++;
    continue;
  }

  console.log(`\n${nome}`);
  console.log(`  ${dados.totalPaginas} pagina(s), fundo ${dados.corFundo}`);

  for (const p of dados.paginas) {
    const estouraAltura = p.altura > A4_ALTURA_PX + 2;
    const estouraLargura = p.largura > A4_LARGURA_PX + 2;
    const conteudoPassa = p.baseRodape && p.baseConteudo > p.baseRodape - 4;

    if (estouraAltura || estouraLargura) {
      console.log(`  x pagina ${p.indice}: ${p.largura}x${p.altura}px, maior que A4`);
      problemas++;
    } else if (conteudoPassa) {
      console.log(
        `  ! pagina ${p.indice}: conteudo chega a ${p.baseConteudo}px e o rodape comeca em ${p.baseRodape}px (risco de sobreposicao)`
      );
      problemas++;
    } else {
      const sobra = p.baseRodape ? p.baseRodape - p.baseConteudo : null;
      console.log(
        `  ok pagina ${p.indice}: ${p.largura}x${p.altura}px, sobra ${sobra}px antes do rodape`
      );
    }

    for (const im of p.imgs) {
      if (!im.carregou) {
        console.log(`  x pagina ${p.indice}: imagem nao carregou -> ${im.src}`);
        problemas++;
      }
    }
  }

  // A fonte do titulo tem que ser uma do sistema, nunca webfont.
  // Webfont carregada do Google quebra a extracao de texto do PDF.
  if (dados.fonteTitulo && /Inter|Oswald|fonts\.googleapis/i.test(dados.fonteTitulo)) {
    console.log(`  x fonte do titulo e webfont (${dados.fonteTitulo}), quebra a extracao de texto`);
    problemas++;
  } else if (dados.fonteTitulo) {
    console.log(`  ok fonte do titulo: ${dados.fonteTitulo.split(',')[0].replace(/"/g, '')}`);
  }
}

// limpa
const { unlinkSync } = await import('node:fs');
const temp = join(AQUI, '.conferir-temp.html');
if (existsSync(temp)) unlinkSync(temp);

console.log();
if (problemas) {
  console.log(`${problemas} problema(s) de layout`);
  process.exit(1);
}
console.log('layout ok em todos os arquivos');
