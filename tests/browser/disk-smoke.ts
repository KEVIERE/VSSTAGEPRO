// 12 faixas WAV 44,1 kHz (o formato mais comum de multitrack) tocando num AudioContext de
// 48 kHz, lidas do arquivo em trechos com conversão de taxa, contra a leitura do arquivo inteiro.
// Abrir com o servidor de desenvolvimento: /tests/browser/disk-smoke.html
import { getClipPlayerWorkletUrl } from '../../src/lib/clipPlayerWorklet';
import { DiskStreamer, PRIORITY_ON_AIR, DISK_CHUNK_FRAMES } from '../../src/lib/audioStreamer';
import { registerClipSource } from '../../src/lib/audioLibrary';
import { openRangeReader } from '../../src/lib/diskSource';
import { readWav } from '../../src/lib/wavReader';
import { deviceSampleRate } from '../../src/lib/audioDecoder';
import type { AudioClip } from '../../src/types';

const out = document.getElementById('out')!;
const TRACKS = 12;
const SECONDS = 30;
const SRC_RATE = 44100;

function wav(seed: number): Blob {
  const frames = SRC_RATE * SECONDS;
  const block = 2 * 3;
  const buf = new ArrayBuffer(44 + frames * block);
  const v = new DataView(buf);
  const w = (o: number, t: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + frames * block, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, SRC_RATE, true); v.setUint32(28, SRC_RATE * block, true); v.setUint16(32, block, true); v.setUint16(34, 24, true);
  w(36, 'data'); v.setUint32(40, frames * block, true);
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) {
    const x = Math.sin((2 * Math.PI * (200 + seed * 37 + c * 50) * i) / SRC_RATE) * 0.5;
    const s = Math.round(x * 8388607);
    v.setUint8(p, s & 255); v.setUint8(p + 1, (s >> 8) & 255); v.setUint8(p + 2, (s >> 16) & 255); p += 3;
  }
  return new File([buf], `faixa-${seed}.wav`, { lastModified: 1 });
}

(async () => {
  const lines: string[] = [];
  try {
    const rate = deviceSampleRate();
    lines.push(`taxa da saída: ${rate} Hz; arquivos: WAV ${SRC_RATE} Hz 24 bits estéreo, ${TRACKS} faixas × ${SECONDS} s`);
    const clips: AudioClip[] = [];
    for (let t = 0; t < TRACKS; t++) {
      const clip = { id: `c${t}`, songId: 'teste-disco', trackId: `t${t}`, name: `faixa ${t}`, startTime: 0, duration: SECONDS } as unknown as AudioClip;
      registerClipSource(clip.id, clip.songId, wav(t));
      clips.push(clip);
    }
    const startOffset = 20; // largada perto do fim
    const t0 = performance.now();
    const readers = await Promise.all(clips.map((c) => openRangeReader(c)));
    const tOpen = performance.now() - t0;
    if (readers.some((r) => !r)) throw new Error('algum leitor não abriu');
    const from = Math.floor(startOffset * rate);
    const initial = await Promise.all(readers.map((r) => r!.read(from, DISK_CHUNK_FRAMES)));
    const tFirst = performance.now() - t0;
    lines.push(`do comando até ter o trecho da largada de todas as faixas: ${tFirst.toFixed(0)} ms (abrir os leitores: ${tOpen.toFixed(0)} ms)`);

    const length = Math.floor((SECONDS - startOffset) * rate);
    const ctx = new OfflineAudioContext({ numberOfChannels: TRACKS, length, sampleRate: rate });
    await ctx.audioWorklet.addModule(getClipPlayerWorkletUrl());
    const merger = ctx.createChannelMerger(TRACKS);
    merger.connect(ctx.destination);
    const ds = new DiskStreamer();
    let underruns = 0;
    for (let t = 0; t < TRACKS; t++) {
      const r = readers[t]!;
      const node = new AudioWorkletNode(ctx, 'clip-player', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { totalFrames: r.length, sampleRate: rate, offsetSamples: from, tempo: 1, pitch: 1, process: false, primeTargetFrames: 2048, fadeInFrames: 1 },
      });
      node.port.onmessage = (ev) => { if (ev.data?.type === 'underrun') underruns++; };
      ds.start(node.port, r, { from, priority: PRIORITY_ON_AIR, initial: { start: from, channels: initial[t] } });
      node.port.postMessage({ startTime: 0 });
      const split = ctx.createChannelSplitter(2);
      node.connect(split);
      split.connect(merger, 0, t);
    }
    // relógio no ritmo real (como num show): a cada 50 ms de áudio, 50 ms de relógio de parede
    const wall0 = performance.now();
    for (let s = 0.05; s < length / rate; s += 0.05) {
      const at = s;
      ctx.suspend(at).then(async () => {
        const wait = wall0 + at * 1000 - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        ctx.resume();
      });
    }
    const buf = await ctx.startRendering();

    // referência: o arquivo inteiro convertido de uma vez, como o app fazia antes. O ponto em
    // que o som começa depende de quando a ordem de largada chega ao áudio; ele tem de ser o
    // MESMO em todas as faixas (sincronia) e, a partir dele, cada amostra tem de bater.
    const { getClipSource } = await import('../../src/lib/audioLibrary');
    let maxDiff = 0;
    const starts: number[] = [];
    for (let t = 0; t < TRACKS; t++) {
      const ref = await readWav(getClipSource(clips[t].id)!, rate);
      const ch = buf.getChannelData(t);
      let begin = 0;
      while (begin < ch.length && ch[begin] === 0) begin++;
      // a 1ª amostra é o início do fade-in (ganho 0): o som começa uma antes do primeiro valor não zero
      begin = Math.max(0, begin - 1);
      starts.push(begin);
      for (let i = begin + 1; i < ch.length; i++) {
        const d = Math.abs(ch[i] - ref!.channels[0][from + i - begin] / 32767);
        if (d > maxDiff) maxDiff = d;
      }
    }
    lines.push(`início do som em cada faixa (amostra): ${[...new Set(starts)].join(', ')} → ${new Set(starts).size === 1 ? 'todas juntas' : 'DESALINHADAS'}`);
    lines.push(`diferença máxima contra o arquivo convertido inteiro: ${maxDiff.toExponential(2)} (0 = idêntico)`);
    lines.push(`falhas de buffer (underrun): ${underruns}`);
    lines.push('OK');
  } catch (err) {
    lines.push('ERRO: ' + (err instanceof Error ? err.stack : String(err)));
  }
  out.textContent = lines.join('\n');
  (window as unknown as { __result: string }).__result = out.textContent;
})();
