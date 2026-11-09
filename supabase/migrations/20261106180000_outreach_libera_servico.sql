/*
# O envio de campanha passa a funcionar

1. Problema
- `admin_outreach_start`, `admin_outreach_claim` e `admin_outreach_mark` chamam
  `_require_admin()`, que exige uma sessão de usuário (`auth.uid()`).
- Quem chama essas três é a Edge Function `outreach-send`, com a chave de serviço. Nela não
  existe `auth.uid()`, então `is_admin()` devolve falso e a função levanta `not_allowed`.
- Resultado: a campanha era criada, o envio parava no primeiro passo, e a tela mostrava
  "Você não tem permissão para fazer isso" para um administrador logado. Confirmado em
  06/11/2026: `admin_outreach_start` chamada como service_role responde `not_allowed`.

2. Correção
- Só a linha da checagem muda, nas três funções: deixa de exigir admin e passa a exigir
  `service_role`. Todo o resto do corpo fica idêntico ao que já estava em produção, para
  não alterar claim, lease nem contagem de tentativas.
- A autorização do administrador continua acontecendo antes, no `callerIsAdmin()` da Edge
  Function, que confere o JWT de quem chamou.
- As funções que o navegador chama direto (`create`, `pause`, `cancel`, `list`...) não são
  tocadas: seguem exigindo admin.

3. Segurança
- Ao tirar o `_require_admin`, a função não pode ficar chamável por qualquer sessão. Por isso
  o EXECUTE é revogado de PUBLIC, anon e authenticated e dado só a service_role. Um usuário
  logado que chame `start` na mão recebe "permission denied", não o controle da campanha.
*/

CREATE OR REPLACE FUNCTION admin_outreach_start(p_campaign uuid, p_seconds int DEFAULT 150)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_token uuid;
BEGIN
  -- Roda na Edge Function com a chave de serviço: não há auth.uid() aqui.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE outreach_campaigns
     SET run_token = gen_random_uuid(),
         run_lease_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 150), 30), 900)),
         status = 'running',
         started_at = coalesce(started_at, now())
   WHERE id = p_campaign
     AND status IN ('draft', 'running', 'paused')
     AND total > 0
     AND (run_lease_until IS NULL OR run_lease_until < now())
  RETURNING run_token INTO v_token;
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_claim(
  p_campaign uuid, p_run_token uuid, p_limit int DEFAULT 25
) RETURNS SETOF outreach_recipients
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_max int := least(greatest(coalesce(p_limit, 25), 1), 100);
BEGIN
  -- Roda na Edge Function com a chave de serviço: não há auth.uid() aqui.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_allowed'; END IF;

  UPDATE outreach_campaigns
     SET run_lease_until = now() + interval '150 seconds'
   WHERE id = p_campaign AND run_token = p_run_token AND status = 'running';
  IF NOT FOUND THEN RAISE EXCEPTION 'run_superseded'; END IF;

  UPDATE outreach_recipients
     SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
         error = coalesce(error, 'lease_expired'),
         lease_until = NULL
   WHERE campaign_id = p_campaign
     AND status = 'sending'
     AND lease_until IS NOT NULL
     AND lease_until < now();

  RETURN QUERY
  WITH picked AS (
    SELECT id FROM outreach_recipients
     WHERE campaign_id = p_campaign AND status = 'pending'
     ORDER BY id
     LIMIT v_max
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE outreach_recipients r
       SET status = 'sending',
           lease_until = now() + interval '10 minutes',
           attempts = r.attempts + 1
      FROM picked
     WHERE r.id = picked.id
    RETURNING r.*
  )
  SELECT * FROM claimed;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_mark(
  p_campaign uuid, p_run_token uuid, p_results jsonb
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_left int;
  v_sent int;
  v_failed int;
  v_status text;
  v_owner uuid;
BEGIN
  -- Roda na Edge Function com a chave de serviço: não há auth.uid() aqui.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'not_allowed'; END IF;

  SELECT status, run_token INTO v_status, v_owner FROM outreach_campaigns WHERE id = p_campaign;
  IF v_status IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_status = 'canceled' THEN
    RETURN json_build_object('ok', false, 'error', 'canceled');
  END IF;
  -- Quem perdeu o lease não grava resultado: senão a execução que assumiu o envio teria os
  -- números sobrescritos por uma aba que já foi declarada morta.
  IF v_status = 'running' AND v_owner IS DISTINCT FROM p_run_token THEN
    RETURN json_build_object('ok', false, 'error', 'run_superseded');
  END IF;

  UPDATE outreach_recipients r
     SET status = x.status,
         provider_id = x.provider_id,
         error = case when x.status = 'sent' then NULL else x.error end,
         lease_until = NULL,
         sent_at = case when x.status = 'sent' then now() else r.sent_at end
    FROM (
      SELECT (e->>'id')::bigint AS id,
             e->>'status' AS status,
             nullif(e->>'provider_id', '') AS provider_id,
             nullif(e->>'error', '') AS error
        FROM jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
       WHERE e->>'status' IN ('sent', 'failed', 'skipped', 'pending')
    ) x
   WHERE r.id = x.id
     AND r.campaign_id = p_campaign
     AND r.status IN ('sending', 'pending');

  -- Falhou: só conta como definitivo quando estourou as tentativas.
  UPDATE outreach_recipients
     SET status = 'failed', lease_until = NULL,
         error = coalesce(error, 'max_attempts')
   WHERE campaign_id = p_campaign AND status = 'pending' AND attempts >= 3;

  SELECT count(*) INTO v_left
    FROM outreach_recipients WHERE campaign_id = p_campaign AND status IN ('pending', 'sending');

  IF v_left = 0 THEN
    UPDATE outreach_campaigns
       SET status = 'done', run_token = NULL, run_lease_until = NULL,
           finished_at = coalesce(finished_at, now())
     WHERE id = p_campaign AND status <> 'canceled';
  END IF;

  SELECT count(*) FILTER (WHERE status = 'sent'), count(*) FILTER (WHERE status = 'failed')
    INTO v_sent, v_failed
    FROM outreach_recipients WHERE campaign_id = p_campaign;


  RETURN json_build_object('ok', true, 'left', v_left, 'sent', v_sent, 'failed', v_failed,
                           'done', v_left = 0);
END $$;

-- Só a chave de serviço executa estas três. Um usuário logado que tente na mão é barrado
-- pelo próprio Postgres antes de a função rodar.
REVOKE EXECUTE ON FUNCTION admin_outreach_start(uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_outreach_claim(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_outreach_mark(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_outreach_start(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION admin_outreach_claim(uuid, uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION admin_outreach_mark(uuid, uuid, jsonb) TO service_role;
