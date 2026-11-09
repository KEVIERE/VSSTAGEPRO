// Cobrança da assinatura pela InfinitePay (Checkout Integrado).
//   { action: 'create', plan, couponCode? } → cria o LINK de pagamento
//   { action: 'status', id }                → a tela consulta até o pagamento ser confirmado
//
// Diferença em relação ao Asaas: a InfinitePay não devolve QR Code nem
// copia-e-cola. Ela devolve uma URL de checkout para onde o cliente é enviado,
// e lá ele escolhe PIX ou cartão. A confirmação principal chega pelo webhook
// (infinitepay-webhook); o 'status' também confere direto, para liberar mesmo
// se um aviso se perder.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.57.4';
import { InfinitePayError, infinitePayClient } from '../_shared/infinitepay.ts';
import { MIN_PIX_CENTS, PIX_PLANS, type Plan, discountedCents, pixDueDate } from '../_shared/pix.ts';
import { applyPaymentByOrder } from '../_shared/pixDb.ts';

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
// Link aberto é reaproveitado se ainda faltar pelo menos isso para vencer.
const REUSE_MARGIN_MS = 15 * 60_000;

type PixRow = {
  id: string; user_id: string; plan: Plan; amount_cents: number; status: string;
  provider: string | null; checkout_url: string | null; order_nsu: string | null;
  transaction_nsu: string | null; invoice_slug: string | null;
  expires_at: string; checked_at: string | null; access_until: string | null;
};

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
  };
}

/**
 * O pagamento vale como confirmado?
 *
 * O webhook da InfinitePay não tem assinatura, então o aviso sozinho não prova
 * nada: qualquer um poderia forjar um POST dizendo que o pedido foi pago. A
 * confirmação de verdade é esta consulta — o atacante pode inventar um aviso,
 * mas não consegue obrigar a InfinitePay a responder "pago".
 */
async function confirmado(orderNsu: string): Promise<{ pago: boolean; valor: number | null }> {
  const { data: row } = await admin
    .from('pix_payments')
    .select('transaction_nsu, invoice_slug')
    .eq('order_nsu', orderNsu)
    .maybeSingle();

  const r = await infinitepay.conferirPagamento({
    handle: HANDLE || undefined,
    order_nsu: orderNsu,
    transaction_nsu: (row?.transaction_nsu as string | null) ?? undefined,
    slug: (row?.invoice_slug as string | null) ?? undefined,
  });

  if (!r.paid) return { pago: false, valor: null };
  // `paid_amount` pode ser maior que `amount` quando o cliente parcela com as
  // taxas repassadas: vale o que ele pagou, não o valor combinado.
  return { pago: true, valor: Math.round(r.paid_amount ?? r.amount ?? 0) };
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

  // Link igual ainda aberto (mesmo plano e valor): reaproveita em vez de gerar outro
  const { data: openRows, error: openErr } = await admin
    .from('pix_payments').select('*').eq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false });
  if (openErr) throw openErr;
  const open = (openRows ?? []) as PixRow[];
  const reuse = open.find((r) =>
    r.plan === plan && r.amount_cents === amount && r.checkout_url &&
    Date.parse(r.expires_at) - Date.now() > REUSE_MARGIN_MS
  );
  if (reuse) return json(view(reuse));
  // Só um link pagável por vez: os outros desta conta deixam de valer aqui.
  // (A InfinitePay não permite cancelar um link pela API; ele apenas expira.)
  for (const r of open) {
    await admin.from('pix_payments').update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'pending');
  }

  const { expiresAt } = pixDueDate(new Date());
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
      redirect_url: `${SITE_URL}/#assinatura`,
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
        // O link vence junto com o nosso controle de prazo.
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

async function status(user: User, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'not_found' }, 404);
  let row = await loadRow(id, user.id);
  if (!row) return json({ error: 'not_found' }, 404);

  if (row.status === 'pending' && row.order_nsu) {
    const expired = Date.parse(row.expires_at) <= Date.now();
    const stale = !row.checked_at || Date.now() - Date.parse(row.checked_at) > RECHECK_MS;
    if (expired || stale) {
      await admin.from('pix_payments').update({ checked_at: new Date().toISOString() }).eq('id', row.id);
      try {
        const c = await confirmado(row.order_nsu);
        if (c.pago) {
          await applyPaymentByOrder(admin, row.order_nsu, c.valor);
        } else if (expired) {
          await admin.from('pix_payments').update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', row.id).eq('status', 'pending');
        }
      } catch (e) {
        console.error('pix-checkout status', row.order_nsu, e);
        // InfinitePay fora do ar e o prazo acabou: a tela mostra vencido; se o
        // pagamento for confirmado depois, o webhook ainda libera o acesso.
        if (expired) {
          await admin.from('pix_payments').update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', row.id).eq('status', 'pending');
        }
      }
      row = (await loadRow(id, user.id)) ?? row;
    }
  }
  return json(view(row));
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
    return json({ error: 'invalid_action' }, 400);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('pix-checkout', body.action, detail);
    const status = e instanceof InfinitePayError ? e.status : 500;
    return json({ error: 'pix_failed', detail }, status === 403 ? 403 : 500);
  }
});
