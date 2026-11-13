// Correções do motor de áudio: timecode (LTC) sem esperar a música inteira e travado no relógio,
// fade dos clipes que sobrevive ao fader/mudo/solo, fim de música que não pula a próxima,
// preparo que não fica com música clicada de passagem, taxa do motor presa à do áudio aberto e
// medidores pelo lado mais alto. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');
const engine = read('src', 'lib', 'audioEngine.ts');

// ---------- TimecodePlayer com um contexto de áudio de mentira ----------

let buffersBuilt = 0;
class FakeAudioBuffer {
  constructor({ length, numberOfChannels, sampleRate }) {
    buffersBuilt++;
    this.length = length;
    this.sampleRate = sampleRate;
    this.numberOfChannels = numberOfChannels;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c) { return this.data[c]; }
}
globalThis.AudioBuffer = FakeAudioBuffer;

function fakeCtx() {
  const started = [];
  const ctx = {
    currentTime: 0,
    started,
    createBufferSource() {
      const src = {
        buffer: null,
        playbackRate: { value: 1, setValueAtTime() {} },
        stops: [],
        connect() {},
        disconnect() {},
        start(when, offset) { started.push({ src, when, offset }); },
        stop(at) { src.stops.push(at); },
      };
      return src;
    },
  };
  return ctx;
}

const { TimecodePlayer } = await import('../src/lib/timecodePlayer.ts');

function ltc(seconds, rate = 48000) {
  const length = Math.round(seconds * rate);
  const ch = new Int16Array(length);
  for (let i = 0; i < length; i++) ch[i] = (i % 2 ? 32767 : -32767);
  return { channels: [ch], sampleRate: rate, length };
}

test('LTC no horário: começa no ponto pedido, sem compensar nada', () => {
  const ctx = fakeCtx();
  const p = new TimecodePlayer(ctx, {});
  ctx.currentTime = 10;
  p.start('tc', ltc(2), 0.5, 10.05);
  assert.equal(ctx.started.length, 1);
  assert.equal(ctx.started[0].when, 10.05);
  assert.ok(Math.abs(ctx.started[0].offset - 0.5) < 1e-9);
});

test('LTC que chega depois do horário entra no ponto do relógio, não atrasado', () => {
  const ctx = fakeCtx();
  const p = new TimecodePlayer(ctx, {});
  p.setRate(1.1);
  ctx.currentTime = 10.08; // a ordem era para 10,05: 30 ms de atraso
  p.start('tc', ltc(2), 0.5, 10.05);
  const s = ctx.started[0];
  assert.equal(s.when, 10.08);
  assert.ok(Math.abs(s.offset - (0.5 + 0.03 * 1.1)) < 1e-9, `offset ${s.offset}`);
});

test('LTC que começa depois do ponto da música: espera, e se atrasou desconta do arquivo', () => {
  const ctx = fakeCtx();
  const p = new TimecodePlayer(ctx, {});
  ctx.currentTime = 0;
  p.start('tc', ltc(2), -1, 0.05); // arquivo começa 1 s depois
  assert.ok(Math.abs(ctx.started[0].when - 1.05) < 1e-9);
  assert.equal(ctx.started[0].offset, 0);
  ctx.currentTime = 1.1; // salto que chegou 50 ms tarde
  p.start('tc', ltc(2), -1, 0.05);
  assert.ok(Math.abs(ctx.started[1].offset - 0.05) < 1e-9);
});

test('LTC preparado antes não é convertido de novo no Play; o valor é o mesmo de antes (amostra / 32767)', async () => {
  const ctx = fakeCtx();
  const p = new TimecodePlayer(ctx, {});
  const audio = ltc(1);
  await p.preload('tc-a', audio);
  const before = buffersBuilt;
  ctx.currentTime = 0;
  p.start('tc-a', audio, 0, 0.05);
  assert.equal(buffersBuilt, before, 'nenhuma conversão na largada');
  const buf = ctx.started[0].src.buffer;
  assert.equal(buf.getChannelData(0)[0], -32767 / 32767);
  assert.equal(buf.getChannelData(0)[1], 1);
});

