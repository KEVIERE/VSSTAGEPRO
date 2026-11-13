import type { ClipAudio } from '@/lib/audioLibrary';

interface Voice {
  src: AudioBufferSourceNode;
  startsAt: number;
}

// Conversão em fatias: a tela e a entrega do áudio das faixas não param enquanto o LTC é montado.
const BUILD_SLICE = 1 << 18;

function fillRange(src: Int16Array, out: Float32Array, from: number, to: number) {
  for (let i = from; i < to; i++) out[i] = src[i] / 32767;
}

function emptyBuffer(audio: ClipAudio): AudioBuffer {
  return new AudioBuffer({ length: audio.length, numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate });
}

// Escreve direto no AudioBuffer, sem a cópia temporária em float do tamanho da música.
function buildBuffer(audio: ClipAudio): AudioBuffer {
  const buffer = emptyBuffer(audio);
  audio.channels.forEach((ch, c) => fillRange(ch, buffer.getChannelData(c), 0, Math.min(audio.length, ch.length)));
  return buffer;
}

// `keep` falso entre uma fatia e outra: a música saiu da lista e o resto da conversão não é feito.
async function buildBufferAsync(audio: ClipAudio, keep: () => boolean): Promise<AudioBuffer | null> {
  const buffer = emptyBuffer(audio);
  for (let c = 0; c < audio.channels.length; c++) {
    const src = audio.channels[c];
    const out = buffer.getChannelData(c);
    const end = Math.min(audio.length, src.length);
    for (let i = 0; i < end; i += BUILD_SLICE) {
      fillRange(src, out, i, Math.min(end, i + BUILD_SLICE));
      await new Promise((r) => setTimeout(r, 0));
      if (!keep()) return null;
    }
  }
  return buffer;
}

/**
 * Toca o timecode no mesmo andamento das faixas: com o BPM ajustado, ele corre mais rápido ou mais
 * devagar junto (como o varispeed das máquinas de fita), para os telões e as luzes seguirem a
 * música. O afinador (tuner) não mexe nele: o sinal nunca passa pelo processamento de tom.
 */
export class TimecodePlayer {
  private ctx: AudioContext;
  private output: AudioNode;
  private current: Voice | null = null;
  private pending: Voice | null = null;
  // O LTC já montado no formato do navegador: o da música no ar e os das músicas retidas
  // (selecionada e próxima), preparados antes do Play.
  private cache = new Map<string, AudioBuffer>();
  private building = new Map<string, Promise<void>>();
  private currentClipId: string | null = null;
  // LTCs das músicas que ainda valem ficar montados. null: ninguém disse ainda (fica só o do ar
  // e o último preparado).
  private retained: Set<string> | null = null;
  private disposed = false;
  /** Velocidade de leitura (1 = original; 1,1 = BPM 10% mais rápido). */
  private rate = 1;

  constructor(ctx: AudioContext, output: AudioNode) {
    this.ctx = ctx;
    this.output = output;
  }

  private isRetained(clipId: string): boolean {
    return !this.retained || this.retained.has(clipId) || clipId === this.currentClipId;
  }

  private remember(clipId: string, buffer: AudioBuffer) {
    this.cache.delete(clipId);
    this.cache.set(clipId, buffer);
    // cada LTC de 5 min ocupa ~57 MB
    if (this.retained) {
      // ficam o do ar, o que acabou de ser montado e os das músicas retidas
      for (const id of Array.from(this.cache.keys())) {
        if (id !== clipId && !this.isRetained(id)) this.cache.delete(id);
      }
      return;
    }
    // sem lista: fica só o do ar e o último preparado
    for (const id of Array.from(this.cache.keys())) {
      if (this.cache.size <= 2) break;
      if (id !== clipId && id !== this.currentClipId) this.cache.delete(id);
    }
  }

  /**
   * LTCs que devem continuar montados (os da música no ar, da selecionada e da próxima). Os outros
   * saem do cache na hora, menos o que está no ar.
   */
  retain(clipIds: Iterable<string>) {
    this.retained = new Set(clipIds);
    for (const id of Array.from(this.cache.keys())) {
      if (!this.isRetained(id)) this.cache.delete(id);
    }
  }

  private cached(clipId: string, audio: ClipAudio): AudioBuffer | null {
    const hit = this.cache.get(clipId);
    return hit && hit.length === audio.length && hit.sampleRate === audio.sampleRate ? hit : null;
  }

