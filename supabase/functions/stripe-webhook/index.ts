import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// Status do Stripe que liberam o programa. 'past_due' mantém o acesso enquanto o
// Stripe tenta cobrar de novo; se desistir, a assinatura vira 'canceled'/'unpaid'.
const ACTIVE = new Set(["active", "trialing", "past_due"]);

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const interval = sub.items.data[0]?.price?.recurring?.interval;
  const periodEnd = sub.items.data[0]?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const patch = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription: ACTIVE.has(sub.status) ? "active" : "canceled",
    plan: interval === "year" ? "yearly" : interval === "month" ? "monthly" : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };

  const userId = sub.metadata?.user_id;
  const query = admin.from("director_licenses").update(patch);
  const { error } = userId ? await query.eq("user_id", userId) : await query.eq("stripe_customer_id", customerId);
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) return new Response("missing_signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (e) {
    console.error("stripe-webhook signature", e);
    return new Response("invalid_signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          await syncSubscription(await stripe.subscriptions.retrieve(subId));

          // "Últimas vendas" só conta pagamento de fato confirmado pelo Stripe — nunca teste
          // grátis nem ativação manual do admin (essas não passam por aqui).
          if (session.payment_status === "paid") {
            const userId = session.metadata?.user_id ?? session.client_reference_id;
            const plan = session.metadata?.plan;
            if (userId && (plan === "monthly" || plan === "yearly")) {
              const { error } = await admin.from("completed_sales").insert({
                user_id: userId,
                stripe_checkout_session_id: session.id,
                stripe_subscription_id: subId,
                plan,
                amount_cents: session.amount_total ?? 0,
                currency: session.currency ?? "brl",
              });
              // Reentrega do Stripe reenvia o mesmo evento: ON CONFLICT via unique constraint
              // evita duplicar a venda; qualquer outro erro só é logado, não trava o webhook.
              if (error && error.code !== "23505") console.error("stripe-webhook completed_sales", error);
            }
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
    }
  } catch (e) {
    console.error("stripe-webhook", event.type, e);
    return new Response("handler_failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
