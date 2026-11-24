// Lote 7 do plano de velocidade: a IA (separação de faixas, bateria e voz do Maestro) não disputa
// o processador nem o processo principal com o show.
//
// - prioridade abaixo do normal em todo programa de IA (nice 10 no Mac, BELOW_NORMAL no Windows);
// - fim da separação sem leitura síncrona e sem copiar cada faixa de novo;
// - preparo do motor de IA sem execSync (a janela não congela sem o motor embutido);
// - Python da bateria guardado entre músicas e esquecido quando o separador falha;
// - voz de IA parada pode ser fechada antes de separar (releaseIfIdle);
// - separação de um clipe monta o WAV em pedaços, com os mesmos bytes.
//
// Os programas de IA são falsos (scripts de shell e Python): nada de modelo de verdade aqui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeWavPcm24, encodeWavPcm24Async } from '../src/lib/wavEncoder.ts';

const require = createRequire(import.meta.url);
const DESKTOP = fileURLToPath(new URL('../desktop/', import.meta.url));
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const read = (file) => fs.readFileSync(file, 'utf8');
const tmpDir = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `vs-lote7-${name}-`));
const POSIX = process.platform !== 'win32';
const BELOW = os.constants.priority.PRIORITY_BELOW_NORMAL;
// O teste pode rodar já com nice (ex.: nice -n 10 npm test). os.setPriority põe o valor absoluto 10
// (sem poder subir a prioridade acima da do pai); o /usr/bin/nice -n 10 soma 10 à do pai.
const NICE_SET = String(Math.max(10, os.getPriority()));
const NICE_ADD = String(Math.min(20, os.getPriority() + 10));

function fresh(file) {
  const p = path.join(DESKTOP, file);
  delete require.cache[require.resolve(p)];
  return require(p);
}

/** Registra as chamadas de os.setPriority (e as executa de verdade). */
function spyPriority() {
  const real = os.setPriority;
  const calls = [];
  os.setPriority = (...args) => { calls.push(args); return real.apply(os, args); };
  return { calls, restore: () => { os.setPriority = real; } };
}

function withEnv(env) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

/** Motor embutido falso: process.resourcesPath/ai-engine/python/bin/python3 = `script`. */
function fakeEmbeddedPython(script) {
  const root = tmpDir('recursos');
  const bin = path.join(root, 'ai-engine', 'python', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'python3'), script, { mode: 0o755 });
  return root;
}

const demucsDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('vs_demucs_')));

// ---------------------------------------------------------------------------------------------
// Separação de faixas (stemSeparatorLocal.js)

// Demucs falso: grava as 6 faixas como "<nome>:<entrada>" e anota a prioridade em que rodou.
const FAKE_DEMUCS = `#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2;;
    -m|-n) shift 2;;
    *) inp="$1"; shift;;
  esac
done
[ -n "$VS_TESTE_ESPERA" ] && sleep "$VS_TESTE_ESPERA"
sleep 0.3
ps -o nice= -p $$ | tr -d ' ' > "$VS_TESTE_NICE"
echo " 50%|#####     |" >&2
d="$out/htdemucs_6s/input"
mkdir -p "$d"
for s in vocals bass drums other guitar piano; do
  if [ -n "$VS_TESTE_SEM_EXTRAS" ] && { [ "$s" = guitar ] || [ "$s" = piano ]; }; then continue; fi
  { printf '%s:' "$s"; cat "$inp"; } > "$d/$s.wav"
done
exit 0
`;

