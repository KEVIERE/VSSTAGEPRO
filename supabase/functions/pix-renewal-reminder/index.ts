import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { DEFAULT_FROM } from "../_shared/resendBatch.ts";
import {
  dueReminders, isSendingHour, reminderEmail, reminderKey, type ReminderCandidate,
} from "../_shared/pixReminder.ts";

// Aviso por e-mail quando faltam 3, 2 e 1 dia para o período pago vencer (PIX, cartão ou tempo
// manual do admin: nenhum renova sozinho).
//
// Quem chama é o agendamento do banco (pg_cron, migração 20261110150000), de hora em hora das
// 9h às 20h de Brasília, com a senha do Vault no cabeçalho x-cron-secret. Cada aviso é
// reservado no banco antes de sair (pix_reminder_claim): ninguém recebe o mesmo aviso duas
// vezes, e um envio que falhou tenta de novo na hora seguinte.
//
// Corpo opcional: { "dry": true } só lista quem receberia, sem enviar.

const RESEND_SINGLE = "https://api.resend.com/emails";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { data: ok } = await admin.rpc("pix_reminder_secret_ok", { p_secret: req.headers.get("x-cron-secret") ?? "" });
  if (ok !== true) return json({ error: "not_allowed" }, 401);

  const body = await req.json().catch(() => ({})) as { dry?: boolean };
  const now = new Date();
  if (!isSendingHour(now) && !body.dry) return json({ skipped: "fora_do_horario" });

  const { data: rows, error } = await admin.rpc("pix_reminder_candidates");
  if (error) return json({ error: error.message }, 500);
  const due = dueReminders((rows ?? []) as ReminderCandidate[], now);
  if (body.dry) return json({ due: due.map((d) => ({ userId: d.userId, days: d.days, paidUntil: d.paidUntil })) });

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "RESEND_API_KEY ausente" }, 500);
  const from = Deno.env.get("OUTREACH_FROM_EMAIL") || DEFAULT_FROM;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const d of due) {
    const { data: claimed } = await admin.rpc("pix_reminder_claim", {
      p_user: d.userId, p_paid_until: d.paidUntil, p_days: d.days,
    });
    if (claimed !== true) { skipped++; continue; }

    const mail = reminderEmail(d);
    let providerId: string | null = null;
    let err: string | null = null;
    try {
      const res = await fetch(RESEND_SINGLE, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": reminderKey(d),
        },
        body: JSON.stringify({ from, to: [d.email], subject: mail.subject, html: mail.html, text: mail.text }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await res.json().catch(() => null) as { id?: string; message?: string } | null;
      if (res.ok && payload?.id) providerId = payload.id;
      else err = `HTTP ${res.status}: ${payload?.message ?? "sem id"}`;
    } catch (e) {
      err = (e as Error).message;
    }

    await admin.rpc("pix_reminder_done", {
      p_user: d.userId, p_paid_until: d.paidUntil, p_days: d.days, p_provider_id: providerId, p_error: err,
    });
    if (err) failed++; else sent++;
  }

  return json({ due: due.length, sent, failed, skipped });
});
