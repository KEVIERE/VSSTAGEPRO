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
// Folga entre o produtor salvar as letras e o áudio sair do storage. Dá tempo de o produtor
// perceber um erro de digitação e ouvir a música de novo, sem segurar espaço por horas.
const RELEASE_GRACE_MS = 10 * 60 * 1000;
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

/** Marca de liberação e de pedido do show, lidas pela chave do diretor. */
async function repertoireState(showId: string) {
  const { data, error } = await admin
    .from("shows")
    .select("produced_audio_released_at, repertoire_requested_at")
    .eq("id", showId)
    .maybeSingle();
  if (error) throw error;
  return {
    releasedAt: (data?.produced_audio_released_at as string | null) ?? null,
    requestedAt: (data?.repertoire_requested_at as string | null) ?? null,
  };
}

/**
 * Se o produtor salvou as letras e a folga já passou, o áudio de referência sai do storage.
 * Roda antes das ações do diretor e do produtor, então a limpeza acontece sozinha, sem depender
 * de alguém apertar "OK". Um pedido novo de repertório zera a marca e o arquivo deixa de ser
 * apagado antes de subir de novo.
 */
async function releaseExpiredAudio(showId: string) {
  const { releasedAt, requestedAt } = await repertoireState(showId);
  if (!releasedAt) return null;
  if (requestedAt) return null;
  if (Date.now() - Date.parse(releasedAt) < RELEASE_GRACE_MS) return null;
  const res = await removeShowFiles(showId, [BUCKET]);
  // Se a remoção falhar, o próximo ciclo tenta de novo: a marca de liberação
  // continua, então a limpeza não depende de o produtor abrir a página.
  return res;
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

// Todos os arquivos de uma pasta, sem juntar por música: a limpeza precisa ver o que sobrou de
// verdade (um WAV antigo que o listFiles esconde continua ocupando espaço).
async function listAll(bucket: string, showId: string) {
  const { data, error } = await admin.storage.from(bucket).list(showId, { limit: 1000 });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.id !== null && f.name && !f.name.endsWith("/"))
    .map((f) => ({ path: `${showId}/${f.name}`, size: (f.metadata as { size?: number } | null)?.size ?? 0 }));
}

// Apaga a pasta do show nos dois buckets e devolve quanto saiu. Usado pela confirmação do
// diretor (só o áudio) e pela remoção do show (áudio + logo).
async function removeShowFiles(showId: string, buckets: string[]) {
  let removed = 0;
  let bytes = 0;
  for (const bucket of buckets) {
    const files = await listAll(bucket, showId);
    if (files.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(files.map((f) => f.path));
    // Antes, um erro aqui abortava a limpeza inteira e o áudio ficava no
    // storage sem ninguém saber. Agora a limpeza continua nos outros arquivos
    // e o que falhou é reportado, para o espaço não vazar em silêncio.
    if (error) {
      console.error("remove_failed", bucket, showId, error.message);
      continue;
    }
    removed += files.length;
    bytes += files.reduce((sum, f) => sum + f.size, 0);
  }
  return { removed, bytes };
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
        // Antes de responder, aplica a liberação vencida: o programa do diretor deixa de ver
        // (e de reenviar) o áudio que já cumpriu o papel.
        await releaseExpiredAudio(showId).catch(() => null);
        const files = await listFiles(showId);
        const st = await repertoireState(showId);
        return json({
          files: files.map(({ songId, updatedAt, size }) => ({ songId, updatedAt, size })),
          released_at: st.releasedAt,
          requested_at: st.requestedAt,
        });
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

    // O produtor técnico também troca a logo: ele está com a mão na massa no show e é quem vê
    // a TV de perto. Autoriza pelo código do produtor, não pela chave do diretor.
    if (body.action === "logo_upload_code" || body.action === "logo_remove_code" || body.action === "logo_get_upload") {
      const showId = await showForProducer(body.code);
      if (!showId) return json({ error: "invalid_code" }, 403);
      if (body.action === "logo_get_upload") {
        const { data, error } = await admin.storage.from(LOGO_BUCKET).createSignedUploadUrl(`${showId}/logo`, { upsert: true });
        if (error || !data) return json({ error: "upload_unavailable" }, 500);
        return json({ path: data.path, token: data.token, ...(await logoInfo(showId)) });
      }
      if (body.action === "logo_remove_code") {
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

    // O diretor confirma que as letras estão prontas: o áudio de referência já cumpriu o papel
    // e sai do storage. As letras ficam; a pasta do show é que fica vazia.
    if (body.action === "clear") {
      if (!(await directorOk(body.show, body.key))) return json({ error: "forbidden" }, 403);
      const res = await removeShowFiles(body.show as string, [BUCKET]);
      return json(res);
    }

    // Show apagado: some tudo o que era dele nos dois buckets.
    if (body.action === "delete_show") {
      if (!(await directorOk(body.show, body.key))) return json({ error: "forbidden" }, 403);
      const res = await removeShowFiles(body.show as string, [BUCKET, LOGO_BUCKET]);
      return json(res);
    }

    // O produtor pede o repertório de novo (depois de ter salvado e o áudio ter sido liberado):
    // o programa do diretor pega o pedido e reenvia.
    if (body.action === "request") {
      const showId = await showForProducer(body.code);
      if (!showId) return json({ error: "invalid_code" }, 403);
      const { data, error } = await admin
        .from("shows")
        .update({ repertoire_requested_at: new Date().toISOString(), produced_audio_released_at: null })
        .eq("id", showId)
        .select("repertoire_requested_at")
        .maybeSingle();
      if (error) return json({ error: "request_failed" }, 500);
      return json({ ok: true, requested_at: data?.repertoire_requested_at ?? null });
    }

    // O diretor pega o pedido do produtor. Devolve e apaga a marca: uma ação por pedido.
    if (body.action === "take_request") {
      if (!(await directorOk(body.show, body.key))) return json({ error: "forbidden" }, 403);
      const showId = body.show as string;
      const st = await repertoireState(showId);
      if (!st.requestedAt) return json({ requested_at: null });
      const { error } = await admin.from("shows").update({ repertoire_requested_at: null }).eq("id", showId);
      if (error) return json({ error: "request_failed" }, 500);
      return json({ requested_at: st.requestedAt });
    }

    if (body.action === "list") {
      const showId = await showForProducer(body.code);
      if (!showId) return json({ error: "invalid_code" }, 403);
      // Antes de listar, aplica a liberação vencida: o produtor deixa de ver o áudio que já
      // cumpriu o papel, e a pasta vazia não faz o diretor reenviar (ver useReferenceAutoSync).
      await releaseExpiredAudio(showId).catch(() => null);
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
