/*
# InfinitePay: confirmação blindada e forma de pagamento (PIX ou cartão)

1. Problema
- O pagamento era liberado só pelo order_nsu. O transaction_nsu não era único: se o
  /payment_check da InfinitePay aceitasse o código de uma transação já paga num pedido
  novo, alguém ganharia mais um período sem pagar de novo.
- Não ficava registrado se o cliente pagou no PIX ou no cartão (nem as parcelas e o
  comprovante). O e-mail de aviso e o admin não conseguiam falar a forma certa.
- Não havia como registrar um estorno.

2. Mudanças
- `pix_payments` ganha `capture_method` ('pix' | 'credit_card'), `installments`,
  `receipt_url`, `discount_percent`, `full_cents` (preço cheio do plano), `refunded_at` e
  `refund_reason`. O status passa a aceitar 'refunded'.
- `director_licenses.pix_paid_source` ('infinitepay' | 'manual'): quem deu o último tempo
  em `pix_paid_until` (pagamento ou o admin).
- `completed_sales` ganha `pix_payment_id` e `method`, para o admin mostrar a forma de
  cada venda.
- `pix_confirm_payment(...)`: chamada pelas funções do servidor DEPOIS de a InfinitePay
  confirmar no /payment_check. Recusa com 'transaction_reused' um código de transação ou
  de fatura que já pagou outro pedido, grava os códigos e a forma de pagamento conferidos
  e só então chama `pix_apply_payment_by_order`.
- `pix_apply_payment_by_order(...)`: mesma assinatura (a versão publicada das funções
  continua funcionando até a nova sair), mas um pedido estornado ('refunded') passa a
  ser tratado como já processado e nunca libera o tempo de novo.
- Conta com a assinatura antiga do Stripe já vencida que paga pela InfinitePay: a
  `pix_confirm_payment` muda `subscription` de 'active' para 'canceled', para os avisos
  de vencimento e o programa seguirem as datas da InfinitePay.
- Índice único parcial: duas linhas pagas nunca dividem o mesmo transaction_nsu (só é
  criado se o banco não tiver repetição; senão sai um NOTICE).

3. Segurança
- SECURITY DEFINER, só o service role executa.
- Os códigos que chegam no aviso só são gravados depois da confirmação.
- O comprovante só é aceito se for um endereço https da própria InfinitePay.
*/

-- ─── Colunas novas ───────────────────────────────────────────────────────────

ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS capture_method text;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS installments int;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS receipt_url text;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS discount_percent int;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS full_cents int;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS refund_reason text;

ALTER TABLE pix_payments DROP CONSTRAINT IF EXISTS pix_payments_capture_method_check;
ALTER TABLE pix_payments ADD CONSTRAINT pix_payments_capture_method_check
  CHECK (capture_method IS NULL OR capture_method IN ('pix', 'credit_card'));

ALTER TABLE pix_payments DROP CONSTRAINT IF EXISTS pix_payments_status_check;
ALTER TABLE pix_payments ADD CONSTRAINT pix_payments_status_check
  CHECK (status IN ('pending', 'paid', 'expired', 'canceled', 'amount_mismatch', 'refunded'));

ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS pix_paid_source text;
ALTER TABLE director_licenses DROP CONSTRAINT IF EXISTS director_licenses_pix_paid_source_check;
ALTER TABLE director_licenses ADD CONSTRAINT director_licenses_pix_paid_source_check
  CHECK (pix_paid_source IS NULL OR pix_paid_source IN ('infinitepay', 'manual'));

ALTER TABLE completed_sales ADD COLUMN IF NOT EXISTS pix_payment_id uuid;
ALTER TABLE completed_sales ADD COLUMN IF NOT EXISTS method text;
CREATE INDEX IF NOT EXISTS completed_sales_pix_payment_idx
  ON completed_sales (pix_payment_id) WHERE pix_payment_id IS NOT NULL;

-- Duas linhas pagas nunca dividem o mesmo código de transação (defesa final contra
-- corrida entre o aviso e a consulta da tela).
-- Se o banco já tiver duas linhas pagas com o mesmo código, o índice não é criado (a
-- migração não pode falhar por causa disso): sai um NOTICE com a quantidade e as linhas
-- precisam ser conferidas à mão no admin. A pix_confirm_payment abaixo recusa o
-- código repetido mesmo sem o índice.
DO $$
DECLARE v_dup int;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT transaction_nsu FROM pix_payments
     WHERE status = 'paid' AND transaction_nsu IS NOT NULL
     GROUP BY transaction_nsu HAVING count(*) > 1
  ) d;
  IF v_dup > 0 THEN
    RAISE NOTICE 'pix_payments_paid_transaction_uidx nao criado: % codigo(s) de transacao pagos em mais de um pedido. Confira essas linhas e rode a migracao de novo.', v_dup;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS pix_payments_paid_transaction_uidx
      ON pix_payments (transaction_nsu) WHERE status = 'paid' AND transaction_nsu IS NOT NULL;
  END IF;
END $$;

-- ─── Dados que já existem ────────────────────────────────────────────────────

-- Quem já tem tempo pago e algum pagamento confirmado: o tempo veio da InfinitePay.
UPDATE director_licenses l
   SET pix_paid_source = 'infinitepay'
 WHERE l.pix_paid_until IS NOT NULL
   AND l.pix_paid_source IS NULL
   AND EXISTS (SELECT 1 FROM pix_payments p WHERE p.user_id = l.user_id AND p.status = 'paid');

