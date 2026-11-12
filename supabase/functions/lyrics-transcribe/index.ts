// Letra automática do teleprompter (área do produtor).
//
// Caminho: a voz é separada do resto da música (Demucs) e só a voz vai para o WhisperX
// (Whisper large-v3 + alinhamento por palavra), em português. Sem a banda por trás, o Whisper
// erra menos a letra e o alinhador acerta o começo de cada palavra. Se a separação falhar, a
// música inteira vai para o WhisperX mesmo assim.
//
// As duas etapas rodam na Replicate, que leva de 1 a 2 minutos por música. Para não segurar a
// conexão esse tempo todo, o navegador pergunta o andamento a cada poucos segundos:
//   start  (multipart: code, file)          -> { job }
//   status (json: code, job)                -> { status: 'running', job } | { status: 'done', segments } | { status: 'failed' }
//   cancel (json: code, job)                -> { ok: true }
// O `job` só guarda o id da etapa na Replicate e o arquivo enviado; nada fica no banco.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REPLICATE = "https://api.replicate.com/v1";
// cjwbw/demucs: a mesma versão que a separação de faixas do programa já usa.
const DEMUCS_VERSION = "25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953";
// victor-upmeet/whisperx: Whisper large-v3 com alinhamento por palavra (wav2vec2).
const WHISPERX_VERSION = "84d2ad2d6194fe98a17d2b60bef1c7f910c46b2f6fd38996ca457afd9c8abfcb";
const MAX_BYTES = 20 * 1024 * 1024;
const PRED_ID_RE = /^[a-z0-9]{10,64}$/;
const FILE_ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

type Stage = "separate" | "transcribe";
interface Job { stage: Stage; id: string; file?: string | null; audio?: string | null }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

/** Mesmo código do produtor usado pela função prompter-audio. */
async function showForProducer(code: unknown): Promise<string | null> {
  if (typeof code !== "string") return null;
  const norm = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (norm.length !== 10) return null;
  const { data, error } = await admin.from("shows").select("id").eq("producer_code", norm).limit(1).maybeSingle();
  return error || !data ? null : (data.id as string);
}

async function alertLowBalance(): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "[ALERTA: REPLICATE SEM SALDO]\n\nUm produtor tentou gerar a letra automática e a Replicate recusou por falta de saldo.\nRecarregue em https://replicate.com/account/billing",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error("[lyrics-transcribe] telegram:", err);
  }
}

function parseJob(raw: unknown): Job | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  if (j.stage !== "separate" && j.stage !== "transcribe") return null;
  if (typeof j.id !== "string" || !PRED_ID_RE.test(j.id)) return null;
  const file = typeof j.file === "string" && FILE_ID_RE.test(j.file) ? j.file : null;
  // Só aceita de volta o endereço de arquivo da própria Replicate.
  const audio = typeof j.audio === "string" && j.audio.startsWith(`${REPLICATE}/files/`) && j.audio.length < 400 ? j.audio : null;
  return { stage: j.stage, id: j.id, file, audio };
}

