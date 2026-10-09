import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// O link do e-mail de confirmação chega com "#access_token=...&type=signup" (ou type=recovery
// etc). O cliente do Supabase processa e limpa esse hash de forma assíncrona ao iniciar, então
// guardamos o "type" aqui, de forma síncrona, antes dele desaparecer da URL.
function readEmailLinkType(): string | null {
  try {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    return new URLSearchParams(hash).get('type');
  } catch {
    return null;
  }
}
export const emailLinkType = readEmailLinkType();

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