test('separação: devolve as 6 faixas com os bytes certos, em prioridade baixa, e apaga a pasta', { skip: !POSIX && 'script de shell' }, async () => {
  const root = fakeEmbeddedPython(FAKE_DEMUCS);
  const niceFile = path.join(tmpDir('nice'), 'nice.txt');
  const restoreEnv = withEnv({ VS_TESTE_NICE: niceFile, VS_TESTE_SEM_EXTRAS: undefined, VS_TESTE_ESPERA: undefined });
  const spy = spyPriority();
  process.resourcesPath = root;
  const before = demucsDirs();
  try {
    const sep = fresh('stemSeparatorLocal.js');
    const input = Buffer.from('RIFF-entrada-de-teste-'.repeat(5000));
    const progress = [];
    // a tela manda ArrayBuffer; a clonagem manda Buffer: os dois servem
    const stems = await sep.separateStemsLocal(null, 'musica.mp3', input.buffer.slice(input.byteOffset, input.byteOffset + input.length), (p) => progress.push(p));
    for (const name of ['vocals', 'bass', 'drums', 'other', 'guitar', 'piano']) {
      assert.ok(stems[name] instanceof ArrayBuffer, `${name} chega como ArrayBuffer`);
      assert.ok(Buffer.from(stems[name]).equals(Buffer.concat([Buffer.from(`${name}:`), input])), `${name} com os bytes da saída`);
    }
    assert.deepEqual(progress, [50]);
    const lowered = spy.calls.filter(([, prio]) => prio === BELOW);
    assert.equal(lowered.length, 1, 'o Demucs recebe a prioridade baixa logo depois de abrir');
    if (process.platform === 'darwin' || process.platform === 'linux') {
      assert.equal(fs.readFileSync(niceFile, 'utf8').trim(), NICE_SET, 'o Demucs rodou em nice 10');
    }
    const left = [...demucsDirs()].filter((n) => !before.has(n));
    assert.deepEqual(left, [], 'a pasta temporária saiu');

    // guitarra e piano podem faltar; a clonagem passa Buffer direto
    process.env.VS_TESTE_SEM_EXTRAS = '1';
    const voz = await sep.separateStemsLocal(null, 'voz.wav', input);
    assert.equal(voz.guitar, null);
    assert.equal(voz.piano, null);
    assert.ok(Buffer.from(voz.vocals).equals(Buffer.concat([Buffer.from('vocals:'), input])));
  } finally {
    delete process.resourcesPath;
    spy.restore();
    restoreEnv();
  }
});

test('separação: cancelar mata o Demucs, responde separation_cancelled e apaga a pasta', { skip: !POSIX && 'script de shell' }, async () => {
  const root = fakeEmbeddedPython(FAKE_DEMUCS);
  const restoreEnv = withEnv({ VS_TESTE_NICE: path.join(tmpDir('nice'), 'nice.txt'), VS_TESTE_ESPERA: '10' });
  process.resourcesPath = root;
  const before = demucsDirs();
  try {
    const sep = fresh('stemSeparatorLocal.js');
    const started = Date.now();
    const job = sep.separateStemsLocal(null, 'musica.wav', Buffer.from('x'.repeat(1000)));
    setTimeout(() => sep.cancelStemSeparation(), 300);
    await assert.rejects(job, /separation_cancelled/);
    assert.ok(Date.now() - started < 5000, 'não esperou o Demucs terminar');
    assert.deepEqual([...demucsDirs()].filter((n) => !before.has(n)), [], 'a pasta temporária saiu');
  } finally {
    delete process.resourcesPath;
    restoreEnv();
  }
});

test('separação: o ArrayBuffer do arquivo lido vai sem cópia; Buffer de pedaço é copiado', async () => {
  const sep = fresh('stemSeparatorLocal.js');
  const dir = tmpDir('ab');
  const file = path.join(dir, 'grande.wav');
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024, 7));
  const big = await fsp.readFile(file);
  assert.equal(sep._wholeArrayBuffer(big), big.buffer, 'readFile de arquivo grande: o mesmo ArrayBuffer, sem cópia');
  const piece = Buffer.from('pedaco do pool');
  assert.notEqual(piece.buffer.byteLength, piece.length, 'o Buffer pequeno vem do pool');
  const copy = sep._wholeArrayBuffer(piece);
  assert.notEqual(copy, piece.buffer);
  assert.equal(copy.byteLength, piece.length);
  assert.ok(Buffer.from(copy).equals(piece));
});

