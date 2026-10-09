/*
# Director trial licenses (7-day free test)

1. What this does
- Adds a per-account license table `director_licenses` that tracks whether the director's
  free 7-day trial is active or expired. The trial starts automatically on first sign-up.
- The editor gates access by reading this row; after 7 days with no paid subscription it
  shows a "trial expired" screen instead of opening the workspace.

2. New Tables
- `director_licenses` — one row per auth user.
  - `user_id` (uuid, pk, fk auth.users, NOT NULL, defaults to auth.uid() on insert via RPC)
  - `trial_started_at` (timestamptz, when the first session began)
  - `trial_days` (int, defaults to 7)
  - `subscription` (text, 'trial' | 'active' | 'canceled' — 'active' bypasses expiry)
  - `created_at`
- Function `license_status()` (SECURITY DEFINER, EXECUTE only `authenticated`) returns the
  caller's own license state: `{ status: 'active'|'trial'|'expired', trial_started_at,
  days_left, ends_at }`. It creates the row lazily on first call so sign-in immediately
  starts the clock.
- Function `license_grant()` for the admin to flip `subscription` — EXECUTE revoked from
  both anon and authenticated; only the service role / SQL console can invoke it.

3. Security
- RLS enabled on `director_licenses`. There are NO table policies: clients never read or
  write rows directly. All access goes through `license_status()` / `license_grant()`,
  enforcing that a user only ever sees their own row and cannot extend their own trial.
*/

CREATE TABLE IF NOT EXISTS director_licenses (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  trial_started_at timestamptz NOT NULL,
  trial_days int NOT NULL DEFAULT 7,
  subscription text NOT NULL DEFAULT 'trial'
    CHECK (subscription IN ('trial', 'active', 'canceled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE director_licenses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION license_status() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row director_licenses;
  v_end timestamptz;
  v_left int;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('status', 'anonymous'); END IF;

  SELECT * INTO v_row FROM director_licenses WHERE user_id = v_uid;
  IF NOT FOUND THEN
    INSERT INTO director_licenses (user_id, trial_started_at)
    VALUES (v_uid, now())
    RETURNING * INTO v_row;
  END IF;

  v_end := v_row.trial_started_at + (v_row.trial_days || ' days')::interval;
  v_left := greatest(0, extract(epoch from (v_end - now()))::int / 86400 + 1);

  IF v_row.subscription = 'active' THEN
    RETURN json_build_object('status', 'active', 'subscription', 'active');
  END IF;

  IF now() < v_end THEN
    RETURN json_build_object(
      'status', 'trial',
      'trial_started_at', v_row.trial_started_at,
      'ends_at', v_end,
      'days_left', v_left
    );
  END IF;

  RETURN json_build_object('status', 'expired', 'trial_started_at', v_row.trial_started_at, 'ends_at', v_end);
END $$;

CREATE OR REPLACE FUNCTION license_grant(p_user_id uuid, p_subscription text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_subscription NOT IN ('trial', 'active', 'canceled') THEN
    RAISE EXCEPTION 'invalid_subscription';
  END IF;
  UPDATE director_licenses SET subscription = p_subscription WHERE user_id = p_user_id;
END $$;

REVOKE EXECUTE ON FUNCTION license_status() FROM anon;
GRANT EXECUTE ON FUNCTION license_status() TO authenticated;
REVOKE EXECUTE ON FUNCTION license_grant(uuid, text) FROM PUBLIC, anon, authenticated;
