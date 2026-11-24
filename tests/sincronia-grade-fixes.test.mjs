// Click, banda e grade no mesmo lugar: VS por IA, loop, BPM e tom mudados com a música tocando,
// entrada em cima da batida, contagem do Maestro e delay dos pads. Rodar com: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  anchorOnFirstSound, clickNeedsTempoMap, dropStartStub, finalizeTempoMap, leadInFromMap, MIN_TEMPO_MAP_SEC, placeAiTempoMap,
} from '../src/lib/tempoFollow.ts';
import { clickGridTimes } from '../src/lib/clickEdit.ts';
import { audioEntryTime, calculateMusicalAlignment, stemHasDrums } from '../src/lib/musicalAlignment.ts';
import { beatTimesFrom, crossesTempoChange } from '../src/lib/narrations.ts';
import { encodeWavPcm24, encodeWavPcm24Async } from '../src/lib/wavEncoder.ts';
import { waveformPeaks, waveformPeaksAsync } from '../src/lib/waveformPeaks.ts';
import { cursorFor } from '../src/lib/playFlow.ts';
import { DELAY_BLOCK_FRAMES, delayLoopSeconds, delaySeconds } from '../src/lib/samplePads.ts';
import {
  attackEnvelope, measureStretchOffsetMs, nominalStretchLeadMs, shiftSamples,
} from '../src/lib/stretchLatency.ts';
import { SoundTouch, SimpleFilter } from '../src/lib/soundtouch.vendor.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');
const engine = read('src', 'lib', 'audioEngine.ts');
const separator = read('src', 'lib', 'stemSeparator.ts');

class FakeBuffer {
  constructor(channels, sampleRate) {
    this.data = channels;
    this.length = channels[0].length;
    this.numberOfChannels = channels.length;
    this.sampleRate = sampleRate;
    this.duration = this.length / sampleRate;
  }
  getChannelData(c) { return this.data[c]; }
}

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `achei ${name}`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

// ---------- VS por IA: fase e 1 medidos, BPM conferido ----------

test('VS por IA usa a fase e o 1 medidos em música de andamento único', () => {
  assert.match(separator, /readTempoMap\(audioBuffer, beatsPerBar, \{ keepSingle: true \}\)/);
  assert.match(separator, /readTempoMap\(drumsBuffer, beatsPerBar, \{ keepSingle: true \}\)/);
  // batida a 105 BPM, primeiro 1 em 1,143 s: o mapa guarda essa fase
  const beat = 60 / 105;
  const first = 1.143 - 2 * beat;
  const map = finalizeTempoMap([{ startTime: first, endTime: 200, bpm: 105, downbeat: 1.143, barOffset: 2 }], { duration: 200, beatsPerBar: 4, keepSingle: true });
  assert.ok(map.tempoSegments?.length, 'a fase precisa sair do mapa');
  const leadIn = leadInFromMap(map.tempoSegments, 4);
  // com a entrada, o 1 cai numa cabeça de compasso da grade simples a partir do 0:00
  const bar = beat * 4;
  const placed = (1.143 + leadIn) / bar;
  assert.ok(Math.abs(placed - Math.round(placed)) < 1e-9, `o 1 caiu em ${placed} compassos`);
  const grid = clickGridTimes({ bpm: 105, beatsPerBar: 4 }, 200 + leadIn);
  for (let k = 0; k < 300; k++) {
    const t = 1.143 + leadIn + k * beat;
    const near = grid.reduce((b, g) => (Math.abs(g - t) < Math.abs(b - t) ? g : b), Infinity);
    assert.ok(Math.abs(near - t) < 1e-6, `batida ${k} fora da grade por ${(near - t) * 1000} ms`);
  }
});

test('VS por IA de andamento único não ganha trechos: a contagem e a régua seguem simples', () => {
  const beat = 60 / 105;
  const placed = placeAiTempoMap([{ startTime: 0.3, endTime: 100, bpm: 105, downbeat: 0.3 + beat, barOffset: 1 }, { startTime: 100.3, endTime: 200, bpm: 105, downbeat: 100.3 }], null, 4, 200);
  assert.equal(placed.tempoSegments, undefined);
  assert.ok(placed.leadIn > 0);
});

