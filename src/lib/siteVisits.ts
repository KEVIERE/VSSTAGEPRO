import { supabase } from '@/lib/supabaseClient';

// Conta as visitas do site para o painel "Acessos" do admin.
// O visitante é um código aleatório guardado neste navegador: sem nome, e-mail ou IP.
// Cada página conta uma vez por aba aberta; recarregar a página não infla o número.

const VISITOR_KEY = 'vs_visitor';
const SEEN_PREFIX = 'vs_seen_';
const REFERRER_KEY = 'vs_referrer_sent';

function visitorId(): string | null {
  try {
    const saved = localStorage.getItem(VISITOR_KEY);
    if (saved && /^[a-z0-9]{16,40}$/.test(saved)) return saved;
    const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const id = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
    if (id.length < 16) return null;
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export function deviceKind(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

/** Só o domínio de quem mandou a pessoa (Google, Instagram...), e só se for de fora do site. */
export function referrerHost(referrer: string, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, '');
    const own = ownHost.toLowerCase().replace(/^www\./, '');
    if (!host || host === own || host.endsWith(`.${own}`)) return null;
    return host.slice(0, 120);
  } catch {
    return null;
  }
}

export function trackSiteVisit(page: string) {
  if (typeof window === 'undefined' || window.vsDesktop) return;
  if (/^\/staging(\/|$)/i.test(window.location.pathname)) return;
  if (navigator.webdriver) return;
  const visitor = visitorId();
  if (!visitor) return;

  let referrer: string | null = null;
  try {
    if (sessionStorage.getItem(SEEN_PREFIX + page)) return;
    sessionStorage.setItem(SEEN_PREFIX + page, '1');
    // A origem vale só para a primeira página que a pessoa abriu.
    if (!sessionStorage.getItem(REFERRER_KEY)) {
      sessionStorage.setItem(REFERRER_KEY, '1');
      referrer = referrerHost(document.referrer, window.location.hostname);
    }
  } catch { /* navegador sem sessionStorage: conta mesmo assim */ }

  supabase.rpc('track_site_visit', {
    p_visitor: visitor,
    p_page: page,
    p_referrer: referrer,
    p_device: deviceKind(navigator.userAgent),
  }).then(() => {}, () => {});
}
