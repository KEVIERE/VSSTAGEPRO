// Cobrança da assinatura pela InfinitePay (Checkout Integrado).
//   { action: 'create', plan, couponCode? } → cria o LINK de pagamento (vale 30 minutos)
//   { action: 'status', id }                → a tela consulta até o pagamento ser confirmado
//   { action: 'latest' }                    → último pagamento da conta (página de volta de link antigo)
// 'status' e 'latest' aceitam também transaction_nsu, slug e order_nsu: são os
// códigos que a InfinitePay põe no endereço da página de volta. Com eles a
// confirmação sai na hora, sem esperar o aviso automático.
//
// Diferença em relação ao Asaas: a InfinitePay não devolve QR Code nem
// copia-e-cola. Ela devolve uma URL de checkout para onde o cliente é enviado,
// e lá ele escolhe PIX ou cartão. A confirmação principal chega pelo webhook
// (infinitepay-webhook); o 'status' também confere direto, para liberar mesmo
// se um aviso se perder.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.57.4';
import { InfinitePayError, infinitePayClient } from '../_shared/infinitepay.ts';
import {
  MIN_PIX_CENTS, PIX_PLANS, type Plan, discountedCents, pixLinkExpiresAt, reusableLink, statusCheckPlan,
} from '../_shared/pix.ts';
import { applyPaymentByOrder, setInfinitePayIds } from '../_shared/pixDb.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const API_KEY = Deno.env.get('INFINITEPAY_API_KEY') ?? '';
const HANDLE = Deno.env.get('INFINITEPAY_HANDLE') ?? '';
// Onde o cliente volta depois de pagar, e para onde a InfinitePay avisa.
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://vsstagepro.com.br';
const WEBHOOK_URL = Deno.env.get('INFINITEPAY_WEBHOOK_URL') ?? '';
const infinitepay = infinitePayClient(API_KEY);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// Com o link aberto há tempo, a tela pergunta à InfinitePay no máximo a cada 15 s.
const RECHECK_MS = 15_000;
// Quando a página de volta traz os códigos da InfinitePay que ainda não temos,
// pergunta logo (no máximo a cada 3 s): com eles a confirmação sai na hora.
const RECHECK_WITH_IDS_MS = 3_000;
// Página de volta sem pedido no endereço (link antigo): olha o último pagamento de até 1 dia.
const LATEST_WINDOW_MS = 24 * 3600_000;

const UUID_RE = /^[0-9a-f-]{36}$/i;
// Códigos da InfinitePay vindos do endereço da página de volta (o cliente pode mexer neles).
const SAFE_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const safeId = (v: unknown) => (typeof v === 'string' && SAFE_ID_RE.test(v) ? v : undefined);

type PixRow = {
  id: string; user_id: string; plan: Plan; amount_cents: number; status: string;
  provider: string | null; checkout_url: string | null; order_nsu: string | null;
  transaction_nsu: string | null; invoice_slug: string | null;
  expires_at: string; checked_at: string | null; access_until: string | null;
};

