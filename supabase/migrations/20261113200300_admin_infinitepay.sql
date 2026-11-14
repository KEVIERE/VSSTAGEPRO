/*
# Admin com dados da InfinitePay no lugar do Stripe

1. Problema
- `admin_users` devolvia `stripe_customer_id` e não dizia como a pessoa paga nem até
  quando o pagamento pela InfinitePay vale.
- `admin_overview` calculava o anual com o preço antigo (59900/12) e as últimas vendas
  não diziam se foram no PIX ou no cartão.
- `admin_service_health` mostrava para sempre a última linha de cada serviço, então o
  cartão antigo do Stripe continuaria aparecendo depois de sair do health-check.
- Estornos feitos no app da InfinitePay não chegam ao sistema (ela só avisa aprovação):
  o acesso e a comissão do afiliado continuavam valendo.

2. Mudanças
- `admin_users(...)`: mesma assinatura. Passa a devolver `pix_paid_until`, `partner`,
  `payment_source` ('infinitepay' | 'manual' | 'promo' | 'partner' | 'legacy' | null),
  `last_payment_method` ('pix' | 'credit_card' | null) e `last_receipt_url`. Deixa de
  devolver `stripe_customer_id`.
- `admin_user_payments(user)`: pagamentos da conta pela InfinitePay.
- `admin_pix_refund(pagamento, motivo)`: registra um estorno feito no app da InfinitePay.
  Marca 'refunded', tira o período daquele pagamento de `pix_paid_until` (nunca para antes
  de agora) e cancela a comissão do afiliado ainda não paga.
- `admin_overview(...)`: mesma assinatura. Anual a 34900/12, tempo manual fora da receita
  recorrente, e `recent_sales` com `provider` e `method`.
- `admin_service_health()`: só serviços checados nas últimas 24 h, e nunca o 'stripe'.

3. Segurança
- Todas conferem `_require_admin()`; as que mudam dados registram em `admin_audit`.
*/

-- ─── Contas ──────────────────────────────────────────────────────────────────

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
           l.blocked, l.blocked_reason, l.subscribed_at,
           l.pix_paid_until, coalesce(l.partner, false) AS partner,
           CASE
             WHEN l.user_id IS NULL THEN NULL
             WHEN l.partner THEN 'partner'
             WHEN l.subscription = 'active' AND l.stripe_subscription_id IS NOT NULL THEN 'legacy'
             WHEN l.subscription = 'active' THEN 'manual'
             WHEN l.pix_paid_until > now() THEN coalesce(l.pix_paid_source, CASE WHEN lp.id IS NOT NULL THEN 'infinitepay' ELSE 'manual' END)
             WHEN l.comp_until > now() THEN 'promo'
             WHEN l.pix_paid_until IS NOT NULL THEN coalesce(l.pix_paid_source, CASE WHEN lp.id IS NOT NULL THEN 'infinitepay' ELSE 'manual' END)
           END AS payment_source,
           lp.capture_method AS last_payment_method,
           lp.receipt_url AS last_receipt_url,
           CASE WHEN l.user_id IS NULL THEN 'trial' ELSE _license_state(l) END AS state,
           l.trial_started_at + make_interval(hours => l.trial_hours) AS trial_ends_at,
           (SELECT max(f.created_at) FROM feature_usage f WHERE f.user_id = u.id) AS last_seen_at,
           (SELECT count(*) FROM feature_usage f WHERE f.user_id = u.id AND f.created_at > now() - interval '30 days') AS uses_30d,
           EXISTS (SELECT 1 FROM app_admins a WHERE a.user_id = u.id) AS is_admin
      FROM auth.users u
      LEFT JOIN director_licenses l ON l.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT p.id, p.capture_method, p.receipt_url
          FROM pix_payments p
         WHERE p.user_id = u.id AND p.status = 'paid'
         ORDER BY p.paid_at DESC NULLS LAST
         LIMIT 1
      ) lp ON true
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

CREATE OR REPLACE FUNCTION admin_user_payments(p_user uuid) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT p.id, p.plan, p.amount_cents, p.paid_amount_cents, p.status, p.capture_method, p.installments,
           p.coupon_code, p.discount_percent, p.paid_at, p.access_until, p.receipt_url, p.provider,
           p.refunded_at, p.refund_reason, p.created_at
      FROM pix_payments p
     WHERE p.user_id = p_user
     ORDER BY p.created_at DESC
     LIMIT 100
  ) x;
  RETURN r;
END $$;

-- ─── Estorno (feito no app da InfinitePay, registrado aqui) ──────────────────

