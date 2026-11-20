// API de Conversões da Meta: o Purchase de cada assinatura paga, mandado pelo servidor.
//
// Por que pelo servidor: o PIX e o cartão terminam na página da InfinitePay, e muita gente
// fecha a aba antes de voltar ao site. O Pixel do navegador perde essas vendas; daqui
// nenhuma se perde, porque sai quando o banco libera o plano (resultado 'activated', que
// acontece uma vez só por pedido).
//
// O event_id é o mesmo do navegador (src/lib/metaPixel.ts, purchaseEventId): a Meta junta
// os dois e conta uma venda. E-mail, telefone e id da conta vão só com hash SHA-256, como
// a Meta pede. IP e navegador vão sem hash (a Meta exige assim) e vêm do momento em que a
// pessoa abriu o pagamento (pix_payments.meta_tracking).
//
// Segredos (Supabase → Edge Functions → Secrets), nunca no repositório:
//   META_PIXEL_ID         id do conjunto de dados (Pixel); mais de um, separados por vírgula
//   META_CAPI_TOKEN       token da API de Conversões do PRIMEIRO Pixel da lista
//   META_CAPI_TOKEN_<id>  token de um Pixel específico (vale para qualquer um da lista)
//   META_TEST_EVENT_CODE  opcional: código da aba "Testar eventos", só enquanto testa
// Pixel sem token fica de fora; sem nenhum Pixel com token, nada é enviado.
//
// Nada aqui pode atrapalhar o pagamento: reportPurchaseToMeta nunca lança erro.
// Testado em tests/metaPixel.test.mjs (npm test), sem rede.

export const META_GRAPH_VERSION = 'v23.0';

/** Mesmo formato do navegador: é isso que evita contar a venda duas vezes. */
export const purchaseEventId = (paymentId: string) => `purchase_${paymentId}`;

export const PLAN_NAME: Record<string, string> = { monthly: 'VS Stage Pro Mensal', yearly: 'VS Stage Pro Anual' };

export type MetaTracking = { fbp?: string; fbc?: string; url?: string; ip?: string; ua?: string };

export type PurchaseInput = {
  paymentId: string;
  orderNsu: string;
  plan: string;
  /** Valor que a InfinitePay confirmou, em centavos. */
  amountCents: number;
  userId: string;
  email?: string | null;
  phone?: string | null;
  tracking?: MetaTracking | null;
  /** Segundos desde 1970 (a Meta recusa evento com mais de 7 dias). */
  eventTime: number;
};

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** E-mail como a Meta pede antes do hash: sem espaço e em minúsculas. */
export function normalizeEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** Telefone só com números e com o 55 do Brasil na frente. */
export function normalizePhoneBR(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{1,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,500}$/;
const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

/**
 * O que o navegador mandou ao abrir o pagamento, conferido: o corpo do pedido vem do
 * cliente, então só passa o que tem o formato certo e o endereço do próprio site.
 */
export function sanitizeTracking(raw: unknown, client: { ip?: string | null; ua?: string | null }, siteUrl: string): MetaTracking | null {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: MetaTracking = {};
  if (typeof t.fbp === 'string' && FBP_RE.test(t.fbp)) out.fbp = t.fbp;
  if (typeof t.fbc === 'string' && FBC_RE.test(t.fbc)) out.fbc = t.fbc;
  const site = siteUrl.replace(/\/+$/, '');
  if (typeof t.url === 'string' && t.url.length <= 500 && (t.url === site || t.url.startsWith(`${site}/`))) out.url = t.url;
  const ip = String(client.ip ?? '').split(',')[0].trim();
  if (IP_RE.test(ip)) out.ip = ip;
  const ua = String(client.ua ?? '').trim();
  if (ua) out.ua = ua.slice(0, 400);
  return Object.keys(out).length ? out : null;
}

export async function buildPurchaseEvent(p: PurchaseInput, siteUrl: string) {
  const email = normalizeEmail(p.email);
  const phone = normalizePhoneBR(p.phone);
  const t = p.tracking ?? {};
  const user_data: Record<string, unknown> = {
    external_id: [await sha256Hex(p.userId)],
  };
  if (email) user_data.em = [await sha256Hex(email)];
  if (phone) user_data.ph = [await sha256Hex(phone)];
  user_data.country = [await sha256Hex('br')];
  if (t.fbp) user_data.fbp = t.fbp;
  if (t.fbc) user_data.fbc = t.fbc;
  if (t.ip) user_data.client_ip_address = t.ip;
  if (t.ua) user_data.client_user_agent = t.ua;

  return {
    event_name: 'Purchase',
    event_time: Math.floor(p.eventTime),
    event_id: purchaseEventId(p.paymentId),
    action_source: 'website',
    event_source_url: t.url || `${siteUrl.replace(/\/+$/, '')}/`,
    user_data,
    custom_data: {
      currency: 'BRL',
      value: Math.round(p.amountCents) / 100,
      content_ids: [p.plan],
      content_name: PLAN_NAME[p.plan] ?? p.plan,
      content_type: 'product',
      num_items: 1,
      order_id: p.orderNsu,
    },
  };
}

export type MetaConfig = {
  pixelId: string;
  token: string;
  testEventCode?: string;
  siteUrl: string;
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** POST /{pixel}/events. O token vai no corpo, nunca no endereço (endereço vai para log). */
export async function sendMetaEvents(
  fetchFn: FetchLike, cfg: MetaConfig, events: unknown[], timeoutMs = 5000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const body: Record<string, unknown> = { data: events, access_token: cfg.token };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
  const res = await fetchFn(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(cfg.pixelId)}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 500) };
}

