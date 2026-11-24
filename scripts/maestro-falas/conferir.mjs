#!/usr/bin/env node
// Confere as falas gravadas: reprova áudio curto, longo, com palavra repetida ou diferente do texto
// no Whisper local, em lotes. Não usa a internet. Veja LEIA-ME.md.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SAIDA_PADRAO, arquivoConferencia, caminhoRelativo, carregarCatalogo, ehPalavraSolta, escolherModos, escolherVozes,
  gravarJson, lerArgs, lerJson, milhar, sha256,
} from './comum.mjs';

const MODELO_PADRAO = path.join(os.homedir(), 'Documents', 'Whatts_Bot', 'models', 'ggml-large-v3-turbo-q5_0.bin');
const SEMELHANCA_MINIMA = 0.6;
const EXTENSO = { 1: 'um', 2: 'dois', 3: 'tres', 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove' };

export function palavras(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
    .map((p) => EXTENSO[p] ?? p);
}

function distancia(a, b) {
  let linha = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const nova = [i];
    for (let j = 1; j <= b.length; j++) {
      nova[j] = Math.min(linha[j] + 1, nova[j - 1] + 1, linha[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    linha = nova;
  }
  return linha[b.length];
}

export function semelhanca(a, b) {
  const x = palavras(a).join('');
  const y = palavras(b).join('');
  if (!x && !y) return 1;
  return 1 - distancia(x, y) / Math.max(x.length, y.length);
}

function repeteAlgo(ouvido, esperado) {
  const tem = (lista, p) => lista.some((v, i) => i > 0 && v === p && lista[i - 1] === p);
  const o = palavras(ouvido);
  const e = palavras(esperado);
  return o.some((p, i) => i > 0 && p === o[i - 1] && !tem(e, p));
}

// Palavras que mudam o comando: número, parte e sentido. Variações da mesma ideia viram uma só.
const CRITICAS = new Map(Object.entries({
  um: 'um', uma: 'um', dois: 'dois', duas: 'dois', tres: 'tres', quatro: 'quatro', cinco: 'cinco', seis: 'seis',
  sete: 'sete', oito: 'oito', nove: 'nove', dez: 'dez', 10: 'dez', onze: 'onze', 11: 'onze', doze: 'doze', 12: 'doze', treze: 'treze', 13: 'treze',
  catorze: 'catorze', quatorze: 'catorze', 14: 'catorze', quinze: 'quinze', 15: 'quinze', dezesseis: 'dezesseis',
  16: 'dezesseis', meio: 'meio', meia: 'meio', primeiro: 'primeiro', primeira: 'primeiro', segundo: 'segundo',
  segunda: 'segundo', terceiro: 'terceiro', terceira: 'terceiro', quarto: 'quarto', quinto: 'quinto',
  ultimo: 'ultimo', ultima: 'ultimo', sobe: 'sobe', subindo: 'sobe', desce: 'desce', descendo: 'desce',
  entra: 'entra', entram: 'entra', entrada: 'entra', sai: 'sai', saida: 'sai', acima: 'acima', abaixo: 'abaixo',
  volta: 'volta', voltas: 'volta', vai: 'vai', mais: 'mais', mas: 'mais', menos: 'menos',
}));
const LETRA_DE_PARTE = { a: 'a', b: 'b', be: 'b', c: 'c', ce: 'c', se: 'c' };

/** As palavras críticas da fala, na ordem. A letra só conta logo depois de "parte". */
export function palavrasCriticas(texto) {
  const lista = palavras(texto);
  const achadas = [];
  lista.forEach((p, i) => {
    if (i > 0 && lista[i - 1] === 'parte' && LETRA_DE_PARTE[p]) achadas.push(`parte-${LETRA_DE_PARTE[p]}`);
    else if (CRITICAS.has(p)) achadas.push(CRITICAS.get(p));
  });
  return achadas.join(' ');
}

/** Limites de duração em segundos, conforme o tamanho da fala. */
export function limitesDuracao(cue) {
  if (ehPalavraSolta(cue.id)) return { min: 0.12, max: cue.id === 'dezesseis' || cue.id === 'catorze' ? 1.25 : 1 };
  const letras = palavras(cue.spoken).join('').length;
  return { min: Math.max(0.15, letras * 0.03), max: 1.2 + letras * 0.14 };
}

/** Motivos para reprovar uma gravação. Lista vazia é aprovada. Sem transcrição, só mede a duração. */
export function avaliar(cue, duracao, ouvido) {
  const motivos = [];
  const { min, max } = limitesDuracao(cue);
  if (!(duracao >= min)) motivos.push(`curto (${duracao.toFixed(2)} s, mínimo ${min.toFixed(2)})`);
  if (duracao > max) motivos.push(`longo (${duracao.toFixed(2)} s, máximo ${max.toFixed(2)})`);
  if (typeof ouvido === 'string') {
    if (repeteAlgo(ouvido, cue.spoken)) motivos.push(`palavra repetida ("${ouvido.trim()}")`);
    const s = Math.max(semelhanca(ouvido, cue.spoken), semelhanca(ouvido, cue.text));
    if (s < SEMELHANCA_MINIMA) motivos.push(`diferente do texto ("${ouvido.trim()}", ${Math.round(s * 100)}%)`);
    const criticas = palavrasCriticas(ouvido);
    if (criticas !== palavrasCriticas(cue.spoken) && criticas !== palavrasCriticas(cue.text)) {
      motivos.push(`palavra-chave trocada ("${ouvido.trim()}")`);
    }
  }
  return motivos;
}

function duracaoDe(arquivo) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arquivo], { encoding: 'utf8' });
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? d : 0;
}

