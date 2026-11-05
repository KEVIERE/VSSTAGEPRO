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

export async function sendTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID ausente nos secrets");
    return { ok: false, error: "secrets_missing" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
    const d = await res.json();
    if (!d.ok) {
      console.error("Telegram API error:", d);
      return { ok: false, error: d.description };
    }
    return { ok: true };
  } catch (e) {
    console.error("sendTelegram fetch error:", e);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Compara contra todas as chaves de serviço que o projeto conhece.
 *
 * Antes só a `SUPABASE_SERVICE_ROLE_KEY` valia, e ela é a chave legada. Quando o projeto trocou
 * as chaves (05/11/2026), o workflow continuou enviando a legada: a função respondia 403
 * `not_allowed` e nenhum aviso de upgrade chegava no Telegram. Aqui a lista cobre a legada e as
 * `sb_secret_*`, para a troca de chaves não derrubar o aviso de novo.
 */
function serviceKeys(): string[] {
  const keys = [
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    Deno.env.get("SUPABASE_SECRET_KEY"),          // sb_secret_* (nome novo do secret)
    Deno.env.get("SUPABASE_SECRET_KEYS"),         // lista em JSON, como o runtime já expõe
  ];
  const out: string[] = [];
  for (const raw of keys) {
    if (!raw) continue;
    const v = raw.trim();
    if (!v) continue;
    if (v.startsWith("[")) {
      try {
        for (const item of JSON.parse(v) as unknown[]) {
          const val = typeof item === "string" ? item : (item as { key?: string })?.key;
          if (typeof val === "string" && val.trim()) out.push(val.trim());
        }
        continue;
      } catch {
        continue;
      }
    }
    out.push(v);
  }
  return out;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  // 1. Chave de serviço (chamadas internas: outros Edge Functions e o workflow de upgrade)
  if (serviceKeys().includes(token)) return true;

  // 2. Usuário com papel de administrador
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user?.id) return false;
  const { data: isAdmin } = await asUser.rpc("is_admin");
  return isAdmin === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!(await isAuthorized(req))) {
    return json({ error: "not_allowed" }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const message = String(body.message || body.text || "").trim();
  if (!message) return json({ error: "missing_message" }, 400);

  const res = await sendTelegram(message);
  if (!res.ok) return json({ error: res.error }, 500);
  return json({ ok: true });
});
