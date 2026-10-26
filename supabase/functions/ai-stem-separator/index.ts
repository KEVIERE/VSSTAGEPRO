import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DEMUCS_VERSION = "25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function notifyTelegramLowBalance(): Promise<void> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) return;

  try {
    const text =
      `🚨 *[ALERTA: REPLICATE SEM SALDO]*\n\n` +
      `Um cliente tentou criar um VS via Inteligência Artificial agora, mas o provedor de GPU (Replicate) retornou erro 402 de saldo esgotado.\n\n` +
      `👉 *Ação urgente*: Recarregue os créditos da Replicate imediatamente para liberar o uso das GPUs:\n` +
      `https://replicate.com/account/billing`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error("[ai-stem-separator] failed to send Telegram alert:", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const token = Deno.env.get("REPLICATE_API_TOKEN");
  if (!token) {
    return json({ error: "missing_replicate_token", message: "Token da Replicate não configurado no servidor." }, 500);
  }

  // Autenticação do usuário (apenas clientes autenticados podem rodar separação)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "not_authenticated", message: "Apenas usuários conectados podem usar a IA de separação." }, 401);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return json({ error: "missing_file", message: "Nenhum arquivo de áudio enviado." }, 400);
    }

    // 1. Upload do arquivo para a infraestrutura da Replicate
    const upForm = new FormData();
    upForm.append("content", file, file.name || "song.wav");

    const upRes = await fetch("https://api.replicate.com/v1/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: upForm,
    });

    if (!upRes.ok) {
      const upErr = await upRes.text();
      console.error("[ai-stem-separator] upload error:", upErr);
      return json({ error: "upload_failed", message: "Falha ao enviar arquivo para o motor de IA." }, 502);
    }

    const upData = await upRes.json();
    const audioUrl = upData.urls?.get;
    if (!audioUrl) {
      return json({ error: "no_audio_url", message: "URL do áudio não retornada pela Replicate." }, 502);
    }

    // 2. Criação do job de predição com o modelo Demucs v4 (HTDemucs Fine-Tuned)
    const predRes = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: DEMUCS_VERSION,
        input: {
          audio: audioUrl,
          model_name: "htdemucs_ft",
          output_format: "wav",
        },
      }),
    });

    if (!predRes.ok) {
      const predErr = await predRes.json().catch(() => ({}));
      console.error("[ai-stem-separator] pred error:", predErr);
      if (predRes.status === 402) {
        notifyTelegramLowBalance().catch(() => {});
        return json({
          error: "service_busy",
          message: "Os servidores de Inteligência Artificial estão com alta demanda no momento. Nossa equipe técnica já foi notificada. Por favor, tente novamente em alguns instantes.",
        }, 402);
      }
      return json({ error: "prediction_failed", message: predErr?.detail || "Erro ao iniciar separação na IA." }, 502);
    }

    const pred = await predRes.json();
    const predId = pred.id;

    // 3. Polling até a separação ser concluída pela GPU
    const maxAttempts = 60; // até ~2 minutos
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));

      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!pollRes.ok) continue;

      const pData = await pollRes.json();
      if (pData.status === "succeeded") {
        const out = pData.output || {};
        return json({
          ok: true,
          stems: {
            vocals: out.vocals,
            drums: out.drums,
            bass: out.bass,
            other: out.other,
            guitar: out.guitar || null,
            piano: out.piano || null,
          },
        });
      }

      if (pData.status === "failed" || pData.status === "canceled") {
        return json({
          error: "processing_failed",
          message: pData.error || "A separação de áudio pela IA falhou.",
        }, 502);
      }
    }

    return json({ error: "timeout", message: "Tempo limite de processamento na IA excedido." }, 504);
  } catch (e) {
    console.error("[ai-stem-separator] unhandled:", e);
    return json({ error: "server_error", message: (e as Error).message }, 500);
  }
});
