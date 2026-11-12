import { supabase } from '@/lib/supabaseClient';
import { encodeMonoMp3 } from '@/lib/prompterAudio';
import { normalizeWords, type RawSegment, type TimedWord } from '@/lib/lyricsAutoSync';

/**
 * Conversa com a função `lyrics-transcribe`: manda o áudio, acompanha a separação da voz e a
 * leitura da letra, e devolve as palavras com tempo. O que fazer com elas fica em lyricsAutoSync.
 */

const FN = 'lyrics-transcribe';
const POLL_MS = 3000;
const MAX_WAIT_MS = 15 * 60 * 1000;
/** Acima disso (ou fora de MP3) o áudio é reduzido no navegador antes de subir. */
const SEND_AS_IS_BYTES = 6 * 1024 * 1024;
const SEND_RATE = 22050;

export type TranscribeStep = 'prepare' | 'upload' | 'separate' | 'transcribe';

interface Job { stage: 'separate' | 'transcribe'; id: string; file?: string | null; audio?: string | null }

async function invoke<T>(body: FormData | Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error) {
    let code: string | null = null;
    try {
      const res = await (error as { context?: Response }).context?.json?.();
      if (res && typeof res === 'object' && 'error' in res) code = String(res.error);
    } catch { /* sem corpo legível */ }
    throw new Error(code ?? 'network');
  }
  if (!data || typeof data !== 'object' || 'error' in data) throw new Error(String((data as { error?: string })?.error ?? 'request_failed'));
  return data as T;
}

/** MP3 mono leve: a IA não precisa de mais que isso e o envio fica rápido até no celular. */
async function prepareAudio(file: Blob): Promise<Blob> {
  if (file.size <= SEND_AS_IS_BYTES && /mpeg|mp3/i.test(file.type)) return file;
  const buf = await file.arrayBuffer();
  const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
  const length = Math.max(1, Math.ceil(decoded.duration * SEND_RATE));
  const ctx = new OfflineAudioContext(1, length, SEND_RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const mono = await ctx.startRendering();
  return encodeMonoMp3(mono.getChannelData(0), SEND_RATE);
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('aborted')); return; }
  const t = window.setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { window.clearTimeout(t); reject(new Error('aborted')); }, { once: true });
});

/**
 * Ouve a música e devolve as palavras cantadas, cada uma com o tempo.
 * Erros saem com o código: invalid_code, service_busy, file_too_big, failed, no_lyrics, timeout, network, aborted.
 */
export async function transcribeSong(code: string, file: Blob, opts: { signal?: AbortSignal; onStep?: (s: TranscribeStep) => void } = {}): Promise<TimedWord[]> {
  const { signal, onStep } = opts;
  onStep?.('prepare');
  const audio = await prepareAudio(file);
  if (signal?.aborted) throw new Error('aborted');

  onStep?.('upload');
  const form = new FormData();
  form.append('action', 'start');
  form.append('code', code);
  form.append('file', new File([audio], 'musica.mp3', { type: 'audio/mpeg' }));
  let { job } = await invoke<{ job: Job }>(form);

  const started = Date.now();
  try {
    for (;;) {
      onStep?.(job.stage);
      await wait(POLL_MS, signal);
      if (Date.now() - started > MAX_WAIT_MS) throw new Error('timeout');
      let res: { status: 'running' | 'done' | 'failed'; job?: Job; segments?: RawSegment[] };
      try {
        res = await invoke({ action: 'status', code, job });
      } catch (e) {
        // Internet piscou no meio: continua perguntando; o trabalho segue na nuvem.
        if ((e as Error).message === 'network') continue;
        throw e;
      }
      if (res.status === 'running') { if (res.job) job = res.job; continue; }
      if (res.status === 'failed') throw new Error('failed');
      const words = normalizeWords(res.segments ?? []);
      if (words.length === 0) throw new Error('no_lyrics');
      return words;
    }
  } catch (e) {
    if ((e as Error).message === 'aborted' || (e as Error).message === 'timeout') {
      invoke({ action: 'cancel', code, job }).catch(() => {});
    }
    throw e;
  }
}

export function transcribeErrorText(code: string): string {
  switch (code) {
    case 'invalid_code': return 'O código do produtor venceu. Saia e entre de novo.';
    case 'service_busy': return 'O serviço de IA está ocupado agora. A equipe já foi avisada. Tente de novo em alguns minutos.';
    case 'file_too_big': return 'O áudio é grande demais para enviar. Use um arquivo menor.';
    case 'no_lyrics': return 'A IA não encontrou voz cantada nesta música.';
    case 'timeout': return 'A IA demorou demais. Tente de novo.';
    case 'network': return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    case 'not_configured': return 'A letra automática ainda não está ligada no servidor.';
    case 'EncodingError':
    case 'decode': return 'Não foi possível ler este arquivo de áudio.';
    default: return 'Não foi possível gerar a letra agora. Tente de novo.';
  }
}
