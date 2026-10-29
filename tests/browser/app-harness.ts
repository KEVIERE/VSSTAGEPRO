// Testes dentro do app de verdade (dev server, rota #programa): monta um show sintético com
// 15 músicas (algumas medleys com BPM próprio por fatia e clipe terminando colado na divisa),
// exporta nos três modos para destinos na memória e mede o tom do master com o tuner.
// Uso no console da página: const h = await import('/tests/browser/app-harness.ts'); await h.setup(); ...
import { useStore } from '../../src/store';
import { audioEngine } from '../../src/lib/audioEngine';
import { runExport, type ExportTargets } from '../../src/lib/bounceEngine';
import type { ExportTarget, ExportStream } from '../../src/lib/exportTarget';
import { startPlayback, stopPlayback } from '../../src/lib/transportControl';
import type { AudioClip, PlaylistEntry, ProjectState, Song } from '../../src/types';
import { validLoudness, levelTarget } from '../../src/lib/songLevel';
export { levelTarget };

const SRC_RATE = 44100;

function wav(seconds: number, freq: number, amp = 0.3): File {
  const frames = Math.round(SRC_RATE * seconds);
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
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / SRC_RATE) * amp * 8388607);
    v.setUint8(p, s & 255); v.setUint8(p + 1, (s >> 8) & 255); v.setUint8(p + 2, (s >> 16) & 255); p += 3;
  }
  return new File([buf], `tom-${freq}-${seconds}-${amp}.wav`, { lastModified: 1000 + freq * 10 + seconds + Math.round(amp * 1000) });
}

export const SONGS = 15;

/** varied: cada música gravada num volume diferente (de -26 a -4 dBFS), para o volume igual. */
export function setup(opts: { varied?: boolean } = {}) {
  const songs: Song[] = [];
  const clips: AudioClip[] = [];
  const sources = new Map<string, Blob>();
  const playlist: PlaylistEntry[] = [];
  for (let n = 0; n < SONGS; n++) {
    const id = `song-${n}`;
    const medley = n % 4 === 1; // 4 medleys
    const dur = medley ? 9 : 6 + (n % 3);
    // nomes repetidos de propósito (duas músicas "Bloco 5") para testar pastas que não se sobrescrevem
    const name = n === 7 ? 'Bloco 5' : n === 5 ? 'Bloco 5' : `Música ${n + 1}${n === 3 ? ' / com:barra' : ''}`;
    const tracks = ['track-guia', 'track-click', 'track-maestro'];
    const songClips: string[] = [];
    tracks.forEach((trackId, t) => {
      const cid = `${id}-c${t}`;
      // num medley, o clipe do maestro termina 2 ms depois da divisa da 2ª fatia (o caso que quebrava)
      const clipDur = medley && t === 2 ? 3.002 : dur;
      const amp = opts.varied ? [0.05, 0.3, 0.6, 0.12, 0.2][n % 5] : 0.3;
      sources.set(cid, wav(clipDur, trackId === 'track-guia' ? 440 : 220 + t * 50, amp));
      clips.push({
        id: cid, trackId, name: `${name} ${trackId}`, fileName: `${cid}.wav`, filePath: '', songId: id,
        startTime: 0, duration: clipDur, sampleRate: SRC_RATE, channels: 2, bpm: 120, markers: [],
        routingMethod: 'manual', routingConfidence: 1, waveformPeaks: [],
      } as AudioClip);
      songClips.push(cid);
    });
    songs.push({
      id, name, clips: songClips, bpm: 120, bpmDetected: true, bpmAdjust: 0, tuner: 0, duration: dur,
      timelineStart: 0, blockId: null, regions: [],
      ...(medley ? { medley: [
        { id: `${id}-p1`, name: 'A', start: 0 },
        { id: `${id}-p2`, name: 'B', start: 3, bpmAdjust: 6, tuner: 2 },
        { id: `${id}-p3`, name: 'C', start: 6, enabled: n % 8 !== 1 },
      ] } : {}),
    } as Song);
    playlist.push({ id: `pl-${n}`, songId: id, name, order: n, bpm: 120, blockId: null, duration: dur });
  }
  useStore.getState().applyLoadedProject({ projectName: 'Show de Teste', songs, clips, playlist, playlistOrder: playlist.map((p) => p.songId) } as Partial<ProjectState>, sources);
  return { songs: songs.length, clips: clips.length };
}

