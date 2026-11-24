// Scripts de gravação das falas do Maestro: tudo contra um servidor falso, sem tocar na ElevenLabs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { avaliar, palavrasCriticas, repartirPalavras, semelhanca } from '../scripts/maestro-falas/conferir.mjs';
import { carregarCatalogo, falar, planejar, textoParaVoz, VOZES } from '../scripts/maestro-falas/comum.mjs';

const require = createRequire(import.meta.url);
const { parseManifest } = require('../desktop/maestroPacks.js');
const DIR = path.resolve(import.meta.dirname, '../scripts/maestro-falas');
const CHAVE = 'chave-falsa-de-teste-123';
const semFfmpeg = spawnSync('ffmpeg', ['-version']).status !== 0;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vs-gravacao-'));

function mp3Falso() {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.6', '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1'], { maxBuffer: 1 << 22 });
  return r.stdout;
}

function ambiente() {
  const raiz = tmp();
  const saida = path.join(raiz, 'saida');
  const publico = path.join(raiz, 'publico');
  fs.mkdirSync(publico);
  const catalogo = path.join(raiz, 'catalogo.json');
  fs.writeFileSync(catalogo, JSON.stringify([{ id: 'refrao', text: 'Refrão' }, { id: 'ponte', text: 'Ponte' }]));
  const chave = path.join(raiz, 'chave');
  fs.writeFileSync(chave, `${CHAVE}\n`);
  return { raiz, saida, publico, catalogo, chave, base: ['--saida=' + saida, '--publico=' + publico, '--catalogo=' + catalogo] };
}