  // Acerto de cache: o pedido por último passa para o fim da fila e não é o primeiro a sair.
  private touch(clipId: string, audio: ClipAudio): AudioBuffer | null {
    const hit = this.cached(clipId, audio);
    if (hit) {
      this.cache.delete(clipId);
      this.cache.set(clipId, hit);
    }
    return hit;
  }

  private bufferFor(clipId: string, audio: ClipAudio): AudioBuffer {
    const hit = this.touch(clipId, audio);
    if (hit) return hit;
    const buffer = buildBuffer(audio);
    this.remember(clipId, buffer);
    return buffer;
  }

  /** Monta antes o LTC de uma música (a próxima), para o Play não converter nada na hora da largada. */
  preload(clipId: string, audio: ClipAudio): Promise<void> {
    if (this.disposed || this.touch(clipId, audio) || audio.length <= 0 || audio.channels.length === 0) return Promise.resolve();
    const inflight = this.building.get(clipId);
    if (inflight) return inflight;
    const keep = () => !this.disposed && this.isRetained(clipId);
    const task = buildBufferAsync(audio, keep)
      .then((buffer) => { if (buffer && keep() && !this.cached(clipId, audio)) this.remember(clipId, buffer); })
      .catch((err) => console.warn('[timecode] não consegui preparar o LTC', err))
      .finally(() => this.building.delete(clipId));
    this.building.set(clipId, task);
    return task;
  }

  private voice(buffer: AudioBuffer, localPos: number, when: number): Voice | null {
    // antes do começo do arquivo, espera o tanto que a música leva até ele (no andamento atual)
    const ideal = when + Math.max(0, -localPos) / this.rate;
    const startsAt = Math.max(this.ctx.currentTime, ideal);
    // Ordem que chegou depois do horário: entra já no ponto em que o relógio do motor está,
    // senão o LTC ficaria atrasado em relação às faixas pelo resto da música.
    const offset = Math.max(0, localPos) + Math.max(0, startsAt - ideal) * this.rate;
    if (offset >= buffer.duration) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.rate;
    src.connect(this.output);
    src.start(startsAt, offset);
    src.onended = () => { try { src.disconnect(); } catch { /* ignore */ } };
    return { src, startsAt };
  }

  /** Andamento para os próximos inícios (chamar antes de start). */
  setRate(rate: number) {
    this.rate = rate > 0 ? rate : 1;
  }

  /** BPM mudou tocando: a partir do instante `at`, o timecode corre no andamento novo. */
  retime(rate: number, at: number) {
    this.setRate(rate);
    const when = Math.max(this.ctx.currentTime, at);
    for (const v of [this.current, this.pending]) {
      if (v) v.src.playbackRate.setValueAtTime(this.rate, when);
    }
  }

  /** Começa (ou recomeça) no ponto `localPos` do arquivo, no instante `when` do relógio de áudio. */
  start(clipId: string, audio: ClipAudio, localPos: number, when: number) {
    this.cancelJump();
    this.currentClipId = clipId;
    const next = this.voice(this.bufferFor(clipId, audio), localPos, when);
    if (this.current) this.halt(this.current, next ? next.startsAt : this.ctx.currentTime);
    this.current = next;
  }

  /** Salto de loop: a troca acontece no mesmo instante exato do salto dos stems. */
  scheduleJump(clipId: string, audio: ClipAudio, localPos: number, at: number) {
    this.cancelJump();
    const next = this.voice(this.bufferFor(clipId, audio), localPos, at);
    if (!next) return;
    if (this.current) this.halt(this.current, next.startsAt);
    this.pending = next;
  }

  cancelJump() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.startsAt <= this.ctx.currentTime) {
      // o salto já aconteceu: a voz nova vira a atual
      this.current = p;
      return;
    }
    this.halt(p, this.ctx.currentTime);
    // desfaz a parada agendada da voz atual (a última chamada de stop é a que vale)
    if (this.current) { try { this.current.src.stop(this.ctx.currentTime + 1e7); } catch { /* ignore */ } }
  }

  stop() {
    const now = this.ctx.currentTime;
    if (this.pending) this.halt(this.pending, now);
    if (this.current) this.halt(this.current, now);
    this.pending = null;
    this.current = null;
    // parado, o LTC da última música tocada não prende vaga no cache (o start grava de novo)
    this.currentClipId = null;
  }

  dispose() {
    this.stop();
    this.disposed = true;
    this.cache.clear();
    this.currentClipId = null;
  }

  private halt(v: Voice, at: number) {
    try { v.src.stop(Math.max(this.ctx.currentTime, at)); } catch { /* ignore */ }
  }
}
