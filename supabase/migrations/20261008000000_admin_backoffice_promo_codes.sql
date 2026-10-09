/*
# Admin backoffice, promo codes, feature usage and account blocking

1. What this does
- `app_admins` — accounts allowed into the admin page (/admin). Add an admin with:
    INSERT INTO app_admins (user_id) SELECT id FROM auth.users WHERE email = 'voce@exemplo.com';
- `director_licenses` gets:
  - `blocked` / `blocked_reason` / `blocked_at` — admin can "derrubar" an account
  - `comp_until` — free access granted by admin or by a promo code
  - `subscribed_at`, `updated_at`
- `subscription_events` — history of sales/cancellations (filled by a trigger whenever
  `subscription` changes), used by the sales dashboard.
- `promo_codes` + `promo_redemptions` — admin-created bonus codes:
  - kind 'trial_hours': adds N hours to the free trial
  - kind 'free_days': N days of full access (as if subscribed)
- `feature_usage` — one row per feature use, written by the client through `track_feature()`.
- `admin_audit` — every admin action is logged.
- `license_status()` now returns 'blocked', and 'active' with plan 'promo' while `comp_until` is in the future.

2. Functions
- Client (authenticated): `license_status()`, `redeem_promo(code)`, `track_feature(feature)`.
- Public (anon + authenticated): `promo_check(code)` — validates a code on the login screen.
- Admin only (checked via `is_admin()` inside each SECURITY DEFINER function):
  `admin_overview()`, `admin_users()`, `admin_extend_trial()`, `admin_set_comp()`,
  `admin_set_subscription()`, `admin_block()`, `admin_promo_list()`, `admin_promo_create()`,
  `admin_promo_set_active()`, `admin_promo_delete()`, `admin_feature_usage()`, `admin_audit_list()`.

3. Security
- RLS enabled on every new table with NO policies: all access goes through the functions.
- Admin functions raise 'not_allowed' unless the caller is in `app_admins`.
*/

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;

ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS blocked_reason text;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS comp_until timestamptz;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS subscribed_at timestamptz;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS subscription_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('subscribed', 'canceled')),
  plan text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_events_created_idx ON subscription_events (created_at DESC);
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS promo_codes (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind text NOT NULL CHECK (kind IN ('trial_hours', 'free_days')),
  value int NOT NULL CHECK (value > 0 AND value <= 3650 * 24),
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  uses int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  code text NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS feature_usage (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature ~ '^[a-z0-9_]{2,40}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_usage_created_idx ON feature_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS feature_usage_user_idx ON feature_usage (user_id, created_at DESC);
ALTER TABLE feature_usage ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_audit (
  id bigserial PRIMARY KEY,
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);
ALTER TABLE admin_audit ENABLE ROW LEVEL SECURITY;

-- ─── Sales history trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _director_license_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.subscription = 'active' AND (TG_OP = 'INSERT' OR OLD.subscription IS DISTINCT FROM 'active') THEN
    NEW.subscribed_at := now();
    INSERT INTO subscription_events (user_id, kind, plan) VALUES (NEW.user_id, 'subscribed', NEW.plan);
  ELSIF TG_OP = 'UPDATE' AND OLD.subscription = 'active' AND NEW.subscription <> 'active' THEN
    INSERT INTO subscription_events (user_id, kind, plan) VALUES (NEW.user_id, 'canceled', OLD.plan);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS director_license_touch ON director_licenses;
CREATE TRIGGER director_license_touch BEFORE INSERT OR UPDATE ON director_licenses
FOR EACH ROW EXECUTE FUNCTION _director_license_touch();

-- ─── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM app_admins WHERE user_id = auth.uid()) $$;

CREATE OR REPLACE FUNCTION _require_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_allowed'; END IF;
END $$;

CREATE OR REPLACE FUNCTION _audit(p_action text, p_target uuid, p_details jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ INSERT INTO admin_audit (admin_id, action, target_user, details) VALUES (auth.uid(), p_action, p_target, p_details) $$;

-- Status calculado de uma licença (mesma regra do license_status).
CREATE OR REPLACE FUNCTION _license_state(l director_licenses) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN l.blocked THEN 'blocked'
    WHEN l.subscription = 'active' THEN 'active'
    WHEN l.comp_until IS NOT NULL AND l.comp_until > now() THEN 'promo'
    WHEN now() < l.trial_started_at + make_interval(hours => l.trial_hours) THEN 'trial'
    ELSE 'expired'
  END
$$;

CREATE OR REPLACE FUNCTION _ensure_license(p_user uuid) RETURNS director_licenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row director_licenses;
BEGIN
  SELECT * INTO v_row FROM director_licenses WHERE user_id = p_user;
  IF NOT FOUND THEN
    INSERT INTO director_licenses (user_id, trial_started_at) VALUES (p_user, now()) RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;

-- ─── Client functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION license_status() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row director_licenses;
  v_end timestamptz;
  v_hours int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('status', 'anonymous'); END IF;
  v_row := _ensure_license(v_uid);

  IF v_row.blocked THEN
    RETURN json_build_object('status', 'blocked', 'reason', v_row.blocked_reason);
  END IF;

  IF v_row.subscription = 'active' THEN
    RETURN json_build_object(
      'status', 'active', 'subscription', 'active',
      'plan', v_row.plan, 'current_period_end', v_row.current_period_end
    );
  END IF;

  IF v_row.comp_until IS NOT NULL AND v_row.comp_until > now() THEN
    RETURN json_build_object('status', 'active', 'subscription', 'promo', 'plan', 'promo', 'current_period_end', v_row.comp_until);
  END IF;

  v_end := v_row.trial_started_at + make_interval(hours => v_row.trial_hours);
  v_hours := greatest(0, ceil(extract(epoch from (v_end - now())) / 3600)::int);

  IF now() < v_end THEN
    RETURN json_build_object(
      'status', 'trial',
      'trial_started_at', v_row.trial_started_at,
      'ends_at', v_end,
      'hours_left', v_hours,
      'days_left', ceil(v_hours / 24.0)::int
    );
  END IF;

  RETURN json_build_object('status', 'expired', 'trial_started_at', v_row.trial_started_at, 'ends_at', v_end);
END $$;

CREATE OR REPLACE FUNCTION promo_check(p_code text) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v promo_codes;
BEGIN
  SELECT * INTO v FROM promo_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND OR NOT v.active THEN RETURN json_build_object('valid', false, 'error', 'promo_invalid'); END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN RETURN json_build_object('valid', false, 'error', 'promo_expired'); END IF;
  IF v.max_uses IS NOT NULL AND v.uses >= v.max_uses THEN RETURN json_build_object('valid', false, 'error', 'promo_used_up'); END IF;
  RETURN json_build_object('valid', true, 'kind', v.kind, 'value', v.value);
END $$;

CREATE OR REPLACE FUNCTION redeem_promo(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v promo_codes;
  v_row director_licenses;
  v_end timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v FROM promo_codes WHERE code = upper(trim(p_code)) FOR UPDATE;
  IF NOT FOUND OR NOT v.active THEN RAISE EXCEPTION 'promo_invalid'; END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN RAISE EXCEPTION 'promo_expired'; END IF;
  IF v.max_uses IS NOT NULL AND v.uses >= v.max_uses THEN RAISE EXCEPTION 'promo_used_up'; END IF;
  IF EXISTS (SELECT 1 FROM promo_redemptions WHERE code = v.code AND user_id = v_uid) THEN
    RAISE EXCEPTION 'promo_already_used';
  END IF;

  v_row := _ensure_license(v_uid);

  IF v.kind = 'trial_hours' THEN
    -- Soma a partir do fim atual do teste (ou de agora, se o teste já acabou).
    v_end := greatest(now(), v_row.trial_started_at + make_interval(hours => v_row.trial_hours))
             + make_interval(hours => v.value);
    UPDATE director_licenses
       SET trial_hours = ceil(extract(epoch from (v_end - trial_started_at)) / 3600)::int
     WHERE user_id = v_uid;
  ELSE
    UPDATE director_licenses
       SET comp_until = greatest(now(), coalesce(comp_until, now())) + make_interval(days => v.value)
     WHERE user_id = v_uid;
  END IF;

  INSERT INTO promo_redemptions (code, user_id) VALUES (v.code, v_uid);
  UPDATE promo_codes SET uses = uses + 1 WHERE code = v.code;
  RETURN json_build_object('ok', true, 'kind', v.kind, 'value', v.value);
END $$;

CREATE OR REPLACE FUNCTION track_feature(p_feature text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_feature !~ '^[a-z0-9_]{2,40}$' THEN RETURN; END IF;
  -- Limite simples contra abuso: no máximo 600 registros por conta por hora.
  IF (SELECT count(*) FROM feature_usage WHERE user_id = auth.uid() AND created_at > now() - interval '1 hour') >= 600 THEN
    RETURN;
  END IF;
  INSERT INTO feature_usage (user_id, feature) VALUES (auth.uid(), p_feature);
END $$;

-- ─── Admin functions ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_overview(p_days int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  r json;
BEGIN
  PERFORM _require_admin();
  WITH lic AS (SELECT l.*, _license_state(l) AS state FROM director_licenses l)
  SELECT json_build_object(
    'total_users', (SELECT count(*) FROM auth.users),
    'trial', (SELECT count(*) FROM lic WHERE state = 'trial'),
    'expired', (SELECT count(*) FROM lic WHERE state = 'expired'),
    'active', (SELECT count(*) FROM lic WHERE state = 'active'),
    'monthly', (SELECT count(*) FROM lic WHERE state = 'active' AND plan = 'monthly'),
    'yearly', (SELECT count(*) FROM lic WHERE state = 'active' AND plan = 'yearly'),
    'manual', (SELECT count(*) FROM lic WHERE state = 'active' AND plan IS NULL),
    'promo', (SELECT count(*) FROM lic WHERE state = 'promo'),
    'blocked', (SELECT count(*) FROM lic WHERE state = 'blocked'),
    'mrr_cents', (SELECT coalesce(sum(CASE plan WHEN 'monthly' THEN 5500 WHEN 'yearly' THEN round(59900 / 12.0) ELSE 0 END), 0)
                  FROM lic WHERE state = 'active'),
    'signups_period', (SELECT count(*) FROM auth.users WHERE created_at >= v_since),
    'subs_period', (SELECT count(*) FROM subscription_events WHERE kind = 'subscribed' AND created_at >= v_since),
    'cancels_period', (SELECT count(*) FROM subscription_events WHERE kind = 'canceled' AND created_at >= v_since),
    'revenue_period_cents', (SELECT coalesce(sum(CASE plan WHEN 'monthly' THEN 5500 WHEN 'yearly' THEN 59900 ELSE 0 END), 0)
                             FROM subscription_events WHERE kind = 'subscribed' AND created_at >= v_since),
    'active_users_period', (SELECT count(DISTINCT user_id) FROM feature_usage WHERE created_at >= v_since),
    'days', v_days,
    'series', (
      SELECT json_agg(json_build_object(
        'day', to_char(d, 'YYYY-MM-DD'),
        'signups', (SELECT count(*) FROM auth.users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day'),
        'subs', (SELECT count(*) FROM subscription_events e WHERE e.kind = 'subscribed' AND e.created_at >= d AND e.created_at < d + interval '1 day'),
        'active_users', (SELECT count(DISTINCT f.user_id) FROM feature_usage f WHERE f.created_at >= d AND f.created_at < d + interval '1 day')
      ) ORDER BY d)
      FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') d
    ),
    'recent_sales', (
      SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT e.created_at, e.kind, e.plan, u.email, u.raw_user_meta_data->>'name' AS name
          FROM subscription_events e JOIN auth.users u ON u.id = e.user_id
         ORDER BY e.created_at DESC LIMIT 12
      ) x
    )
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_users(
  p_search text DEFAULT NULL, p_state text DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0
) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  WITH base AS (
    SELECT u.id, u.email, u.raw_user_meta_data->>'name' AS name, u.created_at, u.last_sign_in_at,
           l.trial_started_at, l.trial_hours, l.subscription, l.plan, l.current_period_end, l.comp_until,
           l.blocked, l.blocked_reason, l.stripe_customer_id, l.subscribed_at,
           CASE WHEN l.user_id IS NULL THEN 'trial' ELSE _license_state(l) END AS state,
           l.trial_started_at + make_interval(hours => l.trial_hours) AS trial_ends_at,
           (SELECT max(f.created_at) FROM feature_usage f WHERE f.user_id = u.id) AS last_seen_at,
           (SELECT count(*) FROM feature_usage f WHERE f.user_id = u.id AND f.created_at > now() - interval '30 days') AS uses_30d,
           EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id = u.id) AS is_admin
      FROM auth.users u LEFT JOIN director_licenses l ON l.user_id = u.id
  ), filtered AS (
    SELECT * FROM base
     WHERE (p_search IS NULL OR p_search = '' OR email ILIKE '%' || p_search || '%' OR name ILIKE '%' || p_search || '%')
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

CREATE OR REPLACE FUNCTION admin_extend_trial(p_user uuid, p_hours int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row director_licenses; v_end timestamptz;
BEGIN
  PERFORM _require_admin();
  IF p_hours IS NULL OR p_hours = 0 OR abs(p_hours) > 24 * 3650 THEN RAISE EXCEPTION 'invalid_value'; END IF;
  v_row := _ensure_license(p_user);
  IF p_hours > 0 THEN
    v_end := greatest(now(), v_row.trial_started_at + make_interval(hours => v_row.trial_hours)) + make_interval(hours => p_hours);
  ELSE
    v_end := v_row.trial_started_at + make_interval(hours => greatest(0, v_row.trial_hours + p_hours));
  END IF;
  UPDATE director_licenses
     SET trial_hours = greatest(0, ceil(extract(epoch from (v_end - trial_started_at)) / 3600)::int)
   WHERE user_id = p_user;
  PERFORM _audit('extend_trial', p_user, json_build_object('hours', p_hours)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_set_comp(p_user uuid, p_days int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  PERFORM _ensure_license(p_user);
  IF p_days IS NULL OR p_days <= 0 THEN
    UPDATE director_licenses SET comp_until = NULL WHERE user_id = p_user;
  ELSE
    UPDATE director_licenses
       SET comp_until = greatest(now(), coalesce(comp_until, now())) + make_interval(days => least(p_days, 3650))
     WHERE user_id = p_user;
  END IF;
  PERFORM _audit('set_comp', p_user, json_build_object('days', p_days)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_set_subscription(p_user uuid, p_subscription text, p_plan text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF p_subscription NOT IN ('trial', 'active', 'canceled') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF p_plan IS NOT NULL AND p_plan NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  PERFORM _ensure_license(p_user);
  UPDATE director_licenses
     SET subscription = p_subscription,
         plan = CASE WHEN p_subscription = 'active' THEN p_plan ELSE plan END
   WHERE user_id = p_user;
  PERFORM _audit('set_subscription', p_user, json_build_object('subscription', p_subscription, 'plan', p_plan)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_block(p_user uuid, p_blocked boolean, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'cannot_block_self'; END IF;
  PERFORM _ensure_license(p_user);
  UPDATE director_licenses
     SET blocked = p_blocked,
         blocked_reason = CASE WHEN p_blocked THEN nullif(left(trim(coalesce(p_reason, '')), 200), '') END,
         blocked_at = CASE WHEN p_blocked THEN now() END
   WHERE user_id = p_user;
  IF p_blocked THEN
    -- Encerra as sessões abertas: a conta sai do programa na próxima renovação do login.
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = p_user;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  PERFORM _audit(CASE WHEN p_blocked THEN 'block' ELSE 'unblock' END, p_user, json_build_object('reason', p_reason)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_promo_list() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT p.*,
      (SELECT coalesce(json_agg(json_build_object('email', u.email, 'redeemed_at', pr.redeemed_at) ORDER BY pr.redeemed_at DESC), '[]'::json)
         FROM promo_redemptions pr JOIN auth.users u ON u.id = pr.user_id WHERE pr.code = p.code) AS redemptions
    FROM promo_codes p
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_promo_create(
  p_code text, p_kind text, p_value int, p_max_uses int DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_code text := upper(trim(p_code));
BEGIN
  PERFORM _require_admin();
  IF v_code !~ '^[A-Z0-9_-]{3,32}$' THEN RAISE EXCEPTION 'promo_bad_code'; END IF;
  IF p_kind NOT IN ('trial_hours', 'free_days') OR p_value IS NULL OR p_value <= 0 THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF EXISTS (SELECT 1 FROM promo_codes WHERE code = v_code) THEN RAISE EXCEPTION 'promo_exists'; END IF;
  INSERT INTO promo_codes (code, kind, value, max_uses, expires_at, note, created_by)
  VALUES (v_code, p_kind, p_value, p_max_uses, p_expires_at, nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid());
  PERFORM _audit('promo_create', NULL, json_build_object('code', v_code, 'kind', p_kind, 'value', p_value)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_promo_set_active(p_code text, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  UPDATE promo_codes SET active = p_active WHERE code = p_code;
  PERFORM _audit(CASE WHEN p_active THEN 'promo_enable' ELSE 'promo_disable' END, NULL, json_build_object('code', p_code)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_promo_delete(p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  DELETE FROM promo_codes WHERE code = p_code;
  PERFORM _audit('promo_delete', NULL, json_build_object('code', p_code)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_feature_usage(p_days int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.uses DESC), '[]'::json) INTO r FROM (
    SELECT feature, count(*) AS uses, count(DISTINCT user_id) AS users
      FROM feature_usage
     WHERE created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
     GROUP BY feature
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_audit_list(p_limit int DEFAULT 100) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT a.created_at, a.action, a.details, adm.email AS admin_email, tgt.email AS target_email
      FROM admin_audit a
      LEFT JOIN auth.users adm ON adm.id = a.admin_id
      LEFT JOIN auth.users tgt ON tgt.id = a.target_user
     ORDER BY a.created_at DESC
     LIMIT least(greatest(coalesce(p_limit, 100), 1), 500)
  ) x;
  RETURN r;
END $$;

-- ─── Grants ──────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION _director_license_touch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _require_admin() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _audit(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _ensure_license(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _license_state(director_licenses) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION license_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION license_status() TO authenticated;
REVOKE EXECUTE ON FUNCTION is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION promo_check(text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION redeem_promo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION redeem_promo(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION track_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION track_feature(text) TO authenticated;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_overview(int)', 'admin_users(text, text, int, int)', 'admin_extend_trial(uuid, int)',
    'admin_set_comp(uuid, int)', 'admin_set_subscription(uuid, text, text)', 'admin_block(uuid, boolean, text)',
    'admin_promo_list()', 'admin_promo_create(text, text, int, int, timestamptz, text)',
    'admin_promo_set_active(text, boolean)', 'admin_promo_delete(text)', 'admin_feature_usage(int)', 'admin_audit_list(int)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
