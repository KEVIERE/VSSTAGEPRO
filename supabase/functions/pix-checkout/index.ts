// PIX da assinatura (Asaas).
//   { action: 'create', plan, cpfCnpj?, couponCode? } → gera o PIX (QR Code + copia e cola) com o valor certo
//   { action: 'status', id }                           → a tela consulta até o pagamento ser confirmado
// A confirmação principal vem do aviso do Asaas (asaas-webhook). O 'status' também confere direto no
// Asaas de tempos em tempos, para liberar mesmo se um aviso se perder.
import { createClient, type User } from 'npm:@supabase/supabase-js@2.57.4';
import { AsaasError, asaasClient } from '../_shared/asaas.ts';
import {
  MIN_PIX_CENTS, PIX_PLANS, type Plan, asaasPaymentKind, centsFromReais, discountedCents, isValidCpfCnpj, onlyDigits,
  pixDueDate,
} from '../_shared/pix.ts';
import { applyPixPayment, closePendingPix } from '../_shared/pixDb.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const API_KEY = Deno.env.get('ASAAS_API_KEY') ?? '';
const WEBHOOK_TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '';
const asaas = asaasClient(API_KEY, Deno.env.get('ASAAS_ENV'));
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

// Com o PIX aberto há tempo, a tela pergunta ao Asaas no máximo a cada 15 s.
const RECHECK_MS = 15_000;
// PIX aberto é reaproveitado se ainda faltar pelo menos isso para vencer.
const REUSE_MARGIN_MS = 15 * 60_000;

type PixRow = {
  id: string; user_id: string; plan: Plan; amount_cents: number; status: string;
  asaas_payment_id: string | null; pix_payload: string | null; pix_qr_image: string | null;
  expires_at: string; checked_at: string | null; access_until: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** O que a tela recebe: QR Code e copia e cola só enquanto o PIX está aguardando pagamento. */
function view(row: PixRow) {
  const pending = row.status === 'pending';
  return {
    id: row.id,
    plan: row.plan,
    amount_cents: row.amount_cents,
    status: row.status,
    expires_at: row.expires_at,
    access_until: row.access_until,
    payload: pending ? row.pix_payload : null,
    image: pending ? row.pix_qr_image : null,
  };
}

// PIX ligado: as duas chaves cadastradas e a tabela criada (migração aplicada).
let availableCache: { value: boolean; at: number } | null = null;
async function pixAvailable(): Promise<boolean> {
  if (!API_KEY || !WEBHOOK_TOKEN) return false;
  if (availableCache && Date.now() - availableCache.at < 60_000) return availableCache.value;
  const { error } = await admin.from('pix_payments').select('id', { head: true }).limit(1);
  availableCache = { value: !error, at: Date.now() };
  if (error) console.error('pix-checkout available', error.message);
  return availableCache.value;
}

async function loadRow(id: string, userId: string): Promise<PixRow | null> {
  const { data, error } = await admin.from('pix_payments').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data as PixRow | null;
}

/** Apaga no Asaas (o QR Code deixa de valer) e fecha aqui. Se o PIX já tiver sido pago, o Asaas
 *  recusa apagar e o aviso de pago ainda libera o tempo normalmente. */
async function cancelOpen(row: PixRow) {
  if (row.asaas_payment_id) {
    try { await asaas.deletePayment(row.asaas_payment_id); } catch (e) { console.error('pix-checkout delete', row.asaas_payment_id, e); }
    await closePendingPix(admin, row.asaas_payment_id, 'canceled');
  } else {
    await admin.from('pix_payments').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'pending');
  }
}

