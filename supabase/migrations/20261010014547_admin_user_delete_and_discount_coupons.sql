/* Admin user deletion and Stripe-native discount coupons.
   Coupon codes are deliberately separate from bonus promo_codes: they represent
   a Stripe checkout discount, not free access. */

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS discount_percent int;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS stripe_coupon_id text;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS stripe_promotion_code_id text;
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_kind_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_kind_check CHECK (kind IN ('trial_hours', 'free_days', 'discount'));
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_discount_percent_check CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100));

CREATE OR REPLACE FUNCTION admin_delete_user(p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'cannot_delete_self'; END IF;
  IF EXISTS (SELECT 1 FROM app_admins WHERE user_id = p_user) THEN RAISE EXCEPTION 'cannot_delete_admin'; END IF;
  DELETE FROM auth.users WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  PERFORM _audit('delete_user', p_user, NULL);
END $$;

-- Signature changed (added discount/stripe columns): drop the old 6-arg version first,
-- otherwise Postgres keeps both as an ambiguous overload.
DROP FUNCTION IF EXISTS admin_promo_create(text, text, int, int, timestamptz, text);

CREATE FUNCTION admin_promo_create(
  p_code text, p_kind text, p_value int, p_max_uses int DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL, p_note text DEFAULT NULL,
  p_discount_percent int DEFAULT NULL, p_stripe_coupon_id text DEFAULT NULL,
  p_stripe_promotion_code_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF p_kind = 'discount' THEN
    IF p_discount_percent IS NULL OR p_discount_percent < 1 OR p_discount_percent > 100 THEN RAISE EXCEPTION 'invalid_discount'; END IF;
    p_value := p_discount_percent;
  ELSIF p_kind NOT IN ('trial_hours', 'free_days') OR p_value IS NULL OR p_value <= 0 THEN
    RAISE EXCEPTION 'invalid_value';
  END IF;
  INSERT INTO promo_codes(code, kind, value, max_uses, expires_at, note, created_by, discount_percent, stripe_coupon_id, stripe_promotion_code_id)
  VALUES (upper(trim(p_code)), p_kind, p_value, p_max_uses, p_expires_at, nullif(trim(p_note), ''), auth.uid(),
          CASE WHEN p_kind = 'discount' THEN p_discount_percent END, p_stripe_coupon_id, p_stripe_promotion_code_id);
  PERFORM _audit('promo_create', NULL, json_build_object('code', upper(trim(p_code)), 'kind', p_kind, 'value', p_value)::jsonb);
END $$;

-- 'discount' codes only apply at Stripe checkout (see stripe-checkout function); they must
-- never be accepted by the entry-screen "I have a promo code" flow, which only grants
-- free trial time / full access, not a price reduction.
CREATE OR REPLACE FUNCTION promo_check(p_code text) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v promo_codes;
BEGIN
  SELECT * INTO v FROM promo_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND OR NOT v.active OR v.kind = 'discount' THEN RETURN json_build_object('valid', false, 'error', 'promo_invalid'); END IF;
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
  IF NOT FOUND OR NOT v.active OR v.kind = 'discount' THEN RAISE EXCEPTION 'promo_invalid'; END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN RAISE EXCEPTION 'promo_expired'; END IF;
  IF v.max_uses IS NOT NULL AND v.uses >= v.max_uses THEN RAISE EXCEPTION 'promo_used_up'; END IF;
  IF EXISTS (SELECT 1 FROM promo_redemptions WHERE code = v.code AND user_id = v_uid) THEN
    RAISE EXCEPTION 'promo_already_used';
  END IF;

  v_row := _ensure_license(v_uid);

  IF v.kind = 'trial_hours' THEN
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

-- Public function to validate a discount code at checkout time (client calls this before
-- invoking stripe-checkout, and stripe-checkout re-validates server-side regardless).
CREATE OR REPLACE FUNCTION discount_check(p_code text) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v promo_codes;
BEGIN
  SELECT * INTO v FROM promo_codes WHERE code = upper(trim(p_code)) AND kind = 'discount';
  IF NOT FOUND OR NOT v.active THEN RETURN json_build_object('valid', false, 'error', 'promo_invalid'); END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN RETURN json_build_object('valid', false, 'error', 'promo_expired'); END IF;
  IF v.max_uses IS NOT NULL AND v.uses >= v.max_uses THEN RETURN json_build_object('valid', false, 'error', 'promo_used_up'); END IF;
  RETURN json_build_object('valid', true, 'percent', v.discount_percent, 'stripe_promotion_code_id', v.stripe_promotion_code_id);
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE EXECUTE ON FUNCTION admin_delete_user(uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION admin_delete_user(uuid) TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION discount_check(text) TO anon, authenticated';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION admin_promo_create(text, text, int, int, timestamptz, text, int, text, text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION admin_promo_create(text, text, int, int, timestamptz, text, int, text, text) TO authenticated';
END $$;
