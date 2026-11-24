import { detectBpm, detectMultiTempo, type MultiTempoResult } from '@/lib/beatDetector';
import { gridClickBuffer, makeClickClip } from '@/lib/clickClip';
import { hasTempoChanges, medleyEstimateNotice, readTempoMap } from '@/lib/medleyTempo';
import { MIN_TEMPO_MAP_SEC, clickNeedsTempoMap, isFinalRitOnly, placeAiTempoMap } from '@/lib/tempoFollow';
import { calculateMusicalAlignment, detectContinuousTempoMap, audioEntryTime, detectRobustBpm, stemHasDrums } from '@/lib/musicalAlignment';
import { isolateLiveCrowdAmbience } from '@/lib/crowdIsolation';
import { encodeWavPcm24Async } from '@/lib/wavEncoder';
import { waveformPeaksAsync } from '@/lib/waveformPeaks';
import { classifyInstrumentAudio, type AiRouteResult } from '@/lib/aiRouter';
import {
  putClipAudio,
  registerClipSource,
  toClipAudioAsync,
} from '@/lib/audioLibrary';
import { useStore } from '@/store';
import type { AudioClip, Song } from '@/types';
import { generateMarkers, decodeBlob } from '@/lib/audioDecoder';
import type { StemFilesReply } from '@/lib/localNetwork';

/** Só tenta o mapa de novo na bateria se a primeira leitura terminou antes disto. */
const MAP_RETRY_LIMIT_MS = 120_000;

/**
 * Pergunta à IA de instrumentos o que tem no stem: 3 trechos de 5 s entre os mais fortes,
 * vence o instrumento que aparecer mais (desempate pela confiança). null = não reconheceu.
 */
export async function classifyStem(buffer: AudioBuffer, key: string): Promise<AiRouteResult | null> {
  const sr = buffer.sampleRate;
  const win = Math.min(buffer.length, Math.round(5 * sr));
  if (win < sr) return null;
  const chs = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const step = Math.max(1, Math.floor(win / 2));
  const energy: Array<{ at: number; e: number }> = [];
  for (let at = 0; at + win <= buffer.length; at += step) {
    let e = 0;
    for (const ch of chs) for (let i = at; i < at + win; i += 32) e += ch[i] * ch[i];
    energy.push({ at, e });
  }
  const picks = energy.sort((a, b) => b.e - a.e).slice(0, 3);
  const votes = new Map<string, { n: number; conf: number; best: AiRouteResult }>();
  for (let k = 0; k < picks.length; k++) {
    const mono = new Float32Array(win);
    for (const ch of chs) for (let i = 0; i < win; i++) mono[i] += ch[picks[k].at + i] / chs.length;
    const r = await classifyInstrumentAudio(`${key}-${k}`, mono, sr);
    if (!r) continue;
    const v = votes.get(r.target) ?? { n: 0, conf: 0, best: r };
    v.n++; v.conf += r.confidence;
    if (r.confidence > v.best.confidence) v.best = r;
    votes.set(r.target, v);
  }
  let winner: { n: number; conf: number; best: AiRouteResult } | null = null;
  for (const v of votes.values()) if (!winner || v.n > winner.n || (v.n === winner.n && v.conf > winner.conf)) winner = v;
  return winner && winner.n >= 2 ? winner.best : winner && picks.length < 2 ? winner.best : null;
}

/**
 * Faixa onde um stem entra. Click, Guia e Maestro recebem o clipe direto; nas pastas (Bateria,
 * Contrabaixo, Guitarras...) vai para a faixa com o NOME do stem ("Bumbo", "Baixo"...), que é
 * criada se ainda não existir. Assim vários stems dividem os mesmos canais (e o roteamento
 * de saída que o usuário já salvou para eles) em vez de criar canais novos a cada vez.
 */
