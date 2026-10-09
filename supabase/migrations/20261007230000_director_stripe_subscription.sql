/*
# Director subscription via Stripe

1. What this does
- Adds Stripe fields to `director_licenses` so a paid subscription can unlock the editor:
  - `stripe_customer_id` (text, unique) — Stripe customer of the account
  - `stripe_subscription_id` (text) — current Stripe subscription
  - `plan` (text, 'monthly' | 'yearly', nullable)
  - `current_period_end` (timestamptz, nullable) — end of the paid period
- The `stripe-checkout` edge function creates the Checkout session; the `stripe-webhook`
  edge function (service role) flips `subscription` to 'active' / 'canceled'.
- `license_status()` now returns `plan` and `current_period_end` for active accounts.

2. Security
- Unchanged: RLS on, no table policies. Only the service role (edge functions) writes the
  Stripe fields; clients read their own state through `license_status()`.
*/

ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS plan text CHECK (plan IN ('monthly', 'yearly'));
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

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
    RETURN json_build_object(
      'status', 'active',
      'subscription', 'active',
      'plan', v_row.plan,
      'current_period_end', v_row.current_period_end
    );
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
