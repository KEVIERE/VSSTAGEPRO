/*
# Sign-up confirmation by SMS + phone in the admin panel

1. What this does
- `phone_verifications` — one pending SMS code per unconfirmed account (hash only, never the
  code itself), with expiry, attempt counter and resend limits. Used by the `signup-phone`
  edge function; when the code is right the function confirms the account.
- `_auth_user_by_email(email)` — lookup used only by the edge function (service role).
- `admin_users()` now also returns `phone` (from the sign-up form).

2. Security
- RLS on `phone_verifications` with NO policies; only the service role touches it.
- `_auth_user_by_email` is executable only by `service_role`.
*/

CREATE TABLE IF NOT EXISTS phone_verifications (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  sends int NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE phone_verifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION _auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, email_confirmed_at timestamptz, raw_user_meta_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT u.id, u.email_confirmed_at, u.raw_user_meta_data
    FROM auth.users u
   WHERE lower(u.email) = lower(trim(p_email))
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION _auth_user_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _auth_user_by_email(text) TO service_role;

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
           EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id = u.id) AS is_admin
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
GRANT EXECUTE ON FUNCTION admin_users(text, text, int, int) TO authenticated;