async function create(user: User, body: Record<string, unknown>) {
  const plan = body.plan;
  if (plan !== 'monthly' && plan !== 'yearly') return json({ error: 'invalid_plan' }, 400);

  const { data: lic, error: licErr } = await admin
    .from('director_licenses')
    .select('subscription, blocked, asaas_customer_id')
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

  // PIX igual ainda aberto (mesmo plano e valor): mostra o mesmo QR Code em vez de gerar outro
  const { data: openRows, error: openErr } = await admin
    .from('pix_payments').select('*').eq('user_id', user.id).eq('status', 'pending').order('created_at', { ascending: false });
  if (openErr) throw openErr;
  const open = (openRows ?? []) as PixRow[];
  const reuse = open.find((r) =>
    r.plan === plan && r.amount_cents === amount && r.asaas_payment_id && r.pix_payload &&
    Date.parse(r.expires_at) - Date.now() > REUSE_MARGIN_MS
  );
  if (reuse) return json(view(reuse));
  // Só um QR Code pagável por vez: os outros PIX abertos desta conta deixam de valer
  for (const r of open) await cancelOpen(r);

  // Cliente no Asaas (o CPF/CNPJ fica guardado só lá)
  let customerId = (lic?.asaas_customer_id as string | null | undefined) ?? null;
  if (!customerId) {
    const doc = onlyDigits(body.cpfCnpj);
    if (!doc) return json({ error: 'cpf_required' }, 400);
    if (!isValidCpfCnpj(doc)) return json({ error: 'invalid_cpf' }, 400);
    const name = String(user.user_metadata?.name ?? '').trim() || (user.email ?? '').split('@')[0] || 'Cliente VS Stage';
    const customer = await asaas.createCustomer({ name, email: user.email, cpfCnpj: doc, externalReference: user.id });
    customerId = customer.id;
    const { error: saveErr } = lic
      ? await admin.from('director_licenses').update({ asaas_customer_id: customerId }).eq('user_id', user.id)
      : await admin.from('director_licenses').insert({
        user_id: user.id, trial_started_at: new Date().toISOString(), asaas_customer_id: customerId,
      });
    if (saveErr) throw saveErr;
  }

  const { dueDate, expiresAt } = pixDueDate(new Date());
  const { data: inserted, error: insErr } = await admin
    .from('pix_payments')
    .insert({ user_id: user.id, plan, amount_cents: amount, coupon_code: couponCode, expires_at: expiresAt.toISOString() })
    .select('*')
    .single();
  if (insErr) throw insErr;
  const row = inserted as PixRow;

  let asaasId: string | null = null;
  try {
    const pay = await asaas.createPixPayment({
      customer: customerId,
      value: amount / 100,
      dueDate,
      description: PIX_PLANS[plan].description + (couponCode ? ` — cupom ${couponCode}` : ''),
      externalReference: row.id,
    });
    asaasId = pay.id;
    const qr = await asaas.getPixQrCode(pay.id);
    const { data: saved, error: upErr } = await admin
      .from('pix_payments')
      .update({ asaas_payment_id: pay.id, pix_payload: qr.payload, pix_qr_image: qr.encodedImage, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single();
    if (upErr) throw upErr;

    const { error: intentErr } = await admin.from('checkout_intents').insert({
      user_id: user.id, provider: 'asaas', pix_payment_id: row.id, plan, coupon_code: couponCode, amount_cents: amount,
    });
    if (intentErr) console.error('pix-checkout intent', intentErr);

    return json(view(saved as PixRow));
  } catch (e) {
    await admin.from('pix_payments').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('id', row.id);
    if (asaasId) await asaas.deletePayment(asaasId).catch(() => {});
    // cliente que não existe mais no Asaas (ex.: troca da chave de testes pela de produção): pede o CPF de novo
    if (e instanceof AsaasError && /customer/i.test(e.code) && lic?.asaas_customer_id) {
      await admin.from('director_licenses').update({ asaas_customer_id: null }).eq('user_id', user.id);
      return json({ error: 'cpf_required' }, 400);
    }
    throw e;
  }
}

async function status(user: User, body: Record<string, unknown>) {
  const id = String(body.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'not_found' }, 404);
  let row = await loadRow(id, user.id);
  if (!row) return json({ error: 'not_found' }, 404);

  if (row.status === 'pending' && row.asaas_payment_id) {
    const expired = Date.parse(row.expires_at) <= Date.now();
    const stale = !row.checked_at || Date.now() - Date.parse(row.checked_at) > RECHECK_MS;
    if (expired || stale) {
      await admin.from('pix_payments').update({ checked_at: new Date().toISOString() }).eq('id', row.id);
      try {
        const pay = await asaas.getPayment(row.asaas_payment_id);
        const kind = asaasPaymentKind(pay);
        if (kind === 'paid') {
          await applyPixPayment(admin, pay.id, centsFromReais(pay.value));
        } else if (kind === 'deleted') {
          await closePendingPix(admin, row.asaas_payment_id, 'canceled');
        } else if (expired && (await closePendingPix(admin, row.asaas_payment_id, 'expired'))) {
          await asaas.deletePayment(row.asaas_payment_id).catch((e) => console.error('pix-checkout delete', e));
        }
      } catch (e) {
        console.error('pix-checkout status', row.asaas_payment_id, e);
        // Asaas fora do ar e o prazo acabou: a tela mostra vencido; se o PIX for pago, o aviso ainda libera
        if (expired) await closePendingPix(admin, row.asaas_payment_id, 'expired');
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
    const code = e instanceof AsaasError && e.code === 'invalid_cpfCnpj' ? 'invalid_cpf' : 'pix_failed';
    return json({ error: code, detail }, code === 'invalid_cpf' ? 400 : 500);
  }
});