class MemoryTarget implements ExportTarget {
  files = new Map<string, ArrayBuffer>();
  location = 'memória';
  async write(rel: string, data: ArrayBuffer) { this.files.set(rel, data); }
  async freeSpace() { return null; }
  async finish() { /* nada */ }
  reveal = null;
  async openStream(rel: string): Promise<ExportStream> {
    const parts: ArrayBuffer[] = [];
    return {
      append: async (chunk) => { parts.push(chunk.slice(0)); },
      close: async () => {
        const total = parts.reduce((a, b) => a + b.byteLength, 0);
        const out = new Uint8Array(total);
        let o = 0;
        for (const p of parts) { out.set(new Uint8Array(p), o); o += p.byteLength; }
        this.files.set(rel, out.buffer);
      },
      abort: async () => { parts.length = 0; },
    };
  }
}

function wavInfo(buf: ArrayBuffer) {
  const v = new DataView(buf);
  const dataBytes = v.getUint32(40, true);
  const frames = dataBytes / 6;
  // energia por segundo, para achar buracos de silêncio
  let silentSeconds = 0;
  const perSec = 48000;
  for (let s = 0; s * perSec < frames; s++) {
    let peak = 0;
    for (let i = s * perSec; i < Math.min(frames, (s + 1) * perSec); i += 7) {
      const o = 44 + i * 6;
      const x = (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608;
      peak = Math.max(peak, Math.abs(x));
    }
    if (peak < 0.01) silentSeconds++;
  }
  return { seconds: +(frames / 48000).toFixed(3), declaredOk: buf.byteLength === 44 + dataBytes, silentSeconds };
}

export async function exportAll(mode: 'lr' | 'multipista' | 'show-continuo') {
  const target = new MemoryTarget();
  const targets: ExportTargets = {
    openFileTarget: async (name) => ({ target, name }),
    openFolderTarget: async () => target,
  };
  const t0 = performance.now();
  const res = await runExport({ scope: 'projeto', mode }, useStore.getState(), {
    onProgress: () => {},
    onDiskFull: async () => 'stop',
    cancelled: () => false,
  } as never, targets);
  const ms = Math.round(performance.now() - t0);
  const files = Array.from(target.files.entries()).map(([rel, buf]) => ({ rel, ...wavInfo(buf) }));
  return { ms, status: res?.status, songsSaved: res?.songsSaved, songsTotal: res?.songsTotal, incomplete: res?.incomplete, files };
}

// ---------- tom no master ----------
let analyser: AnalyserNode | null = null;
function tap(): AnalyserNode {
  const eng = audioEngine as unknown as { ctx: AudioContext; masterGain: GainNode };
  if (!analyser || analyser.context !== eng.ctx) {
    analyser = eng.ctx.createAnalyser();
    analyser.fftSize = 32768;
    analyser.smoothingTimeConstant = 0;
    eng.masterGain.connect(analyser);
  }
  return analyser;
}

/** Pico do espectro do master entre lo e hi Hz (o tom da guia, sem confundir com as outras faixas). */
export function masterPeak(lo = 380, hi = 600): number {
  const a = tap();
  const d = new Float32Array(a.frequencyBinCount);
  a.getFloatFrequencyData(d);
  const hz = a.context.sampleRate / a.fftSize;
  let best = -Infinity; let bi = 0;
  for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz); i++) if (d[i] > best) { best = d[i]; bi = i; }
  // interpolação parabólica para precisão abaixo de 1 bin
  const y0 = d[bi - 1], y1 = d[bi], y2 = d[bi + 1];
  const off = (y0 - y2) / (2 * (y0 - 2 * y1 + y2)) || 0;
  return (bi + off) * hz;
}

export function armTap() { tap(); }

