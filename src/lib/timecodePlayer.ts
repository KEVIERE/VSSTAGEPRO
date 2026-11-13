import { clipAudioToBuffer } from '@/lib/audioLibrary';
import type { ClipAudio } from '@/lib/audioLibrary';

interface Voice {
  src: AudioBufferSourceNode;
  startsAt: number;
}

/**
 * Toca o timecode no mesmo andamento das faixas: com o BPM ajustado, ele corre mais rápido ou mais
 * devagar junto (como o varispeed das máquinas de fita), para os telões e as luzes seguirem a
 * música. O afinador (tuner) não mexe nele: o sinal nunca passa pelo processamento de tom.
 */
export class TimecodePlayer {
  private current: Voice | null = null;
  private pending: Voice | null = null;
  private cache: { clipId: string; buffer: AudioBuffer } | null = null;
  /** Velocidade de leitura (1 = original; 1,1 = BPM 10% mais rápido). */
  private rate = 1;

  constructor(private ctx: AudioContext, private output: AudioNode) {}

  private bufferFor(clipId: string, audio: ClipAudio): AudioBuffer {
    if (this.cache?.clipId !== clipId) this.cache = { clipId, buffer: clipAudioToBuffer(audio) };
    return this.cache.buffer;
  }

  private voice(buffer: AudioBuffer, localPos: number, when: number): Voice | null {
    // antes do começo do arquivo, espera o tanto que a música leva até ele (no andamento atual)
    const startsAt = Math.max(this.ctx.currentTime, when + Math.max(0, -localPos) / this.rate);
    const offset = Math.max(0, localPos);
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
  }

  dispose() {
    this.stop();
    this.cache = null;
  }

  private halt(v: Voice, at: number) {
    try { v.src.stop(Math.max(this.ctx.currentTime, at)); } catch { /* ignore */ }
  }
}