-- Liga as vendas antigas da InfinitePay ao pagamento (mesma conta, gravadas juntas).
UPDATE completed_sales s
   SET pix_payment_id = p.id
  FROM pix_payments p
 WHERE s.pix_payment_id IS NULL
   AND s.provider = 'infinitepay'
   AND p.provider = 'infinitepay'
   AND p.status = 'paid'
   AND p.user_id = s.user_id
   AND p.paid_at IS NOT NULL
   AND abs(extract(epoch FROM (s.created_at - p.paid_at))) < 120
   AND NOT EXISTS (SELECT 1 FROM completed_sales s2 WHERE s2.pix_payment_id = p.id);

-- ─── Liberação por pedido: estorno nunca libera de novo ──────────────────────
-- Igual à de 20261109140000_pix_infinitepay.sql, só que 'refunded' conta como já
-- processado. Um aviso atrasado de um pedido estornado (ou uma chamada direta da
-- versão antiga do infinitepay-webhook) não soma o tempo outra vez.

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

  IF v.status IN ('paid', 'refunded') THEN
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

-- ─── Confirmação (só o servidor chama, depois do /payment_check) ─────────────

CREATE OR REPLACE FUNCTION pix_confirm_payment(
  p_order_nsu text,
  p_paid_cents int,
  p_transaction_nsu text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_capture_method text DEFAULT NULL,
  p_installments int DEFAULT NULL,
  p_receipt_url text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v pix_payments;
  v_tx text := nullif(trim(coalesce(p_transaction_nsu, '')), '');
  v_slug text := nullif(trim(coalesce(p_slug, '')), '');
  v_method text := CASE lower(trim(coalesce(p_capture_method, '')))
                     WHEN 'pix' THEN 'pix' WHEN 'credit_card' THEN 'credit_card' END;
  v_inst int := CASE WHEN p_installments BETWEEN 1 AND 24 THEN p_installments END;
  v_receipt text := CASE
    WHEN length(coalesce(p_receipt_url, '')) BETWEEN 1 AND 500
     AND p_receipt_url ~* '^https://([a-z0-9-]+\.)*infinitepay\.(io|com\.br)(/|\?|$)'
    THEN p_receipt_url END;
  r json;
BEGIN
  IF coalesce(p_order_nsu, '') = '' THEN RETURN json_build_object('result', 'unknown_payment'); END IF;

  -- FOR UPDATE: o aviso e a consulta da tela ao mesmo tempo esperam um pelo outro
  SELECT * INTO v FROM pix_payments WHERE order_nsu = p_order_nsu FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('result', 'unknown_payment'); END IF;

  IF v.status IN ('paid', 'refunded') THEN
    RETURN json_build_object('result', 'already_paid', 'user_id', v.user_id, 'access_until', v.access_until);
  END IF;

  v_tx := coalesce(v_tx, v.transaction_nsu);
  v_slug := coalesce(v_slug, v.invoice_slug);

  -- Código de transação ou de fatura que já pagou OUTRO pedido: não libera.
  IF (v_tx IS NOT NULL AND EXISTS (
        SELECT 1 FROM pix_payments o
         WHERE o.id <> v.id AND o.transaction_nsu = v_tx
           AND o.status IN ('paid', 'refunded', 'amount_mismatch')))
  OR (v_slug IS NOT NULL AND EXISTS (
        SELECT 1 FROM pix_payments o
         WHERE o.id <> v.id AND o.invoice_slug = v_slug
           AND o.status IN ('paid', 'refunded', 'amount_mismatch'))) THEN
    RETURN json_build_object('result', 'transaction_reused', 'user_id', v.user_id);
  END IF;

  UPDATE pix_payments
     SET transaction_nsu = v_tx,
         invoice_slug = v_slug,
         capture_method = coalesce(v_method, capture_method),
         installments = coalesce(v_inst, installments),
         receipt_url = coalesce(v_receipt, receipt_url),
         updated_at = now()
   WHERE id = v.id;

  -- Assinatura antiga do Stripe já vencida (o pix-checkout deixa essa conta pagar): passa
  -- a 'canceled' antes de liberar, para o plano novo ser gravado e os avisos de vencimento
  -- e o programa seguirem as datas da InfinitePay. Assinatura ainda no prazo fica igual.
  UPDATE director_licenses
     SET subscription = 'canceled'
   WHERE user_id = v.user_id
     AND subscription = 'active'
     AND (p_paid_cents IS NULL OR p_paid_cents >= v.amount_cents)
     AND v.status NOT IN ('amount_mismatch', 'refunded')
     AND (current_period_end < now()
          OR (current_period_end IS NULL AND stripe_subscription_id IS NOT NULL));

  r := pix_apply_payment_by_order(p_order_nsu, p_paid_cents);

  IF r->>'result' = 'activated' THEN
    UPDATE director_licenses SET pix_paid_source = 'infinitepay' WHERE user_id = v.user_id;
    -- a venda que pix_apply_payment_by_order acabou de gravar, nesta mesma transação
    UPDATE completed_sales
       SET pix_payment_id = v.id, method = coalesce(v_method, method)
     WHERE id = (
       SELECT max(id) FROM completed_sales
        WHERE user_id = v.user_id
          AND provider = coalesce(v.provider, 'asaas')
          AND pix_payment_id IS NULL
          AND created_at >= now() - interval '1 minute'
     );
  END IF;

  RETURN r;
END $$;

REVOKE EXECUTE ON FUNCTION pix_confirm_payment(text, int, text, text, text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pix_confirm_payment(text, int, text, text, text, int, text) TO service_role;
