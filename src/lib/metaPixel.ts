// Pixel da Meta (Facebook e Instagram) no site. Mede o caminho da assinatura para a
// campanha de Vendas: PageView, ViewContent (página de planos), CompleteRegistration
// (conta criada, começa o teste de 48 horas), InitiateCheckout (abriu o pagamento) e
// Purchase (pagamento confirmado).
//
// O Purchase sai só pelo navegador, com event_id fixo (purchaseEventId): se um dia o
// servidor (API de Conversões) mandar a mesma venda com o mesmo event_id, a Meta conta
// uma vez só.
//
// Só liga no site, no navegador: nunca dentro do programa do Mac (window.vsDesktop),
// nunca no admin nem nas telas do show (editor, controle, tela do palco, músico,
// produtor). O Pixel ID vem de VITE_META_PIXEL_ID; sem ele, vale o Pixel do site
// (DEFAULT_PIXEL_ID). O ID não é segredo: a Meta mostra no código de qualquer página.
//
// O cadastro (CompleteRegistration) é o evento que a campanha de anúncios otimiza. Sai na
// hora do cadastro por e-mail e, para quem entra pelo Google ou pelo telefone, quando a
// sessão de uma conta recém-criada chega (metaRegistrationFromSession).
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

/** Pixel "VS Stage Pro - site" (Gerenciador de Eventos da Meta). */
export const DEFAULT_PIXEL_ID = '1074429838967668';

const PIXEL_ID = configuredPixelId(
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_META_PIXEL_ID,
) || DEFAULT_PIXEL_ID;

/** Páginas públicas que contam para a campanha. As telas do show e o admin ficam de fora. */
export const PIXEL_ROUTES: ReadonlySet<string> = new Set([
  'sales', 'pricing', 'download', 'subscribed', 'affiliate', 'recovery', 'subscriber', 'stagedownload',
]);

export function pixelAllowed(opts: { pixelId: string; desktop: boolean; route: string }): boolean {
  return !!opts.pixelId && !opts.desktop && PIXEL_ROUTES.has(opts.route);
}

export const PLAN_VALUE: Record<'monthly' | 'yearly', number> = { monthly: 55, yearly: 349 };
export const PLAN_NAME: Record<'monthly' | 'yearly', string> = { monthly: 'VS Stage Pro Mensal', yearly: 'VS Stage Pro Anual' };

/** event_id de cada evento: a Meta junta envios repetidos com o mesmo id. */
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

// ---------------------------------------------------------------------------
// Navegador

let loaded = false;
const sentOnce = new Set<string>();

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

/**
 * Manda um evento. Cadastro e pagamento podem acontecer em telas do site fora de
 * PIXEL_ROUTES (Área do Assinante, #programa no navegador): o Pixel liga ali mesmo, só
 * para o evento. Devolve true quando o evento foi entregue ao fbq.
 */
function track(event: string, params?: Record<string, unknown>, eventId?: string): boolean {
  if (!load()) return false;
  try {
    if (eventId) window.fbq?.('track', event, params ?? {}, { eventID: eventId });
    else window.fbq?.('track', event, params ?? {});
    return true;
  } catch {
    return false; // bloqueador de anúncio ou rede: nunca atrapalha o site
  }
}

/** Troca de página do site. Liga o Pixel na primeira página pública. */
export function metaPageView(route: string) {
  if (!pixelAllowed({ pixelId: PIXEL_ID, desktop: isDesktop(), route })) return;
  if (!load()) return;
  track('PageView');
}

let lastViewContent = 0;
export function metaViewContent() {
  // O React em modo de desenvolvimento roda o efeito da página duas vezes seguidas.
  const now = Date.now();
  if (now - lastViewContent < 2000) return;
  lastViewContent = now;
  track('ViewContent', { content_name: 'Planos VS Stage Pro', content_category: 'assinatura', currency: 'BRL' });
}

const REGISTRATIONS_KEY = 'vs_meta_registrations';

function storedIds(key: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function storeId(key: string, done: Set<string>, id: string) {
  try {
    localStorage.setItem(key, JSON.stringify([...done, id].slice(-20)));
  } catch { /* modo privado */ }
}

/** Conta nova criada no site: começa o teste de 48 horas. Uma vez por conta neste navegador. */
export function metaCompleteRegistration(userId: string | undefined) {
  if (!userId || !enabled()) return;
  const id = registrationEventId(userId);
  const done = storedIds(REGISTRATIONS_KEY);
  if (sentOnce.has(id) || done.has(userId)) return;
  if (!track('CompleteRegistration', { content_name: 'Teste grátis 48 horas', status: true, currency: 'BRL', value: 0 }, id)) return;
  sentOnce.add(id);
  storeId(REGISTRATIONS_KEY, done, userId);
}

// Sessão de conta criada há menos que isto conta como cadastro (Google, telefone e quem
// confirma o e-mail depois). Mais que isto é um login comum de quem já tinha conta.
export const NEW_ACCOUNT_WINDOW_MS = 30 * 60_000;

export function isNewAccount(createdAt: string | undefined, now: number): boolean {
  const t = Date.parse(createdAt ?? '');
  return Number.isFinite(t) && now - t >= -60_000 && now - t < NEW_ACCOUNT_WINDOW_MS;
}

/** Entrou numa conta recém-criada (qualquer jeito de cadastro): manda o cadastro uma vez. */
export function metaRegistrationFromSession(user: { id?: string; created_at?: string } | null | undefined) {
  if (!user?.id || !isNewAccount(user.created_at, Date.now())) return;
  metaCompleteRegistration(user.id);
}

/** Link de pagamento aberto (Mensal ou Anual), com o valor que a pessoa vai pagar. */
export function metaInitiateCheckout(charge: ChargeLike) {
  if (charge.status !== 'pending') return;
  const id = checkoutEventId(charge.id);
  if (sentOnce.has(id)) return;
  if (track('InitiateCheckout', {
    value: centsToValue(charge.amount_cents), currency: 'BRL',
    content_ids: [charge.plan], content_name: PLAN_NAME[charge.plan], content_type: 'product', num_items: 1,
  }, id)) sentOnce.add(id);
}

const PURCHASES_KEY = 'vs_meta_purchases';

/** Pagamento confirmado na tela. Uma vez por venda neste navegador. */
export function metaPurchase(charge: ChargeLike) {
  if (!enabled()) return;
  const done = storedIds(PURCHASES_KEY);
  if (!shouldTrackPurchase(charge, Date.now(), done)) return;
  if (track('Purchase', {
    value: centsToValue(charge.amount_cents), currency: 'BRL',
    content_ids: [charge.plan], content_name: PLAN_NAME[charge.plan], content_type: 'product', num_items: 1,
  }, purchaseEventId(charge.id))) storeId(PURCHASES_KEY, done, charge.id);
}
