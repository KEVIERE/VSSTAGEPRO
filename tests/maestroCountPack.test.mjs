// Pacote de contagem das vozes clonadas e corte no ataque real da voz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const audio = require('../desktop/maestroAudio.js');
const RATE = 24000;
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `vs-pacote-${n}-`));
const seno = (s, amp, hz) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));
const chiado = (s, amp) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => amp * (i % 2 ? 1 : -1) * (0.7 + 0.3 * Math.sin(i / 11)));
const junta = (...p) => {
  const out = new Float32Array(p.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of p) { out.set(x, at); at += x.length; }
  return out;
};
const pcm = (wav) => {
  const { start, end } = audio.wavLayout(wav);
  return Float32Array.from({ length: (end - start) / 2 }, (_, i) => wav.readInt16LE(start + i * 2) / 32768);
};

test('o começo pega o "s" fraco e deixa de fora o ruído grave do modelo', () => {
  const x = junta(seno(0.2, 0.02, 90), chiado(0.08, 0.006), seno(0.3, 0.5, 200));
  const at = audio.speechOnset(x.length, RATE, (i) => x[i]) / RATE;
  assert.ok(at >= 0.195 && at <= 0.205, `começou em ${at}`);
});

test('corte preciso entra e sai no zero, sem estalo', () => {
  const x = junta(new Float32Array(2400), seno(0.3, 0.5, 200));
  const out = pcm(audio.trimSilence(audio.floatToWav(x, RATE), { preciseEdges: true }));
  assert.ok(Math.abs(out[0]) < 0.001);
  assert.ok(Math.abs(out[out.length - 1]) < 0.01);
  let salto = 0;
  for (let i = 1; i < 24; i++) salto = Math.max(salto, Math.abs(out[i] - out[i - 1]));
  assert.ok(salto < 0.12, `salto ${salto}`);
});

test('fim do número: mantém a sílaba fraca, encurta o "s" arrastado e tira a respiração', () => {
  const fraca = junta(seno(0.2, 0.5, 200), seno(0.1, 0.03, 200), new Float32Array(2400));
  const fim = audio.speechEnd(0, fraca.length - 1, RATE, (i) => fraca[i]) / RATE;
  assert.ok(fim >= 0.29 && fim <= 0.31, `sílaba fraca terminou em ${fim}`);
  const s = junta(seno(0.2, 0.5, 200), chiado(0.4, 0.05));
  const fimS = audio.speechEnd(0, s.length - 1, RATE, (i) => s[i]) / RATE;
  assert.ok(fimS <= 0.39, `"s" terminou em ${fimS}`);
});

test('confere o número: curto, longo e repetido são recusados', () => {
  const wav = (x) => audio.floatToWav(x, RATE);
  assert.equal(audio.checkCountWord(wav(seno(0.4, 0.3, 200)), 1).ok, true);
  assert.equal(audio.checkCountWord(wav(seno(0.1, 0.3, 200)), 1).reason, 'curta');
  assert.equal(audio.checkCountWord(wav(seno(1.2, 0.3, 200)), 1).reason, 'longa');
  assert.equal(audio.checkCountWord(wav(junta(seno(0.2, 0.3, 200), new Float32Array(4800), seno(0.2, 0.3, 200))), 2).reason, 'repetida');
});

test('as palavras do pacote são as mesmas da tela de contagem', () => {
  const src = fs.readFileSync(new URL('../src/lib/narrations.ts', import.meta.url), 'utf8');
  const lista = /NUMBER_WORDS = \[([\s\S]*?)\]/.exec(src)[1].match(/'[^']+'/g).map((w) => w.slice(1, -1));
  const qwen = require('../desktop/maestroQwen.js');
  assert.deepEqual(qwen.COUNT_WORDS.map((e) => e.word), lista);
});

const canRunFake = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync('/usr/bin/python3');
// "Dois!" sai repetido na primeira vez; "Sete!" sai sempre curto demais
const FAKE = `#!/usr/bin/python3
import sys, json, struct, math
def send(o):
    sys.stdout.write('@@VS ' + json.dumps(o) + '\\n'); sys.stdout.flush()
send({'id': 'ready', 'ok': True, 'sampleRate': 24000})
vezes = {}
tom = lambda n: [0.4 * math.sin(i * 0.05) for i in range(n)]
for line in sys.stdin:
    r = json.loads(line)
    t = r['text']
    vezes[t] = vezes.get(t, 0) + 1
    open(sys.argv[0] + '.falas', 'a').write(t + '\\n')
    s = [0.0] * 2400 + tom(8000)
    if t == 'Dois!' and vezes[t] == 1: s = s + [0.0] * 6000 + tom(8000)
    if t == 'Sete!': s = [0.0] * 2400 + tom(600)
    open(r['out'], 'wb').write(struct.pack('<%df' % len(s), *s))
    send({'id': r['id'], 'ok': True, 'sampleRate': 24000, 'elapsed': 0.01})
`;