async function replicate(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${REPLICATE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
}

async function createPrediction(token: string, version: string, input: Record<string, unknown>) {
  const res = await replicate(token, "/predictions", { method: "POST", body: JSON.stringify({ version, input }) });
  if (res.status === 402) {
    alertLowBalance().catch(() => {});
    return { error: json({ error: "service_busy" }, 402) };
  }
  if (!res.ok) {
    console.error("[lyrics-transcribe] prediction:", res.status, await res.text().catch(() => ""));
    return { error: json({ error: "prediction_failed" }, 502) };
  }
  const pred = await res.json();
  if (typeof pred?.id !== "string") return { error: json({ error: "prediction_failed" }, 502) };
  return { id: pred.id as string };
}

function startTranscription(token: string, audio: string) {
  return createPrediction(token, WHISPERX_VERSION, {
    audio_file: audio,
    language: "pt",
    align_output: true,
    temperature: 0,
    // Voz cantada e isolada: o detector de voz um pouco mais sensível pega o canto mais baixo.
    vad_onset: 0.4,
    vad_offset: 0.3,
  });
}

async function deleteFile(token: string, file: string | null | undefined) {
  if (!file) return;
  await replicate(token, `/files/${file}`, { method: "DELETE" }).catch(() => {});
}

/** Só o que a tela usa, e com tamanho limitado. */
function trimSegments(raw: unknown) {
  const segs = Array.isArray(raw) ? raw.slice(0, 2000) : [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return segs.map((s: Record<string, unknown>) => ({
    start: num(s?.start),
    end: num(s?.end),
    text: typeof s?.text === "string" ? s.text.slice(0, 1000) : "",
    words: Array.isArray(s?.words)
      ? (s.words as Record<string, unknown>[]).slice(0, 400).map((w) => ({
        word: typeof w?.word === "string" ? w.word.slice(0, 60) : "",
        start: num(w?.start),
        end: num(w?.end),
      }))
      : [],
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = Deno.env.get("REPLICATE_API_TOKEN");
  if (!token) return json({ error: "not_configured" }, 500);

  try {
    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");

    if (isForm) {
      const form = await req.formData();
      if (form.get("action") !== "start") return json({ error: "bad_request" }, 400);
      if (!(await showForProducer(form.get("code")))) return json({ error: "invalid_code" }, 403);
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) return json({ error: "missing_file" }, 400);
      if (file.size > MAX_BYTES) return json({ error: "file_too_big" }, 413);

      const up = new FormData();
      up.append("content", file, file.name || "musica.mp3");
      const upRes = await replicate(token, "/files", { method: "POST", body: up });
      if (!upRes.ok) {
        console.error("[lyrics-transcribe] upload:", upRes.status, await upRes.text().catch(() => ""));
        return json({ error: "upload_failed" }, 502);
      }
      const upData = await upRes.json();
      const audio = upData?.urls?.get;
      const fileId = typeof upData?.id === "string" ? upData.id : null;
      if (typeof audio !== "string") return json({ error: "upload_failed" }, 502);

      const sep = await createPrediction(token, DEMUCS_VERSION, {
        audio,
        model_name: "htdemucs",
        stem: "vocals",
        output_format: "mp3",
      });
      if (sep.error) {
        // Sem separação, tenta direto na música inteira.
        const tr = await startTranscription(token, audio);
        if (tr.error) { await deleteFile(token, fileId); return tr.error; }
        return json({ job: { stage: "transcribe", id: tr.id, file: fileId, audio: null } });
      }
      return json({ job: { stage: "separate", id: sep.id, file: fileId, audio } });
    }

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return json({ error: "bad_request" }, 400);
    if (!(await showForProducer(body.code))) return json({ error: "invalid_code" }, 403);
    const job = parseJob(body.job);
    if (!job) return json({ error: "bad_request" }, 400);

    if (body.action === "cancel") {
      await replicate(token, `/predictions/${job.id}/cancel`, { method: "POST" }).catch(() => {});
      await deleteFile(token, job.file);
      return json({ ok: true });
    }

    if (body.action !== "status") return json({ error: "bad_request" }, 400);

    const res = await replicate(token, `/predictions/${job.id}`);
    if (!res.ok) return json({ status: "running", job });
    const pred = await res.json();
    // A etapa precisa ser do modelo que ela diz ser: o id não serve para ler outra coisa da conta.
    const expected = job.stage === "separate" ? DEMUCS_VERSION : WHISPERX_VERSION;
    if (pred?.version !== expected) return json({ error: "bad_request" }, 400);

    if (pred.status === "starting" || pred.status === "processing") return json({ status: "running", job });

    if (job.stage === "separate") {
      const vocals = pred.status === "succeeded" && typeof pred.output?.vocals === "string" ? pred.output.vocals : null;
      // Separação falhou: a música inteira vai para o WhisperX.
      const source = vocals ?? job.audio;
      if (!source) { await deleteFile(token, job.file); return json({ status: "failed" }); }
      const tr = await startTranscription(token, source);
      if (tr.error) { await deleteFile(token, job.file); return tr.error; }
      return json({ status: "running", job: { stage: "transcribe", id: tr.id, file: job.file, audio: null } });
    }

    await deleteFile(token, job.file);
    if (pred.status !== "succeeded") {
      console.error("[lyrics-transcribe] whisperx:", pred.status, pred.error);
      return json({ status: "failed" });
    }
    return json({ status: "done", language: pred.output?.detected_language ?? null, segments: trimSegments(pred.output?.segments) });
  } catch (e) {
    console.error("[lyrics-transcribe] unhandled:", e);
    return json({ error: "server_error" }, 500);
  }
});
