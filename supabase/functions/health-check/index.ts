import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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

async function sendTelegram(text: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("Erro Telegram:", e);
  }
}

type CheckResult = {
  service: string;
  status: "up" | "down" | "degraded";
  latencyMs: number;
  detail: string;
};

// 1. Supabase Database check
async function checkSupabase(): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const { error } = await admin.from("service_health").select("id").limit(1);
    const latency = Date.now() - t0;
    if (error) throw error;
    return { service: "supabase", status: "up", latencyMs: latency, detail: "Banco Postgres respondendo normalmente" };
  } catch (e) {
    return { service: "supabase", status: "down", latencyMs: Date.now() - t0, detail: (e as Error).message };
  }
}

// 2. Resend Email check
async function checkResend(): Promise<CheckResult> {
  const t0 = Date.now();
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return { service: "resend", status: "degraded", latencyMs: 0, detail: "RESEND_API_KEY não configurada nos secrets" };
  }
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${resendKey}` },
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      return { service: "resend", status: "up", latencyMs: latency, detail: "API de e-mail e domínio vsstagepro.com.br operando" };
    }
    return { service: "resend", status: "degraded", latencyMs: latency, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { service: "resend", status: "down", latencyMs: Date.now() - t0, detail: (e as Error).message };
  }
}

// 3. Stripe check
async function checkStripe(): Promise<CheckResult> {
  const t0 = Date.now();
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
    return { service: "stripe", status: "degraded", latencyMs: 0, detail: "STRIPE_SECRET_KEY não configurada" };
  }
  try {
    const res = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      return { service: "stripe", status: "up", latencyMs: latency, detail: "API Stripe e pagamentos operando" };
    }
    return { service: "stripe", status: "down", latencyMs: latency, detail: `Stripe retornou HTTP ${res.status}` };
  } catch (e) {
    return { service: "stripe", status: "down", latencyMs: Date.now() - t0, detail: (e as Error).message };
  }
}

// 4. Replicate AI stem separation check
async function checkReplicate(): Promise<CheckResult> {
  const t0 = Date.now();
  const token = Deno.env.get("REPLICATE_API_TOKEN");
  if (!token) {
    return { service: "replicate", status: "degraded", latencyMs: 0, detail: "REPLICATE_API_TOKEN ausente" };
  }
  try {
    const res = await fetch("https://api.replicate.com/v1/account", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      return { service: "replicate", status: "up", latencyMs: latency, detail: "Serviço de IA de Stems ativo" };
    }
    return { service: "replicate", status: "degraded", latencyMs: latency, detail: `Replicate HTTP ${res.status}` };
  } catch (e) {
    return { service: "replicate", status: "down", latencyMs: Date.now() - t0, detail: (e as Error).message };
  }
}

// 5. GitHub Actions check
async function checkGitHub(): Promise<CheckResult> {
  const t0 = Date.now();
  const repo = Deno.env.get("GITHUB_REPO") || "KEVIERE/VSSTAGEPRO";
  const pat = Deno.env.get("GITHUB_PAT");
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, {
      headers: {
        "User-Agent": "VSStagePro-HealthCheck",
        ...(pat ? { Authorization: `Bearer ${pat}` } : {}),
      },
    });
    const latency = Date.now() - t0;
    if (res.ok) {
      return { service: "github", status: "up", latencyMs: latency, detail: "Pipelines de deploy operando" };
    }
    return { service: "github", status: "degraded", latencyMs: latency, detail: `GitHub HTTP ${res.status}` };
  } catch (e) {
    return { service: "github", status: "down", latencyMs: Date.now() - t0, detail: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // Executa todas as checagens em paralelo
  const results = await Promise.all([
    checkSupabase(),
    checkResend(),
    checkStripe(),
    checkReplicate(),
    checkGitHub(),
  ]);

  // Busca o status anterior de cada serviço para detectar transição UP -> DOWN ou DOWN -> UP
  const { data: previousRows } = await admin
    .from("service_health")
    .select("service, status")
    .order("checked_at", { ascending: false })
    .limit(20);

  const prevStatusMap = new Map<string, string>();
  if (previousRows) {
    for (const r of previousRows) {
      if (!prevStatusMap.has(r.service)) {
        prevStatusMap.set(r.service, r.status);
      }
    }
  }

  // Grava as novas checagens
  for (const r of results) {
    await admin.from("service_health").insert({
      service: r.service,
      status: r.status,
      latency_ms: r.latencyMs,
      detail: r.detail,
    });

    const prev = prevStatusMap.get(r.service) || "up";

    // Transição UP -> DOWN / DEGRADED: alerta Telegram
    if (prev === "up" && r.status !== "up") {
      const nowBrt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const emoji = r.status === "down" ? "🔴" : "🟡";
      const alertMsg = `${emoji} *ALERTA DE SISTEMA: SERVIÇO ${r.service.toUpperCase()} INSTÁVEL*
━━━━━━━━━━━━━━━━━━━━
Status: *${r.status.toUpperCase()}*
Detalhe: ${r.detail}
Latência: ${r.latencyMs}ms
Horário: ${nowBrt}

_O monitoramento está acompanhando e avisará quando o serviço normalizar._`;

      await sendTelegram(alertMsg);
    }
    // Transição DOWN -> UP: aviso de recuperação
    else if (prev !== "up" && r.status === "up") {
      const nowBrt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      const recMsg = `✅ *SERVIÇO RESTABELECIDO: ${r.service.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━
Status: *OPERACIONAL (UP)*
Latência: ${r.latencyMs}ms
Horário: ${nowBrt}`;

      await sendTelegram(recMsg);
    }
  }

  return json({ ok: true, results });
});
