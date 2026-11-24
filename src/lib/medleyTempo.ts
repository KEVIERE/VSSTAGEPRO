import type { SongTempoSegment } from '@/types';
import { MIN_CLICK_COVERAGE, MIN_MAP_COVERAGE, canKeepWeakMap, finalizeTempoMap, isFinalRitOnly, placeClickMap, placeOnTimeline, realTempoChanges, type ClickTrackRead, type FinalTempoMap } from '@/lib/tempoFollow';

export interface MedleyTempo { segments: SongTempoSegment[]; bpm: number }

/** Leitura completa da faixa: o mapa final, quanto do click ele cobre e os ataques (em segundos da régua). */
export interface TempoReading {
  map: FinalTempoMap | null;
  coverage?: number;
  hits?: number[];
  /** O click não bateu com nenhuma grade: o mapa não foi aceito. */
  lowCoverage?: boolean;
  /** Trechos (na régua) em que o click não caiu na grade. O resto do mapa vale. */
  weakRanges?: Array<[number, number]>;
  /** O click tem acento: a fase do compasso dele vale. */
  accented?: boolean;
  /** Trechos na régua antes do passo final, com a fase lida no click. */
  placed?: SongTempoSegment[];
}

interface TempoOptions {
  isClick?: boolean;
  keepSingle?: boolean;
  /** Onde o começo do arquivo cai na régua (início do clipe menos o corte). */
  offset?: number;
  /** Duração da música na régua. */
  duration?: number;
}

const SR = 22050;
const TIMEOUT_MS = 5 * 60 * 1000;

/** Mais de um andamento de verdade, ou a mesma velocidade com a batida saltando de lugar na emenda? */
export function hasTempoChanges(segments: SongTempoSegment[]): boolean {
  return realTempoChanges(segments).length > 0;
}

/** Aviso de mapa estimado (faixa sem click): as placas tracejadas da régua podem ser ajustadas. */
export function medleyEstimateNotice(songName: string, segments: SongTempoSegment[]): string {
  if (isFinalRitOnly(segments)) return `"${songName}": a música desacelera no final. Sem faixa de click, esse trecho é estimado: confira as placas tracejadas na régua. Dá para arrastar ou editar.`;
  return `"${songName}": medley detectado, com ${realTempoChanges(segments).length + 1} andamentos. Sem faixa de click, as trocas são estimadas: confira as placas tracejadas na régua. Dá para arrastar ou editar.`;
}

/** Aviso de click que não fechou com nenhuma grade: o mapa não foi salvo. */
export function clickCoverageNotice(songName: string, coverage: number): string {
  return `"${songName}": só ${Math.round(coverage * 100)}% da faixa de click caiu numa grade. O mapa não foi trocado: confira o click dessa música.`;
}

/** Aviso de trecho em que o click não fechou: o resto da grade foi salvo. */
export function clickWeakNotice(songName: string, ranges: Array<[number, number]>): string {
  const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const list = ranges.slice(0, 3).map(([a, b]) => `${clock(a)} a ${clock(b)}`).join(', ');
  return `"${songName}": o click não fechou com a grade em ${list}${ranges.length > 3 ? ' e em outros trechos' : ''}. O resto da grade foi salvo: confira esse ponto.`;
}

async function toMono22k(audio: AudioBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(audio.duration * SR), SR);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice();
}

/**
 * Lê o mapa de andamento da faixa, offline, no próprio computador. Devolve null quando a análise
 * falha. Com click, a cobertura confere o mapa contra os ataques antes de ele valer.
 */