const TAXA_WHISPER = 16000;
const VAO_MS = 1000;

function cabecalhoWav(bytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + bytes, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(TAXA_WHISPER, 24); h.writeUInt32LE(TAXA_WHISPER * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(bytes, 40);
  return h;
}

/**
 * Distribui as palavras transcritas entre as falas pelo FIM de cada palavra: o Whisper costuma
 * esticar o início da primeira palavra para dentro do silêncio anterior, e o fim é o ponto confiável.
 */
export function repartirPalavras(trechos, janelas) {
  const textos = janelas.map(() => []);
  for (const t of trechos) {
    const ponto = Math.max(t.de, t.ate - 40);
    let melhor = 0;
    let menor = Infinity;
    janelas.forEach((j, i) => {
      const d = ponto < j.de ? j.de - ponto : ponto > j.ate ? ponto - j.ate : 0;
      if (d < menor) { menor = d; melhor = i; }
    });
    textos[melhor].push(t.texto.trim());
  }
  return textos.map((p) => p.filter(Boolean).join(' '));
}

/**
 * Um áudio só por lote, com um segundo de silêncio entre as falas. O Whisper processa blocos de
 * 30 s: arquivo por arquivo, cada fala de 1 s custaria um bloco inteiro.
 */
function transcreverLote(itens, modelo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-conferir-'));
  try {
    const vao = Buffer.alloc((TAXA_WHISPER * 2 * VAO_MS) / 1000);
    const partes = [vao];
    const janelas = [];
    let bytes = vao.length;
    for (const item of itens) {
      const r = spawnSync('ffmpeg', ['-v', 'error', '-i', item.caminho, '-f', 's16le', '-ac', '1', '-ar', String(TAXA_WHISPER), 'pipe:1'], { maxBuffer: 32 * 1024 * 1024 });
      if (r.status !== 0 || !r.stdout?.length) throw new Error(`não consegui ler ${item.rel}`);
      const de = (bytes / (TAXA_WHISPER * 2)) * 1000;
      partes.push(r.stdout, vao);
      bytes += r.stdout.length;
      janelas.push({ de, ate: (bytes / (TAXA_WHISPER * 2)) * 1000 });
      bytes += vao.length;
    }
    const wav = path.join(tmp, 'lote.wav');
    fs.writeFileSync(wav, Buffer.concat([cabecalhoWav(bytes), ...partes]));
    const base = path.join(tmp, 'lote');
    // -ng: neste Mac o whisper-cli 1.9.5 aborta ao iniciar na GPU (Metal) com este modelo
    const r = spawnSync('whisper-cli', ['-m', modelo, '-l', 'pt', '-ng', '-np', '-ml', '1', '-sow', '-oj', '-of', base, '-f', wav], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error('o Whisper falhou neste lote');
    const { transcription = [] } = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
    return repartirPalavras(transcription.map((t) => ({ de: t.offsets.from, ate: t.offsets.to, texto: t.text })), janelas);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = lerArgs(process.argv.slice(2), {
    valores: ['saida', 'raiz', 'relatorio', 'voz', 'modo', 'falas', 'catalogo', 'modelo', 'lote', 'limite', 'passo'],
    marcas: ['mover', 'sem-whisper'],
  });
  const saida = path.resolve(typeof args.saida === 'string' ? args.saida : SAIDA_PADRAO);
  const raiz = path.resolve(typeof args.raiz === 'string' ? args.raiz : saida);
  const relatorio = path.resolve(typeof args.relatorio === 'string' ? args.relatorio : arquivoConferencia(saida));
  if (args.mover && raiz !== saida) throw new Error('--mover só vale para a pasta de gravação, nunca para os arquivos do programa.');
  const usarWhisper = !args['sem-whisper'];
  const modelo = typeof args.modelo === 'string' ? args.modelo : process.env.VS_WHISPER_MODEL || MODELO_PADRAO;
  if (usarWhisper && !fs.existsSync(modelo)) throw new Error('Modelo do Whisper não encontrado. Indique com --modelo=caminho.');
  const tamanhoLote = Math.max(1, Number(args.lote) || 10);
  const limite = Number(args.limite) || Infinity;
  const passo = Math.max(1, Number(args.passo) || 1);
  const catalogo = carregarCatalogo(args);
  const vozes = escolherVozes(args);
  const modos = escolherModos(args);
  const dados = lerJson(relatorio, { arquivos: {} });

  const presentes = [];
  for (const voz of vozes) {
    for (const modo of modos) {
      catalogo.forEach((cue, i) => {
        if (i % passo !== 0) return;
        const rel = caminhoRelativo(voz.dir, modo, cue.id);
        const caminho = path.join(raiz, rel);
        if (fs.existsSync(caminho)) presentes.push({ rel, caminho, cue });
      });
    }
  }
  const fila = [];
  for (const item of presentes) {
    if (fila.length >= limite) break;
    item.sha = sha256(item.caminho);
    const antes = dados.arquivos[item.rel];
    if (antes?.sha256 === item.sha && (antes.whisper || !usarWhisper)) continue; // já conferido
    item.duracao = duracaoDe(item.caminho);
    fila.push(item);
  }
  console.log(`Presentes: ${milhar(presentes.length)}. A conferir: ${milhar(fila.length)}.`);

  for (let i = 0; i < fila.length; i += tamanhoLote) {
    const lote = fila.slice(i, i + tamanhoLote);
    const ouvidos = usarWhisper ? transcreverLote(lote, modelo) : lote.map(() => undefined);
    lote.forEach((item, k) => {
      // no lote, uma palavra pode cair na fala vizinha: só reprova depois de ouvir a fala sozinha
      if (usarWhisper && lote.length > 1 && avaliar(item.cue, item.duracao, ouvidos[k]).length) {
        [ouvidos[k]] = transcreverLote([item], modelo);
      }
      const motivos = avaliar(item.cue, item.duracao, ouvidos[k]);
      dados.arquivos[item.rel] = { sha256: item.sha, ok: motivos.length === 0, motivos, duracao: Number(item.duracao.toFixed(3)), ouvido: ouvidos[k], whisper: usarWhisper };
    });
    gravarJson(relatorio, dados); // retoma do último lote se parar no meio
    if (usarWhisper) console.log(`${Math.min(i + tamanhoLote, fila.length)} de ${fila.length} conferidas.`);
  }

  const atuais = presentes.map((p) => [p.rel, dados.arquivos[p.rel]]).filter(([, d]) => d);
  const reprovados = atuais.filter(([, d]) => !d.ok);
  for (const [rel, d] of reprovados.slice(0, 40)) console.log(`REPROVADO ${rel}: ${d.motivos.join('; ')}`);
  if (reprovados.length > 40) console.log(`... e mais ${reprovados.length - 40}.`);
  if (args.mover) {
    for (const [rel] of reprovados) {
      const destino = path.join(saida, '_reprovados', rel);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.renameSync(path.join(saida, rel), destino); // o gravar.mjs volta a ver essa fala como faltando
      delete dados.arquivos[rel];
    }
    gravarJson(relatorio, dados);
    if (reprovados.length) console.log(`${reprovados.length} movidos para _reprovados. Rode o gravar.mjs para regravar.`);
  }
  console.log(`Aprovados: ${milhar(atuais.length - reprovados.length)}. Reprovados: ${milhar(reprovados.length)}.`);
  return reprovados.length ? 2 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => { process.exitCode = c; }).catch((e) => {
    console.error(`Erro: ${e.message}`);
    process.exitCode = 1;
  });
}
