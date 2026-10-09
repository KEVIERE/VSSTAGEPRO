import { supabase } from '@/lib/supabaseClient';
import { callPrompterFn } from '@/lib/prompterAudio';

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
