// Minhas frases do Maestro: a frase salva vira gravação permanente por voz (fora do limite do
// cache de falas), sai na hora sem gerar e some junto com a frase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSavedText, orphanPins } from '../src/lib/myPhrases.ts';

const require = createRequire(import.meta.url);
const DESKTOP = fileURLToPath(new URL('../desktop/', import.meta.url));
const qwenPath = path.join(DESKTOP, 'maestroQwen.js');
const downloadPath = path.join(DESKTOP, 'maestroVoiceDownload.js');
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `vs-frases-${name}-`));

function fresh(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete require.cache[require.resolve(qwenPath)];
  delete require.cache[require.resolve(downloadPath)];
  const qwen = require(qwenPath);
  return { qwen, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } } };
}

// programa de voz falso (o mesmo jeito do teste do motor): conta quantas falas gerou
const FAKE_HELPER = `#!/usr/bin/python3
import sys, json, struct, math, time
def send(o):
    sys.stdout.write('@@VS ' + json.dumps(o) + '\\n'); sys.stdout.flush()
send({'id': 'ready', 'ok': True, 'sampleRate': 24000})
for line in sys.stdin:
    r = json.loads(line)
    sr = 24000
    if 'Devagar' in r.get('text', ''): time.sleep(0.6)
    s = [0.0] * int(sr * 0.1) + [0.3 * math.sin(i / 7) for i in range(int(sr * 0.4))] + [0.0] * int(sr * 0.1)
    open(r['out'], 'wb').write(struct.pack('<%df' % len(s), *s))
    open(sys.argv[0] + '.count', 'a').write('x')
    send({'id': r['id'], 'ok': True, 'samples': len(s), 'sampleRate': sr, 'elapsed': 0.01})
`;

const canRunFake = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync('/usr/bin/python3');

test('frase salva: grava uma vez, fica fora do cache, sai na hora e some ao apagar', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const engine = tmpDir('motor');
  const helper = path.join(engine, 'vs-maestro-voz');
  fs.writeFileSync(helper, FAKE_HELPER, { mode: 0o755 });
  fs.mkdirSync(path.join(engine, 'voices'));
  for (const v of ['feminina', 'masculina']) {
    fs.writeFileSync(path.join(engine, 'voices', `${v}.wav`), 'x');
    fs.writeFileSync(path.join(engine, 'voices', `${v}.txt`), 'Boa noite, pessoal!\n');
  }
  const model = tmpDir('modelo');
  fs.writeFileSync(path.join(model, 'config.json'), '{}');
  const { qwen, restore } = fresh({ VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmpDir('casa'), VS_MAESTRO_FORCE_CPU: undefined });
  const generated = () => { try { return fs.readFileSync(`${helper}.count`, 'utf8').length; } catch { return 0; } };
  try {
    const texto = 'Vamos para o refrão!';
    assert.deepEqual(qwen.pinnedStates({ texts: [texto], voice: 'qwen:feminina' }), { [texto]: 'nao' });
    assert.equal(await qwen.pinPhrase({ text: texto, voice: 'qwen:feminina' }), 'gravada');
    assert.equal(generated(), 1);
    assert.equal(qwen.pinnedStates({ texts: [texto], voice: 'qwen:feminina' })[texto], 'gravada');
    assert.equal(qwen.pinnedStates({ texts: [texto], voice: 'qwen:masculina' })[texto], 'nao', 'cada voz tem a sua gravação');
    const salvos = fs.readdirSync(qwen.pinnedDir(), { recursive: true }).filter((f) => String(f).endsWith('.wav'));
    assert.equal(salvos.length, 1);

    // o cache comum some (limite de 400): a frase salva continua saindo sem gerar
    fs.rmSync(path.join(qwen.pinnedDir(), '..', 'falas-prontas'), { recursive: true, force: true });
    const r = await qwen.render({ text: texto, voice: qwen.qwenVoiceFor('feminina'), span: 0 });
    assert.equal(r.cached, true);
    assert.equal(generated(), 1, 'não gerou de novo');

    // gravar de novo não gera
    assert.equal(await qwen.pinPhrase({ text: texto, voice: 'qwen:feminina' }), 'gravada');
    assert.equal(generated(), 1);

    // música tocando: a gravação espera parar
    qwen.setPlaying(true);
    let done = false;
    const pending = qwen.pinPhrase({ text: 'Segura a ponte!', voice: 'qwen:masculina' }).then((s) => { done = true; return s; });
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(done, false, 'não gera com a música tocando');
    assert.equal(qwen.pinnedStates({ texts: ['Segura a ponte!'], voice: 'qwen:masculina' })['Segura a ponte!'], 'gravando');
    qwen.setPlaying(false);
    assert.equal(await pending, 'gravada');

    // a música começa enquanto a gravação espera a vez na fila: só grava depois de parar
    let fim = false;
    const fala = qwen.render({ text: 'Devagar, na frente da fila.', voice: qwen.qwenVoiceFor('feminina'), span: 0 });
    await new Promise((res) => setTimeout(res, 50)); // a fala lenta já está gerando
    const naFila = qwen.pinPhrase({ text: 'Esperando a vez!', voice: 'qwen:feminina' }).then((s) => { fim = true; return s; });
    await new Promise((res) => setTimeout(res, 150)); // a gravação já entrou na fila, atrás da fala
    qwen.setPlaying(true);
    await fala;
    const antes = generated();
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(fim, false, 'a música começou com a gravação na fila: não grava');
    assert.equal(generated(), antes);
    qwen.setPlaying(false);
    assert.equal(await naFila, 'gravada');

    // apagar durante a gravação: espera terminar e apaga, sem deixar arquivo órfão
    const meio = qwen.pinPhrase({ text: 'Apaga no meio!', voice: 'qwen:masculina' });
    assert.equal(await qwen.unpinPhrase({ text: 'Apaga no meio!', voice: 'qwen:masculina' }), true);
    await meio;
    assert.equal(qwen.pinnedStates({ texts: ['Apaga no meio!'], voice: 'qwen:masculina' })['Apaga no meio!'], 'nao');

    assert.equal(await qwen.unpinPhrase({ text: texto, voice: 'qwen:feminina' }), true);
    assert.equal(qwen.pinnedStates({ texts: [texto], voice: 'qwen:feminina' })[texto], 'nao');

    // voz Maestro (falas prontas) não grava aqui
    await assert.rejects(qwen.pinPhrase({ text: texto, voice: 'pronta:felipe' }), /não grava/);
  } finally {
    qwen.stopHelper();
    restore();
  }
});

