/*
# Cupom de desconto na InfinitePay (PIX e cartão), sem Stripe

1. Problema
- O pix-checkout já aplica o cupom no valor do link, mas `promo_codes.uses` nunca subia
  num pagamento com cupom: o limite de usos nunca travava e "Quem usou" ficava vazio.
- O admin criava o cupom primeiro no Stripe. Sem o Stripe, criar cupom falhava.
- O admin aceitava 100%, mas a cobrança recusa abaixo de R$ 5,00.

2. Mudanças
- `discount_redemptions`: uma linha por pagamento confirmado com cupom (código, conta,
  percentual, preço cheio e valor pago).
- Gatilho em `pix_payments`: quando o pagamento vira 'paid' e tem cupom, grava o uso e soma
  1 em `promo_codes.uses`. Uma vez só por pagamento (chave primária). Protegido por
  EXCEPTION: nunca impede a liberação do plano.
- O limite de usos continua conferido quando o link é criado. Com vários links abertos ao
  mesmo tempo pode passar um pouco do limite (cada um conta ao ser pago). É esperado.
- `admin_discount_create(...)`: cria o cupom só no nosso banco, de 1% a 90%.
- `admin_promo_create(...)`: mesma assinatura (a tela antiga ainda manda os campos do
  Stripe), mas desconto vai de 1% a 90% e os ids do Stripe não são mais gravados.
- `admin_promo_list()`: nos cupons de desconto, "Quem usou" vem dos pagamentos confirmados.
  Deixa de devolver as colunas antigas do Stripe.
- `_discount_check(...)`: deixa de devolver o id do Stripe.

3. Segurança
- RLS ligado em `discount_redemptions`, sem política: só as funções leem.
- Funções do admin conferem `_require_admin()` e registram em `admin_audit`.
*/

-- ─── Usos do cupom ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discount_redemptions (
  pix_payment_id uuid PRIMARY KEY,
  code text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  percent int,
  full_cents int,
  paid_cents int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discount_redemptions_code_idx ON discount_redemptions (code, created_at DESC);
ALTER TABLE discount_redemptions ENABLE ROW LEVEL SECURITY;
-- sem política: só as funções do servidor e do admin leem

CREATE OR REPLACE FUNCTION _discount_on_payment_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  BEGIN
    INSERT INTO discount_redemptions (pix_payment_id, code, user_id, percent, full_cents, paid_cents, created_at)
    VALUES (
      NEW.id, upper(trim(NEW.coupon_code)), NEW.user_id, NEW.discount_percent,
      coalesce(NEW.full_cents, CASE NEW.plan WHEN 'yearly' THEN 34900 ELSE 5500 END),
      coalesce(NEW.paid_amount_cents, NEW.amount_cents),
      coalesce(NEW.paid_at, now())
    )
    ON CONFLICT (pix_payment_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      UPDATE promo_codes SET uses = uses + 1 WHERE code = upper(trim(NEW.coupon_code));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- contar o uso do cupom nunca pode impedir a liberação do plano
    RAISE WARNING 'discount redemption failed for payment %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pix_payments_discount_redemption ON pix_payments;
CREATE TRIGGER pix_payments_discount_redemption
  AFTER UPDATE OF status ON pix_payments
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.coupon_code IS NOT NULL)
  EXECUTE FUNCTION _discount_on_payment_paid();

-- Pagamentos com cupom que já foram confirmados antes desta migração.
WITH ins AS (
  INSERT INTO discount_redemptions (pix_payment_id, code, user_id, percent, full_cents, paid_cents, created_at)
  SELECT p.id, upper(trim(p.coupon_code)), p.user_id, p.discount_percent,
         coalesce(p.full_cents, CASE p.plan WHEN 'yearly' THEN 34900 ELSE 5500 END),
         coalesce(p.paid_amount_cents, p.amount_cents), coalesce(p.paid_at, p.updated_at)
    FROM pix_payments p
   WHERE p.status = 'paid' AND p.coupon_code IS NOT NULL
  ON CONFLICT (pix_payment_id) DO NOTHING
  RETURNING code
)
UPDATE promo_codes pc
   SET uses = pc.uses + c.n
  FROM (SELECT code, count(*)::int AS n FROM ins GROUP BY code) c
 WHERE pc.code = c.code;

-- ─── Conferência do cupom (sem Stripe) ───────────────────────────────────────

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
    'first_payment_only', v.first_payment_only,
    'affiliate', v.affiliate_id IS NOT NULL
  );
END $$;

