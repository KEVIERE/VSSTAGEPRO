// Anti-clip de cada canal do mixer: um limitador de pico em -0,1 dBFS que liga e desliga por canal.
// Fica entre o nível do canal e o medidor, então o medidor e todas as saídas (Master ou saída
// direta da interface) recebem o sinal já limitado.
//
//   desligado:  entrada ─ seco (ganho 1) ─────────────────── saída   (o canal sai como sempre saiu)
//   ligado:     entrada ─ limitador ─ molhado (ganho 1) ───── saída   (o seco fica em 0)
//
// Ligar ou desligar com a música tocando troca um caminho pelo outro em ~10 ms, sem estalo.
import { getPeakLimiterWorkletUrl } from '@/lib/peakLimiterWorklet';
import { ANTI_CLIP_CEILING, LIMITER_LOOKAHEAD, LIMITER_RELEASE } from '@/lib/peakLimiter.js';
import { isTimecodeTrackId } from '@/lib/timecode';
import type { Track } from '@/types';

export { ANTI_CLIP_CEILING };

const SWAP_TIME = 0.01;

/** O limitador vale para este canal? O timecode (LTC) nunca é limitado. */
export function antiClipActive(track: Pick<Track, 'id' | 'antiClip'> | undefined): boolean {
  return !!track?.antiClip && !isTimecodeTrackId(track.id);
}

const loaded = new WeakSet<BaseAudioContext>();
const loading = new WeakMap<BaseAudioContext, Promise<void>>();

/** Carrega o processor do limitador no contexto (uma vez por contexto). */
export function loadPeakLimiter(ctx: BaseAudioContext): Promise<void> {
  if (loaded.has(ctx)) return Promise.resolve();
  let task = loading.get(ctx);
  if (!task) {
    task = ctx.audioWorklet.addModule(getPeakLimiterWorkletUrl()).then(
      () => { loaded.add(ctx); },
      (err) => { loading.delete(ctx); throw err; },
    );
    loading.set(ctx, task);
  }
  return task;
}

export class AntiClipInsert {
  private readonly dry: GainNode;
  private limiter: AudioWorkletNode | null = null;
  private wet: GainNode | null = null;
  private wanted = false;
  private teardown: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ctx: BaseAudioContext, private readonly from: AudioNode, private readonly to: AudioNode) {
    this.dry = ctx.createGain();
    from.connect(this.dry);
    this.dry.connect(to);
  }

  /** Liga ou desliga. `immediate` troca sem a rampa (canal recém-criado, antes de tocar). */
  set(on: boolean, immediate = false) {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.engage(immediate);
    else this.disengage(immediate);
  }

  get engaged(): boolean {
    return this.wanted && this.limiter !== null;
  }

  private engage(immediate: boolean) {
    const ctx = this.ctx;
    if (!loaded.has(ctx)) {
      // o processor ainda está carregando: o canal segue livre até ele chegar
      loadPeakLimiter(ctx)
        .then(() => { if (this.wanted && !this.limiter) this.engage(immediate); })
        .catch((err) => console.warn('[anti-clip] limitador indisponível', err));
      return;
    }
    if (this.teardown) { clearTimeout(this.teardown); this.teardown = null; }
    if (!this.limiter || !this.wet) {
      this.limiter = new AudioWorkletNode(ctx, 'peak-limiter', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { ceiling: ANTI_CLIP_CEILING, lookahead: LIMITER_LOOKAHEAD, release: LIMITER_RELEASE },
      });
      this.wet = ctx.createGain();
      this.wet.gain.value = 0;
      this.from.connect(this.limiter);
      this.limiter.connect(this.wet);
      this.wet.connect(this.to);
    }
    this.swap(this.dry.gain, 0, immediate);
    this.swap(this.wet.gain, 1, immediate);
  }

  private disengage(immediate: boolean) {
    // nunca chegou a ligar (ou ainda carregava): o seco já está em 1
    if (!this.limiter || !this.wet) return;
    this.swap(this.dry.gain, 1, immediate);
    this.swap(this.wet.gain, 0, immediate);
    if (this.teardown) clearTimeout(this.teardown);
    // terminada a troca, solta o limitador para não gastar processamento à toa
    this.teardown = setTimeout(() => {
      this.teardown = null;
      if (!this.wanted) this.dropLimiter();
    }, immediate ? 0 : SWAP_TIME * 1000 + 100);
  }

  private dropLimiter() {
    const { limiter, wet } = this;
    this.limiter = null;
    this.wet = null;
    if (limiter) {
      try { this.from.disconnect(limiter); } catch { /* ignore */ }
      try { limiter.disconnect(); } catch { /* ignore */ }
      try { limiter.port.postMessage({ type: 'dispose' }); } catch { /* ignore */ }
    }
    if (wet) { try { wet.disconnect(); } catch { /* ignore */ } }
  }

  private swap(param: AudioParam, target: number, immediate: boolean) {
    const now = this.ctx.currentTime;
    try {
      param.cancelScheduledValues(now);
      if (immediate) {
        param.setValueAtTime(target, now);
      } else {
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(target, now + SWAP_TIME);
      }
    } catch {
      param.value = target;
    }
  }

  dispose() {
    if (this.teardown) { clearTimeout(this.teardown); this.teardown = null; }
    this.wanted = false;
    this.dropLimiter();
    try { this.from.disconnect(this.dry); } catch { /* ignore */ }
    try { this.dry.disconnect(); } catch { /* ignore */ }
  }
}