test('apagar a frase só apaga a gravação quando nenhuma pasta tem mais a frase', () => {
  const before = { folders: [
    { id: 'a', name: 'A', phrases: [{ id: '1', text: 'Oi', voices: ['qwen:feminina', 'clone:eu'] }, { id: '2', text: 'Tchau', voices: ['qwen:masculina'] }] },
    { id: 'b', name: 'B', phrases: [{ id: '3', text: 'Tchau' }] },
  ] };
  const after = { folders: [{ id: 'b', name: 'B', phrases: [{ id: '3', text: 'Tchau' }] }] };
  assert.deepEqual(orphanPins(before, after), [{ text: 'Oi', voice: 'qwen:feminina' }, { text: 'Oi', voice: 'clone:eu' }]);
  assert.deepEqual(orphanPins(before, before), []);
});

test('Criar fala entra na fila, mostra o LED e não gera com a música tocando', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../src/components/maestro/MyPhrasesPicker.tsx', import.meta.url)), 'utf8');
  assert.match(src, /export function createSpeech[\s\S]{0,1200}queuePin\(t, voice\);/);
  assert.match(src, /await waitIdle\(\);[\s\S]{0,160}await pin\(/);
  assert.match(src, /if \(got !== 'gravada'\) return;/, 'gravação cancelada não marca a fala como pronta');
  assert.ok(!/maestroSpeak/.test(src), 'a aba não gera mais falas soltas em segundo plano');
  const main = fs.readFileSync(fileURLToPath(new URL('../desktop/main.js', import.meta.url)), 'utf8');
  assert.match(main, /maestroQwen\.setPlaying\(!!playing\)/);
});

test('frase apagada antes da vez não é gravada; apagada durante a gravação, a gravação sai', () => {
  const data = { folders: [{ id: 'a', name: 'A', phrases: [{ id: '1', text: 'Oi' }] }] };
  assert.equal(isSavedText(data, 'Oi'), true);
  assert.equal(isSavedText(data, 'Tchau'), false);
  assert.equal(isSavedText({ folders: [] }, 'Oi'), false);
  const src = fs.readFileSync(fileURLToPath(new URL('../src/components/maestro/MyPhrasesPicker.tsx', import.meta.url)), 'utf8');
  assert.match(src, /if \(!isSavedText\(loadMyPhrases\(\), text\)\) return;\s*\n\s*await waitIdle\(\);\s*\n\s*if \(!isSavedText\(loadMyPhrases\(\), text\)\) return;/);
  assert.match(src, /else await window\.vsDesktop\?\.maestroUnpinPhrase\?\.\(\{ text, voice \}\)/);
});

test('fala gravada sai do disco com o modelo indisponível; fala nova continua dando erro', { skip: !canRunFake && 'só em Mac com chip Apple' }, async () => {
  const engine = tmpDir('motor');
  const helper = path.join(engine, 'vs-maestro-voz');
  fs.writeFileSync(helper, FAKE_HELPER, { mode: 0o755 });
  fs.mkdirSync(path.join(engine, 'voices'));
  for (const v of ['feminina', 'masculina']) {
    fs.writeFileSync(path.join(engine, 'voices', `${v}.wav`), 'x');
    fs.writeFileSync(path.join(engine, 'voices', `${v}.txt`), 'Boa noite, pessoal!\n');
  }
  const model = tmpDir('modelo');
  fs.writeFileSync(path.join(model, 'config.json'), '{}');
  const { qwen, restore } = fresh({ VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmpDir('casa'), VS_MAESTRO_FORCE_CPU: undefined });
  try {
    const voice = qwen.qwenVoiceFor('feminina');
    assert.equal(await qwen.pinPhrase({ text: 'Fala guardada!', voice: 'qwen:feminina' }), 'gravada');
    qwen.stopHelper();
    fs.rmSync(model, { recursive: true, force: true });
    assert.ok(qwen.unavailableReason(), 'o modelo saiu');
    const r = await qwen.render({ text: 'Fala guardada!', voice, span: 0 });
    assert.equal(r.cached, true);
    await assert.rejects(qwen.render({ text: 'Fala que não existe', voice, span: 0 }));
  } finally {
    qwen.stopHelper();
    restore();
  }
});
