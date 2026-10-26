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

async function sendTelegramAlert(text: string) {
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
    console.error("Erro ao enviar Telegram:", e);
  }
}

async function lookupGeo(ip: string | null): Promise<string> {
  if (!ip || ip === "127.0.0.1" || ip === "::1") return "Local / Não identificado";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return "Localização não disponível";
    const d = await res.json();
    if (!d.success) return "Localização não disponível";
    const parts = [d.city, d.region_code || d.region, d.country].filter(Boolean);
    const flag = d.flag?.emoji ? ` ${d.flag.emoji}` : "";
    return `${parts.join(", ")}${flag}`;
  } catch {
    return "Localização não disponível";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const hwId = String(body.hw || "").trim();
  const appVersion = String(body.appVersion || body.version || "").trim();
  const asarSha = String(body.asarSha || "").trim();
  const hasSession = Boolean(body.hasSession);
  let tampered = Boolean(body.tampered);
  let reason = body.tamperReason ? String(body.tamperReason).trim() : null;

  if (!hwId || !appVersion) {
    return json({ error: "missing_fields" }, 400);
  }

  const clientIp = req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  // 1. Confere se o hardware já está na blacklist
  const { data: blacklisted } = await admin
    .from("hardware_blacklist")
    .select("reason")
    .eq("hw_id", hwId)
    .maybeSingle();

  if (blacklisted) {
    return json({ ok: true, blocked: true, reason: blacklisted.reason || "Dispositivo bloqueado" });
  }

  // 2. Se o cliente reportou adulteração ou se o asar_sha foi modificado
  if (tampered && !reason) {
    reason = "Código executável modificado / crackeado (assinatura de integridade inválida)";
  }

  // 3. Se está rodando sem sessão e não é primeiro boot
  const isFirstLaunch = Boolean(body.firstLaunch);
  if (!hasSession && !isFirstLaunch && !tampered) {
    // Alerta de execução suspeita sem autenticação após período de abertura
    const runMinutes = Number(body.runningMinutes || 0);
    if (runMinutes >= 10) {
      tampered = true;
      reason = `Programa aberto e em uso contínuo (${runMinutes} min) sem nenhuma conta logada (possível bypass da tela de login)`;
    }
  }

  let shouldAlert = false;
  if (tampered || reason) {
    // Deduplicação: só alerta se não enviamos alerta para este mesmo hardware nas últimas 12 horas
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data: recentAlert } = await admin
      .from("app_heartbeats")
      .select("id")
      .eq("hw_id", hwId)
      .eq("alert_sent", true)
      .gte("created_at", twelveHoursAgo)
      .limit(1)
      .maybeSingle();

    if (!recentAlert) {
      shouldAlert = true;
    }
  }

  // Grava o evento no banco
  await admin.from("app_heartbeats").insert({
    hw_id: hwId,
    ip: clientIp,
    app_version: appVersion,
    asar_sha: asarSha || null,
    has_session: hasSession,
    tampered,
    reason,
    alert_sent: shouldAlert,
  });

  // Dispara alerta no Telegram com riqueza de detalhes
  if (shouldAlert) {
    const geo = await lookupGeo(clientIp);
    const hwShort = hwId.length > 12 ? `${hwId.slice(0, 8)}...${hwId.slice(-4)}` : hwId;
    const nowBrt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const msg = `🚨 *USO ILEGAL / CRACK DETECTADO*
━━━━━━━━━━━━━━━━━━━━
⚠️ *Motivo:* ${reason}

📍 *Localização:* ${geo}
💻 *Dispositivo:* Mac (\`${hwShort}\`)
🌐 *IP:* \`${clientIp || "Desconhecido"}\`
📦 *Versão:* \`${appVersion}\`
🔑 *Sessão:* ${hasSession ? "Conta conectada" : "❌ *Nenhum login (burlar tela de entrada)*"}
🕒 *Horário:* ${nowBrt}

_O evento foi registrado na aba Monitoramento do painel administrativo._`;

    await sendTelegramAlert(msg);
  }

  return json({ ok: true, blocked: false });
});