/** Dá play e devolve quantos ms levou até o som sair de verdade no master. */
export async function play(songId: string): Promise<number> {
  useStore.getState().selectSong(songId);
  useStore.getState().setCurrentTime(0);
  const t0 = performance.now();
  await startPlayback();
  for (let i = 0; i < 600; i++) {
    if (rawLevel() > 0.02) return Math.round(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 5));
  }
  return -1;
}

/** Tom da guia, só quando há som (sem som o espectro guardado engana). */
export function pitch(lo = 340, hi = 700): string {
  return rawLevel() > 0.02 ? masterPeak(lo, hi).toFixed(0) : 'mudo';
}

/** Pico do sinal nos últimos ~20 ms, sem nenhuma suavização. */
export function rawLevel(): number {
  if (!(audioEngine as unknown as { ctx: AudioContext | null }).ctx) return 0;
  const a = tap();
  const n = 1024;
  const d = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  let peak = 0;
  for (let i = d.length - n; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return peak;
}

export function stop() { stopPlayback(); }

export function setTuner(songId: string, semis: number) {
  useStore.getState().setSongTuner(songId, semis);
  audioEngine.applySongPlaybackParams(songId);
}

export function state() {
  const st = useStore.getState();
  return { playing: st.transport.isPlaying, current: st.transport.currentSongId, error: st.playbackError, ctx: (audioEngine as unknown as { ctx: AudioContext | null }).ctx?.state };
}

// ---------- o que sai no arquivo exportado ----------
function wavSamples(buf: ArrayBuffer): Float32Array {
  const v = new DataView(buf);
  const frames = v.getUint32(40, true) / 6;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = 44 + i * 6;
    out[i] = (v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16)) / 8388608;
  }
  return out;
}

/** Frequência mais forte entre lo e hi (Goertzel), no trecho [from, to) segundos do arquivo. */
function toneIn(x: Float32Array, from: number, to: number, lo = 340, hi = 700): number {
  const sr = 48000;
  const a = Math.floor(from * sr);
  const b = Math.min(x.length, Math.floor(to * sr));
  let best = 0; let bestF = 0;
  for (let f = lo; f <= hi; f += 0.5) {
    const w = (2 * Math.PI * f) / sr;
    const c = 2 * Math.cos(w);
    let s1 = 0; let s2 = 0;
    for (let i = a; i < b; i++) { const s0 = x[i] + c * s1 - s2; s2 = s1; s1 = s0; }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2;
    if (p > best) { best = p; bestF = f; }
  }
  return bestF;
}

export async function exportSong(songId: string, mode: 'lr' | 'multipista', probes: Array<[number, number]>) {
  const target = new MemoryTarget();
  const targets: ExportTargets = { openFileTarget: async (name) => ({ target, name }), openFolderTarget: async () => target };
  const res = await runExport({ scope: 'musica', songId, mode }, useStore.getState(), { onProgress: () => {}, onDiskFull: async () => 'stop', cancelled: () => false } as never, targets);
  const files = Array.from(target.files.entries()).map(([rel, buf]) => {
    const x = wavSamples(buf);
    return { rel, seconds: +(x.length / 48000).toFixed(3), tones: probes.map(([f, t]) => toneIn(x, f, t)) };
  });
  return { status: res?.status, files };
}

/** O mesmo estado que a exportação e o motor leem. */
export const store = useStore;

/** RMS do master (dBFS) nos últimos ~0,7 s. */
export function masterRmsDb(): number {
  if (!(audioEngine as unknown as { ctx: AudioContext | null }).ctx) return -Infinity;
  const a = tap();
  const d = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  let s = 0; for (const v of d) s += v * v;
  return 10 * Math.log10(s / d.length + 1e-20);
}

export async function waitLevels(timeoutMs = 60000) {
  const t0 = performance.now();
  for (;;) {
    const st = useStore.getState();
    const done = st.playlist.every((p) => validLoudness(st, p.songId));
    if (done) return Math.round(performance.now() - t0);
    if (performance.now() - t0 > timeoutMs) return -1;
    await new Promise((r) => setTimeout(r, 200));
  }
}
