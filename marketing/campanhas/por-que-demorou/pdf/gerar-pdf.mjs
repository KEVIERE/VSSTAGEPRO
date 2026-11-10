#!/usr/bin/env node
/**
 * Gera os PDFs de apresentacao da campanha.
 *
 * Usa o Chrome em modo headless para imprimir os HTML em PDF.
 * Cada arquivo HTML e um documento independente e autocontido.
 *
 * Uso: node gerar-pdf.mjs
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, 'saida');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(SAIDA)) mkdirSync(SAIDA, { recursive: true });

const arquivos = readdirSync(AQUI)
  .filter((f) => f.endsWith('.html'))
  .sort();

if (arquivos.length === 0) {
  console.error('nenhum html encontrado');
  process.exit(1);
}

let falhas = 0;

for (const nome of arquivos) {
  const entrada = join(AQUI, nome);
  const pdf = join(SAIDA, nome.replace(/\.html$/, '.pdf'));

  if (existsSync(pdf)) unlinkSync(pdf);

  const args = [
    '--headless',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${pdf}`,
    '--no-sandbox',
    '--virtual-time-budget=3000',
    `file://${entrada}`,
  ];

  try {
    execFileSync(CHROME, args, { stdio: 'pipe', timeout: 180000 });
  } catch (erro) {
    console.error(`  erro ao gerar ${nome}: ${erro.message.split('\n')[0]}`);
    falhas++;
    continue;
  }

  if (!existsSync(pdf)) {
    console.error(`  ${nome}: PDF nao foi criado`);
    falhas++;
    continue;
  }

  // O PDF nao pode sair com webfont embutida: o Chrome grava o texto dessas
  // fontes de um jeito que a extracao le embaralhado, e o PDF fica impossivel
  // de copiar e buscar. As fontes saem com prefixo de subset ("/FontName
  // /AAAAAA+Inter-Regular") e tambem com "/FontFamily (Inter)", entao a
  // busca e pelo nome solto, sem ancorar no inicio.
  const texto = readFileSync(pdf).toString('latin1');
  const WEBFONTS = ['Inter', 'Oswald', 'Roboto', 'Montserrat', 'Open Sans',
                    'Lato', 'Poppins', 'Source Sans', 'Nunito', 'Raleway'];
  const achadas = WEBFONTS.filter(
    (f) => new RegExp(`\\+${f}[-)]|\\+${f}$|/FontFamily \\(${f}\\)`).test(texto)
  );
  if (achadas.length) {
    console.error(`  x ${nome}: saiu com webfont (${achadas.join(', ')}).`);
    console.error(`    O texto do PDF fica embaralhado. Use fonte do sistema no estilo.css.`);
    falhas++;
    continue;
  }

  const kb = (statSync(pdf).size / 1024).toFixed(0);
  console.log(`  ok  ${basename(pdf)}  ${kb} KB`);
}

console.log();
if (falhas) {
  console.error(`${falhas} arquivo(s) falharam`);
  process.exit(1);
}
console.log('todos os PDFs gerados');
