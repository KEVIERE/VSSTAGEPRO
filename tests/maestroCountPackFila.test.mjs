// Fila do pacote de contagem: prioridade do pedido da tela, programa de voz que morre e grupo inteiro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const audio = require('../desktop/maestroAudio.js');
const RATE = 24000;
const canRunFake = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync('/usr/bin/python3');
const skip = !canRunFake && 'só em Mac com chip Apple';
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `vs-fila-${n}-`));
const seno = (s) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 200 * i) / RATE));

const CABECALHO = `#!/usr/bin/python3
import sys, json, struct, math, os
def send(o):
    sys.stdout.write('@@VS ' + json.dumps(o) + '\\n'); sys.stdout.flush()
send({'id': 'ready', 'ok': True, 'sampleRate': 24000})
`;
const NORMAL = `${CABECALHO}for line in sys.stdin:
    r = json.loads(line)
    open(sys.argv[0] + '.falas', 'a').write(os.path.basename(r['ref']) + ' ' + r['text'] + '\\n')
    n = 7000 + 900 * len(r['text'])
    s = [0.0] * 2400 + [0.4 * math.sin(i * 0.05) for i in range(n)]
    open(r['out'], 'wb').write(struct.pack('<%df' % len(s), *s))
    send({'id': r['id'], 'ok': True, 'sampleRate': 24000, 'elapsed': 0.01})
`;
const SEM_MEMORIA = `${CABECALHO}for line in sys.stdin:
    r = json.loads(line)
    open(sys.argv[0] + '.falas', 'a').write(r['text'] + '\\n')
    send({'id': r['id'], 'ok': False, 'error': 'A voz de IA não gerou a fala.'})
`;
const MORRE = `${CABECALHO}sys.exit(3)
`;

function motor(fake, modes = ['normal']) {
  const engine = tmp('programa');
  const programa = path.join(engine, 'vs-maestro-voz');
  fs.writeFileSync(programa, fake, { mode: 0o755 });
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
  for (const mode of modes) {
    fs.writeFileSync(path.join(dir, `voz-${mode}.wav`), audio.floatToWav(seno(1), RATE));
    fs.writeFileSync(path.join(dir, `texto-${mode}.txt`), 'Texto lido na gravação.');
  }
  const env = { VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmp('casa'), VS_MAESTRO_CLONES_HOME: vozes, VS_MAESTRO_FORCE_CPU: undefined };
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const paths = ['../desktop/maestroQwen.js', '../desktop/maestroVoiceDownload.js'].map((p) => require.resolve(p));
  for (const p of paths) delete require.cache[p];
  const m = require(paths[0]);
  const falas = () => { try { return fs.readFileSync(`${programa}.falas`, 'utf8').trim().split('\n'); } catch { return []; } };
  const restore = () => {
    m.cancelCountPacks('clone:teste-abc123');
    m.stopHelper();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    for (const p of paths) delete require.cache[p];
  };
  return { m, falas, restore };
}

const espera = async (cond, ms = 20000) => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

test('pedido da tela passa à frente e o pacote interrompido retoma sem repetir número', { skip }, async () => {
  const { m, falas, restore } = motor(NORMAL, ['normal', 'calma', 'forte']);
  const base = 'clone:teste-abc123';
  const forte = `${base}:forte`;
  try {
    m.setPlaying(true);
    m.startCountPacks(base);
    assert.equal(await m.ensureCountPack(forte), true);
    m.setPlaying(false);
    assert.ok(await espera(() => m.countPackStatus(forte).state === 'pronta'), 'o modo pedido terminou');
    const lista = falas();
    const primeira = lista.findIndex((f) => f.startsWith('voz-forte'));
    assert.ok(primeira >= 0 && primeira <= 1, `primeiro número do Forte só na fala ${primeira}`);
    assert.ok(await espera(() => [base, `${base}:calma`].every((id) => m.countPackStatus(id).state === 'pronta')), 'os outros modos terminaram');
    const todas = falas();
    assert.equal(new Set(todas).size, todas.length, 'nenhum número gerado duas vezes');
    assert.equal(todas.length, 48);
  } finally {
    restore();
  }
});

test('disparo automático mantém a ordem Normal, Calma, Forte', { skip }, async () => {
  const { m, falas, restore } = motor(NORMAL, ['normal', 'calma', 'forte']);
  const base = 'clone:teste-abc123';
  try {
    m.startCountPacks(base);
    assert.ok(await espera(() => m.countPackStatus(`${base}:forte`).state === 'pronta'));
    const modos = falas().map((f) => f.split(' ')[0]);
    assert.ok(modos.lastIndexOf('voz-normal.wav') < modos.indexOf('voz-calma.wav'));
    assert.ok(modos.lastIndexOf('voz-calma.wav') < modos.indexOf('voz-forte.wav'));
  } finally {
    restore();
  }
});

test('programa de voz que morre logo depois de abrir não prende a fila', { skip }, async () => {
  const { m, restore } = motor(MORRE);
  try {
    const voice = m.qwenVoiceFor('clone:teste-abc123');
    for (let i = 0; i < 3; i++) {
      const inicio = Date.now();
      await assert.rejects(m.render({ text: `Fala ${i}`, voice, span: 0 }), /fechou sozinha/);
      assert.ok(Date.now() - inicio < 5000, 'respondeu sem esperar o tempo limite');
    }
  } finally {
    restore();
  }
});

test('erro do motor para o pacote em vez de reabrir o modelo número a número', { skip }, async () => {
  const { m, falas, restore } = motor(SEM_MEMORIA);
  const id = 'clone:teste-abc123';
  try {
    await m.ensureCountPack(id);
    assert.ok(await espera(() => m.countPackStatus(id).state === 'falhou'));
    assert.equal(falas().length, 1);
    assert.match(m.countPackStatus(id).error, /não gerou/);
  } finally {
    restore();
  }
});

test('contagem com pacote parcial sai com o grupo completo e um tempo só', { skip }, async () => {
  const { m, falas, restore } = motor(NORMAL);
  const id = 'clone:teste-abc123';
  const group = ['Um!', 'Dois!', 'Três!', 'Quatro!'];
  try {
    const voice = m.qwenVoiceFor(id);
    assert.equal(await m.speechState({ text: 'Um!', voice, span: 0.3, group }), 'nao');
    const saidas = [];
    for (const text of group) saidas.push(await m.render({ text, voice, span: 0.3, pace: 1, group }));
    assert.equal(new Set(saidas.map((r) => r.tempo)).size, 1, 'mesma velocidade em todos');
    assert.deepEqual(falas().map((f) => f.split(' ')[1]).sort(), [...group].sort());
  } finally {
    restore();
  }
});
