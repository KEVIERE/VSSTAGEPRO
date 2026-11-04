// Voz brasileira de IA do Maestro (Qwen3-TTS): velocidade, texto, conversa com o programa de voz
// (um programa falso que imita o vs-maestro-voz) e o download do modelo contra um servidor local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DESKTOP = fileURLToPath(new URL('../desktop/', import.meta.url));
const qwenPath = path.join(DESKTOP, 'maestroQwen.js');
const downloadPath = path.join(DESKTOP, 'maestroVoiceDownload.js');

/** Carrega o motor de novo com outras variáveis de ambiente (o download lê a lista ao carregar). */
function fresh(env = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete require.cache[require.resolve(qwenPath)];
  delete require.cache[require.resolve(downloadPath)];
  const mods = { qwen: require(qwenPath), download: require(downloadPath) };
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  return { ...mods, restore };
}

const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `vs-qwen-${name}-`));
const { qwen } = fresh();

test('feminina, masculina, cubas e keven viram as vozes de IA; voz do Mac não é de IA', () => {
  assert.equal(qwen.qwenVoiceFor('cubas').ref, 'cubas');
  assert.equal(qwen.qwenVoiceFor('qwen:cubas').name, 'Cubas (IA)');
  assert.equal(qwen.qwenVoiceFor('keven').ref, 'keven');
  assert.equal(qwen.qwenVoiceFor('qwen:keven').name, 'Keven (IA)');
  assert.equal(qwen.qwenVoiceFor('feminina').ref, 'feminina');
  assert.equal(qwen.qwenVoiceFor('masculina').ref, 'masculina');
  assert.equal(qwen.qwenVoiceFor('qwen:masculina').gender, 'masculina');
  assert.equal(qwen.qwenVoiceFor('Luciana'), null);
});

test('rótulo de compasso vira só o número ("A1" não é "a um")', () => {
  assert.equal(qwen.stripCompassLabel('A1'), '1');
  assert.equal(qwen.stripCompassLabel('a 4'), '4');
  assert.equal(qwen.stripCompassLabel('B2'), 'B 2', 'outra letra pode ser nota: fica, separada do número');
  assert.equal(qwen.cleanText('  “Atenção”,\n banda  '), 'Atenção, banda');
});

test('fala comum: só acelera se não couber na marcação, até 1,35×; nunca desacelera', () => {
  assert.deepEqual(qwen.fitTempo(1.0, 2.0), { tempo: 1, seconds: 1, overflow: false });
  const cabe = qwen.fitTempo(2.6, 2.0);
  assert.equal(cabe.tempo, 1.3);
  assert.ok(Math.abs(cabe.seconds - 2.0) < 1e-9 && !cabe.overflow);
  const passa = qwen.fitTempo(4.0, 2.0);
  assert.equal(passa.tempo, 1.35);
  assert.ok(passa.overflow, 'nem em 1,35× coube: avisa');
  assert.equal(qwen.fitTempo(1.0, 0).tempo, 1, 'sem marcação: velocidade natural');
});

test('contagem: usa a velocidade escolhida e só acelera mais se o número não couber no tempo', () => {
  assert.equal(qwen.fitTempo(0.3, 0.5, 1.15).tempo, 1.15);
  const longo = qwen.fitTempo(0.8, 0.5, 1.15);
  assert.equal(longo.tempo, 1.6);
  assert.ok(Math.abs(longo.seconds - 0.5) < 1e-9);
  const enorme = qwen.fitTempo(1.2, 0.5, 1.0);
  assert.equal(enorme.tempo, 1.8);
  assert.ok(enorme.overflow);
  assert.equal(qwen.fitTempo(0.3, 0.5, 0.5).tempo, 0.85, 'velocidade abaixo do mínimo sobe para 0,85×');
});

test('limite de áudio: palavra solta tem pouco espaço para o modelo inventar; texto longo tem teto', () => {
  const um = qwen.maxTokensFor('Um!');
  assert.ok(um >= 30 && um <= 45, `"Um!" pode gerar até ${um} tokens`);
  assert.equal(qwen.maxTokensFor('x'.repeat(5000)), Math.ceil(150 * 12.5));
});

test('cada voz tem a sua semente fixa: todas as falas da voz saem do mesmo jeito', () => {
  assert.equal(qwen.seedFor('qwen:feminina'), qwen.seedFor('qwen:feminina'));
  assert.notEqual(qwen.seedFor('qwen:feminina'), qwen.seedFor('qwen:masculina'));
});

test('a contagem é falada de uma vez: "Um, dois, três, quatro."', () => {
  assert.equal(qwen.countUtterance(['Um!', 'Dois!', 'Três!', 'Quatro!']), 'Um, dois, três, quatro.');
});

