#!/usr/bin/env node
// Monta o pacote de uma voz no formato de desktop/maestroPacks.js, sem enviar nada:
//   <saida>/pacotes/<voz>/<versão>/manifest.json + <id>.mp3, calma/<id>.mp3, forte/<id>.mp3
// e <saida>/pacotes/<voz>-<versão>.trava.json, com o trecho para desktop/maestro-packs.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MODOS, PUBLICO_PADRAO, SAIDA_PADRAO, arquivoConferencia, caminhoRelativo, carregarCatalogo, gravarJson, lerArgs, lerJson, milhar, sha256,
} from './comum.mjs';

const require = createRequire(import.meta.url);
const { parseManifest } = require('../../desktop/maestroPacks.js');
const VOZES_DE_PACOTE = ['will', 'carla'];

const caminhoNoPacote = (modo, id) => (modo === 'normal' ? `${id}.mp3` : `${modo}/${id}.mp3`);

/** De onde vem cada arquivo. Gravação nova só entra se a conferência aprovou exatamente aquele áudio. */
export function reunirArquivos({ voz, catalogo, saida, publico }) {
  const conferencia = lerJson(arquivoConferencia(saida), { arquivos: {} }).arquivos;
  const arquivos = [];
  const faltando = [];
  const semAprovacao = [];
  for (const modo of MODOS) {
    for (const cue of catalogo) {
      const rel = caminhoRelativo(voz, modo, cue.id);
      const noPrograma = path.join(publico, rel);
      const gravado = path.join(saida, rel);
      let origem = null;
      if (fs.existsSync(noPrograma)) origem = noPrograma;
      else if (fs.existsSync(gravado)) {
        const nota = conferencia[rel];
        if (nota?.ok && nota.whisper && nota.sha256 === sha256(gravado)) origem = gravado;
        else { semAprovacao.push(rel); continue; }
      }
      if (!origem) { faltando.push(rel); continue; }
      arquivos.push({ origem, rel, novo: origem === gravado, path: caminhoNoPacote(modo, cue.id) });
    }
  }
  return { arquivos, faltando, semAprovacao };
}

/**
 * Maestro IA: copia para a pasta do programa só o áudio aprovado. Sem --confirmar, apenas mostra
 * quanto o instalador cresceria. Falta ou áudio sem aprovação recusa tudo, sem copiar nada.
 */
function embutir(args) {
  if (args.voz !== 'felipe') throw new Error('--embutir só vale para --voz=felipe.');
  const saida = path.resolve(typeof args.saida === 'string' ? args.saida : SAIDA_PADRAO);
  const destino = path.resolve(args.embutir);
  const catalogo = carregarCatalogo(args);
  const { arquivos, faltando, semAprovacao } = reunirArquivos({ voz: 'felipe', catalogo, saida, publico: destino });
  if (faltando.length || semAprovacao.length) {
    console.error(`Recusado: ${milhar(faltando.length)} faltando e ${milhar(semAprovacao.length)} sem aprovação na conferência.`);
    for (const r of [...faltando, ...semAprovacao].slice(0, 10)) console.error(`  ${r}`);
    return 2;
  }
  const novos = arquivos.filter((a) => a.novo);
  const bytes = novos.reduce((n, a) => n + fs.statSync(a.origem).size, 0);
  console.log(`Maestro IA: ${milhar(novos.length)} arquivos novos, +${(bytes / 1024 / 1024).toFixed(1)} MB no instalador.`);
  if (!args.confirmar) {
    console.log('Nada foi copiado. Para copiar, repita com --confirmar.');
    return 0;
  }
  for (const a of novos) {
    const final = path.join(destino, a.rel);
    const tmp = `${final}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(final), { recursive: true });
    fs.copyFileSync(a.origem, tmp);
    if (sha256(tmp) !== sha256(a.origem)) { fs.rmSync(tmp, { force: true }); throw new Error(`Cópia divergente: ${a.rel}`); }
    fs.renameSync(tmp, final);
  }
  console.log(`Copiados ${milhar(novos.length)} arquivos para ${destino}.`);
  console.log('Atenção: a fala só aparece depois de atualizar a lista de gravadas do programa, que hoje vale também para a Bianca.');
  return 0;
}

function main() {
  const args = lerArgs(process.argv.slice(2), {
    valores: ['voz', 'versao', 'saida', 'publico', 'falas', 'catalogo', 'embutir'],
    marcas: ['confirmar'],
  });
  if (args.embutir) return embutir(args);
  if (args.confirmar) throw new Error('--confirmar só vale junto com --embutir.');
  const voz = args.voz;
  if (!VOZES_DE_PACOTE.includes(voz)) {
    throw new Error('Use --voz=will ou --voz=carla. O Maestro 1 não tem pacote: use --voz=felipe --embutir=public/maestro-falas.');
  }
  const versao = typeof args.versao === 'string' ? args.versao : 'v1';
  if (!/^[a-z0-9][a-z0-9._-]{0,47}$/i.test(versao) || versao.includes('..')) throw new Error('Versão inválida.');
  const saida = path.resolve(typeof args.saida === 'string' ? args.saida : SAIDA_PADRAO);
  const publico = path.resolve(typeof args.publico === 'string' ? args.publico : PUBLICO_PADRAO);
  const catalogo = carregarCatalogo(args);

  const { arquivos, faltando, semAprovacao } = reunirArquivos({ voz, catalogo, saida, publico });
  if (faltando.length || semAprovacao.length) {
    console.error(`Pacote recusado: ${milhar(faltando.length)} faltando e ${milhar(semAprovacao.length)} sem aprovação na conferência.`);
    for (const r of [...faltando, ...semAprovacao].slice(0, 10)) console.error(`  ${r}`);
    return 2;
  }

  const pastaFinal = path.join(saida, 'pacotes', voz, versao);
  if (fs.existsSync(pastaFinal)) throw new Error(`A versão ${versao} de ${voz} já existe. Use outra com --versao=.`);
  const pastaTemp = `${pastaFinal}.montando-${process.pid}`;
  try {
    const files = [];
    for (const a of arquivos) {
      const destino = path.join(pastaTemp, a.path);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.copyFileSync(a.origem, destino);
      files.push({ path: a.path, size: fs.statSync(destino).size, sha256: sha256(destino) });
    }
    files.sort((x, y) => (x.path < y.path ? -1 : 1));
    const bruto = Buffer.from(JSON.stringify({ schema: 1, voice: voz, version: versao, files }));
    const conferido = parseManifest(bruto, voz, versao); // a mesma validação que o programa faz ao baixar
    fs.writeFileSync(path.join(pastaTemp, 'manifest.json'), bruto);
    fs.renameSync(pastaTemp, pastaFinal);
    const trava = { version: versao, sha256: crypto.createHash('sha256').update(bruto).digest('hex'), size: bruto.length };
    gravarJson(path.join(saida, 'pacotes', `${voz}-${versao}.trava.json`), { voices: { [voz]: trava } });
    console.log(`Pacote de ${voz} ${versao}: ${milhar(files.length)} arquivos, ${(conferido.total / 1024 / 1024).toFixed(1)} MB.`);
    console.log(`Pasta: ${pastaFinal}`);
    console.log(`Trava para desktop/maestro-packs.json: ${JSON.stringify(trava)}`);
    console.log('Nada foi enviado.');
    return 0;
  } finally {
    fs.rmSync(pastaTemp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.error(`Erro: ${e.message}`);
    process.exitCode = 1;
  }
}