test('preparo do motor: os programas rodam sem travar o processo principal', { skip: !POSIX && 'usa sleep e echo' }, async () => {
  const sep = fresh('stemSeparatorLocal.js');
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 20);
  const slow = await sep._run('sleep', ['0.5']);
  clearInterval(timer);
  assert.equal(slow.ok, true);
  assert.ok(ticks >= 5, `o laço do principal seguiu andando durante o programa (${ticks} voltas de 20 ms)`);

  const cut = Date.now();
  const late = await sep._run('sleep', ['5'], { timeout: 200 });
  assert.equal(late.ok, false, 'passou do tempo limite: falha, como o execSync');
  assert.ok(Date.now() - cut < 2000);

  const which = await sep._run('sh', ['-c', 'echo /caminho/do/demucs'], { capture: true });
  assert.equal(which.out.trim(), '/caminho/do/demucs');
  assert.equal((await sep._run('sh', ['-c', 'exit 3'])).ok, false, 'saída diferente de zero é falha');
  assert.equal((await sep._run('/nao/existe/programa', [])).ok, false, 'programa que não existe é falha, sem exceção');
});

test('preparo do motor: nenhum exec síncrono nem leitura síncrona de arquivo grande', () => {
  const src = read(path.join(DESKTOP, 'stemSeparatorLocal.js'));
  assert.doesNotMatch(src, /\bexecSync\b|\bexecFileSync\b|\bspawnSync\b/);
  assert.doesNotMatch(src, /\breadFileSync\b|\bwriteFileSync\b|\brmSync\b|\bmkdirSync\b|\bunlinkSync\b/);
  // mesmas tentativas e tempos limite de antes
  for (const t of [
    "run('which', ['demucs'], { timeout: 1000, capture: true })",
    "run(b, ['--help'], { timeout: 2000 })",
    "run(p, ['-c', 'import demucs'], { timeout: 2000 })",
    "run(p, ['--version'], { timeout: 1500 })",
    "run(APP_AI_PYTHON, ['-c', 'import demucs'], { timeout: 3000 })",
    'timeout: 120000',
    'timeout: 420000',
    'timeout: 180000',
  ]) assert.ok(src.includes(t), `continua: ${t}`);
});

test('preparo do motor: o motor embutido é achado sem rodar nada, e duas perguntas juntas recebem a mesma resposta', { skip: !POSIX && 'caminho do Mac' }, async () => {
  const root = fakeEmbeddedPython('#!/bin/sh\nexit 0\n');
  process.resourcesPath = root;
  try {
    const sep = fresh('stemSeparatorLocal.js');
    const [a, b] = await Promise.all([sep._findDemucsRunner(), sep._findDemucsRunner()]);
    assert.equal(a, b);
    assert.equal(a.path, path.join(root, 'ai-engine', 'python', 'bin', 'python3'));
    assert.equal(a.isEmbedded, true);
  } finally {
    delete process.resourcesPath;
  }
});

// ---------------------------------------------------------------------------------------------
// Bateria em peças (drumPieces.js)

const FAKE_DRUM_PYTHON = `#!/bin/sh
if [ "$1" = "-c" ]; then echo teste >> "$VS_TESTE_LOG"; exit 0; fi
while [ $# -gt 0 ]; do
  case "$1" in
    --in) inp="$2"; shift 2;;
    --out) out="$2"; shift 2;;
    --model) shift 2;;
    *) shift;;
  esac
done
echo separa >> "$VS_TESTE_LOG"
sleep 0.2
ps -o nice= -p $$ | tr -d ' ' > "$VS_TESTE_NICE"
if [ -f "$VS_TESTE_FALHA" ]; then echo '{"ok": false, "error": "falhou de propósito"}'; exit 0; fi
mkdir -p "$out"
for p in bumbo caixa pratos tons; do { printf '%s:' "$p"; cat "$inp"; } > "$out/$p.wav"; done
echo '{"ok": true, "seconds": 0.1}'
`;

