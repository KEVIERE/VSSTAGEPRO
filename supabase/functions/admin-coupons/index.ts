import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Backoffice: cupons de desconto. NÃO fala mais com o Stripe.
//
// O desconto vale no pagamento pela InfinitePay (PIX e cartão): o pix-checkout confere o
// cupom em promo_codes e já gera o link com o valor descontado. Por isso nada precisa ser
// criado fora do nosso banco.
//
// A tela nova cria o cupom direto pela RPC admin_discount_create e não chama esta função.
// Ela continua no ar só para a tela antiga do admin, que chama "create" antes de gravar o
// cupom e "deactivate" ao desligar:
//  - action "create":     confere admin, código e percentual (1 a 90) e se o código está
//    livre. Não grava nada: quem grava é o admin_promo_create logo em seguida. Devolve os
//    campos stripe* vazios, como a tela antiga espera.
//  - action "deactivate": não há nada fora do banco para desligar. O cupom deixa de valer
//    quando a tela desliga ou apaga o código em promo_codes.
// Pode ser despublicada quando a tela nova do admin estiver no ar.

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

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
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
  // Até 90%: acima disso o valor cairia abaixo do mínimo de cobrança (R$ 5,00).
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !Number.isInteger(percent) || percent < 1 || percent > 90) {
    return json({ error: "invalid_value" }, 400);
  }

  const [{ data: promo }, { data: aff }] = await Promise.all([
    admin.from("promo_codes").select("code").eq("code", code).maybeSingle(),
    admin.from("affiliates").select("code").eq("code", code).maybeSingle(),
  ]);
  if (promo || aff) return json({ error: "promo_exists" }, 409);

  return json({ ok: true, stripeCouponId: null, stripePromotionCodeId: null });
}

async function deactivate(req: Request) {
  if (!(await callerIsAdmin(req))) return json({ error: "not_allowed" }, 403);
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
    if (body.action === "deactivate") return await deactivate(req);
    return json({ error: "invalid_action" }, 400);
  } catch (e) {
    console.error("admin-coupons", e);
    return json({ error: "request_failed" }, 500);
  }
});