async function servidorFalso({ usados = 0, limite = 100000, status } = {}) {
  const log = { tts: [], saldo: 0, chaves: new Set() };
  const conta = { usados };
  const audio = mp3Falso();
  const server = http.createServer((req, res) => {
    log.chaves.add(req.headers['xi-api-key']);
    const json = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/user/subscription') { log.saldo++; json({ character_count: conta.usados, character_limit: limite }); return; }
    if (req.url === '/v1/voices') { json({ voices: [{ voice_id: 'id-felipe', name: 'Felipe Leão' }, { voice_id: 'id-carla', name: 'Novelinha moça' }] }); return; }
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const dados = JSON.parse(corpo);
      log.tts.push({ url: req.url, ...dados });
      const s = status?.(log.tts.length);
      if (s) { res.statusCode = s; res.end('{}'); return; }
      conta.usados += dados.text.length;
      res.setHeader('content-type', 'audio/mpeg');
      res.end(audio);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { log, url: `http://127.0.0.1:${server.address().port}`, fechar: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

function rodar(script, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(DIR, script), ...args], { env: { ...process.env, VS_ELEVEN_ESPERA_MS: '1', ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}

const envDe = (a, s) => ({ VS_ELEVEN_BASE: s.url, VS_ELEVEN_KEY_FILE: a.chave });

test('catálogo: 1.344 falas, sem duplicar as marcadas JA-EXISTE', () => {
  const lista = carregarCatalogo();
  assert.equal(lista.length, 1344);
  assert.equal(new Set(lista.map((c) => c.id)).size, 1344);
  assert.ok(!lista.some((c) => c.id.startsWith('JA-EXISTE')));
});

test('pronúncia: número por extenso, termo em inglês como se fala e tag de intensidade', () => {
  assert.equal(falar('Verso 1'), 'Verso um');
  assert.equal(falar('Só o pad'), 'Só o pédi');
  assert.equal(falar('Medley'), 'Médlei');
  assert.equal(falar('Parte B'), 'Parte bê');
  assert.equal(textoParaVoz({ id: 'refrao', spoken: 'Refrão' }, 'calma'), '[calm, steady voice] Refrão.');
  assert.equal(textoParaVoz({ id: 'tres', spoken: 'Três' }, 'forte'), '[excited, short punchy shout] Três!');
});

test('plano: o que já está no programa não entra', () => {
  const a = ambiente();
  fs.mkdirSync(path.join(a.publico, 'carla'));
  fs.writeFileSync(path.join(a.publico, 'carla', 'refrao.mp3'), 'x');
  const cat = [{ id: 'refrao', text: 'Refrão', spoken: 'Refrão' }];
  const itens = planejar(cat, VOZES.filter((v) => v.dir === 'carla'), ['normal', 'calma'], { saida: a.saida, publico: a.publico });
  assert.deepEqual(itens.map((i) => i.rel), ['carla/calma/refrao.mp3']);
});

test('conferência reprova curto, longo, repetido e divergente', () => {
  const cue = { id: 'refrao', text: 'Refrão', spoken: 'Refrão' };
  assert.deepEqual(avaliar(cue, 0.6, 'Refrão.'), []);
  assert.match(avaliar(cue, 0.05, 'Refrão')[0], /curto/);
  assert.match(avaliar(cue, 9, 'Refrão')[0], /longo/);
  assert.ok(avaliar(cue, 0.6, 'Refrão. Refrão.').some((m) => /repetida/.test(m)));
  assert.ok(avaliar(cue, 0.6, 'Bom dia a todos').some((m) => /diferente/.test(m)));
  assert.match(avaliar({ id: 'dois', text: 'Dois', spoken: 'Dois' }, 1.1, 'Dois')[0], /longo/);
  assert.deepEqual(avaliar({ id: 'x', text: 'Levada de chá-chá-chá', spoken: 'Levada de chá chá chá' }, 1.2, 'Levada de chá chá chá'), []);
  assert.equal(semelhanca('Verso 2', 'verso dois'), 1);
});

test('conferência reprova palavra-chave trocada, mesmo com letras parecidas', () => {
  const casos = [['Verso 2', 'Verso três'], ['Sobe um tom', 'Desce um tom'], ['Refrão 2', 'Refrão três'], ['Parte C', 'parte bê']];
  for (const [text, ouvido] of casos) {
    const cue = { id: 'x', text, spoken: falar(text) };
    assert.ok(avaliar(cue, 1, ouvido).some((m) => /palavra-chave/.test(m)), ouvido);
    assert.deepEqual(avaliar(cue, 1, text), []);
  }
  assert.deepEqual(avaliar({ id: 'x', text: 'Verso 2', spoken: 'Verso dois' }, 1, 'Verso 2.'), []);
  assert.deepEqual(avaliar({ id: 'x', text: 'Parte B', spoken: 'Parte bê' }, 1, 'Parte B'), []);
  assert.deepEqual(avaliar({ id: 'catorze', text: 'Catorze', spoken: 'Catorze' }, 0.8, 'Quatorze'), []);
  assert.ok(avaliar({ id: 'treze', text: 'Treze', spoken: 'Treze' }, 0.6, 'Três').some((m) => /palavra-chave/.test(m)));
});

test('conferência: nenhuma fala do catálogo reprova contra a própria pronúncia', () => {
  for (const c of carregarCatalogo()) {
    assert.equal(palavrasCriticas(c.spoken), palavrasCriticas(c.text), c.id);
  }
});

test('lote: palavra com início esticado no silêncio fica na fala certa', () => {
  const janelas = [{ de: 1000, ate: 1500 }, { de: 2500, ate: 3000 }];
  const trechos = [{ de: 1000, ate: 1400, texto: ' Final' }, { de: 1500, ate: 2800, texto: ' Pausa' }];
  assert.deepEqual(repartirPalavras(trechos, janelas), ['Final', 'Pausa']);
});

test('ensaio não lê a chave nem usa a rede', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  const s = await servidorFalso();
  const r = await rodar('gravar.mjs', a.base, { VS_ELEVEN_BASE: s.url, VS_ELEVEN_KEY_FILE: path.join(a.raiz, 'nao-existe') });
  await s.fechar();
  assert.equal(r.code, 0);
  assert.match(r.out, /18 gravações/);
  assert.equal(s.log.saldo + s.log.tts.length, 0);
  assert.ok(!fs.existsSync(a.saida));
});

test('--gravar exige teto, e endereço fora do computador é recusado', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  const semTeto = await rodar('gravar.mjs', [...a.base, '--gravar', '--amostra'], { VS_ELEVEN_KEY_FILE: a.chave });
  assert.equal(semTeto.code, 1);
  assert.match(semTeto.out, /--teto/);
  const fora = await rodar('gravar.mjs', [...a.base, '--gravar', '--amostra', '--teto=100'], { VS_ELEVEN_BASE: 'https://exemplo.invalid', VS_ELEVEN_KEY_FILE: a.chave });
  assert.equal(fora.code, 1);
  assert.match(fora.out, /servidor local/);
  assert.ok(!fora.out.includes(CHAVE));
});

test('sem amostra aprovada não grava; aprovada, grava com modelo, idioma e sem vazar a chave', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  const s = await servidorFalso();
  const env = envDe(a, s);
  const barrado = await rodar('gravar.mjs', [...a.base, '--voz=will', '--gravar', '--teto=9999'], env);
  assert.equal(barrado.code, 2);
  assert.equal(s.log.tts.length, 0);
  assert.equal((await rodar('gravar.mjs', [...a.base, '--aprovar=will'], env)).code, 1); // sem amostra gravada
  const amostra = await rodar('gravar.mjs', [...a.base, '--voz=will', '--amostra', '--gravar', '--teto=9999'], env);
  assert.equal(amostra.code, 0, amostra.out);
  assert.equal(s.log.tts.length, 3); // no catálogo de teste, só "refrao" faz parte da amostra
  assert.equal((await rodar('gravar.mjs', [...a.base, '--aprovar=will'], env)).code, 0);
  const completa = await rodar('gravar.mjs', [...a.base, '--voz=will', '--gravar', '--teto=9999'], env);
  await s.fechar();
  assert.equal(completa.code, 0, completa.out);
  assert.equal(s.log.tts.length, 9); // a amostra fica à parte: a gravação completa faz as 6
  const ultimo = s.log.tts.at(-1);
  assert.match(ultimo.url, /^\/v1\/text-to-speech\/1oZawzZ4adgYtgm1oMqN\?/);
  assert.equal(ultimo.model_id, 'eleven_v4');
  assert.equal(ultimo.language_code, 'pt');
  assert.deepEqual([...s.log.chaves], [CHAVE]);
  for (const r of [barrado, amostra, completa]) assert.ok(!r.out.includes(CHAVE));
  const info = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'csv=p=0', path.join(a.saida, 'will/forte/ponte.mp3')], { encoding: 'utf8' });
  assert.equal(info.stdout.trim().split(',').slice(0, 3).join(','), 'mp3,44100,1');
});

