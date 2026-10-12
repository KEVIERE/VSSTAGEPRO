import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// O link do e-mail chega com "#access_token=...&type=signup" ou "type=recovery"
// O cliente do Supabase processa e limpa esse hash de forma assíncrona ao iniciar,
// então guardamos o "type" aqui, de forma síncrona, antes dele desaparecer da URL.
function readEmailLinkType(): string | null {
  try {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const hashType = new URLSearchParams(hash).get('type');
    if (hashType) return hashType;
    const searchType = new URLSearchParams(window.location.search).get('type');
    if (searchType) return searchType;
    if (hash.includes('type=recovery') || window.location.search.includes('type=recovery') || hash.includes('recovery')) return 'recovery';
    if (hash.includes('type=signup') || window.location.search.includes('type=signup')) return 'signup';
    return null;
  } catch {
    return null;
  }
}
export const emailLinkType = readEmailLinkType();

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
