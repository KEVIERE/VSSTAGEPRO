/*
# Monitoramento, Antifraude, Detecção de Crack e Histórico Unificado

1. Tabelas
- `service_health` — Registros periódicos de saúde dos serviços externos (Supabase, Resend, Stripe, Replicate, GitHub).
- `app_heartbeats` — Sinais de integridade enviados pelo app desktop (processo principal) para detecção de tamper/crack.
- `hardware_blacklist` — Dispositivos bloqueados por abuso ou adulteração.
- `webhook_events_log` — Log de eventos e falhas de webhooks recebidos (ex.: Stripe).
- `login_events` — Histórico de acessos por usuário com IP, hardware e versão do app.

2. Funções Administrativas
- `admin_service_health()` — Estado atual e histórico recente de cada serviço.
- `admin_tamper_alerts()` — Tentativas detectadas de crack ou uso ilegal sem autenticação.
- `admin_funnel(p_days)` — Funil de conversão (cadastro -> confirmação -> abertura -> uso de palco -> assinatura).
- `admin_timeline(p_days)` — Linha do tempo unificada com deploys, alertas, vendas e ações de admin.
*/

-- ─── 1. service_health ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_health (
  id bigserial PRIMARY KEY,
  service text NOT NULL,
  status text NOT NULL CHECK (status IN ('up', 'down', 'degraded')),
  latency_ms int,
  detail text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_health_service_idx ON service_health (service, checked_at DESC);
ALTER TABLE service_health ENABLE ROW LEVEL SECURITY;

-- ─── 2. app_heartbeats (detecção de crack/tamper) ──────────────────────────────

CREATE TABLE IF NOT EXISTS app_heartbeats (
  id bigserial PRIMARY KEY,
  hw_id text NOT NULL,
  ip text,
  app_version text NOT NULL,
  asar_sha text,
  has_session boolean NOT NULL DEFAULT false,
  tampered boolean NOT NULL DEFAULT false,
  reason text,
  alert_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_heartbeats_hw_idx ON app_heartbeats (hw_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_heartbeats_tampered_idx ON app_heartbeats (tampered, created_at DESC);
ALTER TABLE app_heartbeats ENABLE ROW LEVEL SECURITY;

-- ─── 3. hardware_blacklist ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hardware_blacklist (
  hw_id text PRIMARY KEY,
  reason text,
  blocked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hardware_blacklist ENABLE ROW LEVEL SECURITY;

-- ─── 4. webhook_events_log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_events_log (
  id bigserial PRIMARY KEY,
  source text NOT NULL DEFAULT 'stripe',
  event_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_events_log_idx ON webhook_events_log (source, created_at DESC);
ALTER TABLE webhook_events_log ENABLE ROW LEVEL SECURITY;

-- ─── 5. login_events ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  hw_id text,
  ip text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_events_user_idx ON login_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_ip_idx ON login_events (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_hw_idx ON login_events (hw_id, created_at DESC);
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;

-- ─── 6. Funções RPC para o Painel Admin ───────────────────────────────────────

-- Saúde mais recente de cada serviço
CREATE OR REPLACE FUNCTION admin_service_health() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x), '[]'::json) INTO r FROM (
    SELECT DISTINCT ON (service)
      service, status, latency_ms, detail, checked_at
    FROM service_health
    ORDER BY service, checked_at DESC
  ) x;
  RETURN r;
END $$;

-- Alertas de crack/tamper recentes
CREATE OR REPLACE FUNCTION admin_tamper_alerts(p_limit int DEFAULT 50) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT h.id, h.hw_id, h.ip, h.app_version, h.asar_sha, h.has_session,
           h.tampered, h.reason, h.created_at,
           EXISTS(SELECT 1 FROM hardware_blacklist b WHERE b.hw_id = h.hw_id) AS is_blacklisted
    FROM app_heartbeats h
    WHERE h.tampered = true OR h.reason IS NOT NULL
    ORDER BY h.created_at DESC
    LIMIT p_limit
  ) x;
  RETURN r;
END $$;

-- Bloquear hardware adulterado
CREATE OR REPLACE FUNCTION admin_block_hardware(p_hw_id text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  INSERT INTO hardware_blacklist (hw_id, reason)
  VALUES (p_hw_id, nullif(trim(p_reason), ''))
  ON CONFLICT (hw_id) DO UPDATE SET reason = EXCLUDED.reason, blocked_at = now();
  PERFORM _audit('block_hardware', NULL, json_build_object('hw_id', p_hw_id, 'reason', p_reason)::jsonb);
END $$;

-- Desbloquear hardware
CREATE OR REPLACE FUNCTION admin_unblock_hardware(p_hw_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  DELETE FROM hardware_blacklist WHERE hw_id = p_hw_id;
  PERFORM _audit('unblock_hardware', NULL, json_build_object('hw_id', p_hw_id)::jsonb);
END $$;

-- Funil de conversão
CREATE OR REPLACE FUNCTION admin_funnel(p_days int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_signups int;
  v_confirmed int;
  v_app_opened int;
  v_stage_used int;
  v_subscribed int;
BEGIN
  PERFORM _require_admin();

  SELECT count(*) INTO v_signups
  FROM auth.users WHERE created_at >= v_since;

  SELECT count(*) INTO v_confirmed
  FROM auth.users WHERE created_at >= v_since AND email_confirmed_at IS NOT NULL;

  SELECT count(DISTINCT user_id) INTO v_app_opened
  FROM feature_usage
  WHERE created_at >= v_since AND feature = 'app_open';

  SELECT count(DISTINCT user_id) INTO v_stage_used
  FROM feature_usage
  WHERE created_at >= v_since AND feature IN ('play', 'show_mode', 'mixer', 'local_network', 'broadcast');

  SELECT count(DISTINCT user_id) INTO v_subscribed
  FROM completed_sales
  WHERE created_at >= v_since;

  RETURN json_build_object(
    'days', v_days,
    'signups', v_signups,
    'confirmed', v_confirmed,
    'app_opened', v_app_opened,
    'stage_used', v_stage_used,
    'subscribed', v_subscribed
  );
END $$;

-- Linha do tempo unificada de eventos do sistema
CREATE OR REPLACE FUNCTION admin_timeline(p_limit int DEFAULT 100) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    -- 1. Ações do Admin
    SELECT
      'admin_action' AS event_type,
      a.action AS title,
      coalesce(a.admin_email, 'admin') || CASE WHEN a.target_user IS NOT NULL THEN ' -> ' || coalesce(u.email, a.target_user::text) ELSE '' END AS subtitle,
      a.details::text AS detail,
      'neutral' AS severity,
      a.created_at
    FROM admin_audit a
    LEFT JOIN auth.users u ON u.id = a.target_user

    UNION ALL

    -- 2. Vendas confirmadas
    SELECT
      'sale' AS event_type,
      'Assinatura confirmada (' || upper(s.plan) || ')' AS title,
      u.email AS subtitle,
      'R$ ' || (s.amount_cents / 100.0)::numeric(10,2) AS detail,
      'positive' AS severity,
      s.created_at
    FROM completed_sales s
    JOIN auth.users u ON u.id = s.user_id

    UNION ALL

    -- 3. Cancelamentos
    SELECT
      'cancel' AS event_type,
      'Assinatura cancelada' AS title,
      u.email AS subtitle,
      coalesce(e.plan, '—') AS detail,
      'negative' AS severity,
      e.created_at
    FROM subscription_events e
    JOIN auth.users u ON u.id = e.user_id
    WHERE e.kind = 'canceled'

    UNION ALL

    -- 4. Alertas de Crack/Tamper
    SELECT
      'tamper' AS event_type,
      'Alerta de Crack / Uso Ilegal' AS title,
      'HW: ' || substr(h.hw_id, 1, 8) || ' • IP: ' || coalesce(h.ip, '—') AS subtitle,
      coalesce(h.reason, 'Código modificado') AS detail,
      'critical' AS severity,
      h.created_at
    FROM app_heartbeats h
    WHERE h.tampered = true OR h.reason IS NOT NULL

    UNION ALL

    -- 5. Quedas de serviço
    SELECT
      'service_down' AS event_type,
      'Serviço instável: ' || upper(sh.service) AS title,
      'Status: ' || upper(sh.status) AS subtitle,
      sh.detail AS detail,
      'warning' AS severity,
      sh.checked_at AS created_at
    FROM service_health sh
    WHERE sh.status IN ('down', 'degraded')

    ORDER BY created_at DESC
    LIMIT p_limit
  ) x;
  RETURN r;
END $$;

-- Permissões
REVOKE EXECUTE ON FUNCTION admin_service_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_service_health() TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_tamper_alerts(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_tamper_alerts(int) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_block_hardware(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_block_hardware(text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_unblock_hardware(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_unblock_hardware(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_funnel(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_funnel(int) TO authenticated;

REVOKE EXECUTE ON FUNCTION admin_timeline(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_timeline(int) TO authenticated;
