// Processor do AudioWorklet do anti-clip (limitador de pico de cada canal). Roda na thread de
// áudio: peakLimiterWorklet.ts junta este arquivo com peakLimiter.js (a classe PeakLimiter) num
// único script. Os testes (tests/peakLimiter.test.mjs) carregam os dois do mesmo jeito.
/* global PeakLimiter, sampleRate, registerProcessor, AudioWorkletProcessor */

class PeakLimiterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.limiter = new PeakLimiter(sampleRate, { ceiling: o.ceiling, lookahead: o.lookahead, release: o.release, channels: 2 });
    this.alive = true;
    // ao desligar o anti-clip o motor manda "dispose": o processor para e o nó pode ser liberado
    this.port.onmessage = (e) => { if (e.data && e.data.type === 'dispose') this.alive = false; };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return this.alive;
    this.limiter.process(inputs[0] || [], output, output[0].length);
    return this.alive;
  }
}

registerProcessor('peak-limiter', PeakLimiterProcessor);