test('cache do LTC: fica o do ar e o último preparado', async () => {
  const ctx = fakeCtx();
  const p = new TimecodePlayer(ctx, {});
  const a = ltc(0.2);
  const b = ltc(0.3);
  const c = ltc(0.4);
  p.start('a', a, 0, 0.05);
  await p.preload('b', b);
  await p.preload('c', c);
  let n = buffersBuilt;
  p.scheduleJump('a', a, 0, 1); // o do ar continua montado (salto de loop sem conversão)
  assert.equal(buffersBuilt, n);
  p.start('c', c, 0, 2);
  assert.equal(buffersBuilt, n, 'o último preparado continua montado');
  n = buffersBuilt;
  p.start('b', b, 0, 3);
  assert.equal(buffersBuilt, n + 1, 'o mais antigo saiu do cache');
});

// ---------- Fade do clipe x fader da faixa filha ----------

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `achei ${name}`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

const fadeSource = stripTypeScriptTypes(extractFunction(engine, 'scheduleClipFade'));
const curveSource = stripTypeScriptTypes(extractFunction(read('src', 'types.ts'), 'evaluateFadeCurve'));
const sandbox = { Math };
vm.createContext(sandbox);
vm.runInContext(`${curveSource}\n${fadeSource}\nthis.scheduleClipFade = scheduleClipFade;`, sandbox);
const { scheduleClipFade } = sandbox;

// AudioParam de mentira: guarda os eventos e calcula o valor em qualquer instante.
function fakeParam(initial) {
  let events = [];
  const param = {
    value: initial,
    cancelScheduledValues(t) { events = events.filter((e) => e.time < t); },
    setValueAtTime(v, t) { events.push({ kind: 'set', v, time: t }); },
    linearRampToValueAtTime(v, t) { events.push({ kind: 'ramp', v, time: t }); },
    at(t) {
      const sorted = events.slice().sort((x, y) => x.time - y.time);
      let prev = null;
      for (const e of sorted) {
        if (e.time <= t) { prev = e; continue; }
        if (e.kind === 'ramp' && prev) return prev.v + (e.v - prev.v) * ((t - prev.time) / (e.time - prev.time));
        break;
      }
      return prev ? prev.v : initial;
    },
    events: () => events,
  };
  return param;
}

const clip = { id: 'c', startTime: 0, duration: 10, fadeIn: 0, fadeOut: 2, fadeCurveIn: 'linear', fadeCurveOut: 'linear' };

test('sem glide o fade é agendado como sempre (degrau no valor do instante)', () => {
  const gain = fakeParam(1);
  const ctx = { currentTime: 3 };
  scheduleClipFade({ gain }, ctx, 0.5, clip, 10, 0, 1);
  const first = gain.events()[0];
  assert.deepEqual([first.kind, first.v, first.time], ['set', 0.5, 3]);
  assert.ok(Math.abs(gain.at(9) - 0.25) < 1e-9, 'meio do fade-out');
  assert.ok(Math.abs(gain.at(10)) < 1e-9, 'fim do clipe em silêncio');
});

test('fader mexido no meio da música: desliza até o volume novo e o fade-out continua', () => {
  const gain = fakeParam(1);
  const ctx = { currentTime: 3 };
  scheduleClipFade({ gain }, ctx, 1, clip, 10, 0, 1); // largada
  ctx.currentTime = 5;
  gain.value = 1;
  scheduleClipFade({ gain }, ctx, 0.5, clip, 10, 0, 1, 0.012); // fader para 0,5
  assert.equal(gain.at(5), 1, 'sem degrau: começa do volume atual');
  assert.ok(Math.abs(gain.at(5.012) - 0.5) < 1e-9, 'chega ao volume novo em 12 ms');
  assert.ok(Math.abs(gain.at(7) - 0.5) < 1e-9, 'platô no volume novo');
  assert.ok(Math.abs(gain.at(9) - 0.25) < 1e-9, 'fade-out mantido, no volume novo');
  assert.ok(Math.abs(gain.at(10)) < 1e-9, 'termina em silêncio');
});

