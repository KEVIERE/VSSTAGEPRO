/*
# Painel de acessos do admin

Junta num lugar só os acessos ao programa e ao site, por dia, semana e mês.

- `site_visits`: uma linha por visitante, por dia e por página do site. O visitante é um
  código aleatório guardado no navegador (sem nome, e-mail ou IP). `views` conta quantas
  vezes a página abriu no dia (no máximo 500, para ninguém inflar o número).
- `track_site_visit(...)`: o site chama ao abrir cada página. Liberada para quem não tem
  login, mas só aceita valores no formato esperado.
- `app_heartbeats.arch`: tipo de Mac (arm64 = Apple Silicon, x64 = Intel), mandado pelo
  programa junto com o sinal de 30 em 30 minutos.
- `admin_access_stats(p_days)`: tudo o que a aba "Acessos" mostra. Só para admin.

Dias e horas no horário de Brasília.
*/

CREATE TABLE IF NOT EXISTS site_visits (
  id bigserial PRIMARY KEY,
  day date NOT NULL,
  visitor text NOT NULL CHECK (visitor ~ '^[a-z0-9]{16,40}$'),
  page text NOT NULL CHECK (page ~ '^[a-z0-9_-]{1,40}$'),
  referrer text CHECK (referrer IS NULL OR length(referrer) <= 120),
  device text NOT NULL CHECK (device IN ('mobile', 'tablet', 'desktop')),
  views int NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, visitor, page)
);
CREATE INDEX IF NOT EXISTS site_visits_day_idx ON site_visits (day);
ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
-- sem política: só as funções abaixo leem e escrevem

ALTER TABLE app_heartbeats ADD COLUMN IF NOT EXISTS arch text;
CREATE INDEX IF NOT EXISTS app_heartbeats_created_idx ON app_heartbeats (created_at);
CREATE INDEX IF NOT EXISTS feature_usage_created_idx ON feature_usage (created_at);

