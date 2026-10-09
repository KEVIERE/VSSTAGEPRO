import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Backoffice: publicar, reverter ou preparar o upload de uma versão do app Mac.
//  - action "sign-upload": gera URLs assinadas de upload direto para o Storage, para o
//    navegador do admin enviar as partes de um .dmg sem passar o arquivo pela função.
//  - action "publish": depois que todas as partes de ao menos uma arquitetura já foram
//    enviadas, monta e grava mac/manifest.json com os builds informados (reaproveitando os
//    builds do manifest atual para a arquitetura que não foi reenviada) e registra o
//    histórico em app_releases.
//  - action "rollback": pega o manifest já gravado em app_releases para a versão/build
//    pedida e o republica como mac/manifest.json no bucket app-downloads. Todo app
//    instalado — mais novo ou mais antigo que essa versão — vai se ajustar sozinho na
//    próxima vez que abrir (ver desktop/selfUpdate.js: compara por diferença, não só "é mais nova?").
// Confere admin via RPC (mesma regra de app_admins usada no resto do backoffice).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const BUCKET = "app-downloads";
const MANIFEST_PATH = "mac/manifest.json";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

async function callerIsAdmin(req: Request): Promise<{ ok: boolean; userId: string | null }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, userId: null };
  // Chamado com o token de quem fez a requisição: is_admin() lê auth.uid() desse token.
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asUser.auth.getUser();
  const userId = userData?.user?.id ?? null;
  if (!userId) return { ok: false, userId: null };
  const { data: isAdminData, error: isAdminErr } = await asUser.rpc("is_admin");
  if (isAdminErr) return { ok: false, userId };
  return { ok: isAdminData === true, userId };
}

type BuildInfo = { arch: string; label: string; file: string; size: number; sha256: string; parts: string[] };

async function currentManifest(): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(MANIFEST_PATH);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

async function signUpload(req: Request, body: Record<string, unknown>) {
  const { ok } = await callerIsAdmin(req);
  if (!ok) return json({ error: "not_allowed" }, 403);

  const version = String(body.version ?? "");
  const build = Number(body.build);
  const arch = String(body.arch ?? "");
  const partCount = Number(body.partCount);
  if (!version || !Number.isFinite(build) || !["arm64", "x64"].includes(arch) || !Number.isFinite(partCount) || partCount < 1 || partCount > 200) {
    return json({ error: "invalid_value" }, 400);
  }

  const folder = `mac/${version}-${build}/${arch}`;
  const urls: Array<{ path: string; signedUrl: string; token: string }> = [];
  for (let i = 0; i < partCount; i++) {
    const name = `part${String(i).padStart(3, "0")}.bin`;
    const path = `${folder}/${name}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !data) return json({ error: "sign_failed" }, 500);
    urls.push({ path, signedUrl: data.signedUrl, token: data.token });
  }
  return json({ ok: true, urls });
}

async function publish(req: Request, body: Record<string, unknown>) {
  const { ok, userId } = await callerIsAdmin(req);
  if (!ok) return json({ error: "not_allowed" }, 403);

  const version = String(body.version ?? "");
  const build = Number(body.build);
  const required = Boolean(body.required);
  const builds = Array.isArray(body.builds) ? (body.builds as BuildInfo[]) : [];
  if (!version || !Number.isFinite(build) || builds.length === 0) return json({ error: "invalid_value" }, 400);

  for (const b of builds) {
    if (!["arm64", "x64"].includes(b.arch) || !b.file || !Number.isFinite(b.size) || !b.sha256 || !Array.isArray(b.parts) || b.parts.length === 0) {
      return json({ error: "invalid_build" }, 400);
    }
  }

  // Mantém o build da arquitetura que não foi reenviada (ex.: admin só subiu o arm64).
  const archs = new Set(builds.map((b) => b.arch));
  const missing = ["arm64", "x64"].filter((a) => !archs.has(a));
  if (missing.length > 0) {
    const current = await currentManifest();
    const currentBuilds = Array.isArray(current?.builds) ? (current!.builds as BuildInfo[]) : [];
    for (const a of missing) {
      const found = currentBuilds.find((b) => b.arch === a);
      if (found) builds.push(found);
    }
  }

  const manifest = { version, build, published: new Date().toISOString(), required, builds };

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(MANIFEST_PATH, new TextEncoder().encode(JSON.stringify(manifest)), {
      contentType: "application/json",
      upsert: true,
      cacheControl: "no-cache",
    });
  if (upErr) throw upErr;

  const { error: recErr } = await admin.rpc("admin_release_record", {
    p_version: version,
    p_build: build,
    p_manifest: manifest,
    p_by: userId,
  });
  if (recErr) throw recErr;

  return json({ ok: true });
}

async function rollback(req: Request, body: Record<string, unknown>) {
  const { ok, userId } = await callerIsAdmin(req);
  if (!ok) return json({ error: "not_allowed" }, 403);

  const version = String(body.version ?? "");
  const build = Number(body.build);
  const required = Boolean(body.required);
  if (!version || !Number.isFinite(build)) return json({ error: "invalid_value" }, 400);

  const { data: row, error: selErr } = await admin
    .from("app_releases")
    .select("manifest")
    .eq("version", version)
    .eq("build", build)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!row) return json({ error: "not_found" }, 404);

  const manifest = row.manifest as Record<string, unknown>;
  const republished = { ...manifest, published: new Date().toISOString(), required };

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(MANIFEST_PATH, new TextEncoder().encode(JSON.stringify(republished)), {
      contentType: "application/json",
      upsert: true,
      cacheControl: "no-cache",
    });
  if (upErr) throw upErr;

  const { error: recErr } = await admin.rpc("admin_release_record", {
    p_version: version,
    p_build: build,
    p_manifest: republished,
    p_by: userId,
  });
  if (recErr) throw recErr;

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
    if (body.action === "sign-upload") return await signUpload(req, body);
    if (body.action === "publish") return await publish(req, body);
    if (body.action === "rollback") return await rollback(req, body);
    return json({ error: "invalid_action" }, 400);
  } catch (e) {
    console.error("admin-releases", e);
    return json({ error: "request_failed" }, 500);
  }
});