test('mudo no meio de um fade-in: desliza a zero e volta seguindo o fade', () => {
  const c = { ...clip, fadeIn: 4, fadeOut: 0 };
  const gain = fakeParam(0);
  const ctx = { currentTime: 1 };
  gain.value = 0.25;
  scheduleClipFade({ gain }, ctx, 0, c, 10, 0, 1, 0.012); // mudo
  assert.ok(Math.abs(gain.at(1.012)) < 1e-9);
  assert.ok(Math.abs(gain.at(3)) < 1e-9, 'mudo segue mudo');
  ctx.currentTime = 2;
  gain.value = 0;
  scheduleClipFade({ gain }, ctx, 1, c, 10, 0, 1, 0.012); // tira o mudo
  assert.ok(Math.abs(gain.at(2.012) - 2.012 / 4) < 1e-6, 'volta no ponto do fade-in');
  assert.ok(Math.abs(gain.at(4) - 1) < 1e-9, 'fade-in termina no volume cheio');
  assert.ok(Math.abs(gain.at(10)) < 1e-9, 'degrau de fim do clipe mantido');
});

test('clipe que ainda não começou: glide não vaza som antes do início', () => {
  const c = { ...clip, startTime: 5, fadeIn: 1, fadeOut: 0 };
  const gain = fakeParam(0);
  const ctx = { currentTime: 1 };
  scheduleClipFade({ gain }, ctx, 0.8, c, 10, 0, 1, 0.012);
  assert.equal(gain.at(4.9), 0);
  assert.ok(Math.abs(gain.at(6) - 0.8) < 1e-9);
});

// ---------- Ligações no motor ----------

test('largada pelo preparo do disco arma o fim da entrega (a próxima não abre a música no ar inteira)', () => {
  assert.match(engine, /if \(bundle\.disk\) void this\.afterDiskStart\(songId, myGen\);\n\s+else this\.scheduleRender\(songId, 0\);/);
  assert.match(engine, /else if \(this\.diskSongs\.has\(onAir\) && !this\.headOnly\) await this\.onAirFeedsDone\(\);/);
});

test('timecode: abre só o arquivo do LTC e entra depois das faixas receberem o horário', () => {
  assert.doesNotMatch(engine, /ensureSongLoaded\(songId\)\.then\(\(\) => \{\n\s+const late = getClipAudio/, 'não espera a música inteira');
  assert.match(engine, /void this\.loadTimecodeAudio\(songId\)\.then\(\(late\) =>/);
  assert.match(engine, /if \(armed\) this\.jumpTimecode\(songId, armed\.start, armed\.at\);/, 'rearma o salto do loop no LTC');
  const bundle = engine.slice(engine.indexOf('if (useBundle && bundle) {'), engine.indexOf('const clips = store.clips.filter((c) => c.songId === songId && isStemClip(c));\n    if (clips.length === 0) return;'));
  assert.ok(bundle.indexOf("postMessage({ type: 'seek'") < bundle.indexOf('this.startTimecode('), 'LTC depois das faixas');
});

test('fim de música trata um aviso só por passada', () => {
  assert.match(engine, /if \(this\.songEndGen === this\.playGeneration\) return;\n\s+this\.songEndGen = this\.playGeneration;/);
});

test('preparo de música que saiu da seleção não fica na memória', () => {
  assert.match(engine, /if \(this\.isPlayingSong\(songId\) \|\| !this\.isWanted\(songId\)\) return;/);
  assert.equal((engine.match(/!this\.isWanted\(songId\) \|\| !this\.coversAllClips/g) ?? []).length, 2, 'memória e disco');
});

test('motor nasce na taxa do áudio aberto', () => {
  assert.match(engine, /sampleRate: rate \}\);/);
  assert.match(engine, /const rate = deviceSampleRate\(\);/);
});

test('medidor do canal pelo lado mais alto (fora a saída mono direta)', () => {
  assert.match(engine, /\? Math\.max\(lr\[0\], lr\[1\]\)\n\s+: this\.getMeterLevel\(t\.id\);/);
  assert.match(engine, /levels\.set\('master', this\.smoothMeter\('master', Math\.max\(pkL\[0\], pkR\[0\]\)\)\);/);
});
