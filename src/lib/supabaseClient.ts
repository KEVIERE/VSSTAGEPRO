import { createClient } from '@supabase/supabase-js';

const url =
  (import.meta.env.VITE_SUPABASE_URL as string) || 'https://xfpkftewsxaxycdwwnnv.supabase.co';
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmcGtmdGV3c3hheHljZHd3bm52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0MTc3ODAsImV4cCI6MjEwNjk5Mzc4MH0.JXKzNyF_gKzKF3zw8m8Kk6FFNHyOR5b-6s-r7gleEkM';

// 1. Se a URL chegou com duplo hash (ex: #recuperar#access_token=...),
// normaliza o hash para que o SDK do Supabase leia o access_token sem erros.
try {
  if (typeof window !== 'undefined' && window.location?.hash) {
    const rawHash = window.location.hash;
    const atIdx = rawHash.indexOf('#access_token=');
    if (atIdx > 0) {
      window.location.hash = rawHash.slice(atIdx);
    }
  }
} catch {
  /* ignore */
}

// 2. Lê o tipo de link de autenticação de forma síncrona antes do Supabase limpar o hash da URL.
function readEmailLinkType(): string | null {
  try {
    const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const rawSearch = window.location.search.startsWith('?') ? window.location.search.slice(1) : '';
    const hashParams = new URLSearchParams(rawHash);
    const searchParams = new URLSearchParams(rawSearch);

    // Se a URL contém erro de OTP/link expirado ou inválido
    const err = hashParams.get('error_description') || searchParams.get('error_description') || '';
    const errCode = hashParams.get('error_code') || searchParams.get('error_code') || '';
    if (errCode === 'otp_expired' || /otp|token|expired|invalid/i.test(err)) {
      return 'recovery';
    }

    const type = hashParams.get('type') || searchParams.get('type');
    if (type === 'recovery' || rawHash.includes('type=recovery') || rawSearch.includes('type=recovery') || rawHash.includes('recovery')) {
      return 'recovery';
    }

    if (type === 'signup' || rawHash.includes('type=signup') || rawSearch.includes('type=signup')) {
      return 'signup';
    }

    return null;
  } catch {
    return null;
  }
}
export const emailLinkType = readEmailLinkType();

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
