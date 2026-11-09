/*
# PIX pela InfinitePay no lugar do Asaas

1. Problema
- A cobrança por PIX usava o Asaas. Passamos a usar o Checkout Integrado da
  InfinitePay, cuja API é diferente: ela NÃO devolve QR Code nem copia-e-cola,
  e sim um LINK de pagamento (`POST /links`). O cliente paga na página deles e
  volta pela `redirect_url`.
- A coluna `asaas_payment_id` é o identificador do pagamento usado para
  liberar o plano. Na InfinitePay os identificadores são outros: `order_nsu`
  (nosso) e `transaction_nsu`/`invoice_slug` (deles).

2. Mudanças
- `pix_payments` ganha `provider` ('asaas' | 'infinitepay'), `checkout_url`,
  `order_nsu`, `transaction_nsu` e `invoice_slug`.
- `pix_apply_payment` passa a liberar por `order_nsu` (o pedido), que existe
  nos dois provedores. A assinatura antiga por `asaas_payment_id` é mantida
  para não quebrar pagamentos que já estavam abertos.
- `completed_sales` e `checkout_intents` aceitam `infinitepay` como provedor.

3. Segurança
- SECURITY DEFINER, só o service role executa. As funções continuam sem
  acesso público.
- O webhook da InfinitePay NÃO tem assinatura: a confirmação de pagamento é
  sempre validada por `POST /payment_check` no servidor antes de liberar
  qualquer acesso (ver a função de borda `infinitepay-webhook`).
*/

-- ─── Colunas novas ───────────────────────────────────────────────────────────

ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'asaas';
ALTER TABLE pix_payments DROP CONSTRAINT IF EXISTS pix_payments_provider_check;
ALTER TABLE pix_payments ADD CONSTRAINT pix_payments_provider_check
  CHECK (provider IN ('asaas', 'infinitepay'));

ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS order_nsu text;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS transaction_nsu text;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS invoice_slug text;

-- Um pedido não pode virar duas linhas: é por ele que o pagamento é aplicado.
CREATE UNIQUE INDEX IF NOT EXISTS pix_payments_order_nsu_idx
  ON pix_payments (provider, order_nsu) WHERE order_nsu IS NOT NULL;

CREATE INDEX IF NOT EXISTS pix_payments_transaction_idx
  ON pix_payments (transaction_nsu) WHERE transaction_nsu IS NOT NULL;

-- ─── Provedores aceitos nos registros de venda ───────────────────────────────

ALTER TABLE completed_sales DROP CONSTRAINT IF EXISTS completed_sales_provider_check;
ALTER TABLE completed_sales ADD CONSTRAINT completed_sales_provider_check
  CHECK (provider IN ('stripe', 'asaas', 'infinitepay'));

ALTER TABLE checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_provider_check;
ALTER TABLE checkout_intents ADD CONSTRAINT checkout_intents_provider_check
  CHECK (provider IN ('stripe', 'asaas', 'infinitepay'));

-- ─── Liberação do plano por pedido (order_nsu) ───────────────────────────────

CREATE OR REPLACE FUNCTION pix_apply_payment_by_order(p_order_nsu text, p_paid_cents int) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v pix_payments;
  v_lic director_licenses;
  v_was_active boolean;
  v_until timestamptz;
BEGIN
  IF coalesce(p_order_nsu, '') = '' THEN RETURN json_build_object('result', 'unknown_payment'); END IF;

  -- FOR UPDATE: dois avisos ao mesmo tempo (webhook + consulta da tela) esperam um pelo outro
  SELECT * INTO v FROM pix_payments WHERE order_nsu = p_order_nsu FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('result', 'unknown_payment'); END IF;

  IF v.status = 'paid' THEN
    RETURN json_build_object('result', 'already_paid', 'user_id', v.user_id, 'access_until', v.access_until);
  END IF;
  IF v.status = 'amount_mismatch' THEN
    RETURN json_build_object('result', 'amount_mismatch', 'user_id', v.user_id,
                             'expected_cents', v.amount_cents, 'paid_cents', v.paid_amount_cents);
  END IF;

  -- Valor diferente do combinado não libera sozinho: fica marcado para conferência.
  -- Na InfinitePay o pago pode ser MAIOR que o combinado quando o cliente parcela
  -- com as taxas repassadas; a comparação é só para baixo.
  IF p_paid_cents IS NOT NULL AND p_paid_cents < v.amount_cents THEN
    UPDATE pix_payments
       SET status = 'amount_mismatch', paid_amount_cents = p_paid_cents, paid_at = now(), updated_at = now()
     WHERE id = v.id;
    RETURN json_build_object('result', 'amount_mismatch', 'user_id', v.user_id,
                             'expected_cents', v.amount_cents, 'paid_cents', p_paid_cents);
  END IF;

  -- Mesmo um pagamento já vencido ou trocado por outro: se o dinheiro entrou, o tempo é liberado.
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
     SET status = 'paid', paid_at = now(),
         paid_amount_cents = coalesce(p_paid_cents, v.amount_cents),
         access_until = v_until, updated_at = now()
   WHERE id = v.id;

  IF NOT v_was_active THEN
    INSERT INTO subscription_events (user_id, kind, plan) VALUES (v.user_id, 'subscribed', v.plan);
  END IF;

  INSERT INTO completed_sales (user_id, provider, plan, amount_cents, currency)
  VALUES (v.user_id, coalesce(v.provider, 'asaas'), v.plan, coalesce(p_paid_cents, v.amount_cents), 'brl');

  RETURN json_build_object('result', 'activated', 'user_id', v.user_id, 'access_until', v_until);
END $$;

REVOKE EXECUTE ON FUNCTION pix_apply_payment_by_order(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pix_apply_payment_by_order(text, int) TO service_role;

-- ─── Grava o transação da InfinitePay na linha do pedido ─────────────────────

CREATE OR REPLACE FUNCTION pix_set_infinitepay_ids(
  p_order_nsu text, p_transaction_nsu text, p_invoice_slug text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE pix_payments
     SET transaction_nsu = coalesce(p_transaction_nsu, transaction_nsu),
         invoice_slug = coalesce(p_invoice_slug, invoice_slug),
         updated_at = now()
   WHERE order_nsu = p_order_nsu;
END $$;

REVOKE EXECUTE ON FUNCTION pix_set_infinitepay_ids(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pix_set_infinitepay_ids(text, text, text) TO service_role;