export function trackForStem(parentId: string, childName: string): string {
  if (parentId === 'track-guia' || parentId === 'track-click' || parentId === 'track-maestro') return parentId;
  const wanted = childName.trim().toLocaleLowerCase('pt-BR');
  const existing = useStore.getState().tracks.find((t) => t.parentId === parentId && t.name.trim().toLocaleLowerCase('pt-BR') === wanted);
  if (existing) return existing.id;
  const childId = `${parentId}-child-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  useStore.getState().addChildTrack(parentId, childName, childId);
  return childId;
}

export interface StemSeparationProgress {
  step: 'analyzing' | 'drums' | 'bass' | 'vocals' | 'other' | 'click' | 'finalizing';
  message: string;
  percent: number;
}

/** Erro do botão Cancelar do diálogo de IA (não é falha: nada é mostrado como erro). */
export const SEPARATION_CANCELLED = 'separation_cancelled';

/** Pede ao app do Mac para parar o Demucs em andamento. */
export function cancelStemSeparation(): Promise<boolean> {
  return window.vsDesktop?.cancelStemSeparation?.().catch(() => false) ?? Promise.resolve(false);
}

export interface StemSeparationOptions {
  includeClick: boolean;
  beatsPerBar?: 4 | 3 | 6;
  songName?: string;
  /** Separa também a bateria em bumbo, caixa, pratos e tons (como o Moises). */
  splitDrums?: boolean;
}

/** O app sabe deixar as faixas separadas no disco e servir por vsstage://stems (Lote 6). */
function stemFilesSupported(): boolean {
  const d = typeof window !== 'undefined' ? window.vsDesktop : undefined;
  return typeof d?.stemFileUrl === 'function' && typeof d?.stemFilesRelease === 'function';
}

function isStemFilesReply(x: unknown): x is StemFilesReply {
  const f = (x as StemFilesReply | null)?.stemFiles;
  return !!f && typeof f.token === 'string' && Array.isArray(f.names);
}

/**
 * Lê as faixas que a separação deixou no disco e solta a pasta. Os bytes são os mesmos que antes
 * vinham pelo IPC (o mesmo WAV do Demucs), então a decodificação e o alinhamento não mudam.
 */
async function readStemFiles(reply: StemFilesReply): Promise<Record<string, Blob>> {
  const d = window.vsDesktop!;
  const { token, names } = reply.stemFiles;
  try {
    const settled = await Promise.allSettled(names.map(async (name) => {
      const res = await fetch(d.stemFileUrl!(token, name));
      if (!res.ok) throw new Error(`faixa separada não encontrada (${name})`);
      return [name, new Blob([await res.blob()], { type: 'audio/wav' })] as const;
    }));
    const out: Record<string, Blob> = {};
    for (const r of settled) {
      if (r.status === 'rejected') throw r.reason;
      out[r.value[0]] = r.value[1];
    }
    return out;
  } finally {
    // só depois de ler tudo (no Windows arquivo aberto não sai)
    void d.stemFilesRelease!(token).catch(() => false);
  }
}

/**
 * Separa a bateria já isolada em peças. Devolve as peças decodificadas ou null (aí a bateria
 * fica inteira). Nunca lança: separar a bateria é um extra, não pode derrubar a criação do VS.
 */
async function splitDrumPieces(
  drums: AudioBuffer,
  songName: string,
  onProgress: (p: StemSeparationProgress) => void,
): Promise<Record<'bumbo' | 'caixa' | 'pratos' | 'tons', AudioBuffer> | null> {
  const bridge = window.vsDesktop?.separateDrumPieces;
  if (!bridge) return null;
  try {
    onProgress({ step: 'drums', message: 'Separando a bateria em bumbo, caixa, pratos e tons...', percent: 96 });
    // o modelo pede 44,1 kHz estéreo; o WAV do stem já vem nesse formato do Demucs
    const wav = await encodeWavPcm24Async(drums);
    const ids = ['bumbo', 'caixa', 'pratos', 'tons'] as const;
    const reply = stemFilesSupported() ? await bridge(wav as ArrayBuffer, { files: true }) : await bridge(wav as ArrayBuffer);
    const result: Partial<Record<(typeof ids)[number], ArrayBuffer | Blob | null>> & { why?: string } = isStemFilesReply(reply)
      ? await readStemFiles(reply)
      : (reply as Partial<Record<(typeof ids)[number], ArrayBuffer | null>> & { why?: string });
    if (!ids.some((id) => result[id])) {
      console.warn('separação da bateria indisponível:', result.why ?? 'sem peças');
      return null;
    }
    const entries = await Promise.all(ids.map(async (id) => {
      const raw = result[id];
      if (!raw) return null;
      try {
        return [id, await decodeBlob(raw instanceof Blob ? raw : new Blob([raw], { type: 'audio/wav' }))] as const;
      } catch {
        return null;
      }
    }));
    const pieces = Object.fromEntries(entries.filter(Boolean) as [string, AudioBuffer][]);
    if (!pieces.bumbo && !pieces.caixa) return null;
    return pieces as Record<'bumbo' | 'caixa' | 'pratos' | 'tons', AudioBuffer>;
  } catch (err) {
    console.warn('separação da bateria falhou:', err);
    return null;
  }
}

export interface StemResult {
  songId: string;
  songName: string;
  bpm: number;
  duration: number;
  stemsCount: number;
}

/**
 * Motor Local de Separação de Stems e Criação de VS.
 * Processa 100% localmente no Mac usando filtros de estúdio acelerados e cancelamento de fase estéreo.
 */
export async function separateSongToVS(
  audioBuffer: AudioBuffer,
  file: File,
  options: StemSeparationOptions,
  onProgress?: (p: StemSeparationProgress) => void,
  shouldCancel?: () => boolean
): Promise<StemResult> {
  const stopped = () => shouldCancel?.() ?? false;
  const checkCancelled = () => { if (stopped()) throw new Error(SEPARATION_CANCELLED); };
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;
  const numChannels = audioBuffer.numberOfChannels;
  const songName = (options.songName || file.name.replace(/\.[^/.]+$/, '')).trim() || 'Música';

  // 1. ANÁLISE DE BPM E COMPASSO
  onProgress?.({
    step: 'analyzing',
    message: 'Analisando áudio e detectando BPM da música...',
    percent: 10,
  });

  const rawBpmResult = await detectBpm(audioBuffer).catch(() => null);
  const bpm = detectRobustBpm(audioBuffer, null, rawBpmResult?.bpm);
  const downbeat = rawBpmResult?.downbeat || 0;

  // 2. SEPARAÇÃO DAS STEMS COM O MOTOR DE IA INTERNO DO VS STAGE (HTDemucs 6 Stems)
  let drumsBuffer!: AudioBuffer;
  let bassBuffer!: AudioBuffer;
  let vocalsBuffer!: AudioBuffer;
  let otherBuffer!: AudioBuffer;
  let guitarBuffer: AudioBuffer | null = null;
  let pianoBuffer: AudioBuffer | null = null;

  if (typeof window !== 'undefined' && window.vsDesktop?.separateStemsLocal) {
    onProgress?.({
      step: 'drums',
      message: 'Iniciando Inteligência Artificial interna do VS Stage...',
      percent: 15,
    });

    const unbind = window.vsDesktop.onSeparationProgress?.((data) => {
      onProgress?.({
        step: 'vocals',
        message: data.message,
        percent: Math.min(95, Math.max(15, data.percent || 0)),
      });
    });

    try {
      const separate = window.vsDesktop.separateStemsLocal;
      // Arquivo do disco vai pelo caminho (a tela não lê a música inteira e nada passa pelo IPC);
      // as faixas voltam pelo disco (vsstage://stems). Sem isso, os bytes de sempre.
      const filePath = (window.vsDesktop as { pathForFile?: (f: File) => string }).pathForFile?.(file) || '';
      const useFiles = stemFilesSupported();
      const reply = await (useFiles
        ? separate(file.name, filePath ? { path: filePath } : await file.arrayBuffer(), { files: true })
        : separate(file.name, await file.arrayBuffer())
      ).catch((err) => {
        // Cancelado no meio da IA: não é erro de verdade, só encerra sem criar o VS.
        if (stopped() || /separation_cancelled/.test(String((err as Error)?.message ?? err))) throw new Error(SEPARATION_CANCELLED);
        throw err;
      });
      if (stopped() && isStemFilesReply(reply)) void window.vsDesktop.stemFilesRelease?.(reply.stemFiles.token).catch(() => false);
      checkCancelled();
      const rawStems: Record<string, ArrayBuffer | Blob | null | undefined> = isStemFilesReply(reply)
        ? await readStemFiles(reply)
        : (reply as unknown as Record<string, ArrayBuffer | null | undefined>);
      if (!rawStems.vocals || !rawStems.bass || !rawStems.drums || !rawStems.other) {
        throw new Error('As faixas separadas não foram encontradas na pasta de saída.');
      }
      const asWav = (raw: ArrayBuffer | Blob) => (raw instanceof Blob ? raw : new Blob([raw], { type: 'audio/wav' }));
      onProgress?.({
        step: 'other',
        message: 'Decodificando faixas de alta fidelidade para a timeline...',
        percent: 96,
      });

      const [v, b, d, o, g, p] = await Promise.all([
        decodeBlob(asWav(rawStems.vocals)),
        decodeBlob(asWav(rawStems.bass)),
        decodeBlob(asWav(rawStems.drums)),
        decodeBlob(asWav(rawStems.other)),
        rawStems.guitar ? decodeBlob(asWav(rawStems.guitar)) : Promise.resolve(null),
        rawStems.piano ? decodeBlob(asWav(rawStems.piano)) : Promise.resolve(null),
      ]);
      vocalsBuffer = v;
      bassBuffer = b;
      drumsBuffer = d;
      otherBuffer = o;
      guitarBuffer = g;
      pianoBuffer = p;
    } finally {
      unbind?.();
    }
  } else {
    throw new Error('A separação por Inteligência Artificial é exclusiva do aplicativo oficial do VS Stage para Mac.');
  }

  // 2.4 Isolamento Inteligente de Gritos e Ambiência de Show ao Vivo
  // Limpa a voz do cantor (Guia) e separa os gritos/assobios da plateia em uma trilha exclusiva (mutada por padrão)
  const crowdResult = isolateLiveCrowdAmbience(vocalsBuffer);
  vocalsBuffer = crowdResult.cleanedVocals;
  const crowdAmbienceBuffer = crowdResult.crowdAmbience;

  // 2.5 Refinamento do BPM e Alinhamento Musical Cirúrgico
  const beatsPerBar = options.beatsPerBar || 4;

  // 2.5.1 Mapa de andamento: um BPM para cada música da faixa, com a fase e o 1 medidos no áudio.
  // Se a leitura falhar, tenta de novo só na bateria separada, que costuma ter o pulso mais claro.
  onProgress?.({ step: 'analyzing', message: 'Conferindo o andamento de cada música da faixa...', percent: 91 });
  const mapStart = Date.now();
  let reading = await readTempoMap(audioBuffer, beatsPerBar, { keepSingle: true });
  checkCancelled();
  // Computador lento que já gastou minutos na primeira leitura não espera outra
  if (!reading?.map && duration >= MIN_TEMPO_MAP_SEC && Date.now() - mapStart < MAP_RETRY_LIMIT_MS) {
    reading = await readTempoMap(drumsBuffer, beatsPerBar, { keepSingle: true });
    checkCancelled();
  }
  const measured = reading?.map?.tempoSegments?.length ? reading.map.tempoSegments : null;
  // Sem bateria, os ataques vêm um pouco antes da batida: a entrada do áudio acerta a fase.
  const firstSound = measured && (!hasTempoChanges(measured) || isFinalRitOnly(measured)) && !stemHasDrums(drumsBuffer, audioBuffer) ? audioEntryTime(audioBuffer) : null;
  const placed = placeAiTempoMap(measured, firstSound, beatsPerBar, duration);

  // 2.5.2 Alinhamento Musical Cirúrgico (Trava o Tempo 1 na grade e elimina música cruzada).
  // Com mapa, fase e 1 vêm dele; a entrada faz o primeiro 1 cair em compasso inteiro do primeiro
  // andamento. A heurística de bumbo e caixa só serve quando não há mapa.
  const alignment = placed
    ? null
    : calculateMusicalAlignment(audioBuffer, drumsBuffer, reading?.map ? reading.map.bpm : detectRobustBpm(audioBuffer, drumsBuffer, bpm), beatsPerBar);
  const leadIn = placed ? placed.leadIn : alignment!.leadIn;
  const totalSongDuration = leadIn + duration;
  // Andamento único: a entrada já pôs o 1 numa cabeça de compasso, e a grade simples a partir do
  // 0:00 passa pelas mesmas batidas. Trechos só existem quando o andamento muda de verdade.
  const tempoSegments = placed?.tempoSegments;
  const finalBpm = placed && reading?.map ? reading.map.bpm : alignment!.bpm;

  const clickUnsafe = !!options.includeClick && clickNeedsTempoMap(duration, !!reading?.map);

  // 2.6 Click na grade da música, pelo mesmo caminho do Recriar metrônomo (gridClickBuffer +
  // makeClickClip): mesmo som, nível, taxa do aparelho e encaixe na grade.
  let clickBuffer: AudioBuffer | null = null;
  if (options.includeClick && !clickUnsafe) {
    onProgress?.({
      step: 'click',
      message: 'Sincronizando metrônomo (Click) na grade com 1 compasso de entrada...',
      percent: 92,
    });

    clickBuffer = await gridClickBuffer({ bpm: finalBpm, beatsPerBar, tempoSegments }, totalSongDuration);
  }

  // 2.7 Bateria em peças (bumbo, caixa, pratos, tons), como o Moises faz. É um extra: sem o
  // modelo ou sem internet, a bateria segue inteira e o VS é criado do mesmo jeito.
  const drumPieces = options.splitDrums
    ? await splitDrumPieces(drumsBuffer, songName, (p) => onProgress?.(p))
    : null;
  checkCancelled();

  // 3. MONTAGEM DO PROJETO E ROTEAMENTO OFICIAL
  onProgress?.({
    step: 'finalizing',
    message: 'Roteando stems para as pastas oficiais do programa...',
    percent: 96,
  });

  const songId = 'song-ai-' + Date.now();
  const store = useStore.getState();

  const song: Song = {
    id: songId,
    name: songName,
    clips: [],
    bpm: finalBpm,
    bpmDetected: true,
    bpmSource: 'audio',
    downbeat: 0,
    beatsPerBar,
    ...(tempoSegments ? { tempoSegments } : {}),
    bpmAdjust: 0,
    tuner: 0,
    duration: totalSongDuration,
    timelineStart: 0,
    blockId: null,
    regions: [],
  };

  store.addSong(song);
  store.addToPlaylist(songId, songName, totalSongDuration, finalBpm);

  interface StemEntry {
    name: string;
    childName: string;
    buffer: AudioBuffer;
    parentTrackId: string;
    startTime: number;
    duration: number;
    mute?: boolean;
    /** Volume do clipe (1 = como veio). As peças da bateria entram atenuadas. */
    gain?: number;
  }

  const stemConfigs: StemEntry[] = [];

  // Bateria: separada em peças, cada uma na sua faixa dentro da pasta Bateria (Bumbo, Caixa,
  // Pratos, Tons), como o Moises. Sem a separação, uma faixa só com a bateria inteira.
  if (drumPieces) {
    // As peças tocam juntas: sem atenuar, a soma delas no mixer fica mais alta que a bateria
    // original. O ganho abaixo devolve o volume que a bateria tinha antes de ser separada.
    const aux = 1 / Math.sqrt(Math.max(1, Object.keys(drumPieces).length));
    const ordem = ['bumbo', 'caixa', 'pratos', 'tons'] as const;
    const labels: Record<typeof ordem[number], string> = { bumbo: 'Bumbo', caixa: 'Caixa', pratos: 'Pratos', tons: 'Tons' };
    for (const id of ordem) {
      const buffer = drumPieces[id];
      if (!buffer) continue; // o modelo pode não devolver uma peça (ex.: música sem tons)
      stemConfigs.push({
        name: songName + ' - ' + labels[id],
        childName: labels[id],
        buffer,
        parentTrackId: 'track-bateria',
        startTime: leadIn,
        duration,
        gain: aux,
      });
    }
  } else {
    stemConfigs.push({
      name: songName + ' - Bateria',
      childName: 'Bateria',
      buffer: drumsBuffer,
      parentTrackId: 'track-bateria',
      startTime: leadIn,
      duration,
    });
  }

  stemConfigs.push(
    {
      name: songName + ' - Baixo',
      childName: 'Baixo',
      buffer: bassBuffer,
      parentTrackId: 'track-contrabaixo',
      startTime: leadIn,
      duration,
    });

  if (guitarBuffer) {
    // O modelo entrega violão e guitarra no mesmo stem: a IA de instrumentos ouve os trechos
    // mais fortes e decide a pasta (Violões ou Guitarras).
    checkCancelled();
    const heard = await classifyStem(guitarBuffer, songId + '-guitar');
    const acoustic = heard?.target === 'track-violoes';
    stemConfigs.push({
      name: songName + (acoustic ? ' - Violões' : ' - Guitarras'),
      childName: acoustic ? 'Violões' : 'Guitarras',
      buffer: guitarBuffer,
      parentTrackId: acoustic ? 'track-violoes' : 'track-guitarras',
      startTime: leadIn,
      duration,
    });
  }

  if (pianoBuffer) {
    stemConfigs.push({
      name: songName + ' - Teclados',
      childName: 'Teclados',
      buffer: pianoBuffer,
      parentTrackId: 'track-teclados',
      startTime: leadIn,
      duration,
    });
  }

  stemConfigs.push({
    name: songName + ' - Guia (Voz)',
    childName: 'Guia',
    buffer: vocalsBuffer,
    parentTrackId: 'track-guia',
    startTime: leadIn,
    duration,
  });

  // O stem "outros" é uma mistura (sanfona, cordas, sintetizador, teclado...): fica em Outros.
  // Tentar adivinhar o instrumento dele mandava teclado para Sanfonas.
  stemConfigs.push({
    name: songName + ' - Outros Instrumentos',
    childName: 'Outros Instrumentos',
    buffer: otherBuffer,
    parentTrackId: 'track-outros',
    startTime: leadIn,
    duration,
  });

  if (crowdAmbienceBuffer) {
    stemConfigs.push({
      name: songName + ' - Ambiência e Gritos do Show',
      childName: 'Ambiência Plateia',
      buffer: crowdAmbienceBuffer,
      parentTrackId: 'track-outros',
      startTime: leadIn,
      duration,
      mute: true, // Silenciado por padrão para não atrapalhar no show ao vivo!
    });
  }

  for (let i = 0; i < stemConfigs.length; i++) {
    const config = stemConfigs[i];
    const parentId = config.parentTrackId;

    // Roteamento padrão oficial do VS Stage Pro (ver trackForStem): antes ia para a primeira
    // faixa da pasta, e a bateria inteira caía em "Surdo 1".
    const actualTrackId = trackForStem(parentId, config.childName);

    const clipId = 'clip-' + songId + '-' + i;
    const clipAudio = await toClipAudioAsync(config.buffer);
    // a IA entrega mais resolução que 16 bits: o arquivo do stem guarda em 24 bits. As contas de
    // cada stem saem em pedaços: de uma vez só seguravam a tela por quase 1 s em medley longo.
    const wavAb = await encodeWavPcm24Async(config.buffer);
    const wavBlob = new Blob([wavAb], { type: 'audio/wav' });
    const peakResolution = Math.min(24000, Math.max(8000, Math.round(config.buffer.duration * 100)));
    const peaks = await waveformPeaksAsync(config.buffer, peakResolution);

    const clip: AudioClip = {
      id: clipId,
      trackId: actualTrackId,
      name: config.name,
      fileName: config.name + '.wav',
      filePath: URL.createObjectURL(wavBlob),
      songId,
      startTime: config.startTime,
      duration: config.duration,
      sampleRate,
      channels: config.buffer.numberOfChannels,
      bpm: null,
      markers: generateMarkers(config.duration),
      routingMethod: 'ai',
      routingConfidence: 1,
      waveformPeaks: peaks,
      gain: config.gain ?? 1,
      mute: config.mute ?? false,
      solo: false,
    };

    registerClipSource(clipId, songId, wavBlob);
    putClipAudio(clipId, songId, clipAudio);
    store.addClip(clip);
  }

  // O click entra montado igual ao do Recriar metrônomo (nome, WAV, faixa Click).
  if (clickBuffer) store.addClip(await makeClickClip(song, clickBuffer, 0));
  if (tempoSegments && hasTempoChanges(tempoSegments)) store.setPlaybackError(medleyEstimateNotice(songName, tempoSegments));
  if (clickUnsafe) store.setPlaybackError(`"${songName}": não foi possível medir o andamento desta faixa. O click não foi criado para não tocar fora da batida. Confira o BPM na régua e use Recriar metrônomo.`);

  store.selectSong(songId);

  onProgress?.({
    step: 'finalizing',
    message: 'VS criado com sucesso!',
    percent: 100,
  });

  return {
    songId,
    songName,
    bpm,
    duration,
    stemsCount: stemConfigs.length + (clickBuffer ? 1 : 0),
  };
}
