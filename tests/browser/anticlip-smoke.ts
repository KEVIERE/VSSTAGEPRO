// Anti-clip de um canal no navegador de verdade: o mesmo AntiClipInsert que o audioEngine põe em
// cada canal, com o AudioWorklet do limitador, renderizado num OfflineAudioContext.
// Abrir com o servidor de desenvolvimento: /tests/browser/anticlip-smoke.html
import { AntiClipInsert, ANTI_CLIP_CEILING, loadPeakLimiter } from '../../src/lib/antiClip';
import { PeakLimiter } from '../../src/lib/peakLimiter.js';

const out = document.getElementById('out')!;
const SR = 48000;
const SECONDS = 3;
const N = SR * SECONDS;
const db = (g: number) => 20 * Math.log10(g);

// +6 dB de sobra: seno grave + ruído + batidas, L e R diferentes
function loud(): [Float32Array, Float32Array] {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const hit = (i % 12000) < 400 ? Math.exp(-(i % 12000) / 80) * 1.5 : 0;
    L[i] = 2 * (0.6 * Math.sin(2 * Math.PI * 60 * t) + 0.3 * rnd()) + hit;
    R[i] = 2 * (0.6 * Math.sin(2 * Math.PI * 90 * t + 1) + 0.3 * rnd()) - hit;
  }
  return [L, R];
}

function peak(chs: Float32Array[], from = 0, to = N) {
  let p = 0;
  for (const ch of chs) for (let i = from; i < to; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

function sameAs(a: Float32Array[], b: Float32Array[], from = 0, to = N) {
  let diffs = 0;
  for (let c = 0; c < a.length; c++) for (let i = from; i < to; i++) if (a[c][i] !== b[c][i]) diffs++;
  return diffs;
}

async function render(setup: (ctx: OfflineAudioContext, insert: AntiClipInsert) => void | Promise<void>) {
  const [L, R] = loud();
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: N, sampleRate: SR });
  await loadPeakLimiter(ctx);
  const buf = ctx.createBuffer(2, N, SR);
  buf.copyToChannel(L, 0);
  buf.copyToChannel(R, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // como no canal do mixer: nível → anti-clip → medidor → saída
  const level = ctx.createGain();
  const meter = ctx.createGain();
  src.connect(level);
  const insert = new AntiClipInsert(ctx, level, meter);
  meter.connect(ctx.destination);
  await setup(ctx, insert);
  src.start(0);
  const res = await ctx.startRendering();
  return { input: [L, R], output: [res.getChannelData(0), res.getChannelData(1)] };
}

async function main() {
  const results: Record<string, unknown> = {};
  let ok = true;
  const check = (name: string, cond: boolean, info: unknown) => { results[name] = { ok: cond, ...(info as object) }; if (!cond) ok = false; };

  // 1) desligado: sai exatamente como entrou
  {
    const { input, output } = await render(() => {});
    check('desligado: igual à entrada', sameAs(input, output) === 0, { diferencas: sameAs(input, output), picoEntradaDb: +db(peak(input)).toFixed(2) });
  }

  // 2) ligado: nenhum pico passa de -0,1 dBFS e o resultado é o mesmo da exportação/testes
  {
    const { input, output } = await render((_ctx, insert) => insert.set(true, true));
    const p = peak(output);
    check('ligado: pico <= -0,1 dBFS', p <= ANTI_CLIP_CEILING, { picoSaidaDb: +db(p).toFixed(4) });
    check('ligado: encosta no teto (não esmaga)', db(p) > -0.5, { picoSaidaDb: +db(p).toFixed(4) });
    const lim = new PeakLimiter(SR, { ceiling: ANTI_CLIP_CEILING });
    const ref = [new Float32Array(N), new Float32Array(N)];
    for (let s = 0; s < N; s += 128) {
      lim.process([input[0].subarray(s, s + 128), input[1].subarray(s, s + 128)], [ref[0].subarray(s, s + 128), ref[1].subarray(s, s + 128)], Math.min(128, N - s));
    }
    check('ligado: worklet = mesmo código da exportação', sameAs(ref, output) === 0, { diferencas: sameAs(ref, output) });
  }

  // 3) liga em 1 s e desliga em 2 s com a música tocando
  {
    const { input, output } = await render((ctx, insert) => {
      ctx.suspend(1).then(() => { insert.set(true); ctx.resume(); });
      ctx.suspend(2).then(() => { insert.set(false); ctx.resume(); });
    });
    const a = Math.round(1.02 * SR);
    const b = 2 * SR;
    check('tocando: antes de ligar, igual à entrada', sameAs(input, output, 0, SR) === 0, { diferencas: sameAs(input, output, 0, SR) });
    check('tocando: ligado, pico <= -0,1 dBFS', peak(output, a, b) <= ANTI_CLIP_CEILING, { picoDb: +db(peak(output, a, b)).toFixed(4) });
    const c = Math.round(2.02 * SR);
    check('tocando: depois de desligar, igual à entrada', sameAs(input, output, c, N) === 0, { diferencas: sameAs(input, output, c, N) });
  }

  (window as unknown as { __antiClip: unknown }).__antiClip = { ok, results };
  out.textContent = (ok ? 'OK\n' : 'FALHOU\n') + JSON.stringify(results, null, 2);
}

main().catch((err) => {
  (window as unknown as { __antiClip: unknown }).__antiClip = { ok: false, error: String(err) };
  out.textContent = 'ERRO: ' + String(err?.stack ?? err);
});
