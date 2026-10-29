const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const file = fs.readFileSync('src/lib/clipPlayerWorklet.ts', 'utf8');
const source = file.split('const processorSource = `')[1].split('`;')[0];
let Processor;
const context = {
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, onmessage: null }; } },
  registerProcessor(_name, processor) { Processor = processor; },
  sampleRate: 48000,
  currentTime: 0,
  Float32Array, Int16Array, Math,
};
vm.runInNewContext(source, context);
const audio = new Float32Array(48000 * 4);
for (let i = 0; i < audio.length; i++) audio[i] = i < 48000 ? 0.5 : -0.5;
const player = new Processor({ processorOptions: { left: audio, right: audio, sampleRate: 48000, offsetSamples: 0, tempo: 1, pitch: 1, fadeInFrames: 1 } });
player.port.onmessage({ data: { startTime: 0 } });
function block(time) {
  context.currentTime = time;
  const left = new Float32Array(128);
  const right = new Float32Array(128);
  player.process([], [[left, right]]);
  return left;
}
block(0);
player.port.onmessage({ data: { type: 'retime', offsetSamples: 48000, at: 0.01, resumeAt: 0.01, crossfadeFrames: 256, tempo: 1, pitch: 1, process: false } });
assert.ok(block(0.005).every(x => x > 0.49), 'áudio anterior continua até o salto');
block(0.01);
block(0.0126667);
assert.ok(block(0.016).every(x => x < -0.49), 'áudio do destino toca após o crossfade');
player.port.onmessage({ data: { type: 'retime', offsetSamples: 0, at: 0.02, resumeAt: 0.04, crossfadeFrames: 256, tempo: 1, pitch: 1, process: false } });
block(0.02);
block(0.0226667);
assert.ok(block(0.03).every(x => x === 0), 'clipe futuro permanece silencioso até o horário');
block(0.04);
block(0.0426667);
assert.ok(block(0.05).every(x => x > 0.49), 'clipe futuro começa no horário agendado');
console.log('Testes de salto e agendamento do worklet passaram.');