test('bateria: o Python testado na primeira música vale para as próximas e é esquecido quando o separador falha', { skip: !POSIX && 'script de shell' }, async () => {
  const root = fakeEmbeddedPython(FAKE_DRUM_PYTHON);
  const home = tmpDir('drumsep');
  // modelo "baixado": arquivo esparso de 101 MB (não ocupa disco)
  const fd = fs.openSync(path.join(home, 'drumsep.th'), 'w');
  fs.ftruncateSync(fd, 101 * 1024 * 1024);
  fs.closeSync(fd);
  const work = tmpDir('log');
  const log = path.join(work, 'log.txt');
  const fail = path.join(work, 'falha');
  const niceFile = path.join(work, 'nice.txt');
  const restoreEnv = withEnv({ VS_DRUMSEP_HOME: home, VS_TESTE_LOG: log, VS_TESTE_FALHA: fail, VS_TESTE_NICE: niceFile });
  const spy = spyPriority();
  process.resourcesPath = root;
  const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  const count = (what) => lines().filter((l) => l === what).length;
  try {
    const drums = fresh('drumPieces.js');
    const wav = Buffer.from('bateria-'.repeat(3000));

    const first = await drums.separateDrumPieces(wav);
    for (const id of ['bumbo', 'caixa', 'pratos', 'tons']) {
      assert.ok(first[id].equals(Buffer.concat([Buffer.from(`${id}:`), wav])), `${id} com os bytes do separador`);
    }
    assert.equal(count('teste'), 1, 'a primeira música testa o Python');

    const second = await drums.separateDrumPieces(wav);
    assert.ok(second.bumbo);
    assert.equal(count('teste'), 1, 'a segunda música usa o Python guardado, sem outro teste');
    assert.equal(count('separa'), 2);

    fs.writeFileSync(fail, '1');
    const broken = await drums.separateDrumPieces(wav);
    assert.equal(broken.why, 'falhou de propósito');
    assert.equal(broken.bumbo, undefined);
    fs.rmSync(fail);

    const again = await drums.separateDrumPieces(wav);
    assert.ok(again.bumbo);
    assert.equal(count('teste'), 2, 'depois da falha o Python é testado de novo');

    const lowered = spy.calls.filter(([, prio]) => prio === BELOW).length;
    assert.ok(lowered >= count('teste') + count('separa'), 'todo programa de IA da bateria recebe a prioridade baixa');
    if (process.platform === 'darwin' || process.platform === 'linux') {
      assert.equal(fs.readFileSync(niceFile, 'utf8').trim(), NICE_SET, 'o separador rodou em nice 10');
    }
  } finally {
    delete process.resourcesPath;
    spy.restore();
    restoreEnv();
  }
});

// ---------------------------------------------------------------------------------------------
// Voz de IA do Maestro (maestroQwen.js e maestroVoiceCpu.py)

// Programa de voz falso (como o vs-maestro-voz). "devagar" no texto demora 1,5 s; cada fala anota
// a prioridade em que o programa roda (nice.txt ao lado do modelo).
const FAKE_HELPER = `#!/usr/bin/python3
import sys, json, struct, math, os, time
def send(o):
    sys.stdout.write('@@VS ' + json.dumps(o) + '\\n'); sys.stdout.flush()
if '--model' not in sys.argv: send({'id': 'ready', 'ok': False, 'error': 'sem modelo'}); sys.exit(2)
model = sys.argv[sys.argv.index('--model') + 1]
send({'id': 'ready', 'ok': True, 'sampleRate': 24000})
for line in sys.stdin:
    r = json.loads(line)
    open(os.path.join(model, 'nice.txt'), 'w').write(str(os.getpriority(os.PRIO_PROCESS, 0)))
    if 'devagar' in r['text']: time.sleep(1.5)
    sr = 24000
    s = [0.0] * int(sr * 0.15) + [0.022 + 0.3 * math.sin(i / 7) for i in range(int(sr * 0.3))] + [0.0] * int(sr * 0.2)
    open(r['out'], 'wb').write(struct.pack('<%df' % len(s), *s))
    send({'id': r['id'], 'ok': True, 'samples': len(s), 'sampleRate': sr, 'elapsed': 0.01})
`;

