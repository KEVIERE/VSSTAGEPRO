import { supabase } from '@/lib/supabaseClient';
import { renderLrMasterForSong } from '@/lib/bounceEngine';
import { useStore } from '@/store';
import type { Song } from '@/types';
import { isLocalClient, type RepertoireStatusRaw } from '@/lib/localNetwork';
import { localProducerPost } from '@/lib/localClientApi';

const BUCKET = 'prompter-audio';
const FN = 'prompter-audio';
const REF_RATE = 22050;

/**
 * Chama a função da nuvem e devolve o corpo.
 *
 * O erro vem com o código do servidor (`invalid_code`, `forbidden`, `too_many_attempts`...), não
 * com um texto genérico: quem chama precisa distinguir "o código do produtor venceu" de "sem
 * internet" para avisar a pessoa certa. Antes tudo virava `request_failed`, e a tela culpava a
 * internet mesmo quando o problema era outro.
 */
export async function callPrompterFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error) {
    // `FunctionsHttpError` traz a resposta no `context`: é de lá que sai o código do servidor.
    let codigo: string | null = null;
    try {
      const resposta = await (error as { context?: Response }).context?.json?.();
      if (resposta && typeof resposta === 'object' && 'error' in resposta) codigo = String(resposta.error);
    } catch { /* sem corpo legível */ }
    throw new Error(codigo ?? 'network');
  }
  if (!data || typeof data !== 'object' || 'error' in data) throw new Error(String((data as { error?: string })?.error ?? 'request_failed'));
  return data as T;
}

const REF_KBPS = 48;
const MP3_CHUNK = 1152 * 64;