test('sem o programa de voz no app: a voz de IA não fala e diz por quê (cai na voz do Mac)', () => {
  const m = fresh({ VS_MAESTRO_ENGINE_DIR: tmpDir('vazio'), VS_MAESTRO_MODEL_DIR: undefined });
  try {
    // a pasta de desenvolvimento pode ter o programa: só confere quando não tem
    if (m.qwen.engineDir()) return;
    const st = m.qwen.status();
    assert.equal(st.engine, false);
    assert.equal(st.ready, false);
    assert.ok(m.qwen.unavailableReason());
  } finally {
    m.restore();
  }
});

// ---------------------------------------------------------------------------------------------
// Programa de voz falso: responde como o vs-maestro-voz e grava um "som" com 150 ms de silêncio
// na frente e a fala 2% fora do zero (como o modelo entrega).

const FAKE_HELPER = `#!/usr/bin/python3
import sys, json, struct, math
def send(o):
    sys.stdout.write('@@VS ' + json.dumps(o) + '\\n'); sys.stdout.flush()
print('biblioteca falando no stdout (o app tem de ignorar)'); sys.stdout.flush()
if '--model' not in sys.argv: send({'id': 'ready', 'ok': False, 'error': 'sem modelo'}); sys.exit(2)
send({'id': 'ready', 'ok': True, 'sampleRate': 24000})
for line in sys.stdin:
    r = json.loads(line)
    if r['cmd'] != 'speak': send({'id': r['id'], 'ok': True}); continue
    if not r.get('refText') or not r.get('ref') or r.get('language') != 'portuguese' or not r.get('maxTokens') or not r.get('temperature'):
        send({'id': r['id'], 'ok': False, 'error': 'pedido incompleto'}); continue
    sr = 24000; n = int(sr * 0.3)
    if ',' in r['text']:
        palavras = r['text'].count(',') + 1
        s = [0.0] * int(sr * 0.15)
        for k in range(palavras):
            s += [0.022 + 0.3 * math.sin(i / (6 + k)) for i in range(int(sr * (0.25 + 0.05 * k)))] + [0.0] * int(sr * 0.2)
    else:
        s = [0.0] * int(sr * 0.15) + [0.022 + 0.3 * math.sin(i / 7) for i in range(n)] + [0.0] * int(sr * 0.2)
    open(r['out'], 'wb').write(struct.pack('<%df' % len(s), *s))
    send({'id': r['id'], 'ok': True, 'samples': len(s), 'sampleRate': sr, 'elapsed': 0.01})
`;

function fakeEngine() {
  const engine = tmpDir('motor');
  fs.writeFileSync(path.join(engine, 'vs-maestro-voz'), FAKE_HELPER, { mode: 0o755 });
  fs.mkdirSync(path.join(engine, 'voices'));
  for (const v of ['feminina', 'masculina', 'cubas', 'keven']) {
    fs.writeFileSync(path.join(engine, 'voices', `${v}.wav`), 'x');
    fs.writeFileSync(path.join(engine, 'voices', `${v}.txt`), 'Boa noite, pessoal!\n');
  }
  const model = tmpDir('modelo');
  fs.writeFileSync(path.join(model, 'config.json'), '{}');
  return { engine, model };
}

const canRunFake = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync('/usr/bin/python3');

test('fala pelo programa de voz: começa justo no primeiro som e devolve a velocidade da contagem', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const { engine, model } = fakeEngine();
  const m = fresh({ VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmpDir('casa') });
  try {
    assert.equal(m.qwen.status().ready, true);
    const r = await m.qwen.render({ text: 'A1', voice: m.qwen.qwenVoiceFor('feminina'), span: 0.5, pace: 1.15 });
    assert.equal(r.tempo, 1.15, 'cabe no tempo: fica na velocidade escolhida');
    assert.ok(r.natural > 0.3 && r.natural < 0.4, `fala de ${r.natural.toFixed(3)}s (0,3 s de som + respiro curto)`);
    const first = (() => { for (let i = 0; i < (r.buf.length - 44) / 2; i++) if (Math.abs(r.buf.readInt16LE(44 + i * 2)) > 200) return i / 24000; return -1; })();
    assert.ok(first >= 0 && first <= 0.003, `o som começa em ${(first * 1000).toFixed(1)} ms`);
    // segunda fala usa o mesmo programa já aberto
    const r2 = await m.qwen.render({ text: 'Atenção, banda!', voice: m.qwen.qwenVoiceFor('masculina'), span: 2 });
    assert.equal(r2.tempo, 1);
    assert.equal(r2.cached, false);
    // a mesma fala de novo vem pronta (sem esperar o modelo), já com a velocidade da nova marcação
    const r3 = await m.qwen.render({ text: 'Atenção, banda!', voice: m.qwen.qwenVoiceFor('masculina'), span: 0.2 });
    assert.equal(r3.cached, true);
    assert.ok(r3.buf.equals(r2.buf));
    assert.equal(r3.tempo, 1.35);
    // contagem: falada de uma vez e cortada; todos os números na mesma velocidade (a do mais longo)
    const grupo = ['Um!', 'Dois!', 'Três!', 'Quatro!'];
    const fem = m.qwen.qwenVoiceFor('feminina');
    const dois = await m.qwen.render({ text: 'Dois!', voice: fem, span: 0.3, pace: 1.0, group: grupo });
    assert.equal(dois.group, true, 'veio da contagem falada de uma vez');
    assert.equal(dois.cached, false);
    const um = await m.qwen.render({ text: 'Um!', voice: fem, span: 0.3, pace: 1.0, group: grupo });
    assert.equal(um.cached, true, 'os outros números já saíram da mesma fala');
    assert.ok(um.natural < dois.natural, 'cada número é o seu pedaço (o segundo é mais longo)');
    assert.equal(um.tempo, dois.tempo, 'mesma velocidade em todos os números');
    const quatro = await m.qwen.render({ text: 'Quatro!', voice: fem, span: 0.3, pace: 1.0, group: grupo });
    assert.equal(quatro.tempo, um.tempo);
    assert.ok(quatro.tempo > 1, 'o mais longo não cabe em 0,3 s: todos aceleram juntos');
  } finally {
    m.qwen.stopHelper();
    m.restore();
  }
});

