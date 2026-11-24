// Worker de time-stretch + pitch-shift com SoundTouch (algoritmo WSOLA).
// Mantém tempo e tom independentes e roda fora da thread da UI.
// Recebe e devolve 16 bits quando pedido, para não dobrar a memória durante o processamento.
import { SoundTouch, SimpleFilter } from '../lib/soundtouch.vendor.js';
import { attackEnvelope, measureStretchOffsetMs, nominalStretchLeadMs, shiftSamples, stretchLeadMs } from '../lib/stretchLatency.ts';

type Samples = Int16Array | Float32Array;

type Req = {
  id: string;
  left: Samples;
  right: Samples;
  sampleRate: number;
  tempo: number;  // >1 toca mais rápido, sem alterar o tom
  pitch: number;  // >1 sobe o tom, sem alterar a velocidade
  output: 'int16' | 'float';
};

/** BPM alterado: quanto a faixa já processada sai adiantada, nas cópias reduzidas dela e do original. */
type LeadReq = {
  id: string;
  kind: 'lead';
  input: Int16Array;
  output: Int16Array;
  rate: number;
  tempo: number;
  pitch: number;
};

type Res =
  | { id: string; ok: true; left: Samples; right: Samples }
  | { id: string; ok: false; error: string };

const TAIL_PAD = 16384 * 2;

class ArraySource {
  position = 0;
  private k: number;
  constructor(public left: Samples, public right: Samples) {
    this.k = left instanceof Int16Array ? 1 / 32767 : 1;
  }
  // Silêncio extra no fim: o SoundTouch só processa blocos cheios e cortava o final da faixa.
  extract(target: Float32Array, numFrames: number, position: number): number {
    this.position = position;
    const n = this.left.length;
    const available = Math.min(numFrames, Math.max(0, n + TAIL_PAD - position));
    const k = this.k;
    for (let i = 0; i < available; i++) {
      const p = i + position;
      target[i * 2] = p < n ? this.left[p] * k : 0;
      target[i * 2 + 1] = p < n ? this.right[p] * k : 0;
    }
    return available;
  }
}

function toInt16(v: number): number {
  return v >= 1 ? 32767 : v <= -1 ? -32768 : Math.round(v * 32767);
}

function processClip(req: Req): { left: Samples; right: Samples } {
  // Atalho instantâneo se não houver alteração de tempo nem de tom
  if (Math.abs(req.tempo - 1) < 1e-4 && Math.abs(req.pitch - 1) < 1e-4) {
    return { left: req.left, right: req.right };
  }

  // Só tom alterado: a faixa melódica precisa cair junto da bateria, que toca sem SoundTouch. Os
  // ataques do original ficam guardados para conferir, no fim, onde a saída caiu.
  const pitchOnly = Math.abs(req.tempo - 1) < 1e-4;
  const inputAttacks = pitchOnly ? attackEnvelope(req.left, req.right, req.sampleRate) : null;

  const st = new SoundTouch();
  // quickSeek com algoritmo hierárquico multiescala do SoundTouch: 4x a 5x mais rápido
  // com preservação total de fase e qualidade de estúdio para multitracks ao vivo.
  st.stretch.setParameters(req.sampleRate, 82, 28, 12);
  st.stretch.quickSeek = true;
  st.tempo = req.tempo;
  st.pitch = req.pitch;
  const source = new ArraySource(req.left, req.right);
  const expected = Math.ceil(req.left.length / req.tempo);
  const filter = new SimpleFilter(source, st);
  const asInt = req.output === 'int16';
  const make = (n: number): Samples => (asInt ? new Int16Array(n) : new Float32Array(n));

  const BLOCK = 4096;
  const buf = new Float32Array(BLOCK * 2);
  const chunksL: Samples[] = [];
  const chunksR: Samples[] = [];
  let total = 0;
  while (total < expected) {
    const got = Math.min(filter.extract(buf, BLOCK), expected - total);
    if (got <= 0) break;
    const l = make(got);
    const r = make(got);
    if (asInt) {
      for (let i = 0; i < got; i++) {
        l[i] = toInt16(buf[i * 2]);
        r[i] = toInt16(buf[i * 2 + 1]);
      }
    } else {
      for (let i = 0; i < got; i++) {
        l[i] = buf[i * 2];
        r[i] = buf[i * 2 + 1];
      }
    }
    chunksL.push(l);
    chunksR.push(r);
    total += got;
  }
  // A entrada não é mais necessária; solta antes de juntar a saída.
  req.left = make(0);
  req.right = req.left;
  const outL = make(total);
  const outR = make(total);
  let p = 0;
  for (let i = 0; i < chunksL.length; i++) {
    (outL as Int16Array).set(chunksL[i] as Int16Array, p);
    (outR as Int16Array).set(chunksR[i] as Int16Array, p);
    p += chunksL[i].length;
  }
  if (!inputAttacks) return { left: outL, right: outR };
  // O SoundTouch adianta o áudio: a faixa volta para a grade com o deslocamento medido nela mesma.
  // É uma cópia deslocada: não mexe no som e não cria estalo.
  const measured = measureStretchOffsetMs(inputAttacks, attackEnvelope(outL, outR, req.sampleRate), req.tempo);
  const shiftMs = measured === null ? nominalStretchLeadMs(req.tempo, req.pitch) : -measured;
  const shift = Math.round((shiftMs * req.sampleRate) / 1000);
  return { left: shiftSamples(outL, shift), right: shiftSamples(outR, shift) };
}

self.onmessage = (ev: MessageEvent<Req | LeadReq>) => {
  if ('kind' in ev.data) {
    const { id, input, output, rate, tempo, pitch } = ev.data;
    try {
      (self as unknown as Worker).postMessage({ id, ok: true, leadMs: stretchLeadMs(input, output, rate, tempo, pitch) });
    } catch (e) {
      (self as unknown as Worker).postMessage({ id, ok: false, error: (e as Error).message });
    }
    return;
  }
  const req = ev.data;
  try {
    const { left, right } = processClip(req);
    const res: Res = { id: req.id, ok: true, left, right };
    (self as unknown as Worker).postMessage(res, [left.buffer, right.buffer]);
  } catch (e) {
    const res: Res = { id: req.id, ok: false, error: (e as Error).message };
    (self as unknown as Worker).postMessage(res);
  }
};

export {};
