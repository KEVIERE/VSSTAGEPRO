/*
  # Filtros "Parceiros" e "Em uso agora" na aba Usuários

  - p_state='partner': só quem tem o selo de Parceiro (director_licenses.partner).
  - p_state='online': só quem está com o programa aberto agora — conta como "agora"
    o hardware que mandou heartbeat nos últimos 35 minutos (o programa envia a cada 30).
    O sinal não traz user_id; casa pelo IP do último uso da conta (igual à coluna
    "Versão do app" já faz).
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
           l.partner,
           CASE WHEN l.user_id IS NULL THEN 'trial' ELSE _license_state(l) END AS state,
           l.trial_started_at + make_interval(hours => l.trial_hours) AS trial_ends_at,
           (SELECT max(f.created_at) FROM feature_usage f WHERE f.user_id = u.id) AS last_seen_at,
           (SELECT count(*) FROM feature_usage f WHERE f.user_id = u.id AND f.created_at > now() - interval '30 days') AS uses_30d,
           EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id = u.id) AS is_admin,
           -- versão exata: o sinal mais recente do IP mais recente desta conta
           (
             SELECT h.app_version
               FROM app_heartbeats h
              WHERE h.created_at > now() - interval '30 days'
                AND h.ip IS NOT NULL
                AND h.ip = COALESCE(NULLIF(u.raw_user_meta_data->>'last_ip', ''), 'none')
              ORDER BY h.created_at DESC
              LIMIT 1
           ) AS app_version,
           (
             SELECT max(h.created_at)
               FROM app_heartbeats h
              WHERE h.created_at > now() - interval '30 days'
                AND h.ip IS NOT NULL
                AND h.ip = COALESCE(NULLIF(u.raw_user_meta_data->>'last_ip', ''), 'none')
           ) AS app_version_at,
           -- "aberto agora": sinal nos últimos 35 minutos
           EXISTS (
             SELECT 1 FROM app_heartbeats h
              WHERE h.created_at > now() - interval '35 minutes'
                AND h.ip IS NOT NULL
                AND h.ip = COALESCE(NULLIF(u.raw_user_meta_data->>'last_ip', ''), 'none')
           ) AS online_now
      FROM auth.users u LEFT JOIN director_licenses l ON l.user_id = u.id
  ), filtered AS (
    SELECT * FROM base
     WHERE (p_search IS NULL OR p_search = '' OR email ILIKE '%' || p_search || '%'
            OR name ILIKE '%' || p_search || '%' OR phone ILIKE '%' || p_search || '%')
       AND (
         p_state IS NULL OR p_state = '' OR p_state = 'all'
         OR (p_state = 'partner' AND partner)
         OR (p_state = 'online' AND online_now)
         OR (p_state NOT IN ('partner', 'online') AND state = p_state)
       )
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
