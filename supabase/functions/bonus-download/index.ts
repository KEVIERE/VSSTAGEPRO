// Área do Assinante: entrega o arquivo de um bônus só para quem é assinante em dia.
// O arquivo fica no bucket privado "bonus", na pasta com o nome do bônus (bonus/<id>/<arquivo>).
// A resposta é um link temporário (10 minutos); sem ele, ninguém baixa o arquivo.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "bonus";
const LINK_TTL_S = 10 * 60;
const ID_RE = /^[a-z0-9-]{1,60}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "login" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  // Confere a assinatura com o login de quem pediu (bonus_access usa auth.uid())
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: access, error: accessErr } = await asUser.rpc("bonus_access");
  if (accessErr) return json({ error: "check_failed" }, 500);
  const status = (access as { status?: string } | null)?.status;
  if (status === "anonymous") return json({ error: "login" }, 401);
  if (status !== "subscriber") return json({ error: "not_subscriber" }, 403);

  const body = await req.json().catch(() => null);
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !ID_RE.test(id)) return json({ error: "not_found" }, 404);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: files, error: listErr } = await admin.storage.from(BUCKET).list(id, {
    limit: 20,
    sortBy: { column: "name", order: "asc" },
  });
  if (listErr) return json({ error: "failed" }, 500);
  // pastas vêm com id nulo; arquivos ocultos (.emptyFolderPlaceholder) ficam de fora
  const file = (files ?? []).find((f) => f.id && !f.name.startsWith("."));
  if (!file) return json({ error: "not_found" }, 404);

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(`${id}/${file.name}`, LINK_TTL_S, { download: file.name });
  if (signErr || !signed?.signedUrl) return json({ error: "failed" }, 500);

  return json({ url: signed.signedUrl, name: file.name });
});
