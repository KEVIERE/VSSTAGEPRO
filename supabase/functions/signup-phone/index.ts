import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Cadastro com confirmação por SMS.
//  - action "start":   cria a conta (ainda não confirmada) e envia um código de 6 dígitos por SMS.
//  - action "confirm": confere o código e confirma a conta; depois o app entra com e-mail e senha.
// A confirmação por e-mail usa o fluxo nativo do Supabase (signUp + verifyOtp) direto no app.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+[1-9]\d{9,14}$/;

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hashCode = (userId: string, code: string) =>
  sha256(`${userId}:${code}:${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`);

function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

async function sendSms(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  const service = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!sid || !token || (!from && !service)) throw new Error("sms_not_configured");

  const form = new URLSearchParams({ To: to, Body: body });
  if (service) form.set("MessagingServiceSid", service);
  else form.set("From", from!);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  if (!res.ok) {
    console.error("twilio", res.status, await res.text());
    throw new Error("sms_failed");
  }
}

async function findUser(email: string) {
  const { data, error } = await admin.rpc("_auth_user_by_email", { p_email: email });
  if (error) throw error;
  return (data as Array<{ id: string; email_confirmed_at: string | null; raw_user_meta_data: Record<string, unknown> }>)[0] ?? null;
}

async function start(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim().slice(0, 60);
  const phone = String(body.phone ?? "").trim();
  const password = String(body.password ?? "");
  if (!name) return json({ error: "name_required" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "email_invalid" }, 400);
  if (!PHONE_RE.test(phone)) return json({ error: "phone_invalid" }, 400);
  if (password.length < 6 || password.length > 72) return json({ error: "password_short" }, 400);

  const existing = await findUser(email);
  if (existing?.email_confirmed_at) return json({ error: "already_registered" }, 409);

  let userId: string;
  if (existing) {
    // Cadastro começado antes e não confirmado: atualiza os dados e manda um novo código.
    userId = existing.id;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password,
      user_metadata: { ...existing.raw_user_meta_data, name, phone },
    });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: false, user_metadata: { name, phone },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { data: row } = await admin.from("phone_verifications").select("*").eq("user_id", userId).maybeSingle();
  const now = Date.now();
  let sends = 0;
  let windowStart = now;
  if (row) {
    if (now - new Date(row.last_sent_at).getTime() < RESEND_COOLDOWN_MS) return json({ error: "wait_resend" }, 429);
    windowStart = new Date(row.window_started_at).getTime();
    sends = now - windowStart < 3600_000 ? row.sends : 0;
    if (now - windowStart >= 3600_000) windowStart = now;
    if (sends >= MAX_SENDS_PER_HOUR) return json({ error: "too_many_attempts" }, 429);
  }

  const code = newCode();
  await sendSms(phone, `VS Stage Pro: seu código de confirmação é ${code}. Ele vale por 10 minutos.`);

  const { error: saveErr } = await admin.from("phone_verifications").upsert({
    user_id: userId,
    phone,
    code_hash: await hashCode(userId, code),
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    attempts: 0,
    sends: sends + 1,
    window_started_at: new Date(windowStart).toISOString(),
    last_sent_at: new Date(now).toISOString(),
  });
  if (saveErr) throw saveErr;

  return json({ ok: true, phone_hint: phone.replace(/^(\+\d{2})\d+(\d{4})$/, "$1 •••• $2") });
}

async function confirm(body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").replace(/\D/g, "");
  if (!EMAIL_RE.test(email) || code.length !== 6) return json({ error: "code_invalid" }, 400);

  const user = await findUser(email);
  if (!user) return json({ error: "code_invalid" }, 400);
  if (user.email_confirmed_at) return json({ ok: true });

  const { data: row } = await admin.from("phone_verifications").select("*").eq("user_id", user.id).maybeSingle();
  if (!row) return json({ error: "code_invalid" }, 400);
  if (row.attempts >= MAX_ATTEMPTS) return json({ error: "too_many_attempts" }, 429);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "code_expired" }, 400);

  if ((await hashCode(user.id, code)) !== row.code_hash) {
    await admin.from("phone_verifications").update({ attempts: row.attempts + 1 }).eq("user_id", user.id);
    return json({ error: "code_invalid" }, 400);
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email_confirm: true,
    user_metadata: { ...user.raw_user_meta_data, phone: row.phone, phone_verified: true },
  });
  if (error) throw error;
  await admin.from("phone_verifications").delete().eq("user_id", user.id);
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
    if (body.action === "start") return await start(body);
    if (body.action === "confirm") return await confirm(body);
    return json({ error: "invalid_action" }, 400);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("signup-phone", e);
    if (msg === "sms_not_configured" || msg === "sms_failed") return json({ error: msg }, 502);
    if (/already been registered|already registered|already exists/i.test(msg)) return json({ error: "already_registered" }, 409);
    return json({ error: "request_failed" }, 500);
  }
});
