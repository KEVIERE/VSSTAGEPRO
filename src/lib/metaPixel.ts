// Pixel da Meta (Facebook e Instagram) no site. Mede o caminho da assinatura para a
// campanha de Vendas: PageView, ViewContent (página de planos), CompleteRegistration
// (conta criada, começa o teste de 48 horas), InitiateCheckout (abriu o pagamento) e
// Purchase (pagamento confirmado).
//
// O Purchase também sai pelo servidor (API de Conversões, supabase/functions/_shared/
// metaCapi.ts), porque o PIX e o cartão terminam na página da InfinitePay e o navegador
// perde parte das vendas. Os dois mandam o MESMO event_id (purchaseEventId), e a Meta
// conta uma vez só.
//
// Só liga no site, no navegador: nunca dentro do programa do Mac (window.vsDesktop),
// nunca no admin nem nas telas do show (editor, controle, tela do palco, músico,
// produtor). Sem VITE_META_PIXEL_ID no build, nada carrega e as funções não fazem nada.
//
// Sem import de '@/...': os testes (tests/metaPixel.test.mjs) importam este arquivo direto.

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

const PIXEL_ID_RE = /^\d{6,20}$/;

/** Pixel ID do build (VITE_META_PIXEL_ID), ou '' quando não configurado ou inválido. */
export function configuredPixelId(raw: unknown): string {
  const id = String(raw ?? '').trim();
  return PIXEL_ID_RE.test(id) ? id : '';
}

const PIXEL_ID = configuredPixelId(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_META_PIXEL_ID,
);

/** Páginas públicas que contam para a campanha. As telas do show e o admin ficam de fora. */
export const PIXEL_ROUTES: ReadonlySet<string> = new Set([
  'sales', 'pricing', 'download', 'subscribed', 'affiliate', 'recovery',
]);

export function pixelAllowed(opts: { pixelId: string; desktop: boolean; route: string }): boolean {
  return !!opts.pixelId && !opts.desktop && PIXEL_ROUTES.has(opts.route);
}

export const PLAN_VALUE: Record<'monthly' | 'yearly', number> = { monthly: 55, yearly: 349 };
export const PLAN_NAME: Record<'monthly' | 'yearly', string> = { monthly: 'VS Stage Pro Mensal', yearly: 'VS Stage Pro Anual' };

/** Mesmo formato do servidor (metaCapi.ts): é isso que evita contar a venda duas vezes. */
export const purchaseEventId = (paymentId: string) => `purchase_${paymentId}`;
export const checkoutEventId = (paymentId: string) => `checkout_${paymentId}`;
export const registrationEventId = (userId: string) => `registration_${userId}`;

/** Reais com 2 casas, a partir de centavos. */
export const centsToValue = (cents: number) => Math.round(cents) / 100;

// Venda confirmada há mais de um dia (ex.: a página de volta aberta de novo dias depois)
// não vai mais pelo navegador: a Meta só junta navegador e servidor dentro de 48 horas.
export const PURCHASE_BROWSER_WINDOW_MS = 24 * 3600_000;

type ChargeLike = { id: string; plan: 'monthly' | 'yearly'; amount_cents: number; status: string; expires_at: string };

export function shouldTrackPurchase(charge: ChargeLike, now: number, alreadyTracked: ReadonlySet<string>): boolean {
  if (charge.status !== 'paid' || !charge.id || alreadyTracked.has(charge.id)) return false;
  const exp = Date.parse(charge.expires_at);
  return Number.isFinite(exp) && exp > now - PURCHASE_BROWSER_WINDOW_MS;
}

const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{1,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,500}$/;