function motor() {
  const engine = tmp('programa');
  const programa = path.join(engine, 'vs-maestro-voz');
  fs.writeFileSync(programa, FAKE, { mode: 0o755 });
  fs.mkdirSync(path.join(engine, 'voices'));
  for (const v of ['feminina', 'masculina']) {
    fs.writeFileSync(path.join(engine, 'voices', `${v}.wav`), 'x');
    fs.writeFileSync(path.join(engine, 'voices', `${v}.txt`), 'Boa noite, pessoal!\n');
  }
  const model = tmp('modelo');
  fs.writeFileSync(path.join(model, 'config.json'), '{}');
  const vozes = tmp('vozes');
  const dir = path.join(vozes, 'teste-abc123');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ name: 'Teste', gender: 'masculina', created: '2026-01-01', masterVersion: 3 }));
  fs.writeFileSync(path.join(dir, 'voz-normal.wav'), audio.floatToWav(seno(1, 0.3, 200), RATE));
  fs.writeFileSync(path.join(dir, 'texto-normal.txt'), 'Texto lido na gravação.');
  const env = { VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmp('casa'), VS_MAESTRO_CLONES_HOME: vozes, VS_MAESTRO_FORCE_CPU: undefined };
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const paths = ['../desktop/maestroQwen.js', '../desktop/maestroVoiceDownload.js'].map((p) => require.resolve(p));
  for (const p of paths) delete require.cache[p];
  const m = require(paths[0]);
  const falas = () => { try { return fs.readFileSync(`${programa}.falas`, 'utf8').trim().split('\n'); } catch { return []; } };
  const restore = () => {
    m.stopHelper();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const p of paths) delete require.cache[p];
  };
  return { m, dir, falas, restore };
}

const espera = async (cond, ms = 15000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

test('pacote: espera a música, regrava o ruim, registra a falha e sai na hora', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const { m, dir, falas, restore } = motor();
  const id = 'clone:teste-abc123';
  try {
    m.setPlaying(true);
    assert.equal(await m.ensureCountPack(id), true);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(falas().length, 0, 'com música não gera');
    m.setPlaying(false);
    assert.ok(await espera(() => !['gerando', 'na-fila'].includes(m.countPackStatus(id).state)), 'terminou');
    const st = m.countPackStatus(id);
    assert.equal(st.state, 'falhou');
    assert.equal(st.done, 15);
    assert.match(st.error, /Sete/);
    assert.equal(falas().filter((t) => t === 'Dois!').length, 2, 'regravou o repetido');
    assert.equal(falas().filter((t) => t === 'Sete!').length, 3, 'parou no limite de tentativas');
    const antes = falas().length;
    const w = await m.countWord({ voice: id, word: 'Três!' });
    assert.ok(w.seconds > 0.2 && Buffer.from(w.wavBase64, 'base64').length > 44);
    assert.equal(await m.countWord({ voice: id, word: 'Sete!' }), null);
    const voice = m.qwenVoiceFor(id);
    const r = await m.render({ text: 'Dois!', voice, span: 0.5, pace: 1, group: ['Um!', 'Dois!', 'Três!', 'Quatro!'] });
    assert.equal(r.cached, true);
    assert.equal(falas().length, antes, 'contagem pronta não chama o modelo');
    assert.ok(fs.existsSync(path.join(dir, 'contagem')), 'fica na pasta da voz');
  } finally {
    restore();
  }
});

test('apagar a voz para o pacote e nada volta para a pasta', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const { m, dir, falas, restore } = motor();
  const id = 'clone:teste-abc123';
  try {
    await m.ensureCountPack(id);
    assert.ok(await espera(() => falas().length >= 1));
    await m.cancelCountPacks(id);
    fs.rmSync(dir, { recursive: true, force: true });
    const depois = falas().length;
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(falas().length <= depois + 1);
    assert.equal(fs.existsSync(dir), false);
  } finally {
    restore();
  }
});

test('frase salva antes do corte novo continua valendo, sem gerar de novo', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const { m, falas, restore } = motor();
  const id = 'clone:teste-abc123';
  try {
    const voice = m.qwenVoiceFor(id);
    const texto = 'Vamos pra ponte!';
    const antiga = m.legacyPinnedFile(voice, texto);
    fs.mkdirSync(path.dirname(antiga), { recursive: true });
    fs.writeFileSync(antiga, audio.floatToWav(seno(0.5, 0.3, 200), RATE));
    assert.equal(m.pinnedStates({ texts: [texto], voice: id })[texto], 'gravada');
    const r = await m.render({ text: texto, voice, span: 0 });
    assert.equal(r.cached, true);
    assert.equal(falas().length, 0);
    assert.ok(fs.existsSync(antiga), 'o arquivo do dono continua lá');
  } finally {
    restore();
  }
});