test('pedido de ensaio ou opção errada nunca grava', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso();
  const env = envDe(a, s);
  for (const extra of [['--dry-run', '--gravar', '--teto=500'], ['--gravar=false', '--teto=500'], ['--gravr', '--teto=500'], ['--gravar', '--teto']]) {
    const r = await rodar('gravar.mjs', [...a.base, '--voz=will', ...extra], env);
    assert.equal(r.code, 1, extra.join(' '));
  }
  assert.equal((await rodar('gravar.mjs', [...a.base, '--voz=will', '--dry-run'], env)).code, 0);
  await s.fechar();
  assert.equal(s.log.tts.length + s.log.saldo, 0);
});

test('redirecionamento não leva a chave a outro endereço e para na hora', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const recebidos = [];
  const outro = http.createServer((req, res) => { recebidos.push(req.headers['xi-api-key']); res.end('{}'); });
  await new Promise((r) => outro.listen(0, '127.0.0.1', r));
  let tts = 0;
  const destino = `http://127.0.0.1:${outro.address().port}/roubo`;
  const api = http.createServer((req, res) => {
    if (req.url === '/v1/user/subscription') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ character_count: 0, character_limit: 9999 })); return; }
    tts++;
    req.resume();
    res.statusCode = 307;
    res.setHeader('location', destino);
    res.end();
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const r = await rodar('gravar.mjs', [...a.base, '--voz=will', '--gravar', '--teto=9999'], { VS_ELEVEN_BASE: `http://127.0.0.1:${api.address().port}`, VS_ELEVEN_KEY_FILE: a.chave });
  await new Promise((f) => { api.closeAllConnections(); api.close(f); });
  await new Promise((f) => { outro.closeAllConnections(); outro.close(f); });
  assert.equal(r.code, 2, r.out);
  assert.equal(tts, 1);
  assert.deepEqual(recebidos, []);
});