function fakeVoiceEngine() {
  const engine = tmpDir('motor');
  fs.writeFileSync(path.join(engine, 'vs-maestro-voz'), FAKE_HELPER, { mode: 0o755 });
  fs.mkdirSync(path.join(engine, 'voices'));
  for (const v of ['feminina', 'masculina']) {
    fs.writeFileSync(path.join(engine, 'voices', `${v}.wav`), 'x');
    fs.writeFileSync(path.join(engine, 'voices', `${v}.txt`), 'Boa noite, pessoal!\n');
  }
  const model = tmpDir('modelo');
  fs.writeFileSync(path.join(model, 'config.json'), '{}');
  return { engine, model };
}

function freshQwen(env) {
  const restore = withEnv(env);
  for (const f of ['maestroQwen.js', 'maestroVoiceDownload.js']) delete require.cache[require.resolve(path.join(DESKTOP, f))];
  return { qwen: require(path.join(DESKTOP, 'maestroQwen.js')), restore };
}

const canRunFakeVoice = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync('/usr/bin/python3');

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

test('voz: releaseIfIdle fecha o programa parado e não mexe no que está gerando', { skip: !canRunFakeVoice && 'só em Mac com chip Apple' }, async () => {
  const { engine, model } = fakeVoiceEngine();
  const m = freshQwen({ VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmpDir('casa') });
  try {
    const voice = m.qwen.qwenVoiceFor('feminina');
    assert.equal(m.qwen.releaseIfIdle(), false, 'sem programa aberto: nada a fechar');

    const r1 = await m.qwen.render({ text: 'Atenção, banda!', voice, span: 2 });
    assert.equal(r1.cached, false);
    assert.equal(m.qwen.releaseIfIdle(), true, 'aberto e parado: fecha');
    assert.equal(m.qwen.releaseIfIdle(), false, 'já fechou');

    // fala nova depois de fechar: o programa abre de novo e fala
    const args = { text: 'Vamos devagar agora', voice, span: 3 };
    const job = m.qwen.render(args);
    assert.ok(await until(async () => (await m.qwen.speechState(args)) === 'gerando'), 'a fala entrou na geração');
    assert.equal(m.qwen.releaseIfIdle(), false, 'com fala gerando: não fecha');
    const r2 = await job;
    assert.equal(r2.cached, false);
    assert.equal(m.qwen.releaseIfIdle(), true, 'terminou a fala: agora fecha');
  } finally {
    m.qwen.stopHelper();
    m.restore();
  }
});

test('voz: no Mac roda em nice 10 pelo /usr/bin/nice; sem ele (como no Windows), pelo os.setPriority', { skip: !canRunFakeVoice && 'só em Mac com chip Apple' }, async () => {
  const { engine, model } = fakeVoiceEngine();
  const m = freshQwen({ VS_MAESTRO_ENGINE_DIR: engine, VS_MAESTRO_MODEL_DIR: model, VS_MAESTRO_MODEL_HOME: tmpDir('casa') });
  const spy = spyPriority();
  const realExists = fs.existsSync;
  try {
    const voice = m.qwen.qwenVoiceFor('masculina');
    await m.qwen.render({ text: 'Primeira fala.', voice, span: 2 });
    assert.equal(fs.readFileSync(path.join(model, 'nice.txt'), 'utf8').trim(), NICE_ADD, 'com o nice: prioridade 10');
    assert.equal(spy.calls.length, 0, 'com o nice o Node não mexe na prioridade');
    m.qwen.stopHelper();

    // sem o /usr/bin/nice: o caminho do Windows
    fs.existsSync = (p) => (p === '/usr/bin/nice' ? false : realExists(p));
    fs.rmSync(path.join(model, 'nice.txt'));
    await m.qwen.render({ text: 'Segunda fala.', voice, span: 2 });
    assert.equal(spy.calls.filter(([, prio]) => prio === BELOW).length, 1, 'prioridade baixa pelo os.setPriority');
    assert.equal(fs.readFileSync(path.join(model, 'nice.txt'), 'utf8').trim(), NICE_SET, 'sem o nice: prioridade 10 do mesmo jeito');
  } finally {
    fs.existsSync = realExists;
    spy.restore();
    m.qwen.stopHelper();
    m.restore();
  }
});

