import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { escapeHtml, verifyUnsubToken } from "../_shared/outreach.ts";

// Descadastro das mensagens de e-mail.
//
// Duas rotas, e a separação é obrigatória, não estilo:
//   GET  -> mostra a página com o botão de confirmar. NÃO grava nada.
//   POST -> grava o opt-out.
//
// O Gmail e o Microsoft Defender abrem links de e-mail sozinhos para varrer. Se o GET
// gravasse, uma única campanha descadastraria a base inteira sem ninguém clicar em nada.
// O header List-Unsubscribe-Post manda o cliente fazer POST direto, que é o caso do botão
// nativo do Gmail/Outlook.

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const secret = () => Deno.env.get("OUTREACH_UNSUB_SECRET") ?? "";

function page(title: string, message: string, status = 200) {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — VS Stage Pro</title></head>
<body style="margin:0;background:#0a0b0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#eaeaea;">
<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
  <div style="width:100%;max-width:420px;background:#17181c;border:1px solid #2c2f38;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,0.5);">
    <div style="height:4px;background:linear-gradient(90deg,#f59e0b,#22c55e);"></div>
    <div style="padding:32px 28px;text-align:center;">
      <img src="https://vsstagepro.com.br/icon-192.png" alt="VS Stage Pro" width="56" height="56" style="display:block;margin:0 auto 14px;border-radius:12px;border:1px solid #2c2f38;">
      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#30d158;font-weight:700;margin-bottom:18px;">VS Stage Pro</div>
      <h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;font-weight:600;">${escapeHtml(title)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#9a9a9a;">${message}</div>
    </div>
  </div>
</div>
</body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function text(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function confirmForm(token: string, address: string) {
  return `
      <p style="margin:0 0 20px;">Podemos parar de mandar mensagens para <strong style="color:#eaeaea;">${escapeHtml(address)}</strong>.</p>
      <form method="post" style="margin:0;">
        <input type="hidden" name="t" value="${escapeHtml(token)}">
        <button type="submit" style="display:inline-block;padding:13px 30px;border:0;border-radius:10px;background:#30d158;color:#06110a;font-size:14px;font-weight:700;cursor:pointer;">
          Não quero mais receber
        </button>
      </form>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#55555a;">
        Se foi engano, é só fechar esta página: sua conta continua recebendo os avisos importantes.
      </p>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" || req.method === "HEAD") {
    const token = url.searchParams.get("t") ?? "";
    const check = await verifyUnsubToken(secret(), token);
    if (!check.ok) {
      return page("Link inválido", "Este link de descadastro não vale mais. Se ainda estiver recebendo mensagens, responda o último e-mail que resolveremos para você.", 400);
    }
    if (check.channel !== "email") {
      return page("Link inválido", "Este link é de e-mail. Para parar as mensagens no WhatsApp, responda SAIR na conversa.", 400);
    }
    return page("Não quero mais receber", confirmForm(token, check.address));
  }

  if (req.method !== "POST") return text(405, "method_not_allowed");

  // O POST pode vir do formulário ou do descadastro de um clique do Gmail/Outlook.
  let token = url.searchParams.get("t") ?? "";
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData().catch(() => null);
    if (form) token = String(form.get("t") ?? token);
  }

  const check = await verifyUnsubToken(secret(), token);
  if (!check.ok || check.channel !== "email") {
    return page("Link inválido", "Este link de descadastro não vale mais. Se ainda estiver recebendo mensagens, responda o último e-mail que resolveremos para você.", 400);
  }

  const { error } = await admin.rpc("outreach_optout", {
    p_channel: "email", p_address: check.address, p_reason: "link",
  });
  if (error) {
    console.error("outreach-unsubscribe", error);
    return page("Não deu certo agora", "Tivemos um problema para registrar seu pedido. Tente de novo em alguns minutos.", 500);
  }

  return page("Pronto, você saiu da lista", `Não vamos mais enviar avisos para <strong style="color:#eaeaea;">${escapeHtml(check.address)}</strong>. Se mudar de ideia, é só falar com o suporte.`);
});
