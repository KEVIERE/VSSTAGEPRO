import { supabase } from '@/lib/supabaseClient';
import { renderLrMasterForSong } from '@/lib/bounceEngine';
import { useStore } from '@/store';
import type { Song } from '@/types';
import { isLocalClient } from '@/lib/localNetwork';

const BUCKET = 'prompter-audio';
const FN = 'prompter-audio';
const REF_RATE = 22050;

export async function callPrompterFn<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(FN, { body });
  if (error) throw new Error('request_failed');
  if (!data || typeof data !== 'object' || 'error' in data) throw new Error(String((data as { error?: string })?.error ?? 'request_failed'));
  return data as T;
}

const REF_KBPS = 48;
const MP3_CHUNK = 1152 * 64;

async function encodeMonoMp3(samples: Float32Array, sampleRate: number): Promise<Blob> {
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
async function renderReference(song: Song): Promise<Blob> {
  const full = await renderLrMasterForSong(song, useStore.getState());
  const length = Math.max(1, Math.ceil(full.duration * REF_RATE));
  const ctx = new OfflineAudioContext(1, length, REF_RATE);
  const src = ctx.createBufferSource();
  src.buffer = full;
  src.connect(ctx.destination);
  src.start();
  const mono = await ctx.startRendering();
  return encodeMonoMp3(mono.getChannelData(0), REF_RATE);
}

export async function uploadSongReference(showId: string, directorKey: string, song: Song): Promise<void> {
  const blob = await renderReference(song);
  const { path, token } = await callPrompterFn<{ path: string; token: string }>({ action: 'upload', show: showId, key: directorKey, song: song.id, format: 'mp3' });
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, blob, { contentType: 'audio/mpeg', upsert: true });
  if (error) throw new Error('upload_failed');
}

export async function directorReferenceStatus(showId: string, directorKey: string): Promise<Map<string, string | null>> {
  const res = await callPrompterFn<{ files: { songId: string; updatedAt: string | null }[] }>({ action: 'status', show: showId, key: directorKey });
  return new Map((Array.isArray(res.files) ? res.files : []).map((f) => [f.songId, f.updatedAt]));
}

export interface ProducerReference { url: string; updatedAt: string | null }

export async function producerReferenceList(code: string): Promise<Map<string, ProducerReference>> {
  // Áudio de referência fica na nuvem; na rede local o editor de letras funciona sem ele.
  if (isLocalClient()) return new Map();
  const res = await callPrompterFn<{ files: { songId: string; url: string | null; updatedAt: string | null }[] }>({ action: 'list', code });
  return new Map(
    (Array.isArray(res.files) ? res.files : [])
      .filter((f) => typeof f.url === 'string')
      .map((f) => [f.songId, { url: f.url as string, updatedAt: f.updatedAt ?? null }]),
  );
}