export type ReportDeps = {
  /** Um por Pixel com token. Lista vazia: nada é enviado. */
  configs: MetaConfig[];
  /** Pedido pago com o e-mail e o telefone da conta, ou null. */
  loadPurchase(orderNsu: string): Promise<Omit<PurchaseInput, 'eventTime'> | null>;
  fetch: FetchLike;
  now(): number;
  log(message: string, ...extra: unknown[]): void;
  error(message: string, ...extra: unknown[]): void;
};

/** Pixels da lista META_PIXEL_ID (separados por vírgula), válidos e sem repetir. */
export function metaPixelIdsFromEnv(get: (k: string) => string | undefined): string[] {
  const ids = String(get('META_PIXEL_ID') ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /^\d{6,20}$/.test(x));
  return [...new Set(ids)];
}

/**
 * Lê os segredos da Meta: um config por Pixel que tem token (META_CAPI_TOKEN_<id>, ou
 * META_CAPI_TOKEN para o primeiro da lista). Pixel sem token fica de fora.
 */
export function metaConfigFromEnv(get: (k: string) => string | undefined, siteUrl: string): MetaConfig[] {
  const testEventCode = (get('META_TEST_EVENT_CODE') ?? '').trim() || undefined;
  return metaPixelIdsFromEnv(get).flatMap((pixelId, i) => {
    const token = ((get(`META_CAPI_TOKEN_${pixelId}`) ?? '') || (i === 0 ? get('META_CAPI_TOKEN') ?? '' : '')).trim();
    return token ? [{ pixelId, token, testEventCode, siteUrl }] : [];
  });
}

/** Manda o Purchase de um pedido recém-liberado. Nunca lança: o pagamento já valeu. */
export async function reportPurchaseToMeta(deps: ReportDeps, orderNsu: string): Promise<'sent' | 'skipped' | 'failed'> {
  if (!deps.configs.length) return 'skipped';
  try {
    const p = await deps.loadPurchase(orderNsu);
    if (!p) {
      deps.error('meta-capi pedido nao encontrado', orderNsu);
      return 'failed';
    }
    const event = await buildPurchaseEvent({ ...p, eventTime: deps.now() / 1000 }, deps.configs[0].siteUrl);
    // O mesmo evento (mesmo event_id) para cada Pixel. Um que falhe não impede os outros.
    let ok = true;
    for (const cfg of deps.configs) {
      try {
        const r = await sendMetaEvents(deps.fetch, cfg, [event]);
        if (r.ok) deps.log('meta-capi purchase enviado', orderNsu, cfg.pixelId);
        else { ok = false; deps.error('meta-capi recusou', orderNsu, cfg.pixelId, r.status, r.body); }
      } catch (e) {
        ok = false;
        deps.error('meta-capi falhou', orderNsu, cfg.pixelId, e instanceof Error ? e.message : e);
      }
    }
    return ok ? 'sent' : 'failed';
  } catch (e) {
    deps.error('meta-capi falhou', orderNsu, e instanceof Error ? e.message : e);
    return 'failed';
  }
}
