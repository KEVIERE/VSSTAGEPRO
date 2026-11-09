import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import {
  buildUnsubToken, chunkArray, fillVars, LIMITS, renderEmailHtml, sleep,
  unsubscribeFooter, whatsappEta,
} from "../_shared/outreach.ts";
import {
  batchIdempotencyKey, DEFAULT_FROM, errorMessage, readBatchResponse, RESEND_ENDPOINT,
  shouldSplit, toResendItem, type ResendItem, type ResendResult,
} from "../_shared/resendBatch.ts";

// Comunicação com os usuários: envia um lote de e-mail (Resend) ou de WhatsApp (Twilio), e
// cuida do remetente e dos modelos de WhatsApp na Twilio.
//
// Por que em lotes: a Edge Function tem 150s de execução e a base cresce. A tela do admin
// chama esta função em sequência, com barra de progresso. Fechar a tela pausa a campanha; o
// histórico retoma do ponto onde parou. Nada é perdido e ninguém recebe duas vezes, porque a
// fila no banco entrega cada destinatário a uma execução só (admin_outreach_claim).
//
// Ordens que a tela manda: run, pause, cancel, sender-status, sender-register, sender-verify,
// template-create, template-approve, template-status.

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

const TWILIO_API = "https://api.twilio.com/2010-04-01";
const TWILIO_CONTENT = "https://content.twilio.com/v1/Content";
const TWILIO_SENDERS = "https://messaging.twilio.com/v2/Channels/Senders";

/** URL pública das nossas funções, montada de constante e não de req.url: proxy muda o host
 *  e a assinatura da Twilio deixa de bater. */
function publicFunctionUrl(name: string): string {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  return `${base.replace(/\/+$/, "")}/functions/v1/${name}`;
}

async function callerIsAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return false;
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData?.user?.id) return false;
  const { data: isAdminData, error } = await asUser.rpc("is_admin");
  if (error) return false;
  return isAdminData === true;
}

function twilioAuth(): { sid: string; token: string } | null {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  return sid && token ? { sid, token } : null;
}

async function twilioFetch(url: string, init: RequestInit = {}) {
  const auth = twilioAuth();
  if (!auth) throw new Error("twilio_not_configured");
  return await fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${auth.sid}:${auth.token}`)}`,
      ...(init.headers ?? {}),
    },
  });
}

// ─── E-mail (Resend) ─────────────────────────────────────────────────────────

type Row = {
  id: number;
  address: string;
  name: string | null;
  vars: Record<string, string> | null;
  attempts: number;
};

async function sendEmailBatch(
  campaign: Record<string, unknown>, rows: Row[], apiKey: string, secret: string, deadline: number,
): Promise<{ results: ResendResult[]; rows: Row[] }> {
  const subject = String(campaign.subject ?? "");
  const body = String(campaign.body ?? "");
  const replyTo = (campaign.reply_to as string | null) ?? null;
  const from = Deno.env.get("OUTREACH_FROM_EMAIL") || DEFAULT_FROM;

  // Mantém pares (item, linha) na MESMA ordem: é o que permite ligar data[i] ao destinatário.
  const pairs: Array<{ item: ResendItem; row: Row }> = [];
  for (const row of rows) {
    const vars = { nome: row.name ?? "", ...(row.vars ?? {}) };
    if (!vars.nome) vars.nome = 'você';
    const unsub = await buildUnsubToken(secret, "email", row.address);
    const unsubUrl = `${publicFunctionUrl("outreach-unsubscribe")}?t=${encodeURIComponent(unsub ?? "")}`;
    pairs.push({
      row,
      item: toResendItem({
        from,
        to: row.address,
        subject: fillVars(subject, vars),
        html: renderEmailHtml(body, vars, unsubscribeFooter(unsubUrl)),
        text: fillVars(body, vars),
        replyTo,
        unsubUrl,
      }),
    });
  }

  const send = async (batch: Array<{ item: ResendItem; row: Row }>, depth = 0): Promise<ResendResult[]> => {
    if (!batch.length) return [];
    if (Date.now() > deadline) {
      return batch.map((_, i) => ({ kind: "retry" as const, index: i, error: "deadline" }));
    }
    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": await batchIdempotencyKey(
            String(campaign.id), batch[0].row.id, batch[batch.length - 1].row.id,
          ),
        },
        body: JSON.stringify(batch.map((p) => p.item)),
      });
    } catch (e) {
      // Timeout ou queda de rede: não dá para saber se saiu. Volta para a fila.
      console.error("resend fetch", e);
      return batch.map((_, i) => ({ kind: "retry" as const, index: i, error: "resend_unavailable" }));
    }

    const payload = await res.json().catch(() => null);
    const results = readBatchResponse(res.status, payload, batch.length);

    // Um lote rejeitado inteiro pode esconder um único endereço ruim: divide até isolar.
    if (shouldSplit(results, batch.length) && depth < 8) {
      await sleep(300);
      const mid = Math.ceil(batch.length / 2);
      const left = await send(batch.slice(0, mid), depth + 1);
      const right = await send(batch.slice(mid), depth + 1);
      return [...left, ...right.map((r) => ({ ...r, index: r.index + mid }))];
    }
    if (!res.ok) console.error("resend", res.status, errorMessage(payload));
    return results;
  };

  // Um erro por lote: até 100 itens por chamada, que é o teto do Resend.
  const results: ResendResult[] = [];
  for (const part of chunkArray(pairs, LIMITS.resendBatch)) {
    const offset = pairs.indexOf(part[0]);
    const partResults = await send(part);
    for (const r of partResults) {
      results.push({ ...r, index: r.index + offset } as ResendResult);
    }
  }
  return { results, rows };
}