export async function readTempoMap(audio: AudioBuffer, beatsPerBar = 4, opts: TempoOptions = {}): Promise<TempoReading | null> {
  if (typeof window === 'undefined' || !window.vsDesktop || audio.duration < 30) return null;
  let worker: Worker | null = null;
  try {
    const mono = await toMono22k(audio);
    worker = new Worker(new URL('@/workers/beatTrack.worker.ts', import.meta.url), { type: 'module' });
    const w = worker;
    const modelUrl = new URL(`${import.meta.env.BASE_URL}modelos/beat-this-small0-v2.onnx`, window.location.href).href;
    const res = await new Promise<{ ok: boolean; segments?: SongTempoSegment[]; error?: string } & Omit<ClickTrackRead, 'segments'>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tempo esgotado')), TIMEOUT_MS);
      w.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data); };
      w.onerror = (ev) => { clearTimeout(timer); reject(new Error(ev.message)); };
      w.postMessage({ mono, beatsPerBar, modelUrl, isClick: opts.isClick }, [mono.buffer]);
    });
    if (!res.ok || !res.segments?.length) {
      console.warn('[medley] análise falhou:', res.error);
      return null;
    }
    const offset = opts.offset ?? 0;
    const hits = res.hits?.map((t) => t + offset);
    // cobertura por trecho: o trecho ruim vira aviso, e só um click ruim quase inteiro recusa o mapa
    const weak = opts.isClick && typeof res.coverage === 'number' && res.coverage < MIN_CLICK_COVERAGE;
    if (weak && !canKeepWeakMap(res.weakShare)) {
      console.warn('[medley] click com cobertura baixa:', res.coverage);
      return { map: null, coverage: res.coverage, hits, lowCoverage: true };
    }
    const weakRanges = weak ? res.weakRanges?.map(([a, b]): [number, number] => [a + offset, b + offset]) : undefined;
    // pouca batida cai na grade: melhor o BPM único do que um mapa errado sem avisar
    if (!opts.isClick && typeof res.coverage === 'number' && res.coverage < MIN_MAP_COVERAGE) return null;
    const duration = opts.duration ?? audio.duration + offset;
    const placed = opts.offset === undefined
      ? res.segments
      : opts.isClick
        ? placeClickMap(res.segments, offset, duration, beatsPerBar, res.accented !== false)
        : placeOnTimeline(res.segments, offset, duration, beatsPerBar);
    const map = finalizeTempoMap(placed, {
      duration,
      beatsPerBar,
      isClick: !!opts.isClick,
      keepSingle: opts.isClick ? true : !!opts.keepSingle,
      hits: opts.isClick ? hits : undefined,
      halfRanges: res.halfRanges?.map(([a, b]): [number, number] => [a + offset, b + offset]),
      lineTol: res.lineTol,
    });
    return { map, coverage: res.coverage, hits, accented: res.accented, placed, ...(weakRanges?.length ? { weakRanges } : {}) };
  } catch (err) {
    console.warn('[medley] análise falhou:', err);
    return null;
  } finally {
    worker?.terminate();
  }
}

/**
 * Ativação de downbeat do modelo para a mistura mono a 22050 Hz, em segundo plano. Se `canGoOn` ficar
 * falso (Play, troca de projeto), o worker é encerrado na hora e nada é devolvido.
 */
export async function readDownbeats(mono: Float32Array, canGoOn: () => boolean): Promise<{ downbeat: Float32Array; fps: number } | 'interrupted' | null> {
  if (typeof window === 'undefined' || !window.vsDesktop) return null;
  let worker: Worker | null = null;
  let watch: ReturnType<typeof setInterval> | null = null;
  try {
    worker = new Worker(new URL('@/workers/beatTrack.worker.ts', import.meta.url), { type: 'module' });
    const w = worker;
    const modelUrl = new URL(`${import.meta.env.BASE_URL}modelos/beat-this-small0-v2.onnx`, window.location.href).href;
    const res = await new Promise<{ ok: boolean; downbeat?: Float32Array; fps?: number; error?: string } | 'interrupted'>((resolve, reject) => {
      // o limite vale sem sinal de vida do worker: um medley longo, com o Mac carregado, passa de 5 min no total
      const expire = () => setTimeout(() => reject(new Error('tempo esgotado')), TIMEOUT_MS);
      let timer = expire();
      const done = (v: { ok: boolean; downbeat?: Float32Array; fps?: number; error?: string } | 'interrupted') => { clearTimeout(timer); resolve(v); };
      watch = setInterval(() => { if (!canGoOn()) done('interrupted'); }, 250);
      w.onmessage = (ev) => {
        if (ev.data?.progress) { clearTimeout(timer); timer = expire(); return; }
        done(ev.data);
      };
      w.onerror = (ev) => { clearTimeout(timer); reject(new Error(ev.message)); };
      w.postMessage({ mono, beatsPerBar: 4, modelUrl, downbeatOnly: true }, [mono.buffer]);
    });
    if (res === 'interrupted') return 'interrupted';
    if (!res.ok || !res.downbeat) {
      console.warn('[tempo 1] modelo falhou:', res.error);
      return null;
    }
    return { downbeat: res.downbeat, fps: res.fps ?? 50 };
  } catch (err) {
    console.warn('[tempo 1] modelo falhou:', err);
    return null;
  } finally {
    if (watch) clearInterval(watch);
    worker?.terminate();
  }
}

/**
 * Mapa de andamento da faixa. Devolve null quando a música tem um andamento só, na grade simples,
 * ou quando a análise falha: aí vale o BPM único, como sempre foi.
 */
export async function detectMedleyTempo(audio: AudioBuffer, beatsPerBar = 4, opts: TempoOptions = {}): Promise<MedleyTempo | null> {
  const reading = await readTempoMap(audio, beatsPerBar, opts);
  const segments = reading?.map?.tempoSegments;
  return reading?.map && segments?.length ? { segments, bpm: reading.map.bpm } : null;
}