test('voz no processador: deixa um núcleo livre (antes usava todos os lógicos)', () => {
  const py = read(path.join(DESKTOP, 'maestroVoiceCpu.py'));
  assert.match(py, /torch\.set_num_threads\(max\(1, \(os\.cpu_count\(\) or 2\) - 1\)\)/);
  assert.doesNotMatch(py, /set_num_threads\(max\(1, os\.cpu_count\(\) or 1\)\)/);
});

// ---------------------------------------------------------------------------------------------
// Separação de um clipe (clipStemSplit.ts)

class FakeBuffer {
  constructor(channels, sampleRate) {
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.numberOfChannels = channels.length;
    this.length = channels[0].length;
    this.duration = this.length / sampleRate;
  }
  getChannelData(c) { return this.channels[c]; }
}

test('clipe: o WAV em pedaços sai com os mesmos bytes, byte a byte', async () => {
  const slice = 1 << 17;
  const cases = [
    { frames: 1, chans: 2 },
    { frames: slice, chans: 2 },
    { frames: slice + 1, chans: 2 },
    { frames: slice * 3 + 777, chans: 1 },
    { frames: 50_000, chans: 6 },
  ];
  for (const { frames, chans } of cases) {
    const channels = Array.from({ length: chans }, (_, c) => {
      const d = new Float32Array(frames);
      for (let i = 0; i < frames; i++) d[i] = Math.sin(i * (0.001 + c * 0.0007)) * 1.2; // passa de ±1: corta igual
      d[0] = -1; if (frames > 1) d[1] = 1; if (frames > 2) d[2] = -0;
      return d;
    });
    const buf = new FakeBuffer(channels, 44100);
    const sync = Buffer.from(encodeWavPcm24(buf));
    const chunked = Buffer.from(await encodeWavPcm24Async(buf));
    assert.ok(chunked.equals(sync), `${frames} quadros, ${chans} canais: bytes idênticos`);
  }
  // amostra inválida: as duas recusam
  const bad = new FakeBuffer([new Float32Array([0, NaN, 0])], 44100);
  assert.throws(() => encodeWavPcm24(bad));
  await assert.rejects(encodeWavPcm24Async(bad));
});

test('clipe: as três codificações da separação são em pedaços e cancelar antes da IA não a começa', () => {
  const src = read(path.join(SRC, 'lib', 'clipStemSplit.ts'));
  assert.match(src, /import \{ encodeWavPcm24Async as encodeWavPcm24 \} from '@\/lib\/wavEncoder'/);
  assert.doesNotMatch(src, /import \{ encodeWavPcm24 \}/, 'a versão de uma vez só não é mais usada aqui');
  const uses = src.match(/encodeWavPcm24\(/g) ?? [];
  const awaited = src.match(/await encodeWavPcm24\(/g) ?? [];
  assert.equal(uses.length, 3);
  assert.equal(awaited.length, 3, 'toda codificação é esperada');
  // o WAV é montado antes; se cancelou nesse meio tempo, a IA nem começa
  assert.match(src, /const drumsWav = await encodeWavPcm24\(drums\);\s*\/\/[^\n]*\n\s*if \(cancelled\) throw new Error\(CANCELLED\);\s*const result = await bridge\(drumsWav\)/);
  assert.match(src, /const wav = await encodeWavPcm24\(await toStereo44k\(input\)\);[\s\S]{0,300}if \(cancelled\) throw new Error\(CANCELLED\);\s*raw = await bridge\(/);
});
