/*
# Director trial: 48 hours instead of 7 days

1. What this does
- Adds `trial_hours` (int, default 48) to `director_licenses` and makes `license_status()`
  compute the trial end from hours. Every existing trial row is moved to 48 hours, counted
  from its original `trial_started_at`.
- `license_status()` now also returns `hours_left` so the client can show the remaining time.

2. Security
- Unchanged: RLS on, no table policies, access only through the SECURITY DEFINER functions.
*/

ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS trial_hours int NOT NULL DEFAULT 48;
UPDATE director_licenses SET trial_hours = 48;

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

  SELECT * INTO v_row FROM director_licenses WHERE user_id = v_uid;
  IF NOT FOUND THEN
    INSERT INTO director_licenses (user_id, trial_started_at)
    VALUES (v_uid, now())
    RETURNING * INTO v_row;
  END IF;

  IF v_row.subscription = 'active' THEN
    RETURN json_build_object('status', 'active', 'subscription', 'active');
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

REVOKE EXECUTE ON FUNCTION license_status() FROM anon;
GRANT EXECUTE ON FUNCTION license_status() TO authenticated;