test('sem mapa, o click não é gravado e o aviso sai (faixa de 30 s ou mais)', () => {
  assert.equal(clickNeedsTempoMap(MIN_TEMPO_MAP_SEC, false), true);
  assert.equal(clickNeedsTempoMap(60, false), true, 'faixa abaixo de 90 s também é conferida');
  assert.equal(clickNeedsTempoMap(300, true), false);
  assert.equal(clickNeedsTempoMap(MIN_TEMPO_MAP_SEC - 1, false), false, 'abaixo do mínimo o mapa nem é tentado');
  assert.match(separator, /clickNeedsTempoMap\(duration, !!reading\?\.map\)/);
  assert.match(separator, /if \(clickUnsafe\) store\.setPlaybackError/);
});

// ---------- música sem bateria ----------

/** Pulsos de `seconds` segundos em cima da grade, começando em `first`. */
function pulses(seconds, sr, bpm, first) {
  const x = new Float32Array(Math.round(seconds * sr));
  const beat = 60 / bpm;
  for (let k = 0; first + k * beat < seconds - 0.2; k++) {
    const at = Math.round((first + k * beat) * sr);
    for (let i = 0; i < 900; i++) x[at + i] += 0.8 * Math.exp(-i / 220) * Math.sin(2 * Math.PI * 90 * i / sr);
  }
  return x;
}

test('stem de bateria mudo ou só com vazamento não vale como bateria', () => {
  const sr = 22050;
  const mix = new FakeBuffer([pulses(40, sr, 105, 2.25)], sr);
  assert.equal(stemHasDrums(new FakeBuffer([new Float32Array(mix.length)], sr), mix), false);
  assert.equal(stemHasDrums(new FakeBuffer([mix.data[0].map((v) => v * 0.03)], sr), mix), false, 'vazamento a -30 dB');
  assert.equal(stemHasDrums(new FakeBuffer([mix.data[0].map((v) => v * 0.5)], sr), mix), true);
});

test('música sem bateria que não começa na batida: a grade cai nas batidas', () => {
  const sr = 22050;
  const bpm = 105, first = 2.25;
  const x = pulses(40, sr, bpm, first);
  const mix = new FakeBuffer([x], sr);
  const beat = 60 / bpm;
  for (const stem of [new Float32Array(x.length), x.map((v) => v * 0.03)]) {
    const r = calculateMusicalAlignment(mix, new FakeBuffer([stem], sr), bpm, 4);
    const miss = (first + r.leadIn) / beat;
    const ms = Math.abs(miss - Math.round(miss)) * beat * 1000;
    assert.ok(ms <= 6, `grade ${ms.toFixed(1)} ms fora da batida`);
  }
});

test('sem bateria: a entrada do áudio depois de silêncio é a batida; fora do alcance o mapa fica', () => {
  const sr = 22050;
  const x = pulses(30, sr, 105, 2.25);
  assert.ok(Math.abs(audioEntryTime(new FakeBuffer([x], sr)) - 2.25) < 0.003);
  // entrada baixa também conta: o que marca é o fim do silêncio digital
  const soft = new Float32Array(sr * 6);
  for (let i = sr; i < soft.length; i++) soft[i] = 0.001 * Math.sin(i * 0.05 + 0.5);
  assert.ok(Math.abs(audioEntryTime(new FakeBuffer([soft], sr)) - 1) < 0.002);
  assert.equal(audioEntryTime(new FakeBuffer([pulses(10, sr, 120, 0.001)], sr)), null, 'sem silêncio antes');
  const beat = 60 / 105;
  const seg = (start) => [{ startTime: start, endTime: 100, bpm: 105, downbeat: start + beat, barOffset: 1 }];
  // entrada em cima da batida medida, dentro do ruído da medida: a grade vai para o som
  const moved = anchorOnFirstSound(seg(2.25 - 0.002 - 3 * beat), 2.25);
  assert.ok(Math.abs(moved[0].startTime + 3 * beat - 2.25) < 1e-9);
  assert.ok(Math.abs(moved[0].downbeat - moved[0].startTime - beat) < 1e-9, 'o 1 anda junto');
  const after = anchorOnFirstSound(seg(2.25 + 0.002 - 3 * beat), 2.25);
  assert.ok(Math.abs(after[0].startTime + 3 * beat - 2.25) < 1e-9, 'a batida medida logo depois da entrada também');
  // entrada 6 ms ou mais longe é um gate abrindo fora do tempo: a fase medida fica
  for (const miss of [0.006, 0.028, 0.06]) {
    const far = seg(2.25 - miss - 3 * beat);
    assert.equal(anchorOnFirstSound(far, 2.25), far);
  }
  assert.match(separator, /!stemHasDrums\(drumsBuffer, audioBuffer\) \? audioEntryTime\(audioBuffer\)/);
});

