#!/usr/bin/env node
// Grava na ElevenLabs só as falas que faltam, por voz e modo. Sem --gravar é um ensaio: mostra os
// caracteres, não lê a chave e não acessa a rede. Veja LEIA-ME.md.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { trimSpeechChannels } from '../../src/lib/speechTrim.ts';
import {
  IDS_AMOSTRA, MODELO_TTS, MODOS, PUBLICO_PADRAO, SAIDA_PADRAO, VOZES, arquivoAprovacoes, caminhoRelativo,
  carregarCatalogo, ehPalavraSolta, escolherModos, escolherVozes, gravarJson, lerArgs, lerJson, milhar, planejar, textoParaVoz,
} from './comum.mjs';

const TAXA = 44100;
/** Nível médio medido nas falas atuais do programa (36 arquivos: -20,0 dB). */
const VOLUME_ALVO_DB = -20;
const PICO_MAX_DB = -1;
const FRANQUIA_MENSAL = 131000;
const CONSULTA_A_CADA = 10;
const TENTATIVAS = 3;
const FALHAS_SEGUIDAS_MAX = 3;
const arquivoCusto = (saida) => path.join(saida, 'custo-medido.json');
const ESPERA_BASE_MS = Number(process.env.VS_ELEVEN_ESPERA_MS ?? 2000);