// ---------------------------------------------------------------------------------------------
// Download do modelo contra um servidor local

function serve(files) {
  const ranges = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.slice(1));
    const body = files[name];
    if (!body) { res.writeHead(404); res.end(); return; }
    const range = req.headers.range;
    ranges.push(range ?? null);
    if (range) {
      const from = Number(range.match(/bytes=(\d+)-/)[1]);
      res.writeHead(206, { 'Content-Length': body.length - from, 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` });
      res.end(body.subarray(from));
    } else {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, ranges, base: `http://127.0.0.1:${server.address().port}` })));
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function manifestFor(files, { wrongSha = null } = {}) {
  const file = path.join(tmpDir('lista'), 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({
    repo: 'teste/modelo', revision: 'abcdef1234567890',
    files: Object.entries(files).map(([p, b]) => ({ path: p, size: b.length, sha256: p === wrongSha ? '0'.repeat(64) : sha(b) })),
  }));
  return file;
}

const FILES = { 'model.safetensors': crypto.randomBytes(300_000), 'speech_tokenizer/config.json': Buffer.from('{"ok":true}') };

test('download: baixa tudo, confere o SHA-256 e só então marca como pronto', async () => {
  const { server, base } = await serve(FILES);
  const home = tmpDir('casa');
  const m = fresh({ VS_MAESTRO_MODEL_MANIFEST: manifestFor(FILES), VS_MAESTRO_MODEL_BASE_URL: base, VS_MAESTRO_MODEL_HOME: home });
  try {
    assert.equal(m.download.isReady(), false);
    await m.download.downloadAll();
    assert.equal(m.download.isReady(), true);
    assert.equal(m.download.status().state, 'ready');
    const dir = m.download.modelDir();
    assert.ok(fs.readFileSync(path.join(dir, 'model.safetensors')).equals(FILES['model.safetensors']));
    assert.ok(!fs.existsSync(path.join(dir, 'model.safetensors.part')));
  } finally {
    m.restore();
    server.close();
  }
});

test('download: continua de onde parou (pede só o que falta)', async () => {
  const { server, base, ranges } = await serve(FILES);
  const home = tmpDir('casa');
  const m = fresh({ VS_MAESTRO_MODEL_MANIFEST: manifestFor(FILES), VS_MAESTRO_MODEL_BASE_URL: base, VS_MAESTRO_MODEL_HOME: home });
  try {
    const dir = m.download.modelDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'model.safetensors.part'), FILES['model.safetensors'].subarray(0, 100_000));
    await m.download.downloadAll();
    assert.ok(ranges.includes('bytes=100000-'), `pediu ${JSON.stringify(ranges)}`);
    assert.ok(fs.readFileSync(path.join(dir, 'model.safetensors')).equals(FILES['model.safetensors']));
    assert.equal(m.download.isReady(), true);
  } finally {
    m.restore();
    server.close();
  }
});

test('download: arquivo que não confere é apagado e o modelo não fica pronto', async () => {
  const { server, base } = await serve(FILES);
  const home = tmpDir('casa');
  const m = fresh({ VS_MAESTRO_MODEL_MANIFEST: manifestFor(FILES, { wrongSha: 'model.safetensors' }), VS_MAESTRO_MODEL_BASE_URL: base, VS_MAESTRO_MODEL_HOME: home });
  try {
    await assert.rejects(m.download.downloadAll(), /não confere/);
    assert.equal(m.download.isReady(), false);
    assert.ok(!fs.existsSync(path.join(m.download.modelDir(), 'model.safetensors.part')), 'o pedaço errado não fica para trás');
  } finally {
    m.restore();
    server.close();
  }
});
