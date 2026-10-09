import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "prompter-audio";
const LOGO_BUCKET = "show-logos";
const LOGO_TTL_S = 60 * 60 * 6;
const PLAY_TTL_S = 60 * 60 * 3;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function directorOk(show: unknown, key: unknown): Promise<boolean> {
  if (typeof show !== "string" || !UUID_RE.test(show) || typeof key !== "string" || key.length > 200) return false;
  const { data, error } = await admin.rpc("_director_ok", { p_show: show, p_key: key });
  return !error && data === true;
}

async function showForProducer(code: unknown): Promise<string | null> {
  return showForCode(code, false);
}

async function showForCode(code: unknown, allowScreen: boolean): Promise<string | null> {
  if (typeof code !== "string") return null;
  const norm = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (norm.length !== 10) return null;
  const filter = allowScreen ? `producer_code.eq.${norm},screen_code.eq.${norm}` : `producer_code.eq.${norm}`;
  const { data, error } = await admin.from("shows").select("id").or(filter).limit(1).maybeSingle();
  return error || !data ? null : (data.id as string);
}

async function logoInfo(showId: string) {
  const { data, error } = await admin.storage.from(LOGO_BUCKET).list(showId, { limit: 10 });
  if (error) throw error;
  const file = (data ?? []).find((f) => f.name === "logo");
  if (!file) return { url: null, updatedAt: null };
  const { data: signed, error: sErr } = await admin.storage.from(LOGO_BUCKET).createSignedUrl(`${showId}/logo`, LOGO_TTL_S);
  if (sErr || !signed) throw sErr ?? new Error("sign_failed");
  return { url: signed.signedUrl, updatedAt: file.updated_at ?? file.created_at ?? null };
}

async function listFiles(showId: string) {
  const { data, error } = await admin.storage.from(BUCKET).list(showId, { limit: 1000 });
  if (error) throw error;
  const bySong = new Map<string, { songId: string; path: string; updatedAt: string | null; size: number | null }>();
  for (const f of data ?? []) {
    const m = f.name.match(/^(.+)\.(mp3|wav)$/);
    if (!m) continue;
    const file = {
      songId: m[1],
      path: `${showId}/${f.name}`,
      updatedAt: f.updated_at ?? f.created_at ?? null,
      size: (f.metadata as { size?: number } | null)?.size ?? null,
    };
    const prev = bySong.get(file.songId);
    if (!prev || (file.updatedAt ?? "") > (prev.updatedAt ?? "")) bySong.set(file.songId, file);
  }
  return [...bySong.values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "bad_request" }, 400);

    if (body.action === "upload" || body.action === "status") {
      if (!(await directorOk(body.show, body.key))) return json({ error: "forbidden" }, 403);
      const showId = body.show as string;
      if (body.action === "status") {
        const files = await listFiles(showId);
        return json({ files: files.map(({ songId, updatedAt, size }) => ({ songId, updatedAt, size })) });
      }
      if (typeof body.song !== "string" || !ID_RE.test(body.song)) return json({ error: "bad_request" }, 400);
      const ext = body.format === "mp3" ? "mp3" : "wav";
      const path = `${showId}/${body.song}.${ext}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error || !data) return json({ error: "upload_unavailable" }, 500);
      return json({ path: data.path, token: data.token });
    }

    if (body.action === "logo_upload" || body.action === "logo_remove" || body.action === "logo_director") {
      if (!(await directorOk(body.show, body.key))) return json({ error: "forbidden" }, 403);
      const showId = body.show as string;
      if (body.action === "logo_director") return json(await logoInfo(showId));
      if (body.action === "logo_remove") {
        const { error } = await admin.storage.from(LOGO_BUCKET).remove([`${showId}/logo`]);
        if (error) return json({ error: "remove_failed" }, 500);
        return json({ ok: true });
      }
      const { data, error } = await admin.storage.from(LOGO_BUCKET).createSignedUploadUrl(`${showId}/logo`, { upsert: true });
      if (error || !data) return json({ error: "upload_unavailable" }, 500);
      return json({ path: data.path, token: data.token });
    }

    if (body.action === "logo_get") {
      const showId = await showForCode(body.code, true);
      if (!showId) return json({ error: "invalid_code" }, 403);
      return json(await logoInfo(showId));
    }

    if (body.action === "list") {
      const showId = await showForProducer(body.code);
      if (!showId) return json({ error: "invalid_code" }, 403);
      const files = await listFiles(showId);
      if (files.length === 0) return json({ files: [] });
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(files.map((f) => f.path), PLAY_TTL_S);
      if (error || !data) return json({ error: "list_unavailable" }, 500);
      const urlByPath = new Map(data.map((d) => [d.path, d.signedUrl]));
      return json({
        files: files
          .map((f) => ({ songId: f.songId, updatedAt: f.updatedAt, url: urlByPath.get(f.path) ?? null }))
          .filter((f) => f.url),
      });
    }

    return json({ error: "bad_request" }, 400);
  } catch (_err) {
    return json({ error: "server_error" }, 500);
  }
});
