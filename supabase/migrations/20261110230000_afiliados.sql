/*
# Programa de afiliados

1. O que é
- Pessoas convidadas pelo admin divulgam o VS Stage Pro com um link (`?ref=CODIGO`) e um cupom
  com o mesmo código. Ganham uma comissão (padrão 10%) de cada pagamento confirmado dos clientes
  que trouxeram, enquanto eles pagarem. O cupom dá desconto (padrão 10%) só no primeiro pagamento.
- O afiliado pede o saque quando quiser, a partir de R$ 100,00 disponível. O pedido leva todo o
  saldo liberado; o admin faz o PIX e marca como pago, ou recusa com motivo.
- Não confundir com o "Parceiro" (acesso grátis, `admin_set_partner`), que continua igual.

2. Tabelas
- `affiliates`: um por conta, com código, situação, comissão, desconto e chave PIX.
- `affiliate_referrals`: quem veio por quem. Um cliente tem no máximo um afiliado e isso não muda.
- `affiliate_commissions`: uma por pagamento (`pix_payment_id` único). Situações:
  pending (nos 7 dias para estorno) → available (calculado na leitura, sem cron) → reserved
  (preso a um pedido de saque) → paid; ou canceled (estorno, pelo admin).
- `affiliate_payouts`: pedidos de saque. Só um em aberto por afiliado; mínimo de 10000 centavos.
- `promo_codes` ganha `affiliate_id` e `first_payment_only`.

3. Como a comissão nasce
- Gatilho AFTER UPDATE em `pix_payments` quando a linha vira 'paid'. A função que confirma o
  pagamento (`pix_apply_payment_by_order`) não foi mexida. Qualquer falha no gatilho vira só um
  aviso no log: a liberação do plano nunca para por causa da comissão.

4. Segurança
- RLS ligado em todas as tabelas novas, sem políticas: tudo passa pelas funções abaixo.
- Funções do admin chamam `_require_admin()` e registram em `_audit()`.
- `discount_check_for_user` e `affiliate_attach_by_coupon` só o service role executa (pix-checkout).
*/