test('sem ffmpeg não lê a chave nem gasta', async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso().catch(() => null);
  const vazio = path.join(a.raiz, 'sem-programas');
  fs.mkdirSync(vazio);
  const r = await rodar('gravar.mjs', [...a.base, '--voz=will', '--gravar', '--teto=9999'], { VS_ELEVEN_BASE: s.url, VS_ELEVEN_KEY_FILE: a.chave, PATH: vazio });
  await s.fechar();
  assert.equal(r.code, 1);
  assert.match(r.out, /ffmpeg/);
  assert.equal(s.log.tts.length + s.log.saldo, 0);
});

test('áudio pago com falha no tratamento é reaproveitado sem nova cobrança', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso();
  const env = envDe(a, s);
  const bin = path.join(a.raiz, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\n[ "$1" = "-version" ] && exit 0\nexit 1\n', { mode: 0o755 });
  const args = [...a.base, '--voz=will', '--modo=normal', '--gravar', '--teto=9999'];
  const r1 = await rodar('gravar.mjs', args, { ...env, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r1.code, 2, r1.out);
  assert.match(r1.out, /não gravadas 2/);
  assert.equal(s.log.tts.length, 2);
  const r2 = await rodar('gravar.mjs', args, env);
  await s.fechar();
  assert.equal(r2.code, 0, r2.out);
  assert.equal(s.log.tts.length, 2);
  assert.ok(fs.existsSync(path.join(a.saida, 'will/ponte.mp3')));
  assert.deepEqual(fs.readdirSync(path.join(a.saida, '_bruto/will')), []);
});

test('Maestro IA: embutir mostra o tamanho, só copia com --confirmar e recusa o não aprovado', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  const audio = mp3Falso();
  const sha = crypto.createHash('sha256').update(audio).digest('hex');
  const notas = {};
  for (const modo of ['', 'calma/', 'forte/']) {
    fs.mkdirSync(path.join(a.saida, 'felipe', modo), { recursive: true });
    for (const id of ['refrao', 'ponte']) {
      const rel = `felipe/${modo}${id}.mp3`;
      fs.writeFileSync(path.join(a.saida, rel), audio);
      notas[rel] = { sha256: sha, ok: true, whisper: true };
    }
  }
  const destino = path.join(a.raiz, 'embutido');
  const args = [...a.base, '--voz=felipe', `--embutir=${destino}`];
  assert.equal((await rodar('empacotar.mjs', args)).code, 2); // sem conferência
  fs.writeFileSync(path.join(a.saida, 'conferencia.json'), JSON.stringify({ arquivos: notas }));
  const ver = await rodar('empacotar.mjs', args);
  assert.equal(ver.code, 0, ver.out);
  assert.match(ver.out, /6 arquivos novos/);
  assert.ok(!fs.existsSync(destino));
  const copia = await rodar('empacotar.mjs', [...args, '--confirmar']);
  assert.equal(copia.code, 0, copia.out);
  assert.ok(fs.existsSync(path.join(destino, 'felipe/forte/ponte.mp3')));
  assert.equal((await rodar('empacotar.mjs', [...a.base, '--voz=will', `--embutir=${destino}`])).code, 1);
});

function aprovar(a, voz) {
  const d = path.join(a.saida, 'aprovacoes.json');
  fs.mkdirSync(a.saida, { recursive: true });
  fs.writeFileSync(d, JSON.stringify({ [voz]: { em: 'teste' } }));
}