/** Decodifica, corta no ataque como o programa corta, iguala o volume e grava em MP3 mono de 96 kbps. */
export function tratarAudio(mp3, destino, { palavraSolta = false } = {}) {
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(TAXA), 'pipe:1'], { input: mp3, maxBuffer: 64 * 1024 * 1024 });
  if (dec.status !== 0 || !dec.stdout?.length) throw new Error('áudio recebido não pôde ser lido');
  const bruto = dec.stdout.buffer.slice(dec.stdout.byteOffset, dec.stdout.byteOffset + dec.stdout.length - (dec.stdout.length % 4));
  const [cortado] = trimSpeechChannels([new Float32Array(bruto)], TAXA, { singleWord: palavraSolta });
  let soma = 0;
  let pico = 0;
  for (const v of cortado) { soma += v * v; pico = Math.max(pico, Math.abs(v)); }
  if (!cortado.length || pico <= 0) throw new Error('áudio recebido está mudo');
  const rmsDb = 10 * Math.log10(soma / cortado.length);
  const ganhoDb = Math.min(VOLUME_ALVO_DB - rmsDb, PICO_MAX_DB - 20 * Math.log10(pico));
  const ganho = 10 ** (ganhoDb / 20);
  const saida = new Float32Array(cortado.length);
  for (let i = 0; i < cortado.length; i++) saida[i] = cortado[i] * ganho;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp.mp3`;
  const enc = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(TAXA), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '96k', tmp], { input: Buffer.from(saida.buffer) });
  if (enc.status !== 0) { fs.rmSync(tmp, { force: true }); throw new Error('falha ao gerar o MP3'); }
  fs.renameSync(tmp, destino); // só aparece pronto: uma queda no meio não conta como gravado
}

function baseDaApi() {
  const base = process.env.VS_ELEVEN_BASE;
  if (!base) return 'https://api.elevenlabs.io';
  const { hostname } = new URL(base);
  // a chave de verdade só pode sair para a ElevenLabs; endereço trocado é só para o servidor falso
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new Error('VS_ELEVEN_BASE só aceita servidor local.');
  return base.replace(/\/$/, '');
}

function lerChave() {
  const arquivo = process.env.VS_ELEVEN_KEY_FILE || path.join(os.homedir(), '.vsstage-elevenlabs-key');
  let chave = '';
  try { chave = fs.readFileSync(arquivo, 'utf8').trim(); } catch { /* mensagem abaixo */ }
  if (!chave) throw new Error('Chave da ElevenLabs não encontrada em ~/.vsstage-elevenlabs-key.');
  return chave;
}

class RedirecionamentoRecusado extends Error {}

async function pedir(base, chave, rota, init = {}) {
  // redirecionamento nunca é seguido: levaria a chave no cabeçalho para outro endereço
  const r = await fetch(`${base}${rota}`, { ...init, redirect: 'manual', headers: { 'xi-api-key': chave, ...init.headers }, signal: AbortSignal.timeout(90_000) });
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) {
    await r.arrayBuffer().catch(() => {});
    throw new RedirecionamentoRecusado(`a API pediu redirecionamento (HTTP ${r.status}); parei sem seguir`);
  }
  return r;
}

function exigirFfmpeg() {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) throw new Error('ffmpeg não encontrado: nada foi enviado à ElevenLabs.');
}

/** Resposta crua já paga. O nome leva voz, modelo e texto: pronúncia alterada não reaproveita áudio velho. */
function caminhoBruto(saida, item, idVoz) {
  const marca = crypto.createHash('sha256').update(`${idVoz}|${MODELO_TTS}|${item.texto}`).digest('hex').slice(0, 12);
  return path.join(saida, '_bruto', item.rel.replace(/\.mp3$/, `.${marca}.mp3`));
}

function guardarBruto(arquivo, audio) {
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(`${arquivo}.tmp`, audio);
    fs.renameSync(`${arquivo}.tmp`, arquivo);
  } catch (e) {
    console.error(`Não guardei a resposta crua: ${e.message}.`);
  }
}

/** Compara o que a conta cobrou com o que foi enviado. Só informa: o teto continua contando a tag. */
async function medirCusto(base, chave, saida, r) {
  if (!r.enviados) return;
  try {
    const { usados } = await consultarSaldo(base, chave);
    const cobrados = usados - r.saldoInicial;
    if (cobrados <= 0) return;
    const fator = Number((cobrados / r.enviados).toFixed(3));
    gravarJson(arquivoCusto(saida), { em: new Date().toISOString(), enviados: r.enviados, cobrados, fator });
    console.log(`Custo medido: ${milhar(cobrados)} cobrados por ${milhar(r.enviados)} enviados (fator ${fator}).`);
  } catch {
    console.error('Não consegui medir o custo real desta rodada.');
  }
}

async function consultarSaldo(base, chave) {
  const r = await pedir(base, chave, '/v1/user/subscription');
  if (!r.ok) throw new Error(`não consegui consultar o saldo (HTTP ${r.status})`);
  const d = await r.json();
  if (!Number.isFinite(d.character_count) || !Number.isFinite(d.character_limit)) throw new Error('resposta de saldo inesperada');
  return { usados: d.character_count, limite: d.character_limit, renova: d.next_character_count_reset_unix };
}

async function resolverIdsDeVoz(base, chave, vozes, args) {
  const ids = {};
  const faltam = [];
  for (const v of vozes) {
    const dado = args[`id-${v.dir}`];
    if (typeof dado === 'string') ids[v.dir] = dado;
    else if (v.elevenId) ids[v.dir] = v.elevenId;
    else faltam.push(v);
  }
  if (!faltam.length) return ids;
  const r = await pedir(base, chave, '/v1/voices');
  if (!r.ok) throw new Error(`não consegui listar as vozes (HTTP ${r.status})`);
  const { voices = [] } = await r.json();
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const v of faltam) {
    const achadas = voices.filter((x) => norm(x.name ?? '').includes(norm(v.nomeEleven)));
    if (achadas.length !== 1) {
      throw new Error(`A voz "${v.nomeEleven}" apareceu ${achadas.length} vez(es) na conta. Indique com --id-${v.dir}=ID.`);
    }
    ids[v.dir] = achadas[0].voice_id;
  }
  return ids;
}

function itensDaAmostra(catalogo, vozes, modos) {
  const escolhidas = IDS_AMOSTRA.map((id) => catalogo.find((c) => c.id === id)).filter(Boolean);
  const cues = escolhidas.length ? escolhidas : catalogo.slice(0, 3);
  return vozes.flatMap((voz) => modos.flatMap((modo) => cues.map((cue) => {
    const texto = textoParaVoz(cue, modo);
    return { voz, modo, cue, rel: `_amostra/${caminhoRelativo(voz.dir, modo, cue.id)}`, texto, custo: texto.length };
  })));
}

function mostrarPlano(itens, aprovadas, saida) {
  console.log('Voz          Modo     Falas   Caracteres (com tag)   Só o texto');
  let total = 0;
  let semTag = 0;
  for (const voz of VOZES) {
    for (const modo of MODOS) {
      const doGrupo = itens.filter((i) => i.voz.dir === voz.dir && i.modo === modo);
      if (!doGrupo.length) continue;
      const c = doGrupo.reduce((n, i) => n + i.custo, 0);
      const s = doGrupo.reduce((n, i) => n + i.cue.spoken.length, 0);
      total += c;
      semTag += s;
      console.log(`${voz.label.padEnd(12)} ${modo.padEnd(8)} ${String(doGrupo.length).padStart(5)}   ${milhar(c).padStart(20)}   ${milhar(s).padStart(10)}`);
    }
  }
  console.log(`TOTAL: ${milhar(itens.length)} gravações, ${milhar(total)} caracteres com tag, ${milhar(semTag)} só de texto.`);
  console.log(`Franquia de ${milhar(FRANQUIA_MENSAL)} por mês: ${(total / FRANQUIA_MENSAL).toFixed(1)} mês(es) contando a tag, ${(semTag / FRANQUIA_MENSAL).toFixed(1)} só o texto.`);
  const medido = lerJson(arquivoCusto(saida), null);
  if (medido?.fator > 0) {
    const real = Math.ceil(total * medido.fator);
    console.log(`Pelo custo medido (fator ${medido.fator}): ${milhar(real)} caracteres, ${(real / FRANQUIA_MENSAL).toFixed(1)} mês(es).`);
  }
  console.log(`Vozes aprovadas para a gravação completa: ${aprovadas.length ? aprovadas.join(', ') : 'nenhuma'}.`);
  return { total, semTag };
}

async function gravarItens(itens, { base, chave, ids, teto, saida }) {
  let saldo = await consultarSaldo(base, chave);
  const inicio = saldo.usados;
  console.log(`Saldo: ${milhar(saldo.limite - saldo.usados)} caracteres. Teto desta rodada: ${milhar(teto)}.`);
  let gastoLocal = 0;
  let desdeConsulta = 0;
  let pedidos = 0;
  let gravadas = 0;
  let enviados = 0;
  let falhasSeguidas = 0;
  // conta o maior entre o gasto somado aqui e o informado pela conta: nunca passa do teto por atraso
  const gasto = () => Math.max(gastoLocal, saldo.usados - inicio + desdeConsulta);
  const restante = () => saldo.limite - saldo.usados - desdeConsulta;
  const motivoParada = (custo) => {
    if (gasto() + custo > teto) return 'teto';
    if (custo > restante()) return 'saldo';
    return null;
  };
  const fim = (motivo) => ({ motivo, gravadas, faltaram: itens.length - gravadas, gasto: gasto(), enviados, saldoInicial: inicio });

  for (const item of itens) {
    const bruto = caminhoBruto(saida, item, ids[item.voz.dir]);
    const jaPago = fs.existsSync(bruto);
    let audio = jaPago ? fs.readFileSync(bruto) : null;
    for (let tentativa = 1; tentativa <= TENTATIVAS && !audio; tentativa++) {
      if (pedidos > 0 && pedidos % CONSULTA_A_CADA === 0) {
        saldo = await consultarSaldo(base, chave);
        desdeConsulta = 0;
      }
      const parada = motivoParada(item.custo);
      if (parada) return fim(parada);
      pedidos++;
      gastoLocal += item.custo;
      desdeConsulta += item.custo;
      let r;
      try {
        r = await pedir(base, chave, `/v1/text-to-speech/${encodeURIComponent(ids[item.voz.dir])}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: item.texto, model_id: MODELO_TTS, language_code: 'pt' }),
        });
      } catch (e) {
        if (e instanceof RedirecionamentoRecusado) return fim(e.message);
        r = null;
      }
      if (r?.ok) {
        audio = Buffer.from(await r.arrayBuffer());
        enviados += item.custo;
        guardarBruto(bruto, audio); // já foi pago: uma falha no tratamento não paga de novo
        break;
      }
      // lê o corpo do erro antes de seguir: resposta pendente seguraria a conexão e o processo aberto
      await r?.arrayBuffer().catch(() => {});
      if (r && (r.status === 401 || r.status === 402)) return fim(`recusado pela ElevenLabs (HTTP ${r.status}: chave ou franquia)`);
      const repetir = !r || r.status === 429 || r.status >= 500;
      console.error(`Falha em ${item.rel} (${r ? `HTTP ${r.status}` : 'rede'}), tentativa ${tentativa} de ${TENTATIVAS}.`);
      if (!repetir) break;
      if (tentativa < TENTATIVAS) await new Promise((ok) => setTimeout(ok, ESPERA_BASE_MS * 2 ** (tentativa - 1)));
    }
    try {
      if (!audio) throw new Error('sem áudio');
      tratarAudio(audio, path.join(saida, item.rel), { palavraSolta: ehPalavraSolta(item.cue.id) });
      fs.rmSync(bruto, { force: true });
      gravadas++;
      falhasSeguidas = 0;
      if (gravadas % 25 === 0) console.log(`${gravadas} gravadas, ${milhar(gasto())} caracteres.`);
    } catch (e) {
      console.error(`Não gravou ${item.rel}: ${e.message}.`);
      if (jaPago) { // a segunda falha com o mesmo áudio é do áudio: separa para a próxima rodada pedir outro
        const recusado = path.join(saida, '_bruto-recusado', path.relative(path.join(saida, '_bruto'), bruto));
        fs.mkdirSync(path.dirname(recusado), { recursive: true });
        fs.renameSync(bruto, recusado);
      }
      if (++falhasSeguidas >= FALHAS_SEGUIDAS_MAX) return fim('falhas seguidas');
    }
  }
  return fim(null);
}