test('medley do VS por IA: a batida colada no começo do arquivo não vira emenda na régua', () => {
  const stub = { startTime: 0, endTime: 0.426, bpm: 140, downbeat: 0 };
  const main = { startTime: 0.426, endTime: 22, bpm: 140, downbeat: 1.712, barOffset: 3 };
  const next = { startTime: 22, endTime: 60, bpm: 143, downbeat: 22 };
  assert.deepEqual(dropStartStub([stub, main, next]), [main, next]);
  assert.deepEqual(dropStartStub([main, next]), [main, next], 'dois trechos: nada a tirar');
  const longFirst = { ...stub, endTime: 4 };
  assert.equal(dropStartStub([longFirst, main, next]).length, 3, 'trecho de verdade fica');
  const otherBpm = { ...stub, bpm: 120, endTime: 0.4 };
  assert.equal(dropStartStub([otherBpm, main, next]).length, 3, 'outro andamento fica');
});

// ---------- fade dos clipes acompanha o relógio ----------

const fadeSource = stripTypeScriptTypes(extractFunction(engine, 'scheduleClipFade'));
const curveSource = stripTypeScriptTypes(extractFunction(read('src', 'types.ts'), 'evaluateFadeCurve'));
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${curveSource}\n${fadeSource}\nthis.scheduleClipFade = scheduleClipFade;`, sandbox);
const { scheduleClipFade } = sandbox;

function fakeParam(initial) {
  let events = [];
  return {
    value: initial,
    cancelScheduledValues(t) { events = events.filter((e) => e.time < t); },
    cancelAndHoldAtTime(t) { events = events.filter((e) => e.time < t); },
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
  };
}

const longClip = { id: 'c', startTime: 0, duration: 214, fadeIn: 0, fadeOut: 0 };

test('loop: o corte do fim do clipe sai do lugar antigo e vai para depois da volta', () => {
  const gain = fakeParam(1);
  const ctx = { currentTime: 1 };
  // Play em 0, clipe de 214 s: o corte fica marcado em 214 s de relógio
  scheduleClipFade({ gain }, ctx, 1, longClip, 214, 0, 1);
  assert.equal(gain.at(214.1), 0, 'ponto de partida do teste');
  // loop de 186 a 192,86, salto marcado para o relógio 192,86: daí em diante a música volta 6,86 s
  const at = 192.86;
  scheduleClipFade({ gain }, ctx, 1, longClip, 214, at - 186, 1, 0, at);
  assert.equal(gain.at(214.1), 1, 'o som não pode sumir no fim original');
  assert.equal(gain.at(190), 1, 'antes do salto segue igual');
  assert.equal(gain.at(at - 186 + 214 + 0.01), 0, 'o fim verdadeiro continua cortado');
});

test('BPM mudado com a música tocando: o corte acompanha o andamento novo', () => {
  const gain = fakeParam(1);
  const ctx = { currentTime: 2 };
  scheduleClipFade({ gain }, ctx, 1, longClip, 214, 0, 1);
  // em 152 s de música passa para 0,75x (alfa 4/3): o fim passa de 214 para 152 + 62 x 4/3
  const at = 152;
  const alpha = 4 / 3;
  const start = at - 152 * alpha;
  scheduleClipFade({ gain }, ctx, 1, longClip, 214, start, alpha, 0, at);
  assert.equal(gain.at(214.1), 1, 'no ponto antigo a música ainda toca');
  const realEnd = start + 214 * alpha;
  assert.equal(gain.at(realEnd - 0.01), 1);
  assert.equal(gain.at(realEnd + 0.01), 0);
});

test('motor: loop, troca de BPM e fader reagendam o fade pelo relógio novo', () => {
  assert.match(engine, /this\.refreshClipFades\(at, this\.playbackStartTime, newAlpha\)/);
  assert.match(engine, /this\.armedLoop = \{ regionId[^\n]*\n[^\n]*\n\s*this\.reapplyArmedFades\(\)/);
  assert.match(engine, /private refreshClipFades\(/);
});

test('fim da música segue o relógio do áudio, não o timer', () => {
  assert.match(engine, /window\.setTimeout\(\(\) => this\.songEndDue\(end, pos\), remaining\)/);
  const due = engine.slice(engine.indexOf('private songEndDue('), engine.indexOf('private songEndGen'));
  assert.match(due, /const left = \(end - pos\) \* \(this\.playbackAlpha \|\| 1\)/);
  assert.match(due, /left > 0\.02 && pos > lastPos \+ 1e-3/, 'relógio parado não segura a próxima música');
});

// ---------- contagem do Maestro ----------

const medley = {
  bpm: 140,
  tempoSegments: [
    { startTime: 0, endTime: 20.571428, bpm: 140 },
    { startTime: 20.571428, endTime: 60, bpm: 150 },
  ],
};

test('contagem não atravessa uma troca de andamento', () => {
  const beat = 60 / 140;
  const change = medley.tempoSegments[1].startTime;
  const crossing = beatTimesFrom(medley, change - 2 * beat, 5);
  assert.equal(crossesTempoChange(medley, crossing), true, 'dois tempos antes da troca');
  const before = beatTimesFrom(medley, change - 4 * beat, 5);
  assert.equal(crossesTempoChange(medley, before), false, 'terminar na troca é a contagem de entrada');
  const after = beatTimesFrom(medley, change, 5);
  assert.equal(crossesTempoChange(medley, after), false, 'dentro do trecho novo');
});

test('trecho só repartido, com o mesmo BPM e a mesma fase, não é troca', () => {
  const split = { bpm: 120, tempoSegments: [{ startTime: 0, endTime: 16, bpm: 120 }, { startTime: 16, endTime: 60, bpm: 120 }] };
  const t = beatTimesFrom(split, 15, 5);
  assert.equal(crossesTempoChange(split, t), false);
  assert.match(read('src', 'lib', 'maestroVoice.ts'), /crossesTempoChange\(song, times\)/);
});

// ---------- tela e montagem ----------

test('wav e picos em pedaços saem iguais aos de uma vez', async () => {
  const n = 300000;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) { a[i] = Math.sin(i * 0.013) * 0.7; b[i] = Math.cos(i * 0.007) * 0.5; }
  const buf = new FakeBuffer([a, b], 22050);
  const sync = new Uint8Array(encodeWavPcm24(buf));
  const asyncOut = new Uint8Array(await encodeWavPcm24Async(buf));
  assert.equal(asyncOut.length, sync.length);
  for (let i = 0; i < sync.length; i += 97) assert.equal(asyncOut[i], sync[i]);
  assert.deepEqual(await waveformPeaksAsync(buf, 8000), waveformPeaks(buf, 8000));
});

test('VS por IA não segura a tela na montagem dos clipes', () => {
  assert.match(separator, /await encodeWavPcm24Async\(config\.buffer\)/);
  assert.match(separator, /await waveformPeaksAsync\(config\.buffer, peakResolution\)/);
});

// ---------- Play e cursor ----------

test('Play respeita o cursor posto na música nova, e ignora o que veio de outra', () => {
  // parou a anterior, selecionou esta e clicou no 30
  assert.equal(cursorFor({ currentTime: 30, currentSongId: 'medley', cursorSongId: 'degrau' }, 'degrau'), 30);
  // parou a anterior com esta selecionada: o cursor era da outra música
  assert.equal(cursorFor({ currentTime: 24, currentSongId: 'medley', cursorSongId: 'medley' }, 'degrau'), null);
  assert.equal(cursorFor({ currentTime: 12, currentSongId: 'degrau', cursorSongId: 'degrau' }, 'degrau'), 12);
  assert.equal(cursorFor({ currentTime: 12, currentSongId: null }, 'degrau'), 12);
  assert.equal(cursorFor({ currentTime: 12, currentSongId: 'medley' }, 'degrau'), null, 'projeto antigo: vale a regra de antes');
});

test('cursor não lê o relógio da música anterior durante a largada', () => {
  // o motor só conta como tocando quando o relógio novo já vale; até lá o cursor é o ponto pedido
  assert.match(engine, /this\.playbackStartTime = scheduledStart - startOffset \* alpha;\n\s*this\.isPlaying = true;\n\s*this\.currentSongId = songId;/);
  assert.match(engine, /this\.markOnAir\(songId\);\n\s*this\.playbackOffset = startOffset;\n\s*this\.headOnly = !!heads;/);
  assert.match(engine, /if \(!this\.isPlaying \|\| !this\.ctx\) return this\.playbackOffset;/);
});

test('linha do cursor desconta a latência de saída; o relógio do motor não', () => {
  assert.match(read('src', 'components', 'Playhead.tsx'), /audioEngine\.getHeardTime\(\)/);
  assert.match(engine, /getHeardTime\(\): number \{[\s\S]{0,260}baseLatency[\s\S]{0,60}outputLatency/);
  assert.match(engine, /getCurrentTime\(\): number \{[\s\S]{0,180}return \(this\.ctx\.currentTime - this\.playbackStartTime\) \/ alpha;/);
});

test('click entra seco em seek, pausa e Play com preparo', () => {
  const src = stripTypeScriptTypes(extractFunction(engine, 'entryFadeFrames'));
  const dry = stripTypeScriptTypes(extractFunction(engine, 'entersDry'));
  const speech = stripTypeScriptTypes(extractFunction(engine, 'isSpeechTrack'));
  const box = { MAESTRO_IA_TRACK_ID: 'track-maestro-ia' };
  vm.createContext(box);
  vm.runInContext(`${speech}\n${dry}\n${src}\nthis.f = entryFadeFrames;`, box);
  assert.equal(box.f({ id: 'track-click', parentId: null }, 1024, true), 10);
  assert.equal(box.f({ id: 'x', parentId: 'track-click' }, 512, false), 10);
  assert.equal(box.f({ id: 'track-maestro-ia', parentId: 'track-maestro' }, 1024, true), 256, 'fala num pulo: 5 ms');
  assert.equal(box.f({ id: 'track-maestro-ia', parentId: 'track-maestro' }, 512, false), 10);
  assert.equal(box.f({ id: 'baixo', parentId: 'track-contrabaixo' }, 1024, true), 1024);
  assert.doesNotMatch(engine, /fadeInFrames: 1024,/);
});

test('música lida do disco: BPM ou tom mudados abrem o áudio para preparar', () => {
  assert.match(engine, /const closed = this\.songNodes\(songId\)[\s\S]{0,420}await ensureSongLoaded\(songId\)/);
});

test('click remontado fica pronto sem depender de reprodutor', () => {
  assert.match(engine, /const clickClips = store\.clips\.filter\(\(c\) => c\.songId === songId && isClickTrack/);
});

// ---------- delay dos pads ----------

test('delay do pad: o laço desconta o bloco que o Web Audio soma em cada volta', () => {
  const sr = 48000;
  const loop = delayLoopSeconds(140, sr);
  const block = DELAY_BLOCK_FRAMES / sr;
  const D = delaySeconds(140);
  // primeira repetição: bloco de entrada + delay; cada volta seguinte: delay + bloco do laço
  for (let n = 1; n <= 8; n++) {
    const heard = block + loop + (n - 1) * (loop + block);
    assert.ok(Math.abs(heard - n * D) < 1e-9, `repetição ${n}`);
  }
  const pads = read('src', 'lib', 'padPlayer.ts');
  assert.match(pads, /delaySend\.connect\(delayBlock\)\.connect\(delay\)/);
  assert.match(pads, /setTargetAtTime\(delayLoopSeconds\(bpm, o\.ctx\.sampleRate\)/);
});

// ---------- SoundTouch na grade ----------

/** Áudio de ataques secos numa grade: um ponto fácil de localizar antes e depois do processamento. */
function drumLike(seconds, sr, beat) {
  const x = new Int16Array(Math.round(seconds * sr));
  const times = [];
  for (let k = 0; (k + 1) * beat < seconds - 1; k++) {
    const t = (k + 1) * beat;
    times.push(t);
    const at = Math.round(t * sr);
    for (let i = 0; i < 700; i++) x[at + i] += Math.round(24000 * Math.exp(-i / 140) * Math.sin(2 * Math.PI * (160 + 900 * Math.exp(-i / 60)) * i / sr));
  }
  return { x, times };
}

function stretch(x, sr, tempo, pitch) {
  const st = new SoundTouch();
  st.stretch.setParameters(sr, 82, 28, 12);
  st.stretch.quickSeek = true;
  st.tempo = tempo;
  st.pitch = pitch;
  const source = {
    extract(target, n, position) {
      const available = Math.min(n, Math.max(0, x.length + 32768 - position));
      for (let i = 0; i < available; i++) {
        const v = position + i < x.length ? x[position + i] / 32767 : 0;
        target[i * 2] = v; target[i * 2 + 1] = v;
      }
      return available;
    },
  };
  const filter = new SimpleFilter(source, st);
  const want = Math.ceil(x.length / tempo);
  const out = new Int16Array(want);
  const buf = new Float32Array(8192);
  let total = 0;
  while (total < want) {
    const got = Math.min(filter.extract(buf, 4096), want - total);
    if (got <= 0) break;
    for (let i = 0; i < got; i++) out[total + i] = Math.max(-32768, Math.min(32767, Math.round(buf[i * 2] * 32767)));
    total += got;
  }
  return out;
}

/** Desvio mediano (ms) dos ataques da saída em relação à grade no andamento novo. */
function medianDeviation(out, sr, times, tempo) {
  const dev = [];
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (const t of times) {
    const want = Math.round((t / tempo) * sr);
    let found = -1;
    for (let i = Math.max(0, want - Math.round(0.08 * sr)); i < Math.min(out.length, want + Math.round(0.05 * sr)); i++) {
      if (Math.abs(out[i]) > peak * 0.25) { found = i; break; }
    }
    if (found >= 0) dev.push(((found - want) / sr) * 1000);
  }
  dev.sort((a, b) => a - b);
  return dev[dev.length >> 1];
}

test('tom alterado no BPM original: a medida devolve os ataques para a grade', () => {
  const sr = 22050;
  const { x, times } = drumLike(40, sr, 0.5);
  const inAttacks = attackEnvelope(x, x, sr);
  for (const [tempo, pitch] of [[1, 1.1225], [1, 1.2599], [1, 0.8909]]) {
    const out = stretch(x, sr, tempo, pitch);
    const before = medianDeviation(out, sr, times, tempo);
    const measured = measureStretchOffsetMs(inAttacks, attackEnvelope(out, out, sr), tempo);
    assert.ok(measured !== null, 'precisa medir');
    const fixed = shiftSamples(out, Math.round((-measured * sr) / 1000));
    const after = medianDeviation(fixed, sr, times, tempo);
    assert.ok(Math.abs(after) <= 3, `${tempo}/${pitch}: ainda ${after.toFixed(2)} ms fora da grade (antes ${before.toFixed(2)})`);
    assert.equal(fixed.length, out.length);
  }
});

test('áudio guardado: só o de tom alterado no BPM original é refeito', () => {
  const store = read('src', 'lib', 'readyStore.ts');
  const src = stripTypeScriptTypes(extractFunction(store, 'renderVersion'));
  const box = {};
  vm.createContext(box);
  vm.runInContext(`${src}\nthis.f = renderVersion;`, box);
  assert.notEqual(box.f(1, 1.1225), '');
  assert.equal(box.f(0.9, 1), '');
  assert.equal(box.f(0.9, 1.1225), '');
  assert.equal(box.f(1, 1), '');
});

test('faixa muda não dá medida e a conta nominal assume', () => {
  const silent = new Float32Array(30000);
  assert.equal(measureStretchOffsetMs(silent, silent, 1), null);
  assert.ok(nominalStretchLeadMs(0.75, 1) > nominalStretchLeadMs(1, 1));
  assert.ok(nominalStretchLeadMs(1.25, 1) < nominalStretchLeadMs(1, 1));
});

test('deslocar a faixa não muda o tamanho nem cria valor novo', () => {
  const x = Int16Array.from({ length: 1000 }, (_, i) => i - 500);
  const later = shiftSamples(x, 10);
  assert.equal(later.length, 1000);
  assert.equal(later[9], 0);
  assert.equal(later[10], x[0]);
  const earlier = shiftSamples(x, -10);
  assert.equal(earlier[0], x[10]);
  assert.equal(earlier[999], 0);
  assert.equal(shiftSamples(x, 0), x);
});

test('voz ao vivo com tom alterado sai na grade e a 1x continua intacta', () => {
  const soundtouch = read('src', 'lib', 'soundtouch.vendor.js').replace(/export\s*\{[^}]*\}\s*;?/g, '');
  const proc = read('src', 'lib', 'clipPlayerProcessor.js');
  const SR = 48000;
  const sb = { currentTime: 0, sampleRate: SR, Float32Array, Int16Array, Math, Number, console };
  sb.AudioWorkletProcessor = class {
    constructor() { this.port = { onmessage: null, postMessage() {} }; }
  };
  sb.registerProcessor = (_n, cls) => { sb.cls = cls; };
  vm.createContext(sb);
  vm.runInContext(`${soundtouch}\n${proc}`, sb);
  const { x, times } = drumLike(20, SR, 0.5);
  const play = (tempo, pitch, process) => {
    sb.currentTime = 0;
    const p = new sb.cls({ processorOptions: { sampleRate: SR, primeTargetFrames: 2048, left: x, right: x, tempo, pitch, process } });
    p.port.onmessage({ data: { type: 'seek', offsetSamples: 0, startTime: 0.05, fadeInFrames: 1 } });
    const q = Math.ceil(((18 / tempo) * SR) / 128);
    const out = new Int16Array(q * 128);
    for (let n = 0; n < q; n++) {
      const L = new Float32Array(128); const R = new Float32Array(128);
      p.process([], [[L, R]]);
      for (let i = 0; i < 128; i++) out[n * 128 + i] = Math.round(L[i] * 32767);
      sb.currentTime += 128 / SR;
    }
    return out.subarray(Math.round(0.05 * SR));
  };
  // a 1x, sem processamento: ataque na amostra exata
  const dry = play(1, 1, false);
  const d0 = medianDeviation(dry, SR, times.slice(0, 20), 1);
  assert.ok(Math.abs(d0) <= 0.5, `1x mudou: ${d0} ms`);
  // só tom alterado: a leitura compensa o adiantamento, e o ataque não pode sair mais cedo que isso
  const toned = medianDeviation(play(1, 1.1225, true), SR, times.slice(0, 20), 1);
  assert.ok(Math.abs(toned) <= 12, `tom: ao vivo ${toned.toFixed(2)} ms da grade`);
});

test('BPM alterado segue como era: a compensação só vale no BPM original', () => {
  const proc = read('src', 'lib', 'clipPlayerProcessor.js');
  assert.match(proc, /function liveLeadFrames\(sr, tempo, pitch\) \{\n\s*if \(Math\.abs\(tempo - 1\) >= 1e-4\) return 0;/);
  const worker = read('src', 'workers', 'timeStretch.worker.ts');
  assert.match(worker, /const pitchOnly = Math\.abs\(req\.tempo - 1\) < 1e-4;/);
  assert.match(worker, /if \(!inputAttacks\) return \{ left: outL, right: outR \};/);
});
