import { supabase } from '@/lib/supabaseClient';
import { callPrompterFn } from '@/lib/prompterAudio';
import { isLocalClient } from '@/lib/localNetwork';
import { localProducerPost } from '@/lib/localClientApi';

const BUCKET = 'show-logos';
export const LOGO_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg'];
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

export interface LogoInfo { url: string | null; updatedAt: string | null }

function asInfo(v: LogoInfo): LogoInfo {
  return { url: typeof v.url === 'string' ? v.url : null, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null };
}

export async function uploadShowLogo(showId: string, directorKey: string, file: File): Promise<void> {
  const { path, token } = await callPrompterFn<{ path: string; token: string }>({ action: 'logo_upload', show: showId, key: directorKey });
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type, upsert: true });
  if (error) throw new Error('upload_failed');
}

export async function removeShowLogo(showId: string, directorKey: string): Promise<void> {
  await callPrompterFn({ action: 'logo_remove', show: showId, key: directorKey });
}

export async function directorShowLogo(showId: string, directorKey: string): Promise<LogoInfo> {
  return asInfo(await callPrompterFn<LogoInfo>({ action: 'logo_director', show: showId, key: directorKey }));
}

export async function screenShowLogo(code: string): Promise<LogoInfo> {
  return asInfo(await callPrompterFn<LogoInfo>({ action: 'logo_get', code }));
}

/** Lê o arquivo como base64, sem o prefixo `data:...;base64,`. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      const comma = raw.indexOf(',');
      if (comma < 0) reject(new Error('read_failed'));
      else resolve(raw.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

// Pelo código do produtor: ele também troca a logo, sem precisar da chave do diretor.
// Na Rede Local a imagem fica no Mac do diretor (o servidor local guarda e serve); ir pela nuvem
// aqui pegava 403, porque a função de lá exige a chave do diretor, não o código do produtor.
export async function producerUploadShowLogo(code: string, file: File): Promise<void> {
  if (isLocalClient()) {
    await localProducerPost(code, 'logo', { type: file.type, data: await toBase64(file) });
    return;
  }
  const { path, token } = await callPrompterFn<{ path: string; token: string }>({ action: 'logo_get_upload', code });
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(path, token, file, { contentType: file.type, upsert: true });
  if (error) throw new Error('upload_failed');
}

export async function producerRemoveShowLogo(code: string): Promise<void> {
  if (isLocalClient()) { await localProducerPost(code, 'logo-remove', {}); return; }
  await callPrompterFn({ action: 'logo_remove_code', code });
}
