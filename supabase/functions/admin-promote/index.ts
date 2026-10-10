import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Backoffice: dispara o workflow "Upgrade de produção" no GitHub Actions (botão da aba
// "Teste interno" do admin). Usa um PAT com permissão "Actions: write" no repositório —
// configure o secret GITHUB_PAT no Supabase (Edge Functions > Secrets) e GITHUB_REPO
// (ex.: "KEVIERE/VSSTAGEPRO") se for diferente do padrão abaixo.
// Confere admin via RPC (mesma regra de app_admins usada no resto do backoffice).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "KEVIERE/VSSTAGEPRO";
const WORKFLOW_FILE = "promote-production.yml";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callerIsAdmin(req: Request): Promise<{ ok: boolean; email: string | null }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, email: null };
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user?.id) return { ok: false, email: null };
  const { data: isAdminData, error } = await asUser.rpc("is_admin");
  if (error) return { ok: false, email: userData.user.email ?? null };
  return { ok: isAdminData === true, email: userData.user.email ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { ok, email } = await callerIsAdmin(req);
  if (!ok) return json({ error: "not_allowed" }, 403);

  const pat = Deno.env.get("GITHUB_PAT");
  if (!pat) return json({ error: "github_not_configured" }, 500);

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("admin-promote", res.status, text);
    return json({ error: "github_dispatch_failed" }, 502);
  }

  console.log(`admin-promote: ${email ?? "admin"} disparou o upgrade de produção`);
  return json({ ok: true });
});