async function main() {
  const args = lerArgs(process.argv.slice(2), {
    valores: ['saida', 'publico', 'voz', 'modo', 'falas', 'catalogo', 'teto', 'aprovar', 'id-felipe', 'id-will', 'id-carla'],
    marcas: ['gravar', 'amostra', 'dry-run'],
  });
  if (args.gravar && args['dry-run']) throw new Error('--dry-run e --gravar não podem vir juntos.');
  const saida = path.resolve(typeof args.saida === 'string' ? args.saida : SAIDA_PADRAO);
  const publico = path.resolve(typeof args.publico === 'string' ? args.publico : PUBLICO_PADRAO);
  const vozes = escolherVozes(args);
  const modos = escolherModos(args);
  const catalogo = carregarCatalogo(args);
  const aprovacoes = lerJson(arquivoAprovacoes(saida), {});

  if (typeof args.aprovar === 'string') {
    const voz = VOZES.find((v) => v.dir === args.aprovar);
    if (!voz) throw new Error(`Voz desconhecida: ${args.aprovar}`);
    const faltando = itensDaAmostra(catalogo, [voz], MODOS).filter((i) => !fs.existsSync(path.join(saida, i.rel)));
    if (faltando.length) throw new Error(`A amostra de ${voz.label} ainda não foi gravada (faltam ${faltando.length}).`);
    aprovacoes[voz.dir] = { em: new Date().toISOString() };
    gravarJson(arquivoAprovacoes(saida), aprovacoes);
    console.log(`${voz.label} aprovada para a gravação completa.`);
    return 0;
  }

  const novas = catalogo.filter((c) => c.origem === 'nova').length;
  console.log(`Catálogo: ${milhar(catalogo.length)} falas (${milhar(catalogo.length - novas)} atuais e ${milhar(novas)} novas), ${MODOS.length} modos, ${VOZES.length} vozes.`);
  const aprovadas = VOZES.filter((v) => aprovacoes[v.dir]).map((v) => v.dir);
  const plano = args.amostra
    ? itensDaAmostra(catalogo, vozes, modos).filter((i) => !fs.existsSync(path.join(saida, i.rel)))
    : planejar(catalogo, vozes, modos, { saida, publico });
  if (args.amostra) console.log('Amostra de teste para aprovação:');
  mostrarPlano(plano, aprovadas, saida);

  if (args.gravar !== true) {
    console.log('Ensaio: nada foi gravado, a chave não foi lida e a rede não foi usada. Para gravar: --gravar --teto=N.');
    return 0;
  }
  const teto = Number(args.teto);
  if (!Number.isInteger(teto) || teto <= 0) throw new Error('--gravar exige --teto=N (máximo de caracteres nesta rodada).');
  if (!plano.length) { console.log('Nada a gravar.'); return 0; }

  let fila = plano;
  if (!args.amostra) {
    // respeita a ordem: para na primeira voz sem amostra aprovada
    const barrada = vozes.find((v) => !aprovacoes[v.dir] && plano.some((i) => i.voz.dir === v.dir));
    if (barrada) {
      const liberadas = vozes.slice(0, vozes.indexOf(barrada)).map((v) => v.dir);
      fila = plano.filter((i) => liberadas.includes(i.voz.dir));
      console.log(`${barrada.label} não tem amostra aprovada: a gravação para antes dela. Use --amostra e depois --aprovar=${barrada.dir}.`);
      if (!fila.length) return 2;
    }
  }

  const base = baseDaApi();
  exigirFfmpeg();
  const chave = lerChave();
  const vozesDaFila = VOZES.filter((v) => fila.some((i) => i.voz.dir === v.dir));
  const ids = await resolverIdsDeVoz(base, chave, vozesDaFila, args);
  const r = await gravarItens(fila, { base, chave, ids, teto, saida });
  await medirCusto(base, chave, saida, r);
  console.log(`Gravadas ${milhar(r.gravadas)}, não gravadas ${milhar(r.faltaram)}, gasto de até ${milhar(r.gasto)} caracteres.`);
  if (r.motivo) {
    console.log(`Parou: ${r.motivo}. Rode de novo para continuar de onde parou.`);
    return 2;
  }
  if (r.faltaram > 0) {
    console.log(`Faltaram ${milhar(r.faltaram)} falas. Rode de novo para tentar só essas.`);
    return 2;
  }
  return fila.length === plano.length ? 0 : 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((c) => { process.exitCode = c; }).catch((e) => {
    console.error(`Erro: ${e.message}`);
    process.exitCode = 1;
  });
}
