import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { isStopMessage, normalizePhone, verifyTwilioSignature } from "../_shared/outreach.ts";

// O que chega do WhatsApp pela Twilio: hoje, o descadastro.
//
// Quem recebe uma mensagem e responde SAIR (ou PARAR, STOP) não quer mais receber. Aqui a
// pessoa vira opt-out na hora, e some das próximas listas.
//
// Cuidados que já custaram caro em outros projetos:
//  - a assinatura X-Twilio-Signature é conferida com a URL PÚBLICA exata, montada de
//    constante. Usar req.url quebra a validação atrás de proxy ou rewrite.
//  - o corpo é form-encoded: as chaves entram na assinatura em ordem, então é preciso ler os
//    campos para conferir. Assinatura errada é 403, sem tocar em nada.
//  - respondemos 204 sempre que processamos, senão a Twilio reenfileira o mesmo aviso.
//
// Enquanto o número não estiver registrado no WhatsApp, esta função não recebe nada. Ela fica
// publicada e inerte, para o dia em que o remetente ficar ONLINE.

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

function publicUrl(): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1/twilio-inbound`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(null, { status: 405 });

  const contentType = req.headers.get("content-type") ?? "";
  const params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return new Response(null, { status: 400 });
    for (const [k, v] of form.entries()) {
      if (typeof v === "string") params[k] = v;
    }
  } else {
    // Sem formulário não há como conferir a assinatura: recusa em vez de aceitar às cegas.
    return new Response(null, { status: 400 });
  }

  const token = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const ok = await verifyTwilioSignature(token, publicUrl(), params, req.headers.get("x-twilio-signature"));
  if (!ok) {
    console.error("twilio-inbound assinatura invalida");
    return new Response(null, { status: 403 });
  }

  const body = params.Body ?? "";
  const from = normalizePhone((params.From ?? "").replace(/^whatsapp:/, ""));
  if (!from) return new Response(null, { status: 204 });

  if (isStopMessage(body)) {
    const { error } = await admin.rpc("outreach_optout", {
      p_channel: "whatsapp", p_address: from, p_reason: "whatsapp",
    });
    if (error) {
      console.error("twilio-inbound optout", error);
      // 500 faz a Twilio tentar de novo mais tarde, que é o certo quando o banco falhou.
      return new Response(null, { status: 500 });
    }
    // Resposta curta e TwiML vazio: confirma sem abrir outra conversa.
    return new Response(
      `<Response><Message>Pronto. Você não vai mais receber nossas mensagens. Se precisar de suporte, é só chamar.</Message></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
    );
  }

  // Qualquer outra mensagem é conversa: não mexemos em nada aqui. O suporte responde pelo
  // WhatsApp normal. Registramos só o fato para o histórico não ficar cego.
  await admin.from("webhook_events_log").insert({
    source: "twilio-whatsapp", event_type: "inbound_message", status: "ok",
    detail: `mensagem de ${from.slice(0, 4)}***`,
  }).then(() => {}, () => {});

  return new Response(null, { status: 204 });
});
