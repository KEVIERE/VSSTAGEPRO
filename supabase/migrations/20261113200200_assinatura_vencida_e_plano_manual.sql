/*
# Assinatura vencida e plano manual pelo admin

1. Problema
- Quem pagou (PIX ou cartão pela InfinitePay) e deixou vencer recebia de `license_status()`
  o mesmo 'expired' de quem nunca pagou, e o programa mostrava "Seu teste grátis terminou".
- A ativação manual do admin (`admin_set_subscription(..., 'active')`) ligava uma
  assinatura sem prazo e herdava o `current_period_end` antigo do Stripe. Isso dava acesso
  sem fim e fazia o pix-checkout recusar o pagamento ("assinatura já ativa").

2. Mudanças
- `license_status()`: no 'expired' passa a devolver também
  - `reason`: 'paid_period_over' (já pagou) ou 'trial_over' (nunca pagou);
  - `paid_before` (e o mesmo valor em `had_paid`): a conta já pagou alguma vez;
  - `paid_until`: até quando valeu o último período pago;
  - `last_plan`: o último plano ('monthly' | 'yearly').
  Os campos antigos continuam iguais: programas antigos não quebram.
- `license_status()` testa o período pago pela InfinitePay (`pix_paid_until`) antes da
  assinatura antiga do Stripe: quem tinha Stripe e pagou pela InfinitePay recebe as
  datas novas.
- `admin_grant_plan(user, plan)`: soma 1 mês ou 1 ano a `pix_paid_until`, igual a um
  pagamento (o tempo novo entra depois do que ainda falta). A pessoa recebe os avisos de
  vencimento e pode renovar pela InfinitePay.
- `admin_revoke_plan(user)`: encerra agora o período pago.
- `admin_set_subscription(user, 'active', plan)`: passa a dar o tempo como o
  `admin_grant_plan` (1 mês se o plano não vier), em vez de ligar uma assinatura sem prazo.
  'canceled' e 'trial' continuam iguais (servem para a assinatura antiga do Stripe).

3. Segurança
- Funções do admin conferem `_require_admin()` e registram em `admin_audit`.
*/

-- ─── license_status ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION license_status() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row director_licenses;
  v_end timestamptz;
  v_hours int;
  v_paid_before boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('status', 'anonymous'); END IF;
  v_row := _ensure_license(v_uid);

  IF v_row.blocked THEN
    RETURN json_build_object('status', 'blocked', 'reason', v_row.blocked_reason);
  END IF;

  -- Período pago (PIX ou cartão pela InfinitePay, ou tempo manual): sem renovação automática.
  -- O valor 'pix' de subscription fica assim por compatibilidade com o programa.
  -- Vem ANTES da assinatura antiga do Stripe: uma conta antiga que pagou pela InfinitePay
  -- recebe as datas da InfinitePay (a não ser que o período do Stripe ainda vá além).
  IF v_row.pix_paid_until IS NOT NULL AND v_row.pix_paid_until > now()
     AND NOT (v_row.subscription = 'active' AND v_row.current_period_end IS NOT NULL
              AND v_row.current_period_end > v_row.pix_paid_until) THEN
    RETURN json_build_object(
      'status', 'active', 'subscription', 'pix',
      'plan', v_row.plan, 'current_period_end', v_row.pix_paid_until
    );
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

  -- Vencido: diz se foi o período pago ou o teste grátis que terminou.
  v_paid_before := v_row.pix_paid_until IS NOT NULL OR _affiliate_has_paid(v_uid);
  RETURN json_build_object(
    'status', 'expired',
    'trial_started_at', v_row.trial_started_at,
    'ends_at', v_end,
    'reason', CASE WHEN v_paid_before THEN 'paid_period_over' ELSE 'trial_over' END,
    'paid_before', v_paid_before,
    'had_paid', v_paid_before,
    'paid_until', CASE WHEN v_paid_before THEN coalesce(v_row.pix_paid_until, v_row.current_period_end) END,
    'last_plan', CASE WHEN v_paid_before AND v_row.plan IN ('monthly', 'yearly') THEN v_row.plan END
  );
END $$;

-- ─── Plano manual ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_grant_plan(p_user uuid, p_plan text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lic director_licenses;
  v_was_active boolean;
  v_until timestamptz;
BEGIN
  PERFORM _require_admin();
  IF p_user IS NULL OR p_plan IS NULL OR p_plan NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  PERFORM _ensure_license(p_user);
  SELECT * INTO v_lic FROM director_licenses WHERE user_id = p_user FOR UPDATE;

  v_was_active := v_lic.pix_paid_until IS NOT NULL AND v_lic.pix_paid_until > now();
  v_until := greatest(now(), coalesce(v_lic.pix_paid_until, now()))
             + CASE p_plan WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END;

  UPDATE director_licenses
     SET pix_paid_until = v_until,
         pix_paid_source = 'manual',
         plan = CASE WHEN subscription = 'active' THEN plan ELSE p_plan END
   WHERE user_id = p_user;

  IF NOT v_was_active AND v_lic.subscription IS DISTINCT FROM 'active' THEN
    INSERT INTO subscription_events (user_id, kind, plan) VALUES (p_user, 'subscribed', p_plan);
  END IF;

  PERFORM _audit('grant_plan', p_user, json_build_object('plan', p_plan, 'paid_until', v_until, 'source', 'manual')::jsonb);
  RETURN json_build_object('ok', true, 'pix_paid_until', v_until);
END $$;

CREATE OR REPLACE FUNCTION admin_revoke_plan(p_user uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_lic director_licenses;
BEGIN
  PERFORM _require_admin();
  IF p_user IS NULL THEN RAISE EXCEPTION 'invalid_value'; END IF;
  SELECT * INTO v_lic FROM director_licenses WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND OR v_lic.pix_paid_until IS NULL OR v_lic.pix_paid_until <= now() THEN
    RETURN json_build_object('ok', true, 'changed', false);
  END IF;

  UPDATE director_licenses SET pix_paid_until = now() WHERE user_id = p_user;
  IF v_lic.subscription IS DISTINCT FROM 'active' THEN
    INSERT INTO subscription_events (user_id, kind, plan) VALUES (p_user, 'canceled', v_lic.plan);
  END IF;

  PERFORM _audit('revoke_plan', p_user, json_build_object('was_paid_until', v_lic.pix_paid_until)::jsonb);
  RETURN json_build_object('ok', true, 'changed', true);
END $$;

-- 'active' deixa de ligar uma assinatura sem prazo: dá o tempo como um pagamento.
CREATE OR REPLACE FUNCTION admin_set_subscription(p_user uuid, p_subscription text, p_plan text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF p_subscription NOT IN ('trial', 'active', 'canceled') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF p_plan IS NOT NULL AND p_plan NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  PERFORM _ensure_license(p_user);

  IF p_subscription = 'active' THEN
    PERFORM admin_grant_plan(p_user, coalesce(p_plan, 'monthly'));
    RETURN;
  END IF;

  UPDATE director_licenses SET subscription = p_subscription WHERE user_id = p_user;
  PERFORM _audit('set_subscription', p_user, json_build_object('subscription', p_subscription, 'plan', p_plan)::jsonb);
END $$;

-- ─── Permissões ──────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION license_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION license_status() TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_grant_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_grant_plan(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_revoke_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_revoke_plan(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_set_subscription(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_subscription(uuid, text, text) TO authenticated;
