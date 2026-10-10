import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Valores em centavos (BRL).
const PLANS = {
  monthly: { amount: 5500, interval: "month", name: "VS Stage Pro — Plano Mensal" },
  yearly: { amount: 59900, interval: "year", name: "VS Stage Pro — Plano Anual" },
} as const;

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://vsstage-pro-showonline.bolt.host").replace(/\/+$/, "");

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !auth.user) return json({ error: "unauthorized" }, 401);
  const user = auth.user;

  let plan: keyof typeof PLANS;
  let couponCode: string | null = null;
  try {
    const body = await req.json();
    if (body?.plan !== "monthly" && body?.plan !== "yearly") return json({ error: "invalid_plan" }, 400);
    plan = body.plan;
    if (body?.couponCode) couponCode = String(body.couponCode).trim().toUpperCase();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  // Confere o cupom direto no nosso banco (fonte da verdade sobre validade/expiração/uso),
  // e só então aplica o promotion_code correspondente no Stripe — nunca confia no que
  // o cliente diz ter digitado sem essa validação server-side.
  let promotionCodeId: string | null = null;
  if (couponCode) {
    const { data: check, error: checkErr } = await admin.rpc("discount_check", { p_code: couponCode });
    if (checkErr || !check?.valid || !check?.stripe_promotion_code_id) return json({ error: "invalid_coupon" }, 400);
    promotionCodeId = check.stripe_promotion_code_id as string;
  }

  try {
    const { data: row } = await admin
      .from("director_licenses")
      .select("stripe_customer_id, subscription")
      .eq("user_id", user.id)
      .maybeSingle();

    if (row?.subscription === "active") return json({ error: "already_active" }, 409);

    let customerId = row?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: (user.user_metadata?.name as string | undefined) ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error: saveErr } = row
        ? await admin.from("director_licenses").update({ stripe_customer_id: customerId }).eq("user_id", user.id)
        : await admin.from("director_licenses").insert({
          user_id: user.id,
          trial_started_at: new Date().toISOString(),
          stripe_customer_id: customerId,
        });
      if (saveErr) throw saveErr;
    }

    const p = PLANS[plan];
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      locale: "pt-BR",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "brl",
          unit_amount: p.amount,
          recurring: { interval: p.interval },
          product_data: { name: p.name },
        },
      }],
      subscription_data: { metadata: { user_id: user.id, plan, ...(couponCode ? { coupon_code: couponCode } : {}) } },
      metadata: { user_id: user.id, plan, ...(couponCode ? { coupon_code: couponCode } : {}) },
      ...(promotionCodeId ? { discounts: [{ promotion_code: promotionCodeId }] } : {}),
      success_url: `${SITE_URL}/#assinatura-ok`,
      cancel_url: `${SITE_URL}/#assinatura-cancelada`,
    });

    // Registra a intenção de venda assim que o checkout é aberto — ainda não é uma venda,
    // mas já mostra quem demonstrou interesse real (ao contrário de quem só olhou a página).
    const { error: intentErr } = await admin.from("checkout_intents").insert({
      user_id: user.id,
      stripe_checkout_session_id: session.id,
      plan,
      coupon_code: couponCode,
      amount_cents: p.amount,
    });
    if (intentErr) console.error("stripe-checkout intent", intentErr);

    return json({ url: session.url });
  } catch (e) {
    console.error("stripe-checkout", e);
    return json({ error: "checkout_failed" }, 500);
  }
});
