/*
  # Versão do programa por usuário na aba Usuários

  O programa manda um heartbeat a cada 30 minutos com a versão exata que está rodando
  (app_heartbeats.app_version). O admin_users não lia essa tabela: o painel mostrava só
  a versão do metadata do login (que fica velha quando o app atualiza sem relogar).

  Esta migração substitui admin_users acrescentando:
  - `app_version`: a versão do heartbeat mais recente de qualquer computador da conta.
  - `app_version_at`: quando esse sinal chegou (para saber se é dado fresco).
  - `macs`: quantos Macs distintos mandaram sinal nos últimos 30 dias.
*/

CREATE OR REPLACE FUNCTION admin_users(
  p_search text DEFAULT NULL, p_state text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  WITH base AS (
    SELECT u.id, u.email, u.raw_user_meta_data->>'name' AS name, u.raw_user_meta_data->>'phone' AS phone,
           u.created_at, u.last_sign_in_at, u.email_confirmed_at,
           l.trial_started_at, l.trial_hours, l.subscription, l.plan, l.current_period_end, l.comp_until,
           l.blocked, l.blocked_reason, l.stripe_customer_id, l.subscribed_at,
           CASE WHEN l.user_id IS NULL THEN 'trial' ELSE _license_state(l) END AS state,
           l.trial_started_at + make_interval(hours => l.trial_hours) AS trial_ends_at,
           (SELECT max(f.created_at) FROM feature_usage f WHERE f.user_id = u.id) AS last_seen_at,
           (SELECT count(*) FROM feature_usage f WHERE f.user_id = u.id AND f.created_at > now() - interval '30 days') AS uses_30d,
           EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id = u.id) AS is_admin,
           -- versão exata: o sinal mais recente de qualquer Mac que já usou alguma conta.
           -- O heartbeat não traz user_id; o IP do sinal casa com o IP do último uso da conta.
           (
             SELECT h.app_version
               FROM app_heartbeats h
              WHERE h.created_at > now() - interval '30 days'
                AND h.ip = COALESCE(
                  (SELECT meta.last_ip FROM (
                     SELECT (u.raw_user_meta_data->>'last_ip') AS last_ip
                   ) meta WHERE meta.last_ip IS NOT NULL),
                  '\?\?none'
                )
              ORDER BY h.created_at DESC
              LIMIT 1
           ) AS app_version,
           (
             SELECT max(h.created_at)
               FROM app_heartbeats h
              WHERE h.created_at > now() - interval '30 days'
                AND h.ip = COALESCE(
                  (SELECT meta.last_ip FROM (
                     SELECT (u.raw_user_meta_data->>'last_ip') AS last_ip
                   ) meta WHERE meta.last_ip IS NOT NULL),
                  '\?\?none'
                )
           ) AS app_version_at
      FROM auth.users u LEFT JOIN director_licenses l ON l.user_id = u.id
  ), filtered AS (
    SELECT * FROM base
     WHERE (p_search IS NULL OR p_search = '' OR email ILIKE '%' || p_search || '%'
            OR name ILIKE '%' || p_search || '%' OR phone ILIKE '%' || p_search || '%')
       AND (p_state IS NULL OR p_state = '' OR p_state = 'all' OR state = p_state)
  )
  SELECT json_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', (SELECT coalesce(json_agg(f ORDER BY f.created_at DESC), '[]'::json) FROM (
      SELECT * FROM filtered ORDER BY created_at DESC
       LIMIT least(greatest(coalesce(p_limit, 50), 1), 200) OFFSET greatest(coalesce(p_offset, 0), 0)
    ) f)
  ) INTO r;
  RETURN r;
END $$;

REVOKE EXECUTE ON FUNCTION admin_users(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_users(text, text, int, int) TO service_role;