// ─── WhatsApp (Twilio) ───────────────────────────────────────────────────────

async function whatsappSenderFrom(): Promise<string | null> {
  const configured = Deno.env.get("TWILIO_WHATSAPP_FROM")?.trim();
  if (!configured) return null;
  // Nunca cai no TWILIO_FROM do SMS: aquele número pode não estar registrado no WhatsApp, e
  // mandar de um remetente errado queima o número em vez de avisar que falta configuração.
  return configured.startsWith("whatsapp:") ? configured : `whatsapp:${configured}`;
}

type SendOutcome = { status: "sent" | "failed" | "pending"; provider_id?: string; error?: string };

async function sendWhatsApp(
  campaign: Record<string, unknown>, row: Row, from: string,
): Promise<SendOutcome> {
  const contentSid = (campaign.content_sid as string | null) ?? null;
  const bodyTemplate = String(campaign.body ?? "");
  const variables = (campaign.variables as string[] | null) ?? [];
  const vars: Record<string, string> = { nome: row.name ?? 'você', ...(row.vars ?? {}) };

  const form = new URLSearchParams({ To: `whatsapp:${row.address}`, From: from });

  if (contentSid) {
    // Modelo aprovado: as variáveis vão na ordem declarada no modelo ({{1}}, {{2}}...), como
    // string JSON, que é o formato que a Twilio espera.
    const payload: Record<string, string> = {};
    variables.forEach((key, i) => {
      const v = vars[key];
      payload[String(i + 1)] = v === undefined || v === null || v === "" ? "" : String(v);
    });
    form.set("ContentSid", contentSid);
    if (Object.keys(payload).length) form.set("ContentVariables", JSON.stringify(payload));
  } else {
    // Texto livre: só funciona dentro da janela de 24h aberta pelo próprio usuário. Fora
    // dela a Twilio devolve erro, que vira falha na linha com explicação.
    form.set("Body", fillVars(bodyTemplate, vars));
  }

  let res: Response;
  try {
    const auth = twilioAuth();
    if (!auth) return { status: "failed", error: "whatsapp_not_configured" };
    res = await fetch(`${TWILIO_API}/Accounts/${auth.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${auth.sid}:${auth.token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
  } catch (e) {
    console.error("twilio fetch", e);
    // Rede caiu: pode ter saído. Volta para a fila em vez de falhar para sempre.
    return { status: "pending", error: "network" };
  }

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (res.status >= 200 && res.status < 300) {
    return { status: "sent", provider_id: String((data as { sid?: string }).sid ?? "") };
  }
  const code = Number((data as { code?: number }).code);
  const message = String((data as { message?: string }).message ?? "").slice(0, 200);
  console.error("twilio", res.status, code, message);

  // 429 e 5xx são temporários: devolve para a fila, com limite de tentativas no banco.
  if (res.status === 429 || res.status >= 500) return { status: "pending", error: `twilio_${res.status}` };
  // 63016: fora da janela de 24h sem template. 63003/63007: número sem WhatsApp. São
  // definitivos para esta linha, e a mensagem explica o motivo no histórico.
  const friendly = code === 63016 ? "whatsapp_template_required"
    : code === 63003 || code === 63007 || code === 21211 ? "whatsapp_invalid_number"
    : `twilio_${code || res.status}`;
  return { status: "failed", error: `${friendly}${message ? `: ${message}` : ""}`.slice(0, 240) };
}

// ─── Motor ───────────────────────────────────────────────────────────────────

async function run(body: Record<string, unknown>) {
  const campaignId = String(body.campaignId ?? "");
  if (!campaignId) return json({ error: "invalid_value" }, 400);

  const deadline = Date.now() + LIMITS.runDeadlineMs;

  const { data: campaign, error: cErr } = await admin.from("outreach_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (cErr) throw cErr;
  if (!campaign) return json({ error: "not_found" }, 404);
  if (campaign.status === "canceled") return json({ ok: true, canceled: true, done: true });
  if (campaign.status === "done") return json({ ok: true, done: true });
  // Campanha sem destinatário não tem nada a fazer. Sem esta saída, admin_outreach_start não
  // atualizaria linha nenhuma e a tela diria "está sendo enviada em outra aba" em vez de
  // explicar que a lista veio vazia.
  if (!Number(campaign.total ?? 0)) return json({ ok: true, done: true, sent: 0, failed: 0, left: 0 });

  const channel = campaign.channel as "email" | "whatsapp";
  const secret = Deno.env.get("OUTREACH_UNSUB_SECRET") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

  let from = "";
  if (channel === "whatsapp") {
    const sender = await whatsappSenderFrom();
    if (!sender) return json({ error: "whatsapp_not_configured" }, 502);
    from = sender;
  } else if (!resendKey) {
    return json({ error: "resend_not_configured" }, 502);
  }

  // Lease de execução: se outra aba já está enviando esta campanha, esta para aqui.
  let runToken = body.runToken ? String(body.runToken) : "";
  if (!runToken) {
    const { data: token, error: sErr } = await admin.rpc("admin_outreach_start", { p_campaign: campaignId });
    if (sErr) throw sErr;
    if (!token) return json({ error: "already_running" }, 409);
    runToken = String(token);
  }

  let total = { sent: 0, failed: 0, left: campaign.total ?? 0 };
  let guard = 0;

  while (Date.now() < deadline && guard++ < 200) {
    const batchSize = channel === "whatsapp" ? LIMITS.whatsappBatch : LIMITS.resendBatch;
    const { data: claimed, error: qErr } = await admin.rpc("admin_outreach_claim", {
      p_campaign: campaignId, p_run_token: runToken, p_limit: batchSize,
    });
    if (qErr) {
      if (/run_superseded/.test(qErr.message)) return json({ error: "run_superseded" }, 409);
      throw qErr;
    }
    const rows = (claimed ?? []) as Row[];
    if (!rows.length) break;

    let results: Array<{ id: number; status: string; provider_id?: string; error?: string }> = [];

    if (channel === "email") {
      const { results: resendResults } = await sendEmailBatch(campaign, rows, resendKey, secret, deadline);
      results = resendResults.map((r) => ({
        id: rows[r.index]?.id,
        status: r.kind === "sent" ? "sent" : r.kind === "retry" ? "pending" : "failed",
        provider_id: r.kind === "sent" ? r.providerId : undefined,
        error: r.kind === "sent" ? undefined : r.error,
      }));
    } else {
      for (const row of rows) {
        // Serial e com intervalo: o número entrega ~1 mensagem a cada 3s. Disparar em paralelo
        // faz a Twilio recusar o lote inteiro por rate limit.
        if (Date.now() > deadline) {
          results.push({ id: row.id, status: "pending", error: "deadline" });
          continue;
        }
        const out = await sendWhatsApp(campaign, row, from);
        results.push({ id: row.id, status: out.status, provider_id: out.provider_id, error: out.error });
        if (out.status !== "failed") {
          await admin.from("outreach_channel_state")
            .update({ last_sent_at: new Date().toISOString() })
            .eq("channel", "whatsapp");
          await sleep(LIMITS.whatsappGapMs);
        }
      }
    }

    const { data: marked, error: mErr } = await admin.rpc("admin_outreach_mark", {
      p_campaign: campaignId, p_run_token: runToken, p_results: results,
    });
    if (mErr) throw mErr;
    if (marked && (marked as { ok?: boolean }).ok === false) {
      return json({ error: (marked as { error?: string }).error ?? "run_superseded" }, 409);
    }
    if (marked) {
      total = {
        sent: Number((marked as { sent?: number }).sent ?? 0),
        failed: Number((marked as { failed?: number }).failed ?? 0),
        left: Number((marked as { left?: number }).left ?? 0),
      };
    }
    if (marked && (marked as { done?: boolean }).done) break;
  }

  // Ainda sobrou gente: a tela chama de novo. paused = true, o front continua.
  return json({
    ok: true,
    paused: total.left > 0,
    done: total.left === 0,
    sent: total.sent,
    failed: total.failed,
    left: total.left,
    eta: channel === "whatsapp" ? whatsappEta(total.left) : null,
    runToken,
  });
}

// ─── Remetente de WhatsApp (Senders API) ────────────────────────────────────

type SenderPayload = {
  sid?: string;
  status?: string;
  sender_id?: string;
  profile?: {
    name?: string;
    display_name_status?: string;
    pending_display_name?: string;
    pending_display_name_status?: string;
  };
  offline_reasons?: Array<{ code?: string; message?: string }>;
};

async function senderStatus() {
  const res = await twilioFetch(`${TWILIO_SENDERS}?Channel=whatsapp&PageSize=20`);
  if (!res.ok) return json({ error: `twilio_${res.status}` }, 502);
  const data = await res.json().catch(() => ({}));
  const list = ((data as { senders?: SenderPayload[] }).senders ?? []);
  const configured = await whatsappSenderFrom();
  const plain = (configured ?? "").replace(/^whatsapp:/, "");
  const mine = list.find((s) => (s.sender_id ?? "").replace(/^whatsapp:/, "") === plain) ?? list[0] ?? null;

  if (mine?.sid) {
    await admin.rpc("admin_outreach_save_sender", {
      p_sid: mine.sid, p_status: mine.status ?? null, p_display_name: mine.profile?.name ?? null,
    });
  }

  return json({
    ok: true,
    phone: plain || null,
    sender: mine
      ? {
        sid: mine.sid,
        status: mine.status,
        displayName: mine.profile?.name ?? null,
        displayNameStatus: mine.profile?.pending_display_name_status ?? mine.profile?.display_name_status ?? null,
        pendingDisplayName: mine.profile?.pending_display_name ?? null,
        offlineReasons: (mine.offline_reasons ?? []).map((r) => r.message ?? r.code).filter(Boolean),
      }
      : null,
    online: mine?.status === "ONLINE",
  });
}

async function senderRegister(body: Record<string, unknown>) {
  const phone = String(body.phone ?? "").trim();
  const name = String(body.displayName ?? "").trim();
  const wabaId = String(body.wabaId ?? "").trim();
  const method = body.method === "voice" ? "voice" : "sms";
  if (!/^\+[1-9]\d{9,14}$/.test(phone)) return json({ error: "invalid_value", field: "phone" }, 400);
  if (!name) return json({ error: "invalid_value", field: "displayName" }, 400);
  if (!wabaId) return json({ error: "invalid_value", field: "wabaId" }, 400);

  const res = await twilioFetch(TWILIO_SENDERS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender_id: `whatsapp:${phone}`,
      profile: { name },
      configuration: { waba_id: wabaId, verification_method: method },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("sender register", res.status, data);
    return json({ error: errorMessage(data), status: res.status }, 502);
  }
  const sid = (data as SenderPayload).sid;
  if (sid) {
    await admin.rpc("admin_outreach_save_sender", {
      p_sid: sid, p_status: (data as SenderPayload).status ?? null, p_display_name: name,
    });
  }
  return json({ ok: true, sid, status: (data as SenderPayload).status ?? null });
}

async function senderVerify(body: Record<string, unknown>) {
  const sid = String(body.sid ?? "").trim();
  const code = String(body.code ?? "").trim();
  if (!sid || !code) return json({ error: "invalid_value" }, 400);
  const res = await twilioFetch(`${TWILIO_SENDERS}/${sid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configuration: { verification_code: code } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("sender verify", res.status, data);
    return json({ error: errorMessage(data), status: res.status }, 502);
  }
  return senderStatus();
}

// ─── Modelos de WhatsApp (Content API) ──────────────────────────────────────

async function templateCreate(body: Record<string, unknown>) {
  const templateId = String(body.templateId ?? "");
  if (!templateId) return json({ error: "invalid_value" }, 400);

  const { data: tpl, error } = await admin.from("outreach_templates").select("*").eq("id", templateId).maybeSingle();
  if (error) throw error;
  if (!tpl) return json({ error: "not_found" }, 404);

  const variables = (tpl.variables as string[] | null) ?? [];
  // O texto-fonte usa {{nome}}; a Twilio espera {{1}}, {{2}} na ordem declarada.
  let text = String(tpl.body ?? "");
  variables.forEach((key, i) => {
    text = text.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"), `{{${i + 1}}}`);
  });

  const name = String(tpl.name ?? "modelo")
    .normalize("NFD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase().slice(0, 60);

  const res = await twilioFetch(TWILIO_CONTENT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      friendly_name: `${name}_${Date.now().toString(36)}`,
      language: "pt_BR",
      variables: Object.fromEntries(variables.map((k, i) => [String(i + 1), k])),
      types: { "twilio/text": { body: text } },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("content create", res.status, data);
    return json({ error: errorMessage(data) }, 502);
  }
  const sid = String((data as { sid?: string }).sid ?? "");
  await admin.rpc("admin_outreach_template_twilio", {
    p_id: templateId, p_content_sid: sid, p_approval_status: "draft",
  });
  return json({ ok: true, contentSid: sid });
}

async function templateApprove(body: Record<string, unknown>) {
  const templateId = String(body.templateId ?? "");
  if (!templateId) return json({ error: "invalid_value" }, 400);
  const { data: tpl } = await admin.from("outreach_templates").select("*").eq("id", templateId).maybeSingle();
  if (!tpl?.twilio_content_sid) return json({ error: "no_content_sid" }, 400);

  const category = ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(String(tpl.approval_category))
    ? String(tpl.approval_category) : "UTILITY";
  const name = String(tpl.name ?? "modelo")
    .normalize("NFD").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase().slice(0, 60);

  const res = await twilioFetch(`${TWILIO_CONTENT}/${tpl.twilio_content_sid}/ApprovalRequests/WhatsApp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || "vs_stage", category }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("content approve", res.status, data);
    return json({ error: errorMessage(data) }, 502);
  }
  await admin.rpc("admin_outreach_template_twilio", {
    p_id: templateId, p_content_sid: tpl.twilio_content_sid, p_approval_status: "pending",
  });
  return json({ ok: true, status: String((data as { status?: string }).status ?? "pending") });
}

async function templateStatus(body: Record<string, unknown>) {
  const templateId = String(body.templateId ?? "");
  if (!templateId) return json({ error: "invalid_value" }, 400);
  const { data: tpl } = await admin.from("outreach_templates").select("*").eq("id", templateId).maybeSingle();
  if (!tpl?.twilio_content_sid) return json({ error: "no_content_sid" }, 400);

  const res = await twilioFetch(`${TWILIO_CONTENT}/${tpl.twilio_content_sid}/ApprovalRequests`);
  if (!res.ok) return json({ error: `twilio_${res.status}` }, 502);
  const data = await res.json().catch(() => ({}));
  const requests = ((data as { approval_requests?: Array<{ status?: string }> }).approval_requests ?? []);
  const raw = String(requests[0]?.status ?? "").toLowerCase();
  const mapped = raw === "approved" ? "approved"
    : raw === "rejected" ? "rejected"
    : raw === "received" || raw === "pending" || raw === "submitted" ? "pending"
    : raw === "paused" ? "paused"
    : "unknown";
  await admin.rpc("admin_outreach_template_twilio", {
    p_id: templateId, p_content_sid: tpl.twilio_content_sid, p_approval_status: mapped,
  });
  return json({ ok: true, status: mapped, raw });
}

// ─── Entrada ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!(await callerIsAdmin(req))) return json({ error: "not_allowed" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  try {
    switch (body.action) {
      case "run": return await run(body);
      case "pause": {
        const { error } = await admin.rpc("admin_outreach_pause", { p_campaign: String(body.campaignId ?? "") });
        if (error) throw error;
        return json({ ok: true });
      }
      case "cancel": {
        const { error } = await admin.rpc("admin_outreach_cancel", { p_campaign: String(body.campaignId ?? "") });
        if (error) throw error;
        return json({ ok: true });
      }
      case "sender-status": return await senderStatus();
      case "sender-register": return await senderRegister(body);
      case "sender-verify": return await senderVerify(body);
      case "template-create": return await templateCreate(body);
      case "template-approve": return await templateApprove(body);
      case "template-status": return await templateStatus(body);
      default: return json({ error: "invalid_action" }, 400);
    }
  } catch (e) {
    const msg = (e as Error).message ?? "";
    console.error("outreach-send", body.action, e);
    if (/twilio_not_configured/.test(msg)) return json({ error: "whatsapp_not_configured" }, 502);
    return json({ error: msg && msg.length < 80 ? msg : "request_failed" }, 500);
  }
});
