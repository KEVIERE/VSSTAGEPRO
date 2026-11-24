// Partes comuns dos scripts de gravação das falas do Maestro: vozes, catálogo, pronúncia e plano
// do que falta gravar. Nada aqui acessa a rede nem lê a chave da ElevenLabs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { READY_CUE_GROUPS, cueKey } from '../../src/lib/maestroCues.ts';

export const RAIZ = path.resolve(import.meta.dirname, '../..');
export const PUBLICO_PADRAO = path.join(RAIZ, 'public', 'maestro-falas');
export const SAIDA_PADRAO = path.join(os.homedir(), 'Documents', 'vs-stage-maestro-gravacao');
export const MODELO_TTS = 'eleven_v4';
export const MODOS = ['normal', 'calma', 'forte'];

/** As três vozes na tela: Maestro 1 (pasta felipe), Maestro 2 (will) e Maestro 3 (carla). */
export const VOZES = [
  { dir: 'felipe', id: 'pronta:felipe', label: 'Maestro 1', nomeEleven: 'Felipe Leão' },
  { dir: 'will', id: 'pronta:will', label: 'Maestro 2', elevenId: '1oZawzZ4adgYtgm1oMqN' },
  { dir: 'carla', id: 'pronta:carla', label: 'Maestro 3', elevenId: 'mPDAoQyGzxBSkE0OAOKw' },
];

/** Falas da amostra: palavra comum, número, contagem, termo estrangeiro e fala nova. */
export const IDS_AMOSTRA = ['refrao', 'verso-2', 'tres', 'entra-o-synth', 'levada-de-brega-funk'];

const TAGS = {
  calma: '[calm, steady voice]',
  normal: '[upbeat, confident band leader]',
  forte: '[excited, shouting over a loud band]',
};
const TAG_NUMERO_FORTE = '[excited, short punchy shout]';

/** Números gravados sozinhos: o corte é o de palavra solta e não podem passar de 1 s. */
const NUMEROS_SOLTOS = new Set(['um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis']);
export const ehPalavraSolta = (id) => NUMEROS_SOLTOS.has(id);

const POR_EXTENSO = { 1: 'um', 2: 'dois', 3: 'três', 4: 'quatro', 5: 'cinco', 6: 'seis', 7: 'sete', 8: 'oito', 9: 'nove' };

// Palavra estrangeira vai escrita como se fala no Brasil; o texto na tela não muda.
const PRONUNCIA = {
  medley: 'médlei', pad: 'pédi', riff: 'rífi', rock: 'róque', pop: 'pópi', funk: 'fânque',
  tag: 'tégui', vamp: 'vémpi', synth: 'sínti', backs: 'béques', shaker: 'chêiquer', click: 'clique',
  groove: 'grúvi', swing: 'suíngue', shuffle: 'châfou', reverb: 'riverbe', fade: 'fêide', out: 'áute',
  sax: 'sáxi', cajón: 'carrón',
};

function comMesmaCaixa(original, troca) {
  return original[0] === original[0].toUpperCase() ? troca[0].toUpperCase() + troca.slice(1) : troca;
}

/** Como a fala é escrita para a voz: números por extenso e termos estrangeiros aportuguesados. */
export function falar(texto) {
  const parte = texto.match(/^Parte ([ABC])$/);
  if (parte) return `Parte ${{ A: 'á', B: 'bê', C: 'cê' }[parte[1]]}`;
  return texto
    .replace(/\b[1-9]\b/g, (d) => POR_EXTENSO[d])
    .replace(/[\p{L}]+/gu, (p) => {
      const t = PRONUNCIA[p.toLowerCase()];
      return t ? comMesmaCaixa(p, t) : p;
    });
}

/** Texto enviado à ElevenLabs, com a tag de intensidade. */
export function textoParaVoz(cue, modo) {
  const tag = modo === 'forte' && ehPalavraSolta(cue.id) ? TAG_NUMERO_FORTE : TAGS[modo];
  const fim = /[.!?]$/.test(cue.spoken) ? '' : modo === 'calma' ? '.' : '!';
  return `${tag} ${cue.spoken}${fim}`;
}

/**
 * Lê as opções aceitando só as conhecidas: `valores` exigem --nome=valor e `marcas` são --nome puro.
 * Erro de digitação ou "--gravar=false" param aqui, em vez de mudar o que o comando faz.
 */