CREATE OR REPLACE FUNCTION track_site_visit(p_visitor text, p_page text, p_referrer text, p_device text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_page text := lower(left(coalesce(p_page, ''), 40));
  v_ref text := nullif(lower(left(regexp_replace(coalesce(p_referrer, ''), '[^a-zA-Z0-9.-]', '', 'g'), 120)), '');
  v_dev text := CASE WHEN p_device IN ('mobile', 'tablet', 'desktop') THEN p_device ELSE 'desktop' END;
BEGIN
  IF p_visitor IS NULL OR p_visitor !~ '^[a-z0-9]{16,40}$' THEN RETURN; END IF;
  IF v_page !~ '^[a-z0-9_-]{1,40}$' THEN v_page := 'outra'; END IF;
  IF v_ref IS NOT NULL AND (v_ref = 'vsstagepro.com.br' OR v_ref LIKE '%.vsstagepro.com.br') THEN v_ref := NULL; END IF;

  INSERT INTO site_visits (day, visitor, page, referrer, device)
  VALUES ((now() AT TIME ZONE 'America/Sao_Paulo')::date, p_visitor, v_page, v_ref, v_dev)
  ON CONFLICT (day, visitor, page) DO UPDATE
     SET views = least(site_visits.views + 1, 500), last_at = now();
END $$;

REVOKE EXECUTE ON FUNCTION track_site_visit(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION track_site_visit(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_access_stats(p_days int DEFAULT 30)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tz constant text := 'America/Sao_Paulo';
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_today date := (now() AT TIME ZONE v_tz)::date;
  v_from date := v_today - (greatest(1, least(coalesce(p_days, 30), 365)) - 1);
  v_since date := least(v_today - (greatest(1, least(coalesce(p_days, 30), 365)) - 1), v_today - 29);
  v_res json;
BEGIN
  PERFORM _require_admin();

  WITH
  fu AS (
    SELECT f.user_id, f.feature, (f.created_at AT TIME ZONE v_tz) AS local_at,
           (f.created_at AT TIME ZONE v_tz)::date AS day
      FROM feature_usage f
     WHERE f.created_at >= (v_since::timestamp AT TIME ZONE v_tz)
  ),
  hb AS (
    SELECT DISTINCT ON (h.hw_id) h.hw_id, h.app_version, h.arch
      FROM app_heartbeats h
     WHERE h.created_at >= now() - interval '30 days'
     ORDER BY h.hw_id, h.created_at DESC
  ),
  sv AS (
    SELECT * FROM site_visits WHERE day >= v_since
  )
  SELECT json_build_object(
    'days', v_days,
    'program', json_build_object(
      'online_now', (SELECT count(DISTINCT hw_id) FROM app_heartbeats WHERE created_at > now() - interval '35 minutes'),
      'online_logged', (SELECT count(DISTINCT hw_id) FROM app_heartbeats WHERE created_at > now() - interval '35 minutes' AND has_session),
      'users_today', (SELECT count(DISTINCT user_id) FROM fu WHERE day = v_today),
      'users_7d', (SELECT count(DISTINCT user_id) FROM fu WHERE day > v_today - 7),
      'users_30d', (SELECT count(DISTINCT user_id) FROM fu WHERE day > v_today - 30),
      'users_period', (SELECT count(DISTINCT user_id) FROM fu WHERE day >= v_from),
      'opens_today', (SELECT count(*) FROM fu WHERE day = v_today AND feature = 'app_open'),
      'opens_7d', (SELECT count(*) FROM fu WHERE day > v_today - 7 AND feature = 'app_open'),
      'opens_30d', (SELECT count(*) FROM fu WHERE day > v_today - 30 AND feature = 'app_open'),
      'series', (
        SELECT coalesce(json_agg(json_build_object(
                 'day', d::date,
                 'users', (SELECT count(DISTINCT user_id) FROM fu WHERE fu.day = d::date),
                 'opens', (SELECT count(*) FROM fu WHERE fu.day = d::date AND feature = 'app_open')
               ) ORDER BY d), '[]'::json)
          FROM generate_series(v_from, v_today, interval '1 day') d
      ),
      'hours', (
        SELECT coalesce(json_agg(json_build_object(
                 'hour', h,
                 'users', (SELECT count(DISTINCT (user_id, day)) FROM fu WHERE fu.day >= v_from AND extract(hour FROM fu.local_at) = h)
               ) ORDER BY h), '[]'::json)
          FROM generate_series(0, 23) h
      ),
      'weekdays', (
        SELECT coalesce(json_agg(json_build_object(
                 'dow', w,
                 'users', (SELECT count(DISTINCT (user_id, day)) FROM fu WHERE fu.day >= v_from AND extract(dow FROM fu.day) = w)
               ) ORDER BY w), '[]'::json)
          FROM generate_series(0, 6) w
      ),
      'versions', (
        SELECT coalesce(json_agg(x ORDER BY x.macs DESC, x.version DESC), '[]'::json)
          FROM (SELECT app_version AS version, count(*) AS macs FROM hb GROUP BY app_version) x
      ),
      'archs', (
        SELECT coalesce(json_agg(x ORDER BY x.macs DESC), '[]'::json)
          FROM (SELECT coalesce(arch, 'unknown') AS arch, count(*) AS macs FROM hb GROUP BY coalesce(arch, 'unknown')) x
      ),
      'top_users', (
        SELECT coalesce(json_agg(x ORDER BY x.days_active DESC, x.opens DESC), '[]'::json)
          FROM (
            SELECT u.email::text AS email,
                   count(DISTINCT fu.day) AS days_active,
                   count(*) FILTER (WHERE fu.feature = 'app_open') AS opens,
                   max(fu.local_at) AS last_at
              FROM fu JOIN auth.users u ON u.id = fu.user_id
             WHERE fu.day >= v_from
             GROUP BY u.email
             ORDER BY days_active DESC, opens DESC
             LIMIT 10
          ) x
      )
    ),
    'site', json_build_object(
      'since', (SELECT min(day) FROM site_visits),
      'visitors_today', (SELECT count(DISTINCT visitor) FROM sv WHERE day = v_today),
      'visitors_7d', (SELECT count(DISTINCT visitor) FROM sv WHERE day > v_today - 7),
      'visitors_30d', (SELECT count(DISTINCT visitor) FROM sv WHERE day > v_today - 30),
      'visitors_period', (SELECT count(DISTINCT visitor) FROM sv WHERE day >= v_from),
      'views_today', (SELECT coalesce(sum(views), 0) FROM sv WHERE day = v_today),
      'views_7d', (SELECT coalesce(sum(views), 0) FROM sv WHERE day > v_today - 7),
      'views_30d', (SELECT coalesce(sum(views), 0) FROM sv WHERE day > v_today - 30),
      'signups_period', (SELECT count(*) FROM auth.users WHERE created_at >= (v_from::timestamp AT TIME ZONE v_tz)),
      'series', (
        SELECT coalesce(json_agg(json_build_object(
                 'day', d::date,
                 'visitors', (SELECT count(DISTINCT visitor) FROM sv WHERE sv.day = d::date),
                 'views', (SELECT coalesce(sum(views), 0) FROM sv WHERE sv.day = d::date)
               ) ORDER BY d), '[]'::json)
          FROM generate_series(v_from, v_today, interval '1 day') d
      ),
      'pages', (
        SELECT coalesce(json_agg(x ORDER BY x.visitors DESC), '[]'::json)
          FROM (SELECT page, count(DISTINCT visitor) AS visitors, sum(views) AS views
                  FROM sv WHERE day >= v_from GROUP BY page ORDER BY 2 DESC LIMIT 12) x
      ),
      'referrers', (
        SELECT coalesce(json_agg(x ORDER BY x.visitors DESC), '[]'::json)
          FROM (SELECT coalesce(referrer, 'direct') AS referrer, count(DISTINCT visitor) AS visitors
                  FROM sv WHERE day >= v_from GROUP BY coalesce(referrer, 'direct') ORDER BY 2 DESC LIMIT 10) x
      ),
      'devices', (
        SELECT coalesce(json_agg(x ORDER BY x.visitors DESC), '[]'::json)
          FROM (SELECT device, count(DISTINCT visitor) AS visitors
                  FROM sv WHERE day >= v_from GROUP BY device) x
      )
    )
  ) INTO v_res;

  RETURN v_res;
END $$;

REVOKE EXECUTE ON FUNCTION admin_access_stats(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_access_stats(int) TO authenticated;
