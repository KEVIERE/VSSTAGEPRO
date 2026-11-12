import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Apaga o áudio do produtor (e a letra lida pelo Mac) 10 minutos depois de o produtor salvar.
//
// Quem chama é o agendamento do banco (pg_cron, migração 20261111120000), a cada 5 minutos, com
// a senha do Vault no cabeçalho x-cron-secret. A lista de shows vencidos vem do banco
// (prompter_audio_expired_shows); a remoção é pela API do Storage, que é a única permitida.

const BUCKET = "prompter-audio";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { data: ok } = await admin.rpc("prompter_sweep_secret_ok", { p_secret: req.headers.get("x-cron-secret") ?? "" });
  if (ok !== true) return json({ error: "not_allowed" }, 401);

  const { data: shows, error } = await admin.rpc("prompter_audio_expired_shows");
  if (error) return json({ error: error.message }, 500);

  let removed = 0;
  const failed: string[] = [];
  for (const showId of (shows ?? []) as string[]) {
    const { data: files, error: listErr } = await admin.storage.from(BUCKET).list(showId, { limit: 1000 });
    if (listErr) { failed.push(showId); continue; }
    const paths = (files ?? []).filter((f) => f.id !== null && f.name).map((f) => `${showId}/${f.name}`);
    if (paths.length === 0) continue;
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) { console.error("remove_failed", showId, rmErr.message); failed.push(showId); continue; }
    removed += paths.length;
  }
  return json({ shows: (shows ?? []).length, removed, failed });
});