CREATE OR REPLACE FUNCTION admin_pix_refund(p_payment uuid, p_reason text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v pix_payments;
  v_lic director_licenses;
  v_new timestamptz;
  v_commission text;
BEGIN
  PERFORM _require_admin();
  IF length(trim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO v FROM pix_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.status = 'refunded' THEN RETURN json_build_object('result', 'already_refunded'); END IF;
  IF v.status NOT IN ('paid', 'amount_mismatch') THEN RAISE EXCEPTION 'not_paid'; END IF;

  -- Só o pagamento liberado deu tempo: tira esse período (nunca para antes de agora).
  IF v.status = 'paid' THEN
    SELECT * INTO v_lic FROM director_licenses WHERE user_id = v.user_id FOR UPDATE;
    IF FOUND AND v_lic.pix_paid_until IS NOT NULL THEN
      v_new := greatest(now(), v_lic.pix_paid_until
                 - CASE v.plan WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END);
      UPDATE director_licenses SET pix_paid_until = v_new WHERE user_id = v.user_id;
      IF v_lic.pix_paid_until > now() AND v_new <= now() AND v_lic.subscription IS DISTINCT FROM 'active' THEN
        INSERT INTO subscription_events (user_id, kind, plan) VALUES (v.user_id, 'canceled', v.plan);
      END IF;
    END IF;
  END IF;

  UPDATE pix_payments
     SET status = 'refunded', refunded_at = now(), refund_reason = left(trim(p_reason), 200), updated_at = now()
   WHERE id = v.id;

  -- Comissão do afiliado ainda não paga: cancela. Em saque ou já paga: fica para o admin decidir.
  UPDATE affiliate_commissions
     SET status = 'canceled', cancel_reason = left('Estorno: ' || trim(p_reason), 200), canceled_at = now()
   WHERE pix_payment_id = v.id AND status IN ('pending', 'available');
  SELECT status INTO v_commission FROM affiliate_commissions WHERE pix_payment_id = v.id;

  PERFORM _audit('pix_refund', v.user_id, json_build_object(
    'payment', v.id, 'amount_cents', coalesce(v.paid_amount_cents, v.amount_cents),
    'reason', left(trim(p_reason), 200), 'paid_until', v_new, 'commission', v_commission
  )::jsonb);

  RETURN json_build_object('result', 'refunded', 'pix_paid_until', v_new, 'commission', v_commission);
END $$;

-- ─── Visão geral ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_overview(p_days int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  r json;
BEGIN
  PERFORM _require_admin();
  WITH lic AS (
    SELECT l.*, _license_state(l) AS state,
           -- tempo dado pelo admin, sem cobrança (fica fora da receita recorrente)
           coalesce(l.plan IS NULL
            OR (l.subscription = 'active' AND l.stripe_subscription_id IS NULL)
            OR (l.subscription IS DISTINCT FROM 'active' AND l.pix_paid_source = 'manual'), false) AS is_manual
      FROM director_licenses l
  )
  SELECT json_build_object(
    'total_users', (SELECT count(*) FROM auth.users),
    'trial', (SELECT count(*) FROM lic WHERE state = 'trial'),
    'expired', (SELECT count(*) FROM lic WHERE state = 'expired'),
    'active', (SELECT count(*) FROM lic WHERE state = 'active'),
    'monthly', (SELECT count(*) FROM lic WHERE state = 'active' AND plan = 'monthly' AND NOT is_manual),
    'yearly', (SELECT count(*) FROM lic WHERE state = 'active' AND plan = 'yearly' AND NOT is_manual),
    'manual', (SELECT count(*) FROM lic WHERE state = 'active' AND is_manual),
    'infinitepay', (SELECT count(*) FROM lic WHERE state = 'active' AND NOT is_manual
                      AND subscription IS DISTINCT FROM 'active'),
    'legacy', (SELECT count(*) FROM lic WHERE state = 'active' AND subscription = 'active'
                 AND stripe_subscription_id IS NOT NULL),
    'promo', (SELECT count(*) FROM lic WHERE state = 'promo'),
    'blocked', (SELECT count(*) FROM lic WHERE state = 'blocked'),
    'mrr_cents', (SELECT coalesce(sum(CASE plan WHEN 'monthly' THEN 5500 WHEN 'yearly' THEN round(34900 / 12.0) ELSE 0 END), 0)
                  FROM lic WHERE state = 'active' AND NOT is_manual),
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
    -- link de pagamento aberto na InfinitePay (ou checkout antigo): mostrou interesse, pode não ter pago
    'recent_intentions', (
      SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT i.created_at, i.plan, i.coupon_code, u.email, u.raw_user_meta_data->>'name' AS name
          FROM checkout_intents i JOIN auth.users u ON u.id = i.user_id
         ORDER BY i.created_at DESC LIMIT 12
      ) x
    ),
    -- só pagamento confirmado (InfinitePay pelo webhook mais /payment_check, ou venda antiga)
    'recent_sales', (
      SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT s.created_at, s.plan, s.amount_cents, u.email, u.raw_user_meta_data->>'name' AS name,
               s.provider,
               coalesce(s.method, p.capture_method, CASE WHEN s.provider = 'stripe' THEN 'credit_card' END) AS method
          FROM completed_sales s
          JOIN auth.users u ON u.id = s.user_id
          LEFT JOIN pix_payments p ON p.id = s.pix_payment_id
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

-- ─── Saúde dos serviços ──────────────────────────────────────────────────────

-- Só o que foi checado nas últimas 24 h: um serviço que saiu do health-check (o Stripe)
-- some do painel em vez de ficar parado na última leitura.
CREATE OR REPLACE FUNCTION admin_service_health() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x), '[]'::json) INTO r FROM (
    SELECT DISTINCT ON (service)
      service, status, latency_ms, detail, checked_at
    FROM service_health
    WHERE checked_at > now() - interval '24 hours'
      AND service <> 'stripe'
    ORDER BY service, checked_at DESC
  ) x;
  RETURN r;
END $$;

-- ─── Permissões ──────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION admin_users(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_users(text, text, int, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_user_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_user_payments(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_pix_refund(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_pix_refund(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_overview(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_overview(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_service_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_service_health() TO authenticated;