export function lerArgs(argv, { valores = [], marcas = [] } = {}) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!m) throw new Error(`Opção desconhecida: ${a}`);
    const [, nome, valor] = m;
    if (marcas.includes(nome)) {
      if (valor !== undefined) throw new Error(`--${nome} não aceita valor.`);
      args[nome] = true;
    } else if (valores.includes(nome)) {
      if (!valor) throw new Error(`--${nome} exige um valor (--${nome}=...).`);
      args[nome] = valor;
    } else {
      throw new Error(`Opção desconhecida: --${nome}`);
    }
  }
  return args;
}

/** A lista com a pronúncia das falas novas fica junto dos scripts; --falas troca por outra. */
function arquivoFalasNovas(args) {
  return typeof args.falas === 'string' ? args.falas : path.join(import.meta.dirname, 'falas-novas.json');
}

/**
 * Catálogo completo: as falas atuais mais as novas, sem repetir. O que está marcado JA-EXISTE e o
 * que já entrou em maestroCues.ts não duplica; a pronúncia escrita no arquivo de falas novas vale.
 */
export function carregarCatalogo(args = {}) {
  if (typeof args.catalogo === 'string') {
    return JSON.parse(fs.readFileSync(args.catalogo, 'utf8')).map((c) => ({ ...c, spoken: c.spoken ?? falar(c.text) }));
  }
  const lista = READY_CUE_GROUPS.flatMap((g) => g.cues).map((c) => ({ id: c.id, text: c.text, spoken: falar(c.text), origem: 'atual' }));
  const porId = new Map(lista.map((c) => [c.id, c]));
  const chaves = new Set(lista.map((c) => cueKey(c.text)));
  const novas = JSON.parse(fs.readFileSync(arquivoFalasNovas(args), 'utf8'));
  for (const g of novas.groups) {
    for (const c of g.cues) {
      if (c.id.startsWith('JA-EXISTE')) continue;
      const ja = porId.get(c.id);
      if (ja) { ja.spoken = c.spoken; ja.origem = 'nova'; continue; }
      const chave = cueKey(c.text);
      if (chaves.has(chave)) continue;
      chaves.add(chave);
      const nova = { id: c.id, text: c.text, spoken: c.spoken, origem: 'nova' };
      porId.set(c.id, nova);
      lista.push(nova);
    }
  }
  return lista;
}

export function caminhoRelativo(dir, modo, id) {
  return modo === 'normal' ? `${dir}/${id}.mp3` : `${dir}/${modo}/${id}.mp3`;
}

const temArquivo = (p) => {
  try { return fs.statSync(p).size > 0; } catch { return false; }
};

export function escolherVozes(args) {
  if (typeof args.voz !== 'string') return VOZES;
  const nomes = args.voz.split(',').map((s) => s.trim());
  for (const n of nomes) if (!VOZES.some((v) => v.dir === n)) throw new Error(`Voz desconhecida: ${n} (use felipe, will ou carla)`);
  return VOZES.filter((v) => nomes.includes(v.dir));
}

export function escolherModos(args) {
  if (typeof args.modo !== 'string') return MODOS;
  const nomes = args.modo.split(',').map((s) => s.trim());
  for (const n of nomes) if (!MODOS.includes(n)) throw new Error(`Modo desconhecido: ${n} (use normal, calma ou forte)`);
  return MODOS.filter((m) => nomes.includes(m));
}

/** O que falta gravar, na ordem de gravação. O que já está no programa ou na saída não entra. */
export function planejar(catalogo, vozes, modos, { saida, publico }) {
  const itens = [];
  for (const voz of vozes) {
    for (const modo of modos) {
      for (const cue of catalogo) {
        const rel = caminhoRelativo(voz.dir, modo, cue.id);
        if (temArquivo(path.join(publico, rel)) || temArquivo(path.join(saida, rel))) continue;
        const texto = textoParaVoz(cue, modo);
        itens.push({ voz, modo, cue, rel, texto, custo: texto.length });
      }
    }
  }
  return itens;
}

export function sha256(arquivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex');
}

export const arquivoConferencia = (saida) => path.join(saida, 'conferencia.json');
export const arquivoAprovacoes = (saida) => path.join(saida, 'aprovacoes.json');

export function lerJson(arquivo, padrao) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return padrao; }
}

/** Grava JSON de forma que uma queda no meio não deixe o arquivo pela metade. */
export function gravarJson(arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(dados, null, 1)}\n`);
  fs.renameSync(tmp, arquivo);
}

export const milhar = (n) => n.toLocaleString('pt-BR');