test('para antes do teto e retoma sem regravar', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso();
  const env = envDe(a, s);
  const args = [...a.base, '--voz=will', '--modo=normal'];
  const custo = textoParaVoz({ id: 'refrao', spoken: 'Refrão' }, 'normal').length;
  const r1 = await rodar('gravar.mjs', [...args, '--gravar', `--teto=${custo}`], env);
  assert.equal(r1.code, 2, r1.out);
  assert.match(r1.out, /Parou: teto/);
  assert.equal(s.log.tts.length, 1);
  const r2 = await rodar('gravar.mjs', [...args, '--gravar', '--teto=999'], env);
  await s.fechar();
  assert.equal(r2.code, 0, r2.out);
  assert.equal(s.log.tts.length, 2);
  assert.notEqual(s.log.tts[0].text, s.log.tts[1].text);
});

test('para quando o saldo da conta não cobre a próxima fala', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso({ usados: 996, limite: 1000 });
  const r = await rodar('gravar.mjs', [...a.base, '--voz=will', '--gravar', '--teto=9999'], envDe(a, s));
  await s.fechar();
  assert.equal(r.code, 2);
  assert.match(r.out, /Parou: saldo/);
  assert.equal(s.log.tts.length, 0);
});

test('franquia estourada (401) para na hora, sem insistir', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso({ status: () => 401 });
  const r = await rodar('gravar.mjs', [...a.base, '--voz=will', '--gravar', '--teto=9999'], envDe(a, s));
  await s.fechar();
  assert.equal(r.code, 2);
  assert.equal(s.log.tts.length, 1);
  assert.ok(!r.out.includes(CHAVE));
});

test('erro 500 tenta de novo e grava', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  aprovar(a, 'will');
  const s = await servidorFalso({ status: (n) => (n === 1 ? 500 : 0) });
  const r = await rodar('gravar.mjs', [...a.base, '--voz=will', '--modo=normal', '--gravar', '--teto=9999'], envDe(a, s));
  await s.fechar();
  assert.equal(r.code, 0, r.out);
  assert.equal(s.log.tts.length, 3);
  assert.ok(fs.existsSync(path.join(a.saida, 'will/refrao.mp3')));
});

test('pacote: recusa incompleto ou sem conferência; completo passa na validação do programa', { skip: semFfmpeg }, async () => {
  const a = ambiente();
  const audio = mp3Falso();
  const incompleto = await rodar('empacotar.mjs', [...a.base, '--voz=will']);
  assert.equal(incompleto.code, 2);
  const notas = {};
  for (const modo of ['', 'calma/', 'forte/']) {
    fs.mkdirSync(path.join(a.saida, 'will', modo), { recursive: true });
    for (const id of ['refrao', 'ponte']) {
      const rel = `will/${modo}${id}.mp3`;
      fs.writeFileSync(path.join(a.saida, rel), audio);
      notas[rel] = { sha256: crypto.createHash('sha256').update(audio).digest('hex'), ok: true, whisper: true };
    }
  }
  assert.equal((await rodar('empacotar.mjs', [...a.base, '--voz=will'])).code, 2); // sem conferência
  fs.writeFileSync(path.join(a.saida, 'conferencia.json'), JSON.stringify({ arquivos: notas }));
  const ok = await rodar('empacotar.mjs', [...a.base, '--voz=will', '--versao=v1']);
  assert.equal(ok.code, 0, ok.out);
  const pasta = path.join(a.saida, 'pacotes/will/v1');
  const bruto = fs.readFileSync(path.join(pasta, 'manifest.json'));
  const m = parseManifest(bruto, 'will', 'v1');
  assert.equal(m.files.length, 6);
  const trava = JSON.parse(fs.readFileSync(path.join(a.saida, 'pacotes/will-v1.trava.json'), 'utf8')).voices.will;
  assert.equal(trava.sha256, crypto.createHash('sha256').update(bruto).digest('hex'));
  assert.equal(trava.size, bruto.length);
  assert.equal((await rodar('empacotar.mjs', [...a.base, '--voz=felipe'])).code, 1);
});