-- ─── Tabelas ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS affiliates (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  commission_percent int NOT NULL DEFAULT 10 CHECK (commission_percent BETWEEN 0 AND 100),
  discount_percent int NOT NULL DEFAULT 10 CHECK (discount_percent BETWEEN 1 AND 90),
  pix_key_type text CHECK (pix_key_type IS NULL OR pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
  pix_key text,
  payout_name text,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS affiliate_referrals (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  affiliate_id uuid NOT NULL REFERENCES affiliates(user_id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('link', 'coupon')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id <> affiliate_id)
);
CREATE INDEX IF NOT EXISTS affiliate_referrals_affiliate_idx ON affiliate_referrals (affiliate_id, created_at DESC);
ALTER TABLE affiliate_referrals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(user_id) ON DELETE CASCADE,
  amount_cents int NOT NULL CHECK (amount_cents >= 10000),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'rejected')),
  -- cópia da chave no momento do pedido: trocar a chave depois não muda para onde este saque vai
  pix_key_type text NOT NULL,
  pix_key text NOT NULL,
  payout_name text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  reference text,
  reject_reason text,
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  note text,
  -- aviso no Telegram já mandado (a função telegram-alert manda uma vez só)
  notified_at timestamptz
);
-- Só um pedido em aberto por afiliado.
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payouts_one_open_idx
  ON affiliate_payouts (affiliate_id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS affiliate_payouts_affiliate_idx ON affiliate_payouts (affiliate_id, requested_at DESC);
ALTER TABLE affiliate_payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES affiliates(user_id) ON DELETE CASCADE,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- sem chave estrangeira: a comissão fica no histórico mesmo se o pagamento sumir
  pix_payment_id uuid NOT NULL UNIQUE,
  plan text,
  base_cents int NOT NULL CHECK (base_cents >= 0),
  percent int NOT NULL CHECK (percent BETWEEN 0 AND 100),
  commission_cents int NOT NULL CHECK (commission_cents >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'available', 'reserved', 'paid', 'canceled')),
  available_at timestamptz NOT NULL,
  payout_id uuid REFERENCES affiliate_payouts(id) ON DELETE SET NULL,
  cancel_reason text,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_commissions_affiliate_idx ON affiliate_commissions (affiliate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS affiliate_commissions_payout_idx ON affiliate_commissions (payout_id) WHERE payout_id IS NOT NULL;
ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;

ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS affiliate_id uuid REFERENCES affiliates(user_id) ON DELETE SET NULL;
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS first_payment_only boolean NOT NULL DEFAULT false;

-- ─── Regras pequenas ─────────────────────────────────────────────────────────

-- A conta já pagou alguma vez? (PIX/cartão pela InfinitePay ou o antigo Stripe)
CREATE OR REPLACE FUNCTION _affiliate_has_paid(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM pix_payments WHERE user_id = p_user AND status = 'paid')
      OR EXISTS (SELECT 1 FROM completed_sales WHERE user_id = p_user)
$$;

-- Situação de uma comissão vista agora: 'pending' que já passou dos 7 dias é 'available'.
CREATE OR REPLACE FUNCTION _affiliate_commission_state(p_status text, p_available_at timestamptz) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE WHEN p_status = 'pending' AND p_available_at <= now() THEN 'available' ELSE p_status END
$$;

-- E-mail mascarado para o afiliado: j***@gmail.com
CREATE OR REPLACE FUNCTION _affiliate_mask_email(p_email text) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' in p_email) < 2 THEN '***'
    ELSE left(p_email, 1) || '***' || substring(p_email from position('@' in p_email))
  END
$$;

-- Liga o cliente ao afiliado, se puder. Devolve o resultado em texto.
CREATE OR REPLACE FUNCTION _affiliate_attach(p_user uuid, p_code text, p_source text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v affiliates;
BEGIN
  IF p_user IS NULL THEN RETURN 'not_allowed'; END IF;
  SELECT * INTO v FROM affiliates WHERE code = upper(trim(coalesce(p_code, '')));
  IF NOT FOUND OR v.status <> 'active' THEN RETURN 'invalid_code'; END IF;
  IF v.user_id = p_user THEN RETURN 'self'; END IF;
  -- primeiro que chega fica
  IF EXISTS (SELECT 1 FROM affiliate_referrals WHERE user_id = p_user) THEN RETURN 'already_referred'; END IF;
  -- cliente antigo não pode ser "adotado"
  IF _affiliate_has_paid(p_user) THEN RETURN 'already_customer'; END IF;
  INSERT INTO affiliate_referrals (user_id, affiliate_id, source)
  VALUES (p_user, v.user_id, p_source)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'attached' ELSE 'already_referred' END;
END $$;

-- ─── Cupom de desconto (substitui discount_check) ────────────────────────────

CREATE OR REPLACE FUNCTION _discount_check(p_code text, p_user uuid) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v promo_codes;
BEGIN
  SELECT * INTO v FROM promo_codes WHERE code = upper(trim(p_code)) AND kind = 'discount';
  IF NOT FOUND OR NOT v.active THEN RETURN json_build_object('valid', false, 'error', 'promo_invalid'); END IF;
  IF v.expires_at IS NOT NULL AND v.expires_at <= now() THEN RETURN json_build_object('valid', false, 'error', 'promo_expired'); END IF;
  IF v.max_uses IS NOT NULL AND v.uses >= v.max_uses THEN RETURN json_build_object('valid', false, 'error', 'promo_used_up'); END IF;
  IF v.affiliate_id IS NOT NULL THEN
    -- cupom de afiliado só vale com o afiliado ativo
    IF NOT EXISTS (SELECT 1 FROM affiliates WHERE user_id = v.affiliate_id AND status = 'active') THEN
      RETURN json_build_object('valid', false, 'error', 'promo_invalid');
    END IF;
    IF p_user IS NOT NULL AND p_user = v.affiliate_id THEN
      RETURN json_build_object('valid', false, 'error', 'coupon_own');
    END IF;
  END IF;
  -- sem conta (visitante) ainda não dá para saber: o pix-checkout confere de novo com a conta
  IF v.first_payment_only AND p_user IS NOT NULL AND _affiliate_has_paid(p_user) THEN
    RETURN json_build_object('valid', false, 'error', 'coupon_first_payment_only');
  END IF;
  RETURN json_build_object(
    'valid', true, 'percent', v.discount_percent,
    'stripe_promotion_code_id', v.stripe_promotion_code_id,
    'first_payment_only', v.first_payment_only,
    'affiliate', v.affiliate_id IS NOT NULL
  );
END $$;

-- Tela (site e app): confere com a conta logada, se houver.
CREATE OR REPLACE FUNCTION discount_check(p_code text) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT _discount_check(p_code, auth.uid()) $$;

-- Servidor (pix-checkout, com o service role): confere para a conta que está pagando.
CREATE OR REPLACE FUNCTION discount_check_for_user(p_code text, p_user uuid) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT _discount_check(p_code, p_user) $$;

-- ─── Comissão: nasce quando o pagamento vira 'paid' ──────────────────────────

CREATE OR REPLACE FUNCTION _affiliate_on_payment_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_aff affiliates;
  v_commission int;
BEGIN
  BEGIN
    SELECT a.* INTO v_aff
      FROM affiliate_referrals r JOIN affiliates a ON a.user_id = r.affiliate_id
     WHERE r.user_id = NEW.user_id;
    -- sem afiliado, pausado ou encerrado: nada a fazer
    IF NOT FOUND OR v_aff.status <> 'active' OR v_aff.user_id = NEW.user_id THEN RETURN NEW; END IF;

    -- base: o valor cobrado já com desconto, sem a taxa de parcelamento que o cliente paga a mais
    v_commission := round(NEW.amount_cents * v_aff.commission_percent / 100.0);
    IF v_commission <= 0 THEN RETURN NEW; END IF;

    INSERT INTO affiliate_commissions (
      affiliate_id, customer_id, pix_payment_id, plan, base_cents, percent, commission_cents,
      status, available_at
    ) VALUES (
      v_aff.user_id, NEW.user_id, NEW.id, NEW.plan, NEW.amount_cents, v_aff.commission_percent, v_commission,
      'pending', coalesce(NEW.paid_at, now()) + interval '7 days'
    )
    ON CONFLICT (pix_payment_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- a comissão nunca pode impedir a liberação do plano
    RAISE WARNING 'affiliate commission failed for payment %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pix_payments_affiliate_commission ON pix_payments;
CREATE TRIGGER pix_payments_affiliate_commission
  AFTER UPDATE OF status ON pix_payments
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION _affiliate_on_payment_paid();

-- ─── Público ─────────────────────────────────────────────────────────────────

-- Só diz se o código vale e o desconto, para a página mostrar "10% com o cupom X".
CREATE OR REPLACE FUNCTION affiliate_code_info(p_code text) RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT json_build_object('valid', true, 'code', a.code, 'discount_percent', a.discount_percent)
       FROM affiliates a
       JOIN promo_codes p ON p.affiliate_id = a.user_id AND p.code = a.code AND p.active
      WHERE a.code = upper(trim(coalesce(p_code, ''))) AND a.status = 'active'),
    json_build_object('valid', false)
  )
$$;

-- Ao entrar na conta com um código de link guardado.
CREATE OR REPLACE FUNCTION affiliate_claim(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN json_build_object('result', _affiliate_attach(auth.uid(), p_code, 'link'));
END $$;

-- Cupom de quem trouxe esta conta, se ainda vale (primeiro pagamento). Usado pela tela de
-- assinatura do site e do app: quem veio pelo link vê o cupom já aplicado em qualquer lugar.
CREATE OR REPLACE FUNCTION affiliate_referral_coupon() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_check json;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT a.code INTO v_code
    FROM affiliate_referrals r JOIN affiliates a ON a.user_id = r.affiliate_id
   WHERE r.user_id = v_uid AND a.status = 'active';
  IF v_code IS NULL THEN RETURN NULL; END IF;
  v_check := _discount_check(v_code, v_uid);
  IF NOT coalesce((v_check->>'valid')::boolean, false) THEN RETURN NULL; END IF;
  RETURN json_build_object('code', v_code, 'percent', (v_check->>'percent')::int);
END $$;

-- Servidor: o cliente usou o cupom do afiliado no pagamento (caso do app do Mac, sem link).
CREATE OR REPLACE FUNCTION affiliate_attach_by_coupon(p_user uuid, p_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM promo_codes WHERE code = upper(trim(coalesce(p_code, ''))) AND affiliate_id IS NOT NULL) THEN
    RETURN 'not_affiliate_coupon';
  END IF;
  RETURN _affiliate_attach(p_user, p_code, 'coupon');
END $$;

-- ─── Afiliado logado ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION affiliate_me() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v affiliates;
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
  r json;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v FROM affiliates WHERE user_id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('affiliate', false); END IF;

  WITH c AS (
    SELECT *, _affiliate_commission_state(status, available_at) AS state
      FROM affiliate_commissions WHERE affiliate_id = v_uid
  )
  SELECT json_build_object(
    'affiliate', true,
    'code', v.code,
    'status', v.status,
    'commission_percent', v.commission_percent,
    'discount_percent', v.discount_percent,
    'pix_key_type', v.pix_key_type,
    'pix_key', v.pix_key,
    'payout_name', v.payout_name,
    'created_at', v.created_at,
    'min_payout_cents', 10000,
    'signups', (SELECT count(*) FROM affiliate_referrals WHERE affiliate_id = v_uid),
    'paying_customers', (SELECT count(DISTINCT customer_id) FROM c WHERE state <> 'canceled'),
    'active_subscribers', (
      SELECT count(*) FROM affiliate_referrals r JOIN director_licenses l ON l.user_id = r.user_id
       WHERE r.affiliate_id = v_uid AND _license_state(l) = 'active'),
    'earned_month_cents', (SELECT coalesce(sum(commission_cents), 0) FROM c WHERE state <> 'canceled' AND created_at >= v_month_start),
    'earned_total_cents', (SELECT coalesce(sum(commission_cents), 0) FROM c WHERE state <> 'canceled'),
    'available_cents', (SELECT coalesce(sum(commission_cents), 0) FROM c WHERE state = 'available'),
    'pending_cents', (SELECT coalesce(sum(commission_cents), 0) FROM c WHERE state = 'pending'),
    'reserved_cents', (SELECT coalesce(sum(commission_cents), 0) FROM c WHERE state = 'reserved'),
    'paid_cents', (SELECT coalesce(sum(commission_cents), 0) FROM c WHERE state = 'paid'),
    'releases', (
      SELECT coalesce(json_agg(json_build_object('available_at', available_at, 'commission_cents', commission_cents) ORDER BY available_at), '[]'::json)
        FROM c WHERE state = 'pending'),
    'open_payout', (
      SELECT json_build_object('id', id, 'amount_cents', amount_cents, 'requested_at', requested_at)
        FROM affiliate_payouts WHERE affiliate_id = v_uid AND status = 'requested'),
    'monthly', (
      SELECT coalesce(json_agg(json_build_object('month', m.month, 'cents', m.cents) ORDER BY m.month), '[]'::json)
        FROM (
          SELECT to_char(date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS month,
                 sum(commission_cents) AS cents
            FROM c
           WHERE state <> 'canceled' AND created_at >= v_month_start - interval '11 months'
           GROUP BY 1
        ) m)
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION affiliate_customers() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); r json;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM affiliates WHERE user_id = v_uid) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT
      r.created_at,
      r.source,
      nullif(split_part(trim(coalesce(u.raw_user_meta_data->>'name', '')), ' ', 1), '') AS name,
      _affiliate_mask_email(u.email) AS email,
      CASE
        WHEN l.user_id IS NOT NULL AND _license_state(l) = 'active' THEN 'active'
        WHEN EXISTS (SELECT 1 FROM affiliate_commissions c WHERE c.customer_id = r.user_id AND c.affiliate_id = v_uid) THEN 'paid'
        ELSE 'signed_up'
      END AS situation,
      (SELECT coalesce(sum(c.commission_cents), 0) FROM affiliate_commissions c
        WHERE c.customer_id = r.user_id AND c.affiliate_id = v_uid AND c.status <> 'canceled') AS earned_cents
    FROM affiliate_referrals r
    JOIN auth.users u ON u.id = r.user_id
    LEFT JOIN director_licenses l ON l.user_id = r.user_id
    WHERE r.affiliate_id = v_uid
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION affiliate_commissions_list() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); r json;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM affiliates WHERE user_id = v_uid) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT c.id, c.created_at, c.plan, c.base_cents, c.percent, c.commission_cents,
           _affiliate_commission_state(c.status, c.available_at) AS status,
           c.available_at, c.payout_id, c.cancel_reason,
           nullif(split_part(trim(coalesce(u.raw_user_meta_data->>'name', '')), ' ', 1), '') AS customer_name
      FROM affiliate_commissions c
      LEFT JOIN auth.users u ON u.id = c.customer_id
     WHERE c.affiliate_id = v_uid
     ORDER BY c.created_at DESC
     LIMIT 500
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION affiliate_payouts_list() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); r json;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM affiliates WHERE user_id = v_uid) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT coalesce(json_agg(x ORDER BY x.requested_at DESC), '[]'::json) INTO r FROM (
    SELECT id, amount_cents, status, requested_at, paid_at, reference, reject_reason, pix_key_type, pix_key
      FROM affiliate_payouts WHERE affiliate_id = v_uid
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION affiliate_set_pix(p_type text, p_key text, p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := trim(coalesce(p_key, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_digits text := regexp_replace(coalesce(p_key, ''), '\D', '', 'g');
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM affiliates WHERE user_id = v_uid) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF length(v_name) < 3 OR length(v_name) > 120 THEN RAISE EXCEPTION 'pix_name_invalid'; END IF;
  IF p_type = 'cpf' THEN
    IF length(v_digits) <> 11 THEN RAISE EXCEPTION 'pix_key_invalid'; END IF;
    v_key := v_digits;
  ELSIF p_type = 'cnpj' THEN
    IF length(v_digits) <> 14 THEN RAISE EXCEPTION 'pix_key_invalid'; END IF;
    v_key := v_digits;
  ELSIF p_type = 'phone' THEN
    IF length(v_digits) NOT BETWEEN 10 AND 13 THEN RAISE EXCEPTION 'pix_key_invalid'; END IF;
    v_key := v_digits;
  ELSIF p_type = 'email' THEN
    v_key := lower(v_key);
    IF v_key !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_key) > 120 THEN RAISE EXCEPTION 'pix_key_invalid'; END IF;
  ELSIF p_type = 'random' THEN
    v_key := lower(v_key);
    IF v_key !~ '^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$' THEN RAISE EXCEPTION 'pix_key_invalid'; END IF;
  ELSE
    RAISE EXCEPTION 'pix_key_invalid';
  END IF;
  UPDATE affiliates SET pix_key_type = p_type, pix_key = v_key, payout_name = v_name, updated_at = now()
   WHERE user_id = v_uid;
END $$;

-- Pede o saque de TODO o saldo liberado. Mínimo R$ 100,00.
CREATE OR REPLACE FUNCTION affiliate_payout_request() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v affiliates;
  v_total int;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  -- trava o afiliado: dois pedidos ao mesmo tempo esperam um pelo outro
  SELECT * INTO v FROM affiliates WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v.status = 'ended' THEN RAISE EXCEPTION 'affiliate_ended'; END IF;
  IF EXISTS (SELECT 1 FROM affiliate_payouts WHERE affiliate_id = v_uid AND status = 'requested') THEN
    RAISE EXCEPTION 'request_open';
  END IF;
  IF coalesce(v.pix_key, '') = '' OR coalesce(v.payout_name, '') = '' THEN RAISE EXCEPTION 'no_pix_key'; END IF;

  PERFORM 1 FROM affiliate_commissions
   WHERE affiliate_id = v_uid AND _affiliate_commission_state(status, available_at) = 'available'
   FOR UPDATE;
  SELECT coalesce(sum(commission_cents), 0) INTO v_total FROM affiliate_commissions
   WHERE affiliate_id = v_uid AND _affiliate_commission_state(status, available_at) = 'available';
  IF v_total < 10000 THEN RAISE EXCEPTION 'below_minimum'; END IF;

  INSERT INTO affiliate_payouts (affiliate_id, amount_cents, pix_key_type, pix_key, payout_name)
  VALUES (v_uid, v_total, v.pix_key_type, v.pix_key, v.payout_name)
  RETURNING id INTO v_id;

  UPDATE affiliate_commissions SET status = 'reserved', payout_id = v_id
   WHERE affiliate_id = v_uid AND _affiliate_commission_state(status, available_at) = 'available';

  RETURN json_build_object('id', v_id, 'amount_cents', v_total);
END $$;

-- Servidor (telegram-alert): pega o pedido em aberto ainda sem aviso e marca como avisado.
CREATE OR REPLACE FUNCTION affiliate_payout_alert_claim(p_user uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  WITH upd AS (
    UPDATE affiliate_payouts SET notified_at = now()
     WHERE affiliate_id = p_user AND status = 'requested' AND notified_at IS NULL
     RETURNING id, affiliate_id, amount_cents, requested_at, pix_key_type, pix_key, payout_name
  )
  SELECT json_build_object(
    'id', upd.id, 'amount_cents', upd.amount_cents, 'requested_at', upd.requested_at,
    'pix_key_type', upd.pix_key_type, 'pix_key', upd.pix_key, 'payout_name', upd.payout_name,
    'code', a.code, 'email', u.email
  ) INTO r
  FROM upd JOIN affiliates a ON a.user_id = upd.affiliate_id JOIN auth.users u ON u.id = upd.affiliate_id;
  RETURN r;
END $$;

-- ─── Admin ───────────────────────────────────────────────────────────────────

-- Convida uma conta que já existe (busca pelo e-mail) e cria o cupom junto.
CREATE OR REPLACE FUNCTION admin_affiliate_create(
  p_email text, p_code text, p_commission int DEFAULT 10, p_discount int DEFAULT 10, p_note text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_code text := upper(trim(coalesce(p_code, '')));
BEGIN
  PERFORM _require_admin();
  SELECT id INTO v_user FROM auth.users WHERE lower(email) = lower(trim(coalesce(p_email, '')));
  IF v_user IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_code !~ '^[A-Z0-9_-]{3,32}$' THEN RAISE EXCEPTION 'promo_bad_code'; END IF;
  IF p_commission IS NULL OR p_commission < 0 OR p_commission > 100 THEN RAISE EXCEPTION 'invalid_commission'; END IF;
  IF p_discount IS NULL OR p_discount < 1 OR p_discount > 90 THEN RAISE EXCEPTION 'invalid_discount'; END IF;
  IF EXISTS (SELECT 1 FROM affiliates WHERE user_id = v_user) THEN RAISE EXCEPTION 'affiliate_exists'; END IF;
  IF EXISTS (SELECT 1 FROM promo_codes WHERE code = v_code) OR EXISTS (SELECT 1 FROM affiliates WHERE code = v_code) THEN
    RAISE EXCEPTION 'promo_exists';
  END IF;

  INSERT INTO affiliates (user_id, code, commission_percent, discount_percent, note, created_by)
  VALUES (v_user, v_code, p_commission, p_discount, nullif(trim(p_note), ''), auth.uid());

  INSERT INTO promo_codes (code, kind, value, discount_percent, note, created_by, affiliate_id, first_payment_only)
  VALUES (v_code, 'discount', p_discount, p_discount, 'Cupom do afiliado', auth.uid(), v_user, true);

  PERFORM _audit('affiliate_create', v_user,
    json_build_object('code', v_code, 'commission', p_commission, 'discount', p_discount)::jsonb);
  RETURN json_build_object('user_id', v_user, 'code', v_code);
END $$;

-- Valores nulos ficam como estão. Mudar a comissão vale só para os próximos pagamentos.
CREATE OR REPLACE FUNCTION admin_affiliate_update(
  p_user uuid, p_commission int DEFAULT NULL, p_discount int DEFAULT NULL,
  p_status text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v affiliates;
BEGIN
  PERFORM _require_admin();
  SELECT * INTO v FROM affiliates WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_commission IS NOT NULL AND (p_commission < 0 OR p_commission > 100) THEN RAISE EXCEPTION 'invalid_commission'; END IF;
  IF p_discount IS NOT NULL AND (p_discount < 1 OR p_discount > 90) THEN RAISE EXCEPTION 'invalid_discount'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'paused', 'ended') THEN RAISE EXCEPTION 'invalid_value'; END IF;

  UPDATE affiliates
     SET commission_percent = coalesce(p_commission, commission_percent),
         discount_percent = coalesce(p_discount, discount_percent),
         status = coalesce(p_status, status),
         note = CASE WHEN p_note IS NULL THEN note ELSE nullif(trim(p_note), '') END,
         updated_at = now()
   WHERE user_id = p_user
   RETURNING * INTO v;

  -- o cupom acompanha o desconto e a situação do afiliado
  UPDATE promo_codes
     SET discount_percent = v.discount_percent, value = v.discount_percent, active = (v.status = 'active')
   WHERE affiliate_id = p_user;

  PERFORM _audit('affiliate_update', p_user, json_build_object(
    'commission', p_commission, 'discount', p_discount, 'status', p_status)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_affiliates() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT a.user_id, a.code, a.status, a.commission_percent, a.discount_percent, a.note, a.created_at,
           a.pix_key_type, a.pix_key, a.payout_name,
           u.email, nullif(trim(coalesce(u.raw_user_meta_data->>'name', '')), '') AS name,
           (SELECT count(*) FROM affiliate_referrals r WHERE r.affiliate_id = a.user_id) AS signups,
           (SELECT count(DISTINCT c.customer_id) FROM affiliate_commissions c
             WHERE c.affiliate_id = a.user_id AND c.status <> 'canceled') AS paying,
           (SELECT coalesce(sum(c.base_cents), 0) FROM affiliate_commissions c
             WHERE c.affiliate_id = a.user_id AND c.status <> 'canceled') AS revenue_cents,
           (SELECT coalesce(sum(c.commission_cents), 0) FROM affiliate_commissions c
             WHERE c.affiliate_id = a.user_id AND _affiliate_commission_state(c.status, c.available_at) IN ('available', 'reserved')) AS to_pay_cents,
           (SELECT coalesce(sum(c.commission_cents), 0) FROM affiliate_commissions c
             WHERE c.affiliate_id = a.user_id AND _affiliate_commission_state(c.status, c.available_at) = 'pending') AS pending_cents,
           (SELECT coalesce(sum(c.commission_cents), 0) FROM affiliate_commissions c
             WHERE c.affiliate_id = a.user_id AND c.status = 'paid') AS paid_cents
      FROM affiliates a JOIN auth.users u ON u.id = a.user_id
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_affiliate_detail(p_user uuid) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT json_build_object(
    'customers', (
      SELECT coalesce(json_agg(json_build_object(
        'user_id', rf.user_id, 'email', u.email,
        'name', nullif(trim(coalesce(u.raw_user_meta_data->>'name', '')), ''),
        'source', rf.source, 'created_at', rf.created_at,
        'state', CASE WHEN l.user_id IS NULL THEN 'trial' ELSE _license_state(l) END
      ) ORDER BY rf.created_at DESC), '[]'::json)
        FROM affiliate_referrals rf
        JOIN auth.users u ON u.id = rf.user_id
        LEFT JOIN director_licenses l ON l.user_id = rf.user_id
       WHERE rf.affiliate_id = p_user),
    'commissions', (
      SELECT coalesce(json_agg(json_build_object(
        'id', c.id, 'created_at', c.created_at, 'plan', c.plan, 'base_cents', c.base_cents,
        'percent', c.percent, 'commission_cents', c.commission_cents,
        'status', _affiliate_commission_state(c.status, c.available_at),
        'available_at', c.available_at, 'payout_id', c.payout_id, 'cancel_reason', c.cancel_reason,
        'customer_email', u.email
      ) ORDER BY c.created_at DESC), '[]'::json)
        FROM affiliate_commissions c LEFT JOIN auth.users u ON u.id = c.customer_id
       WHERE c.affiliate_id = p_user),
    'payouts', (
      SELECT coalesce(json_agg(json_build_object(
        'id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'requested_at', p.requested_at,
        'paid_at', p.paid_at, 'reference', p.reference, 'reject_reason', p.reject_reason,
        'pix_key_type', p.pix_key_type, 'pix_key', p.pix_key, 'payout_name', p.payout_name
      ) ORDER BY p.requested_at DESC), '[]'::json)
        FROM affiliate_payouts p WHERE p.affiliate_id = p_user)
  ) INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_affiliate_payouts_open() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.requested_at), '[]'::json) INTO r FROM (
    SELECT p.id, p.affiliate_id, p.amount_cents, p.requested_at, p.pix_key_type, p.pix_key, p.payout_name,
           a.code, u.email, nullif(trim(coalesce(u.raw_user_meta_data->>'name', '')), '') AS name
      FROM affiliate_payouts p
      JOIN affiliates a ON a.user_id = p.affiliate_id
      JOIN auth.users u ON u.id = p.affiliate_id
     WHERE p.status = 'requested'
  ) x;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_affiliate_payout_mark_paid(p_id uuid, p_reference text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v affiliate_payouts;
BEGIN
  PERFORM _require_admin();
  IF length(trim(coalesce(p_reference, ''))) < 1 THEN RAISE EXCEPTION 'reference_required'; END IF;
  SELECT * INTO v FROM affiliate_payouts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.status <> 'requested' THEN RAISE EXCEPTION 'payout_not_open'; END IF;

  UPDATE affiliate_commissions SET status = 'paid' WHERE payout_id = p_id AND status = 'reserved';
  UPDATE affiliate_payouts
     SET status = 'paid', paid_at = now(), reference = trim(p_reference),
         note = nullif(trim(coalesce(p_note, '')), ''), handled_by = auth.uid(), handled_at = now()
   WHERE id = p_id;

  PERFORM _audit('affiliate_payout_paid', v.affiliate_id,
    json_build_object('payout', p_id, 'amount_cents', v.amount_cents, 'reference', trim(p_reference))::jsonb);
END $$;

-- Recusa: as comissões voltam a ficar disponíveis para um novo pedido.
CREATE OR REPLACE FUNCTION admin_affiliate_payout_reject(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v affiliate_payouts;
BEGIN
  PERFORM _require_admin();
  IF length(trim(coalesce(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v FROM affiliate_payouts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.status <> 'requested' THEN RAISE EXCEPTION 'payout_not_open'; END IF;

  UPDATE affiliate_commissions SET status = 'available', payout_id = NULL WHERE payout_id = p_id AND status = 'reserved';
  UPDATE affiliate_payouts
     SET status = 'rejected', reject_reason = trim(p_reason), handled_by = auth.uid(), handled_at = now()
   WHERE id = p_id;

  PERFORM _audit('affiliate_payout_rejected', v.affiliate_id,
    json_build_object('payout', p_id, 'amount_cents', v.amount_cents, 'reason', trim(p_reason))::jsonb);
END $$;

-- Estorno: cancela a comissão de um pagamento. Já paga não se cancela; em saque aberto,
-- recuse o saque antes (o valor do pedido não pode mudar depois de pedido).
CREATE OR REPLACE FUNCTION admin_affiliate_commission_cancel(p_id uuid, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v affiliate_commissions;
BEGIN
  PERFORM _require_admin();
  IF length(trim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v FROM affiliate_commissions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v.status = 'paid' THEN RAISE EXCEPTION 'commission_already_paid'; END IF;
  IF v.status = 'reserved' THEN RAISE EXCEPTION 'commission_in_payout'; END IF;
  IF v.status = 'canceled' THEN RETURN; END IF;

  UPDATE affiliate_commissions SET status = 'canceled', cancel_reason = trim(p_motivo), canceled_at = now()
   WHERE id = p_id;
  PERFORM _audit('affiliate_commission_cancel', v.affiliate_id,
    json_build_object('commission', p_id, 'amount_cents', v.commission_cents, 'reason', trim(p_motivo))::jsonb);
END $$;

-- O cupom do afiliado não é apagado nem desligado pela aba de códigos: vai pela aba Afiliados.
CREATE OR REPLACE FUNCTION admin_promo_delete(p_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF EXISTS (SELECT 1 FROM promo_codes WHERE code = p_code AND affiliate_id IS NOT NULL) THEN
    RAISE EXCEPTION 'promo_affiliate';
  END IF;
  DELETE FROM promo_codes WHERE code = p_code;
  PERFORM _audit('promo_delete', NULL, json_build_object('code', p_code)::jsonb);
END $$;

-- ─── Permissões ──────────────────────────────────────────────────────────────

DO $$
DECLARE f text;
BEGIN
  -- internas: ninguém de fora chama
  FOREACH f IN ARRAY ARRAY[
    '_affiliate_has_paid(uuid)',
    '_affiliate_attach(uuid, text, text)',
    '_discount_check(text, uuid)',
    '_affiliate_on_payment_paid()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;

  -- só o servidor (service role)
  FOREACH f IN ARRAY ARRAY[
    'discount_check_for_user(text, uuid)',
    'affiliate_attach_by_coupon(uuid, text)',
    'affiliate_payout_alert_claim(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;

  -- conta logada (o afiliado e o admin; as do admin conferem _require_admin)
  FOREACH f IN ARRAY ARRAY[
    'affiliate_claim(text)',
    'affiliate_referral_coupon()',
    'affiliate_me()',
    'affiliate_customers()',
    'affiliate_commissions_list()',
    'affiliate_payouts_list()',
    'affiliate_set_pix(text, text, text)',
    'affiliate_payout_request()',
    'admin_affiliate_create(text, text, int, int, text)',
    'admin_affiliate_update(uuid, int, int, text, text)',
    'admin_affiliates()',
    'admin_affiliate_detail(uuid)',
    'admin_affiliate_payouts_open()',
    'admin_affiliate_payout_mark_paid(uuid, text, text)',
    'admin_affiliate_payout_reject(uuid, text)',
    'admin_affiliate_commission_cancel(uuid, text)',
    'admin_promo_delete(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;

  -- públicas
  EXECUTE 'GRANT EXECUTE ON FUNCTION affiliate_code_info(text) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION discount_check(text) TO anon, authenticated';
END $$;