-- ─── Admin ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_discount_create(
  p_code text,
  p_percent int,
  p_max_uses int DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_first_payment_only boolean DEFAULT false,
  p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_code text := upper(trim(coalesce(p_code, '')));
BEGIN
  PERFORM _require_admin();
  IF v_code !~ '^[A-Z0-9_-]{3,32}$' THEN RAISE EXCEPTION 'promo_bad_code'; END IF;
  -- até 90%: acima disso o valor cairia abaixo do mínimo de cobrança (R$ 5,00)
  IF p_percent IS NULL OR p_percent < 1 OR p_percent > 90 THEN RAISE EXCEPTION 'invalid_discount'; END IF;
  IF p_max_uses IS NOT NULL AND p_max_uses < 1 THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF EXISTS (SELECT 1 FROM promo_codes WHERE code = v_code) OR EXISTS (SELECT 1 FROM affiliates WHERE code = v_code) THEN
    RAISE EXCEPTION 'promo_exists';
  END IF;

  INSERT INTO promo_codes (code, kind, value, discount_percent, max_uses, expires_at, first_payment_only, note, created_by)
  VALUES (v_code, 'discount', p_percent, p_percent, p_max_uses, p_expires_at, coalesce(p_first_payment_only, false),
          nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid());

  PERFORM _audit('discount_create', NULL, json_build_object(
    'code', v_code, 'percent', p_percent, 'max_uses', p_max_uses, 'expires_at', p_expires_at,
    'first_payment_only', coalesce(p_first_payment_only, false)
  )::jsonb);
END $$;

-- Mesma assinatura de antes (a tela antiga ainda manda p_stripe_*), mas sem gravar nada do Stripe.
CREATE OR REPLACE FUNCTION public.admin_promo_create(
  p_code text, p_kind text, p_value int, p_max_uses int DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL, p_note text DEFAULT NULL,
  p_discount_percent int DEFAULT NULL, p_stripe_coupon_id text DEFAULT NULL,
  p_stripe_promotion_code_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_code text := upper(trim(coalesce(p_code, '')));
BEGIN
  PERFORM _require_admin();
  IF v_code !~ '^[A-Z0-9_-]{3,32}$' THEN RAISE EXCEPTION 'promo_bad_code'; END IF;
  IF p_kind = 'discount' THEN
    IF p_discount_percent IS NULL OR p_discount_percent < 1 OR p_discount_percent > 90 THEN RAISE EXCEPTION 'invalid_discount'; END IF;
    p_value := p_discount_percent;
  ELSIF p_kind NOT IN ('trial_hours', 'free_days') OR p_value IS NULL OR p_value <= 0 THEN
    RAISE EXCEPTION 'invalid_value';
  END IF;
  IF EXISTS (SELECT 1 FROM promo_codes WHERE code = v_code) OR EXISTS (SELECT 1 FROM affiliates WHERE code = v_code) THEN
    RAISE EXCEPTION 'promo_exists';
  END IF;
  INSERT INTO promo_codes (code, kind, value, max_uses, expires_at, note, created_by, discount_percent)
  VALUES (v_code, p_kind, p_value, p_max_uses, p_expires_at, nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid(),
          CASE WHEN p_kind = 'discount' THEN p_discount_percent END);
  PERFORM _audit('promo_create', NULL, json_build_object('code', v_code, 'kind', p_kind, 'value', p_value)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_promo_list() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(x ORDER BY x.created_at DESC), '[]'::json) INTO r FROM (
    SELECT p.code, p.kind, p.value, p.discount_percent, p.affiliate_id, p.first_payment_only,
           p.max_uses, p.uses, p.expires_at, p.active, p.note, p.created_by, p.created_at,
      CASE WHEN p.kind = 'discount' THEN
        -- cupom de desconto: os pagamentos confirmados com ele
        (SELECT coalesce(json_agg(json_build_object(
                   'email', u.email, 'redeemed_at', d.created_at, 'amount_cents', d.paid_cents
                 ) ORDER BY d.created_at DESC), '[]'::json)
           FROM discount_redemptions d LEFT JOIN auth.users u ON u.id = d.user_id
          WHERE d.code = p.code)
      ELSE
        -- bônus: quem resgatou na tela de entrada do programa
        (SELECT coalesce(json_agg(json_build_object('email', u.email, 'redeemed_at', pr.redeemed_at)
                 ORDER BY pr.redeemed_at DESC), '[]'::json)
           FROM promo_redemptions pr JOIN auth.users u ON u.id = pr.user_id WHERE pr.code = p.code)
      END AS redemptions
    FROM promo_codes p
  ) x;
  RETURN r;
END $$;

-- ─── Permissões ──────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION _discount_on_payment_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _discount_check(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_discount_create(text, int, int, timestamptz, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_discount_create(text, int, int, timestamptz, boolean, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_promo_create(text, text, int, int, timestamptz, text, int, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_promo_create(text, text, int, int, timestamptz, text, int, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_promo_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_promo_list() TO authenticated;
