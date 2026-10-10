/* Track checkout attempts separately from paid subscription sales. */

CREATE TABLE IF NOT EXISTS checkout_intents (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  coupon_code text,
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkout_intents_created_idx ON checkout_intents (created_at DESC);
ALTER TABLE checkout_intents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS completed_sales (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_checkout_session_id text NOT NULL UNIQUE,
  stripe_subscription_id text,
  plan text NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL DEFAULT 'brl',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS completed_sales_created_idx ON completed_sales (created_at DESC);
ALTER TABLE completed_sales ENABLE ROW LEVEL SECURITY;

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
    'subs_period', (SELECT count(*) FROM completed_sales WHERE created_at >= v_since),
    'cancels_period', (SELECT count(*) FROM subscription_events WHERE kind = 'canceled' AND created_at >= v_since),
    'revenue_period_cents', (SELECT coalesce(sum(amount_cents), 0) FROM completed_sales WHERE created_at >= v_since),
    'active_users_period', (SELECT count(DISTINCT user_id) FROM feature_usage WHERE created_at >= v_since),
    'days', v_days,
    'series', (
      SELECT json_agg(json_build_object(
        'day', to_char(d, 'YYYY-MM-DD'),
        'signups', (SELECT count(*) FROM auth.users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day'),
        'subs', (SELECT count(*) FROM completed_sales s WHERE s.created_at >= d AND s.created_at < d + interval '1 day'),
        'active_users', (SELECT count(DISTINCT f.user_id) FROM feature_usage f WHERE f.created_at >= d AND f.created_at < d + interval '1 day')
      ) ORDER BY d)
      FROM generate_series(v_since, date_trunc('day', now()), interval '1 day') d
    ),
    'recent_intentions', (
      SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT i.created_at, i.plan, i.coupon_code, u.email, u.raw_user_meta_data->>'name' AS name
          FROM checkout_intents i JOIN auth.users u ON u.id = i.user_id
         ORDER BY i.created_at DESC LIMIT 12
      ) x
    ),
    'recent_sales', (
      SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT s.created_at, s.plan, s.amount_cents, u.email, u.raw_user_meta_data->>'name' AS name
          FROM completed_sales s JOIN auth.users u ON u.id = s.user_id
         ORDER BY s.created_at DESC LIMIT 12
      ) x
    ),
    'recent_cancellations', (
      SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT e.created_at, e.plan, u.email, u.raw_user_meta_data->>'name' AS name
          FROM subscription_events e JOIN auth.users u ON u.id = e.user_id
         WHERE e.kind = 'canceled'
         ORDER BY e.created_at DESC LIMIT 12
      ) x
    )
  ) INTO r;
  RETURN r;
END $$;
