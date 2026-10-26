import { createClient } from '@supabase/supabase-js';

const url =
  (import.meta.env.VITE_SUPABASE_URL as string) || 'https://eknjqqiamuztomdygalv.supabase.co';
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  'sb_publishable_9yDFOv1hd7w8MITGsE1ZgQ_mY5eJJI2';

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

// Chave que o supabase-js usa no localStorage para guardar a sessão (mesma fórmula
// que a lib usa internamente: `sb-${primeiro-segmento-do-host}-auth-token`).
const AUTH_STORAGE_KEY = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;

// supabase.auth.signOut() só limpa a sessão (e só dispara o evento SIGNED_OUT que
// a tela escuta) DEPOIS que o servidor responde ao pedido de invalidar a sessão —
// mesmo com scope:'local' ainda sai uma chamada de rede antes. Se essa chamada
// falhar por qualquer motivo que não seja "sessão já inválida" (rede lenta,
// instabilidade do serviço, timeout), a Promise nunca resolve do jeito esperado e
// quem clicou em "Sair"/"Entrar com outra conta" fica preso na mesma tela sem
// nenhum aviso, porque a tela só reage ao evento, não ao clique em si.
// Esta função limpa o armazenamento local de forma síncrona (nunca depende de
// rede) e dispara o aviso ao servidor em paralelo, best-effort — use-a em conjunto
// com um reset direto do estado do componente (não espere pelo evento).
export function clearLocalSession(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
  } catch { /* sem storage */ }
  supabase.auth.signOut().catch(() => { /* best effort — já saímos localmente */ });
}
