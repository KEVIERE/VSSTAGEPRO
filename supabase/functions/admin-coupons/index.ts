import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Backoffice: cria/desativa cupons de desconto nativos do Stripe.
//  - action "create":      cria um stripe.coupons (percent_off) + stripe.promotionCodes
//    com o mesmo texto que o admin digitou, para o cliente usar direto no checkout.
//  - action "deactivate":  desativa o promotion code no Stripe (ex.: quando o admin
//    apaga/desativa o código correspondente em promo_codes).
// Confere admin via RPC (mesma regra de app_admins usada no resto do backoffice).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});

async function callerIsAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user?.id) return false;
  const { data: isAdminData, error } = await asUser.rpc("is_admin");
  if (error) return false;
  return isAdminData === true;
}

async function create(req: Request, body: Record<string, unknown>) {
  if (!(await callerIsAdmin(req))) return json({ error: "not_allowed" }, 403);

  const code = String(body.code ?? "").trim().toUpperCase();
  const percent = Number(body.percent);
  const maxUses = body.maxUses != null ? Number(body.maxUses) : null;
  const expiresAt = body.expiresAt ? String(body.expiresAt) : null;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Number.isFinite(percent) || percent < 1 || percent > 100) {
    return json({ error: "invalid_value" }, 400);
  }

  const coupon = await stripe.coupons.create({
    percent_off: percent,
    duration: "once",
    name: `VS Stage — ${code}`,
    ...(maxUses ? { max_redemptions: maxUses } : {}),
    ...(expiresAt ? { redeem_by: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
  });

  const promotionCode = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code,
    ...(maxUses ? { max_redemptions: maxUses } : {}),
    ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
  });

  return json({ ok: true, stripeCouponId: coupon.id, stripePromotionCodeId: promotionCode.id });
}

async function deactivate(req: Request, body: Record<string, unknown>) {
  if (!(await callerIsAdmin(req))) return json({ error: "not_allowed" }, 403);

  const id = String(body.stripePromotionCodeId ?? "");
  if (!id) return json({ error: "invalid_value" }, 400);
  await stripe.promotionCodes.update(id, { active: false });
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  try {
    if (body.action === "create") return await create(req, body);
    if (body.action === "deactivate") return await deactivate(req, body);
    return json({ error: "invalid_action" }, 400);
  } catch (e) {
    console.error("admin-coupons", e);
    return json({ error: "request_failed" }, 500);
  }
});
