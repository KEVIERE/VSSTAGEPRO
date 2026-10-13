import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const DISPOSABLE_REGEX = /@(tempmail|10minutemail|guerrillamail|sharklasers|dispostable|mailinator|yopmail|throwaway|getairmail|fakeinbox|trashmail|mohmal|crazymailing|nada|inboxkitten|burnermail|fakemail|mytemp|temp-mail|generator\.email|emailondeck|dropmail)\./i;

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

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) {
    return { ok: true, userId: "service_role" };
  }

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body.action || "");

  // Ação de ping/presença: executada por qualquer usuário para registrar IP e versão
  if (action === "ping") {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: true });

    const clientIp = req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip");

    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData } = await asUser.auth.getUser();
    if (userData?.user?.id && clientIp) {
      const version = String(body.version || "v1.1.18");
      await admin.auth.admin.updateUserById(userData.user.id, {
        user_metadata: {
          ...(userData.user.user_metadata || {}),
          last_ip: clientIp,
          app_version: version,
          last_seen_at: new Date().toISOString(),
        },
      }).catch(() => {});
    }
    return json({ ok: true, ip: clientIp });
  }

  // Todas as demais ações exigem privilégio de administrador
  const adminCheck = await callerIsAdmin(req);
  if (!adminCheck.ok) return json({ error: "not_allowed" }, 403);

  // Ação 1: Bloquear usuário
  if (action === "block") {
    const targetUserId = String(body.userId || "");
    const reason = String(body.reason || "Suspenso pelo painel de administração");
    if (!targetUserId) return json({ error: "missing_user" }, 400);

    const { error: blockErr } = await admin.from("director_licenses").update({
      blocked: true,
      blocked_reason: reason,
      blocked_at: new Date().toISOString(),
    }).eq("user_id", targetUserId);

    if (blockErr) return json({ error: blockErr.message }, 500);
    return json({ ok: true });
  }

  // Ação 2: Desbloquear usuário
  if (action === "unblock") {
    const targetUserId = String(body.userId || "");
    if (!targetUserId) return json({ error: "missing_user" }, 400);

    const { error: unblockErr } = await admin.from("director_licenses").update({
      blocked: false,
      blocked_reason: null,
      blocked_at: null,
    }).eq("user_id", targetUserId);

    if (unblockErr) return json({ error: unblockErr.message }, 500);
    return json({ ok: true });
  }

  // Ação 3: Estender teste (+24h ou +48h)
  if (action === "extend-trial") {
    const targetUserId = String(body.userId || "");
    const hours = Number(body.hours || 48);
    if (!targetUserId) return json({ error: "missing_user" }, 400);

    const { data: lic } = await admin.from("director_licenses").select("trial_hours").eq("user_id", targetUserId).maybeSingle();
    const currentHours = lic?.trial_hours || 48;
    const newHours = currentHours + hours;

    const { error: extErr } = await admin.from("director_licenses").update({
      trial_hours: newHours,
    }).eq("user_id", targetUserId);

    if (extErr) return json({ error: extErr.message }, 500);
    return json({ ok: true, newHours });
  }

  // Ação Principal: Overview detalhado com Assinantes, Testes e Antifraude
  try {
    const [usersRes, licRes] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from("director_licenses").select("*"),
    ]);

    const users = usersRes.data?.users || [];
    const licenses = (licRes.data as Array<Record<string, unknown>>) || [];

    const licMap = new Map<string, Record<string, unknown>>();
    licenses.forEach((l) => licMap.set(String(l.user_id), l));

    const activeSubscribers = [];
    const activeTrials = [];
    const suspicious = [];
    const ipGroups = new Map<string, string[]>();

    const now = new Date();

    for (const u of users) {
      const l = licMap.get(u.id);
      const meta = (u.user_metadata as Record<string, unknown>) || {};
      const ip = (meta.last_ip as string | undefined) ?? (l?.last_ip as string | undefined) ?? null;
      const appVersion = (meta.app_version as string | undefined) ?? (l?.last_app_version as string | undefined) ?? "v1.1.18";
      const name = (meta.name as string | undefined) ?? null;
      const phone = (meta.phone as string | undefined) ?? null;
      const email = u.email || "";
      const isBlocked = Boolean(l?.blocked);

      if (ip && ip !== "127.0.0.1" && ip !== "::1") {
        const list = ipGroups.get(ip) || [];
        list.push(email);
        ipGroups.set(ip, list);
      }

      const sub = l?.subscription as string | undefined;
      const compUntil = l?.comp_until ? new Date(String(l.comp_until)) : null;
      const trialStarted = l?.trial_started_at ? new Date(String(l.trial_started_at)) : new Date(u.created_at);
      const trialHours = Number(l?.trial_hours || 48);
      const trialEnds = new Date(trialStarted.getTime() + trialHours * 3600 * 1000);

      // 1. Assinantes Ativos
      if (!isBlocked && (sub === "active" || (compUntil && compUntil > now))) {
        let daysRemaining: number | null = null;
        let renewalText = "Assinatura ativa";
        if (l?.current_period_end) {
          const endDate = new Date(String(l.current_period_end));
          daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (86400 * 1000)));
          const dStr = endDate.toLocaleDateString("pt-BR");
          renewalText = `Renova em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dStr})`;
        } else if (compUntil) {
          const days = Math.max(0, Math.ceil((compUntil.getTime() - now.getTime()) / (86400 * 1000)));
          renewalText = `Bônus válido por mais ${days} ${days === 1 ? "dia" : "dias"}`;
        }

        activeSubscribers.push({
          userId: u.id,
          email,
          name,
          phone,
          plan: (l?.plan as string | undefined) || (compUntil ? "promo" : "monthly"),
          priceFormatted: l?.plan === "yearly" ? "R$ 349,00/ano" : l?.plan === "monthly" ? "R$ 55,00/mês" : "Manual",
          currentPeriodEnd: (l?.current_period_end as string | undefined) ?? (l?.comp_until as string | undefined) ?? null,
          daysRemaining,
          renewalText,
          subscribedAt: (l?.subscribed_at as string | undefined) ?? u.created_at,
          lastIp: ip,
          lastAppVersion: appVersion,
          lastSeenAt: (l?.updated_at as string | undefined) ?? u.last_sign_in_at ?? null,
          stripeCustomerId: (l?.stripe_customer_id as string | undefined) ?? null,
          stripeSubscriptionId: (l?.stripe_subscription_id as string | undefined) ?? null,
        });
      }

      // 2. Em Teste Ativo (Trial)
      if (!isBlocked && (sub === "trial" || !sub || sub === "canceled") && (!compUntil || compUntil <= now) && now < trialEnds) {
        const msLeft = trialEnds.getTime() - now.getTime();
        const hoursLeft = Math.max(0, Math.ceil(msLeft / (3600 * 1000)));
        const daysLeft = Math.floor(hoursLeft / 24);
        const remHours = hoursLeft % 24;
        const timeLeftText = daysLeft > 0 ? `Faltam ${daysLeft}d ${remHours}h` : `Faltam ${hoursLeft}h`;
        const elapsedMs = now.getTime() - trialStarted.getTime();
        const totalMs = trialHours * 3600 * 1000;
        const percentUsed = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));

        activeTrials.push({
          userId: u.id,
          email,
          name,
          phone,
          trialStartedAt: trialStarted.toISOString(),
          trialEndsAt: trialEnds.toISOString(),
          hoursRemaining: hoursLeft,
          timeLeftText,
          percentUsed,
          lastIp: ip,
          lastAppVersion: appVersion,
          lastSeenAt: (l?.updated_at as string | undefined) ?? u.last_sign_in_at ?? null,
          totalHours: trialHours,
        });
      }

      // 3. Contas Suspeitas
      if (isBlocked) {
        suspicious.push({
          userId: u.id,
          email,
          name,
          phone,
          reason: l?.blocked_reason ? `Conta suspensa: ${l.blocked_reason}` : "Conta suspensa pela administração",
          riskLevel: "alto",
          createdAt: u.created_at,
          lastIp: ip,
          blocked: true,
        });
      } else if (DISPOSABLE_REGEX.test(email)) {
        suspicious.push({
          userId: u.id,
          email,
          name,
          phone,
          reason: "E-mail temporário descartável detectado (tentativa de burlar teste)",
          riskLevel: "alto",
          createdAt: u.created_at,
          lastIp: ip,
          blocked: false,
        });
      }
    }

    // Alerta de múltiplos e-mails no mesmo IP
    for (const [ip, emails] of ipGroups.entries()) {
      if (emails.length > 1) {
        emails.forEach((e) => {
          const u = users.find((x) => x.email === e);
          if (u) {
            const alreadyIn = suspicious.find((s) => s.userId === u.id);
            if (alreadyIn) {
              alreadyIn.reason += ` • Mesmo IP detectado em ${emails.length} contas`;
            } else {
              suspicious.push({
                userId: u.id,
                email: e,
                name: (u.user_metadata?.name as string | undefined) ?? null,
                phone: (u.user_metadata?.phone as string | undefined) ?? null,
                reason: `Mesmo IP de computador compartilhado por ${emails.length} contas diferentes (${emails.filter((x) => x !== e).join(", ")})`,
                riskLevel: "alto",
                createdAt: u.created_at,
                lastIp: ip,
                blocked: Boolean(licMap.get(u.id)?.blocked),
              });
            }
          }
        });
      }
    }

    // Ordenação: Assinantes que renovam mais cedo primeiro
    activeSubscribers.sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999));
    // Testes que expiram mais cedo primeiro
    activeTrials.sort((a, b) => a.hoursRemaining - b.hoursRemaining);

    return json({
      subscribers: activeSubscribers,
      trials: activeTrials,
      suspicious,
      stats: {
        totalUsers: users.length,
        subscribersCount: activeSubscribers.length,
        trialsCount: activeTrials.length,
        suspiciousCount: suspicious.length,
      },
    });
  } catch (err) {
    console.error("admin-insights error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
