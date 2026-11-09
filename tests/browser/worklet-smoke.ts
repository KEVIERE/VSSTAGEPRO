// Roda o reprodutor de verdade num OfflineAudioContext: 12 faixas recebendo o áudio em
// trechos (audioStreamer) enquanto tocam. O relógio é pausado a cada 50 ms para entregar os
// trechos num ritmo controlado, como a thread principal faria durante o show.
// Abrir com o servidor de desenvolvimento: /tests/browser/worklet-smoke.html
import { getClipPlayerWorkletUrl } from '../../src/lib/clipPlayerWorklet';
import { AudioStreamer, PRIORITY_ON_AIR } from '../../src/lib/audioStreamer';

const out = document.getElementById('out')!;
const SR = 48000;
const TRACKS = 12;
const SECONDS = 20;
const START = 0.1;

function ramp(frames: number, seed: number) {
  const a = new Int16Array(frames);
  for (let i = 0; i < frames; i++) a[i] = ((i + seed) % 30000) + 1;
  return a;
}

async function scenario(name: string, opts: { tempo?: number; seekTo?: number }) {
  const total = SR * SECONDS;
  const ctx = new OfflineAudioContext({ numberOfChannels: TRACKS, length: SR * (SECONDS - (opts.seekTo ?? 0)), sampleRate: SR });
  await ctx.audioWorklet.addModule(getClipPlayerWorkletUrl());
  const merger = ctx.createChannelMerger(TRACKS);
  merger.connect(ctx.destination);
  const streamer = new AudioStreamer();
  const events: string[] = [];
  const from = Math.floor((opts.seekTo ?? 0) * SR);
  const tempo = opts.tempo ?? 1;
  for (let t = 0; t < TRACKS; t++) {
    const data = ramp(total, t * 101);
    const node = new AudioWorkletNode(ctx, 'clip-player', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { totalFrames: total, sampleRate: SR, offsetSamples: from, tempo, pitch: 1, process: tempo !== 1, primeTargetFrames: 2048, fadeInFrames: 1 },
    });
    node.port.onmessage = (ev) => { if (ev.data?.type && ev.data.type !== 'ready') events.push(`${t}:${ev.data.type}`); };
    streamer.start(node.port, { channels: [data, data], length: total }, { from, priority: PRIORITY_ON_AIR });
    node.port.postMessage({ startTime: START });
    const split = ctx.createChannelSplitter(2);
    node.connect(split);
    split.connect(merger, 0, t);
  }
  // entrega os trechos durante a renderização
  for (let s = 0.05; s < ctx.length / SR; s += 0.05) {
    ctx.suspend(s).then(async () => {
      await new Promise((r) => setTimeout(r, 2));
      ctx.resume();
    });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  const startIdx = Math.round(START * SR);
  let mismatches = 0;
  let silentGaps = 0;
  if (tempo === 1) {
    for (let t = 0; t < TRACKS; t++) {
      const ch = buf.getChannelData(t);
      for (let i = startIdx + 1; i < ch.length; i += 997) { // a 1ª amostra é o início do fade-in (ganho 0)
        if (i - startIdx + from >= total) break; // depois do fim do clipe é silêncio mesmo
        const expect = (((i - startIdx + from + t * 101) % 30000) + 1) / 32767;
        if (Math.abs(ch[i] - expect) > 1e-4) {
          mismatches++;
          if (mismatches <= 3) console.warn('fora do lugar', name, { track: t, i, got: ch[i] * 32767, expect: expect * 32767 });
        }
        if (ch[i] === 0) silentGaps++;
      }
    }
  } else {
    for (let t = 0; t < TRACKS; t++) {
      const ch = buf.getChannelData(t);
      for (let i = startIdx; i < ch.length; i += 97) if (Math.abs(ch[i]) > 2 || !Number.isFinite(ch[i])) mismatches++;
    }
  }
  const underruns = events.filter((e) => e.endsWith('underrun')).length;
  const loaded = events.filter((e) => e.endsWith('loaded')).length;
  return `${name}: ${TRACKS} faixas × ${SECONDS}s em ${ms.toFixed(0)} ms | amostras fora do lugar: ${mismatches} | silêncios: ${silentGaps} | underruns: ${underruns} | faixas completas: ${loaded}/${TRACKS}`;
}

(async () => {
  const lines: string[] = [];
  try {
    lines.push(await scenario('largada no início', {}));
    lines.push(await scenario('largada no meio (busca para 15 s)', { seekTo: 15 }));
    lines.push(await scenario('BPM +10% (SoundTouch ao vivo)', { tempo: 1.1 }));
    const live = new AudioContext({ latencyHint: 'playback' });
    lines.push(`AudioContext real (modo Show/'playback'): baseLatency ${(live.baseLatency * 1000).toFixed(1)} ms, outputLatency ${((live.outputLatency || 0) * 1000).toFixed(1)} ms`);
    const inter = new AudioContext({ latencyHint: 'interactive' });
    lines.push(`AudioContext real ('interactive'): baseLatency ${(inter.baseLatency * 1000).toFixed(1)} ms`);
    lines.push('OK');
  } catch (err) {
    lines.push('ERRO: ' + (err instanceof Error ? err.stack : String(err)));
  }
  out.textContent = lines.join('\n');
  (window as unknown as { __result: string }).__result = out.textContent;
})();