/** Códigos da InfinitePay que a página de volta recebeu no endereço. */
type Ids = { transactionNsu?: string; slug?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** O que a tela recebe. `checkoutUrl` é o que ela abre em vez de desenhar um QR Code. */
function view(row: PixRow) {
  const pending = row.status === 'pending';
  return {
    id: row.id,
    plan: row.plan,
    amount_cents: row.amount_cents,
    status: row.status,
    expires_at: row.expires_at,
    access_until: row.access_until,
    checkout_url: pending ? row.checkout_url : null,
    // Hora do servidor: a contagem regressiva da tela não depende do relógio do computador.
    now: new Date().toISOString(),
  };
}

/**
 * O pagamento vale como confirmado?
 *
 * O webhook da InfinitePay não tem assinatura, então o aviso sozinho não prova
 * nada: qualquer um poderia forjar um POST dizendo que o pedido foi pago. A
 * confirmação de verdade é esta consulta: o atacante pode inventar um aviso,
 * mas não consegue obrigar a InfinitePay a responder "pago".
 *
 * O /payment_check precisa do transaction_nsu e do slug, que chegam pelo aviso
 * ou no endereço da página de volta. Os da página de volta só são usados quando
 * ainda não temos os do aviso, e só são guardados se a InfinitePay confirmar.
 */
async function confirmado(row: PixRow, ids?: Ids): Promise<{ pago: boolean; valor: number | null }> {
  const orderNsu = row.order_nsu!;
  const transactionNsu = row.transaction_nsu ?? ids?.transactionNsu;
  const slug = row.invoice_slug ?? ids?.slug;

  const r = await infinitepay.conferirPagamento({
    handle: HANDLE || undefined,
    order_nsu: orderNsu,
    transaction_nsu: transactionNsu ?? undefined,
    slug: slug ?? undefined,
  });

  if (!r.paid) return { pago: false, valor: null };
  // Confirmado com os códigos da página de volta: guarda, agora que valem.
  if (transactionNsu !== (row.transaction_nsu ?? undefined) || slug !== (row.invoice_slug ?? undefined)) {
    await setInfinitePayIds(admin, orderNsu, transactionNsu ?? null, slug ?? null)
      .catch((e) => console.error('pix-checkout ids', orderNsu, e instanceof Error ? e.message : e));
  }
  // `paid_amount` pode ser maior que `amount` quando o cliente parcela com as
  // taxas repassadas: vale o que ele pagou, não o valor combinado.
  return { pago: true, valor: Math.round(r.paid_amount ?? r.amount ?? 0) };
}

const nowIso = () => new Date().toISOString();

async function markClosed(id: string, status: 'expired' | 'canceled') {
  await admin.from('pix_payments').update({ status, updated_at: nowIso() }).eq('id', id).eq('status', 'pending');
}

/**
 * Atualiza a situação do pedido: pergunta à InfinitePay quando precisa (ver
 * statusCheckPlan) e, passado o prazo de 30 min sem pagamento, marca como vencido.
 */
async function refresh(row: PixRow, ids?: Ids): Promise<PixRow> {
  const newIds = (!!ids?.transactionNsu && !row.transaction_nsu) || (!!ids?.slug && !row.invoice_slug);
  const plan = statusCheckPlan(row, Date.now(), newIds ? RECHECK_WITH_IDS_MS : RECHECK_MS);
  if (!plan.check) return row;

  await admin.from('pix_payments').update({ checked_at: nowIso() }).eq('id', row.id);
  try {
    const c = await confirmado(row, ids);
    if (c.pago) await applyPaymentByOrder(admin, row.order_nsu!, c.valor);
    else if (plan.expire) await markClosed(row.id, 'expired');
  } catch (e) {
    console.error('pix-checkout status', row.order_nsu, e);
    // InfinitePay fora do ar e o prazo acabou: a tela mostra vencido; se o
    // pagamento for confirmado depois, o webhook ainda libera o acesso.
    if (plan.expire) await markClosed(row.id, 'expired');
  }
  return (await loadRowById(row.id)) ?? row;
}

// Cobranças ligadas: a chave cadastrada e a tabela criada (migração aplicada).
let availableCache: { value: boolean; at: number } | null = null;
async function pixAvailable(): Promise<boolean> {
  if (!API_KEY && !HANDLE) return false;
  if (availableCache && Date.now() - availableCache.at < 60_000) return availableCache.value;
  const { error } = await admin.from('pix_payments').select('order_nsu', { head: true }).limit(1);
  availableCache = { value: !error, at: Date.now() };
  if (error) console.error('pix-checkout available', error.message);
  return availableCache.value;
}

async function loadRow(id: string, userId: string): Promise<PixRow | null> {
  const { data, error } = await admin.from('pix_payments').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data as PixRow | null;
}

async function loadRowById(id: string): Promise<PixRow | null> {
  const { data, error } = await admin.from('pix_payments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as PixRow | null;
}

async function create(user: User, body: Record<string, unknown>) {
  const plan = body.plan;
  if (plan !== 'monthly' && plan !== 'yearly') return json({ error: 'invalid_plan' }, 400);

  const { data: lic, error: licErr } = await admin
    .from('director_licenses')
    .select('subscription, blocked')
    .eq('user_id', user.id)
    .maybeSingle();
  if (licErr) throw licErr;
  if (lic?.blocked) return json({ error: 'blocked' }, 403);
  // assinatura no cartão (Stripe) já ativa: não cobra de novo
  if (lic?.subscription === 'active') return json({ error: 'already_active' }, 409);

  // Cupom: confere no nosso banco, nunca confia no desconto que a tela diz ter
  let couponCode: string | null = null;
  let percent = 0;
  if (body.couponCode) {
    couponCode = String(body.couponCode).trim().toUpperCase();
    const { data: check, error: checkErr } = await admin.rpc('discount_check', { p_code: couponCode });
    if (checkErr || !check?.valid || !check?.percent) return json({ error: 'invalid_coupon' }, 400);
    percent = Number(check.percent);
  }
  const amount = discountedCents(PIX_PLANS[plan].cents, percent);
  if (amount < MIN_PIX_CENTS) return json({ error: 'amount_too_low' }, 400);

  // Link igual ainda aberto (mesmo plano e valor) e com pelo menos 10 min pela
  // frente: reaproveita em vez de gerar outro (ver reusableLink).
  const { data: openRows, error: openErr } = await admin
    .from('pix_payments').select('*').eq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false });
  if (openErr) throw openErr;
  const open = (openRows ?? []) as PixRow[];
  const reuse = reusableLink(open, plan, amount, Date.now());
  if (reuse) return json(view(reuse));
  // Só um link pagável por vez: os outros desta conta deixam de valer aqui.
  // (A InfinitePay não permite cancelar um link pela API; ele apenas expira.
  // Se alguém pagar um link trocado, o pagamento ainda é liberado.)
  for (const r of open) {
    // Já chegou aviso deste link (temos os códigos): antes de trocar, confere se
    // foi pago. Ex.: a pessoa pagou e recarregou a página antes da liberação.
    if (r.order_nsu && r.transaction_nsu && r.invoice_slug) {
      try {
        const c = await confirmado(r);
        if (c.pago) {
          await applyPaymentByOrder(admin, r.order_nsu, c.valor);
          const done = await loadRow(r.id, user.id);
          if (done && done.status !== 'pending') return json(view(done));
        }
      } catch (e) {
        console.error('pix-checkout create check', r.order_nsu, e);
      }
    }
    await markClosed(r.id, Date.parse(r.expires_at) <= Date.now() ? 'expired' : 'canceled');
  }

  const expiresAt = pixLinkExpiresAt(new Date());
  const orderNsu = `vs-${user.id.slice(0, 8)}-${Date.now()}`;

  const { data: inserted, error: insErr } = await admin
    .from('pix_payments')
    .insert({
      user_id: user.id, plan, amount_cents: amount, coupon_code: couponCode,
      expires_at: expiresAt.toISOString(), provider: 'infinitepay', order_nsu: orderNsu,
    })
    .select('*')
    .single();
  if (insErr) throw insErr;
  const row = inserted as PixRow;

  try {
    const link = await infinitepay.criarLink({
      handle: HANDLE || undefined,
      items: [{
        quantity: 1,
        price: amount,
        description: PIX_PLANS[plan].description + (couponCode ? ` — cupom ${couponCode}` : ''),
      }],
      order_nsu: orderNsu,
      // A página de volta confere este pedido sozinha. A InfinitePay acrescenta
      // order_nsu, transaction_nsu e slug ao endereço.
      redirect_url: `${SITE_URL}/?pagamento=${row.id}#assinatura`,
      webhook_url: WEBHOOK_URL || undefined,
      customer: {
        name: String(user.user_metadata?.name ?? '').trim() || undefined,
        email: user.email ?? undefined,
      },
      options: {
        // Um pagamento por link: depois de pago, ele não pode ser reaproveitado.
        single_payment: true,
        // O cliente escolhe entre PIX e cartão na página deles.
        payment_methods_enabled: ['credit_card', 'pix'],
        // O link vence junto com o nosso controle de prazo (30 minutos).
        valid_until: expiresAt.toISOString(),
      },
    });

    const { data: saved, error: upErr } = await admin
      .from('pix_payments')
      .update({ checkout_url: link.url, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    const { error: intentErr } = await admin.from('checkout_intents').insert({
      user_id: user.id, provider: 'infinitepay', pix_payment_id: row.id, plan, coupon_code: couponCode, amount_cents: amount,
    });
    if (intentErr) console.error('pix-checkout intent', intentErr);

    return json(view(saved as PixRow));
  } catch (e) {
    await admin.from('pix_payments').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', row.id);
    throw e;
  }
}

/** Códigos da página de volta. Só valem se o pedido que veio junto for este. */
function returnIds(row: PixRow, body: Record<string, unknown>): Ids | undefined {
  const transactionNsu = safeId(body.transaction_nsu);
  const slug = safeId(body.slug);
  if (!transactionNsu && !slug) return undefined;
  const orderNsu = safeId(body.order_nsu);
  if (orderNsu && orderNsu !== row.order_nsu) return undefined;
  return { transactionNsu, slug };
}

async function status(user: User, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  if (!UUID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const row = await loadRow(id, user.id);
  if (!row) return json({ error: 'not_found' }, 404);
  return json(view(await refresh(row, returnIds(row, body))));
}

/** Página de volta de um link sem o nosso código no endereço (gerado antes desta versão):
 *  o pedido que a InfinitePay informou ou, sem ele, o último pagamento da conta (até 1 dia). */
async function latest(user: User, body: Record<string, unknown>) {
  const orderNsu = safeId(body.order_nsu);
  let q = admin.from('pix_payments').select('*').eq('user_id', user.id);
  q = orderNsu ? q.eq('order_nsu', orderNsu) : q.gte('created_at', new Date(Date.now() - LATEST_WINDOW_MS).toISOString());
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: 'not_found' }, 404);
  const row = data as PixRow;
  return json(view(await refresh(row, returnIds(row, body))));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }

  if (!(await pixAvailable().catch(() => false))) return json({ error: 'pix_not_configured' }, 503);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth.user) return json({ error: 'unauthorized' }, 401);

  try {
    if (body.action === 'create') return await create(auth.user, body);
    if (body.action === 'status') return await status(auth.user, body);
    if (body.action === 'latest') return await latest(auth.user, body);
    return json({ error: 'invalid_action' }, 400);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('pix-checkout', body.action, detail);
    const status = e instanceof InfinitePayError ? e.status : 500;
    return json({ error: 'pix_failed', detail }, status === 403 ? 403 : 500);
  }
});