function cookieValue(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/**
 * Cookies do próprio site que o Pixel grava (_fbp: navegador, _fbc: clique no anúncio).
 * Vão junto com o pedido de pagamento para o servidor mandar o Purchase ligado ao clique.
 * Sem _fbc, mas com ?fbclid= no endereço, monta o valor no formato da Meta.
 */
export function readMetaTracking(cookies: string, search: string, href: string, now: number) {
  const fbp = cookieValue(cookies, '_fbp');
  let fbc = cookieValue(cookies, '_fbc');
  if (!fbc) {
    try {
      const clid = new URLSearchParams(search).get('fbclid');
      if (clid) fbc = `fb.1.${now}.${clid}`;
    } catch { /* endereço estranho: segue sem */ }
  }
  return {
    fbp: fbp && FBP_RE.test(fbp) ? fbp : undefined,
    fbc: fbc && FBC_RE.test(fbc) ? fbc : undefined,
    url: href.split('#')[0].slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Navegador

let loaded = false;
const sentOnce = new Set<string>();
// Eventos que chegam antes da primeira PageView (o efeito da página roda antes do efeito
// do App, que liga o Pixel): esperam aqui e saem logo depois do init.
const pending: Array<[string, Record<string, unknown> | undefined, string | undefined]> = [];

const isDesktop = () => typeof window !== 'undefined' && !!(window as unknown as { vsDesktop?: unknown }).vsDesktop;
/** Pode ligar neste build e neste lugar (site no navegador, com Pixel ID). */
const enabled = () => !!PIXEL_ID && !isDesktop() && typeof document !== 'undefined';

/** Carrega o fbevents.js uma vez (o código padrão da Meta, escrito em TS). */
function load(): boolean {
  if (loaded) return true;
  if (!enabled()) return false;
  if (!window.fbq) {
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    } as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    // O site troca de página sem recarregar (hash). As PageView saem daqui, uma por
    // página; sem isto o Pixel também contaria cada troca de endereço sozinho.
    n.disablePushState = true;
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  // Sem os eventos automáticos (cliques em botão, dados de formulário): só os nossos.
  window.fbq('set', 'autoConfig', false, PIXEL_ID);
  window.fbq('init', PIXEL_ID);
  loaded = true;
  return true;
}

function track(event: string, params?: Record<string, unknown>, eventId?: string) {
  if (!enabled()) return;
  if (!loaded) {
    if (pending.length < 20) pending.push([event, params, eventId]);
    return;
  }
  try {
    if (eventId) window.fbq?.('track', event, params ?? {}, { eventID: eventId });
    else window.fbq?.('track', event, params ?? {});
  } catch { /* bloqueador de anúncio ou rede: nunca atrapalha o site */ }
}

/** Troca de página do site. Liga o Pixel na primeira página pública. */
export function metaPageView(route: string) {
  if (!pixelAllowed({ pixelId: PIXEL_ID, desktop: isDesktop(), route })) return;
  if (!load()) return;
  track('PageView');
  for (const [event, params, eventId] of pending.splice(0)) track(event, params, eventId);
}

let lastViewContent = 0;
export function metaViewContent() {
  // O React em modo de desenvolvimento roda o efeito da página duas vezes seguidas.
  const now = Date.now();
  if (now - lastViewContent < 2000) return;
  lastViewContent = now;
  track('ViewContent', { content_name: 'Planos VS Stage Pro', content_category: 'assinatura', currency: 'BRL' });
}

/** Conta nova criada no site: começa o teste de 48 horas. */
export function metaCompleteRegistration(userId: string | undefined) {
  if (!userId) return;
  const id = registrationEventId(userId);
  if (sentOnce.has(id)) return;
  sentOnce.add(id);
  track('CompleteRegistration', { content_name: 'Teste grátis 48 horas', status: true, currency: 'BRL', value: 0 }, id);
}

/** Link de pagamento aberto (Mensal ou Anual), com o valor que a pessoa vai pagar. */
export function metaInitiateCheckout(charge: ChargeLike) {
  if (charge.status !== 'pending') return;
  const id = checkoutEventId(charge.id);
  if (sentOnce.has(id)) return;
  sentOnce.add(id);
  track('InitiateCheckout', {
    value: centsToValue(charge.amount_cents), currency: 'BRL',
    content_ids: [charge.plan], content_name: PLAN_NAME[charge.plan], content_type: 'product', num_items: 1,
  }, id);
}

const PURCHASES_KEY = 'vs_meta_purchases';

function trackedPurchases(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(PURCHASES_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Pagamento confirmado na tela. O servidor manda o mesmo evento; a Meta junta os dois. */
export function metaPurchase(charge: ChargeLike) {
  if (!enabled()) return;
  const done = trackedPurchases();
  if (!shouldTrackPurchase(charge, Date.now(), done)) return;
  track('Purchase', {
    value: centsToValue(charge.amount_cents), currency: 'BRL',
    content_ids: [charge.plan], content_name: PLAN_NAME[charge.plan], content_type: 'product', num_items: 1,
  }, purchaseEventId(charge.id));
  try {
    localStorage.setItem(PURCHASES_KEY, JSON.stringify([...done, charge.id].slice(-20)));
  } catch { /* modo privado */ }
}

/** Cookies da Meta para o servidor (vazio fora do site ou sem Pixel). */
export function metaTrackingForCheckout(): { fbp?: string; fbc?: string; url: string } | undefined {
  if (!enabled()) return undefined;
  try {
    return readMetaTracking(document.cookie, location.search, location.href, Date.now());
  } catch {
    return undefined;
  }
}