export async function encodeMonoMp3(samples: Float32Array, sampleRate: number): Promise<Blob> {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(1, sampleRate, REF_KBPS);
  const parts: Uint8Array[] = [];
  const pcm = new Int16Array(MP3_CHUNK);
  for (let start = 0; start < samples.length; start += MP3_CHUNK) {
    const n = Math.min(MP3_CHUNK, samples.length - start);
    for (let i = 0; i < n; i++) {
      const v = Math.max(-1, Math.min(1, samples[start + i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    const out = enc.encodeBuffer(n === MP3_CHUNK ? pcm : pcm.subarray(0, n));
    if (out.length) parts.push(new Uint8Array(out));
    // Libera a tela entre os blocos para o programa não travar enquanto codifica.
    await new Promise((r) => setTimeout(r, 0));
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}

// Versão leve (MP3 mono, 22 kHz, 48 kbps) da mixagem LR, com o BPM e o tom do show, só para referência do produtor.
export async function renderReference(song: Song, rendered?: AudioBuffer): Promise<Blob> {
  const full = rendered ?? await renderLrMasterForSong(song, useStore.getState());
  const length = Math.max(1, Math.ceil(full.duration * REF_RATE));
  const ctx = new OfflineAudioContext(1, length, REF_RATE);
  const src = ctx.createBufferSource();
  src.buffer = full;
  src.connect(ctx.destination);
  src.start();
  const mono = await ctx.startRendering();
  return encodeMonoMp3(mono.getChannelData(0), REF_RATE);
}

/** WAV 16 bits da mixagem inteira: é o que o leitor de letra do Mac recebe (qualidade cheia para separar a voz). */
export function encodeWav16(buf: AudioBuffer): ArrayBuffer {
  const ch = Math.min(2, buf.numberOfChannels);
  const n = buf.length;
  const out = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(out);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

export async function uploadReferenceBlob(showId: string, directorKey: string, songId: string, blob: Blob): Promise<void> {
  const { path, token } = await callPrompterFn<{ path: string; token: string }>({ action: 'upload', show: showId, key: directorKey, song: songId, format: 'mp3' });
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: 'audio/mpeg', upsert: true });
  if (error) throw new Error('upload_failed');
}

export async function uploadSongReference(showId: string, directorKey: string, song: Song): Promise<void> {
  await uploadReferenceBlob(showId, directorKey, song.id, await renderReference(song));
}

/** A letra lida pelo Mac do diretor vai ao lado do áudio (e some junto com ele). */
export async function uploadSongWords(showId: string, directorKey: string, songId: string, json: string): Promise<void> {
  const { path, token } = await callPrompterFn<{ path: string; token: string }>({ action: 'upload', show: showId, key: directorKey, song: songId, format: 'words' });
  const blob = new Blob([json], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: 'application/json', upsert: true });
  if (error) throw new Error('upload_failed');
}

/** O diretor apertou "Enviar repertório": começa um envio novo (tira a liberação anterior). */
export async function directorStartSend(showId: string, directorKey: string): Promise<void> {
  await callPrompterFn({ action: 'send_start', show: showId, key: directorKey });
}

export interface ClearedAudio { removed: number; bytes: number }

// O diretor confirma que as letras ficaram prontas: o áudio de referência do show sai do storage
// (as letras ficam). Usado pelo botão "Confirmar" do aviso no programa.
export async function clearShowAudio(showId: string, directorKey: string): Promise<ClearedAudio> {
  return callPrompterFn<ClearedAudio>({ action: 'clear', show: showId, key: directorKey });
}

// O show foi apagado: some também o que estava no storage dele (áudio e logo).
export async function deleteShowReferences(showId: string, directorKey: string): Promise<ClearedAudio> {
  return callPrompterFn<ClearedAudio>({ action: 'delete_show', show: showId, key: directorKey });
}

export interface ReferenceStatus {
  /** songId -> updatedAt do arquivo no storage. */
  files: Map<string, string | null>;
  /** songId -> updatedAt da letra lida pelo Mac. */
  words: Map<string, string | null>;
  /** O produtor salvou as letras: o áudio já cumpriu o papel e vai sair (ou já saiu). */
  releasedAt: string | null;
  /** O produtor pediu o repertório de novo. */
  requestedAt: string | null;
}

/** Lê a resposta de situação, da nuvem ou da rede local (mesmo formato). */
export function parseReferenceStatus(res: RepertoireStatusRaw | null | undefined): ReferenceStatus {
  const map = (list: unknown) => new Map(
    (Array.isArray(list) ? list : [])
      .filter((f): f is { songId: string; updatedAt: string | null } => !!f && typeof f.songId === 'string')
      .map((f) => [f.songId, f.updatedAt ?? null] as const),
  );
  return {
    files: map(res?.files),
    words: map(res?.words),
    releasedAt: typeof res?.released_at === 'string' ? res.released_at : null,
    requestedAt: typeof res?.requested_at === 'string' ? res.requested_at : null,
  };
}

export async function directorReferenceStatus(showId: string, directorKey: string): Promise<ReferenceStatus> {
  return parseReferenceStatus(await callPrompterFn<RepertoireStatusRaw>({ action: 'status', show: showId, key: directorKey }));
}

/** O produtor pede o repertório: vira um aviso no programa do diretor, que envia. */
export async function producerRequestRepertoire(code: string): Promise<void> {
  if (isLocalClient()) { await localProducerPost(code, 'repertoire-request', {}); return; }
  await callPrompterFn({ action: 'request', code });
}

/** O diretor pega o pedido do produtor. Devolve o carimbo, ou null se não há pedido. */
export async function directorTakeRepertoireRequest(showId: string, directorKey: string): Promise<string | null> {
  const res = await callPrompterFn<{ requested_at?: string | null }>({ action: 'take_request', show: showId, key: directorKey });
  return typeof res.requested_at === 'string' ? res.requested_at : null;
}

export interface ProducerReference {
  url: string;
  updatedAt: string | null;
  /** Letra lida pelo Mac do diretor (palavras com tempo), quando já está pronta. */
  wordsUrl: string | null;
}

type RawReference = { songId: string; url: string | null; updatedAt: string | null; wordsUrl?: string | null };

export async function producerReferenceList(code: string): Promise<Map<string, ProducerReference>> {
  // Na rede local o áudio vem do próprio Mac do diretor; online, do storage.
  const res = isLocalClient()
    ? await localProducerPost(code, 'references', {}) as { files?: RawReference[] }
    : await callPrompterFn<{ files: RawReference[] }>({ action: 'list', code });
  return new Map(
    (Array.isArray(res.files) ? res.files : [])
      .filter((f) => typeof f.url === 'string')
      .map((f) => [f.songId, { url: f.url as string, updatedAt: f.updatedAt ?? null, wordsUrl: typeof f.wordsUrl === 'string' ? f.wordsUrl : null }]),
  );
}
