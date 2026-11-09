/*
# Assinatura por PIX (Asaas), com confirmação automática

1. O que muda
- `director_licenses` ganha:
  - `pix_paid_until` — até quando o PIX pago libera o programa. PIX não se renova sozinho:
    cada pagamento soma 1 mês (mensal) ou 1 ano (anual) a partir do fim do período atual.
  - `asaas_customer_id` — cliente da conta no Asaas (o CPF/CNPJ fica guardado só no Asaas).
- `pix_payments` — uma linha por PIX gerado: plano, valor esperado, QR Code, vencimento e status
  ('pending' | 'paid' | 'expired' | 'canceled' | 'amount_mismatch').
- `completed_sales` e `checkout_intents` passam a aceitar vendas do Asaas (`provider`), então o
  painel do admin conta o PIX na receita e nas intenções de venda sem nenhuma outra mudança.
- `_license_state()` e `license_status()` tratam `pix_paid_until` no futuro como assinatura ativa
  (`subscription: 'pix'`). Quem não pagou PIX continua exatamente igual.
- `pix_apply_payment(asaas_payment_id, valor_pago)` — chamada só pelas funções do servidor quando
  o Asaas confirma o pagamento. Trava a linha, confere o valor e libera o tempo uma única vez:
  aviso repetido devolve 'already_paid' e não soma tempo de novo; valor diferente do cobrado
  vira 'amount_mismatch' e não libera nada.

2. Segurança
- RLS ligado em `pix_payments`, sem políticas: o cliente nunca lê nem escreve direto. A tela
  consulta o status pela função `pix-checkout`, que só devolve PIX da própria conta.
- `pix_apply_payment` só pode ser executada pelo service role (funções do servidor).
*/

-- ─── Licença ─────────────────────────────────────────────────────────────────

ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS pix_paid_until timestamptz;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS asaas_customer_id text UNIQUE;

-- ─── PIX gerados ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pix_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  amount_cents int NOT NULL CHECK (amount_cents > 0),
  coupon_code text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'canceled', 'amount_mismatch')),
  asaas_payment_id text UNIQUE,
  pix_payload text,
  pix_qr_image text,
  expires_at timestamptz NOT NULL,
  checked_at timestamptz,
  paid_at timestamptz,
  paid_amount_cents int,
  access_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pix_payments_user_idx ON pix_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pix_payments_pending_idx ON pix_payments (user_id) WHERE status = 'pending';
ALTER TABLE pix_payments ENABLE ROW LEVEL SECURITY;

-- ─── Vendas e intenções também do Asaas ──────────────────────────────────────

ALTER TABLE completed_sales ALTER COLUMN stripe_checkout_session_id DROP NOT NULL;
ALTER TABLE completed_sales ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe'
  CHECK (provider IN ('stripe', 'asaas'));
ALTER TABLE completed_sales ADD COLUMN IF NOT EXISTS asaas_payment_id text UNIQUE;

ALTER TABLE checkout_intents ALTER COLUMN stripe_checkout_session_id DROP NOT NULL;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe'
  CHECK (provider IN ('stripe', 'asaas'));
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS pix_payment_id uuid UNIQUE;

-- ─── Estado da licença (mesma regra do license_status) ───────────────────────

CREATE OR REPLACE FUNCTION _license_state(l director_licenses) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN l.blocked THEN 'blocked'
    WHEN l.subscription = 'active' THEN 'active'
    WHEN l.pix_paid_until IS NOT NULL AND l.pix_paid_until > now() THEN 'active'
    WHEN l.comp_until IS NOT NULL AND l.comp_until > now() THEN 'promo'
    WHEN now() < l.trial_started_at + make_interval(hours => l.trial_hours) THEN 'trial'
    ELSE 'expired'
  END
$$;

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

  -- PIX pago: libera até o fim do período comprado (sem renovação automática)
  IF v_row.pix_paid_until IS NOT NULL AND v_row.pix_paid_until > now() THEN
    RETURN json_build_object(
      'status', 'active', 'subscription', 'pix',
      'plan', v_row.plan, 'current_period_end', v_row.pix_paid_until
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

-- ─── Confirmação do pagamento (só o servidor chama) ──────────────────────────

CREATE OR REPLACE FUNCTION pix_apply_payment(p_asaas_payment_id text, p_paid_cents int) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v pix_payments;
  v_lic director_licenses;
  v_was_active boolean;
  v_until timestamptz;
BEGIN
  -- FOR UPDATE: dois avisos ao mesmo tempo (webhook + consulta da tela) esperam um pelo outro
  SELECT * INTO v FROM pix_payments WHERE asaas_payment_id = p_asaas_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('result', 'unknown_payment'); END IF;

  IF v.status = 'paid' THEN
    RETURN json_build_object('result', 'already_paid', 'user_id', v.user_id, 'access_until', v.access_until);
  END IF;
  IF v.status = 'amount_mismatch' THEN
    RETURN json_build_object('result', 'amount_mismatch', 'user_id', v.user_id,
                             'expected_cents', v.amount_cents, 'paid_cents', v.paid_amount_cents);
  END IF;

  IF p_paid_cents IS DISTINCT FROM v.amount_cents THEN
    UPDATE pix_payments
       SET status = 'amount_mismatch', paid_amount_cents = p_paid_cents, paid_at = now(), updated_at = now()
     WHERE id = v.id;
    RETURN json_build_object('result', 'amount_mismatch', 'user_id', v.user_id,
                             'expected_cents', v.amount_cents, 'paid_cents', p_paid_cents);
  END IF;

  -- Mesmo um PIX já vencido ou trocado por outro: se o dinheiro entrou, o tempo é liberado.
  PERFORM _ensure_license(v.user_id);
  SELECT * INTO v_lic FROM director_licenses WHERE user_id = v.user_id FOR UPDATE;
  v_was_active := v_lic.pix_paid_until IS NOT NULL AND v_lic.pix_paid_until > now();
  v_until := greatest(now(), coalesce(v_lic.pix_paid_until, now()))
             + CASE v.plan WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END;

  UPDATE director_licenses
     SET pix_paid_until = v_until,
         plan = CASE WHEN subscription = 'active' THEN plan ELSE v.plan END
   WHERE user_id = v.user_id;

  UPDATE pix_payments
     SET status = 'paid', paid_at = now(), paid_amount_cents = p_paid_cents,
         access_until = v_until, updated_at = now()
   WHERE id = v.id;

  -- histórico do painel: conta como nova assinatura só quando a conta não estava com PIX ativo
  IF NOT v_was_active THEN
    INSERT INTO subscription_events (user_id, kind, plan) VALUES (v.user_id, 'subscribed', v.plan);
  END IF;

  INSERT INTO completed_sales (user_id, provider, asaas_payment_id, plan, amount_cents, currency)
  VALUES (v.user_id, 'asaas', p_asaas_payment_id, v.plan, p_paid_cents, 'brl')
  ON CONFLICT (asaas_payment_id) DO NOTHING;

  RETURN json_build_object('result', 'activated', 'user_id', v.user_id, 'access_until', v_until);
END $$;

REVOKE EXECUTE ON FUNCTION pix_apply_payment(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pix_apply_payment(text, int) TO service_role;
REVOKE EXECUTE ON FUNCTION license_status() FROM anon;
GRANT EXECUTE ON FUNCTION license_status() TO authenticated;
