/*
# Área de Comunicação no admin: e-mail em massa e WhatsApp (Twilio)

1. O que isto faz
- `outreach_templates` — mensagens prontas, por canal. As de WhatsApp guardam o ContentSid
  aprovado na Twilio. A migração já semeia os textos pedidos.
- `outreach_campaigns` — um envio (em massa ou para uma pessoa só). Guarda cópia do texto no
  momento do disparo, para editar o modelo depois não mudar o que já saiu.
- `outreach_recipients` — uma linha por destinatário, com estado, tentativa e o id que o
  provedor devolveu. É a fila que garante que ninguém recebe duas vezes.
- `outreach_optouts` — quem pediu para não receber mais, por canal. É filtrado antes de
  qualquer contagem.
- `outreach_channel_state` — último envio por canal e estado do remetente de WhatsApp, para o
  intervalo de 3 segundos valer entre invocações seguidas da função, não só dentro de uma.

2. Como o envio não duplica
- `admin_outreach_start` toma um lease de execução (`run_token`). Duas abas do admin não rodam
  a mesma campanha ao mesmo tempo.
- `admin_outreach_claim` pega lotes com `FOR UPDATE SKIP LOCKED` e grava um lease por linha
  antes de devolver. Linha presa em `sending` (função morreu no meio) volta a ficar elegível
  quando o lease vence; na terceira tentativa vira falha, para não girar para sempre.

3. Segurança
- RLS ligada e SEM policy em todas as tabelas: só o service role e as funções SECURITY
  DEFINER tocam nelas.
- As RPCs de admin passam por `_require_admin()` e registram em `admin_audit` via `_audit()`.
- `outreach_optout` é executável apenas pelo service_role. Não existe RPC público de
  descadastro: com uma, qualquer pessoa descadastraria o e-mail de outra.
*/

-- ─── Aparar versões antigas ──────────────────────────────────────────────────
--
-- Este banco tem objetos criados pelo painel fora das migrações. `CREATE OR REPLACE` só
-- substitui assinatura idêntica; qualquer diferença deixa duas versões e a chamada vira
-- ambígua. Por isso apagamos todas as versões destes nomes ANTES de criar (as funções abaixo
-- são novas nesta migração, então isto não apaga nada que esteja em uso).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         '_outreach_norm_phone', '_outreach_audience',
         'admin_outreach_audience', 'admin_outreach_audience_list',
         'admin_outreach_create', 'admin_outreach_start', 'admin_outreach_pause',
         'admin_outreach_cancel', 'admin_outreach_claim', 'admin_outreach_mark',
         'admin_outreach_list', 'admin_outreach_detail',
         'admin_outreach_templates', 'admin_outreach_template_save',
         'admin_outreach_template_delete', 'admin_outreach_template_twilio',
         'admin_outreach_channel_state', 'admin_outreach_save_sender',
         'outreach_optout', 'admin_outreach_optout_list', 'admin_outreach_optout_remove'
       )
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

-- ─── Normalização do telefone ────────────────────────────────────────────────

-- Mesma regra de normalizePhone (src/lib/authFlow.ts): DDD + número viram +55DDDNÚMERO e o
-- que já está em E.164 fica como está. Serve para o opt-out casar com o cadastro, e para o
-- WhatsApp receber sempre o mesmo formato que o signup-phone gravou.
CREATE OR REPLACE FUNCTION _outreach_norm_phone(p_raw text) RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE d text;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p_raw, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF left(trim(p_raw), 1) = '+' THEN
    RETURN CASE WHEN d ~ '^[1-9][0-9]{9,14}$' THEN '+' || d ELSE NULL END;
  END IF;
  IF length(d) IN (10, 11) THEN RETURN '+55' || d; END IF;
  IF length(d) IN (12, 13) AND left(d, 2) = '55' THEN RETURN '+' || d; END IF;
  RETURN NULL;
END $$;

-- ─── Tabelas ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS outreach_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  subject text,
  -- Texto-fonte com marcação leve: **negrito**, _itálico_, [texto](link) e linha em branco
  -- separando parágrafos. Nunca entra HTML arbitrário: o HTML final é montado por nós.
  body text NOT NULL DEFAULT '',
  -- Para WhatsApp: nomes das variáveis na ordem em que aparecem no modelo ({{1}}, {{2}}...).
  variables text[] NOT NULL DEFAULT '{}',
  twilio_content_sid text,
  approval_status text NOT NULL DEFAULT 'draft'
    CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected', 'paused', 'unknown')),
  approval_category text CHECK (approval_category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outreach_templates_channel_idx ON outreach_templates (channel, active);

CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  template_id uuid REFERENCES outreach_templates(id) ON DELETE SET NULL,
  title text,
  -- Cópia do conteúdo no momento do disparo. Editar o modelo depois não mexe no que saiu.
  subject text,
  body text NOT NULL DEFAULT '',
  content_sid text,
  variables text[] NOT NULL DEFAULT '{}',
  reply_to text,
  -- Filtro usado para montar a lista, para o histórico explicar de onde veio cada campanha.
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  total int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'paused', 'done', 'canceled')),
  -- Lease de execução: quem tem o run_token vigente é o único que pode enviar.
  run_token uuid,
  run_lease_until timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS outreach_campaigns_created_idx ON outreach_campaigns (created_at DESC);

-- Contadores (enviados, falhas, pulados) não ficam em coluna: são derivados dos
-- destinatários na leitura. Coluna desnormalizada passa a divergir no primeiro erro no meio
-- do lote, e aí o painel mente sobre o que foi enviado.
CREATE TABLE IF NOT EXISTS outreach_recipients (
  id bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
  user_id uuid,
  address text NOT NULL,
  name text,
  vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  provider_id text,
  error text,
  attempts int NOT NULL DEFAULT 0,
  lease_until timestamptz,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outreach_recipients_queue_idx ON outreach_recipients (campaign_id, status, id);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_recipients_once_idx ON outreach_recipients (campaign_id, address);

CREATE TABLE IF NOT EXISTS outreach_optouts (
  channel text NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  address text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, address)
);

CREATE TABLE IF NOT EXISTS outreach_channel_state (
  channel text PRIMARY KEY CHECK (channel IN ('email', 'whatsapp')),
  last_sent_at timestamptz,
  sender_sid text,
  sender_status text,
  sender_display_name text,
  sender_checked_at timestamptz
);

ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_channel_state ENABLE ROW LEVEL SECURITY;

INSERT INTO outreach_channel_state (channel) VALUES ('email'), ('whatsapp')
ON CONFLICT (channel) DO NOTHING;

-- ─── Público: quem entra na lista ────────────────────────────────────────────
--
-- Uma única definição de "quem pode receber", usada pela contagem e pelo enfileiramento.
-- Se as duas divergirem, a tela mostra 300 e a campanha enfileira 280 sem ninguém entender.
-- Regras: tem contato válido para o canal, não está descadastrado, e (para e-mail) não é
-- conta sem e-mail ou e-mail inválido.
CREATE OR REPLACE FUNCTION _outreach_audience(p_channel text, p_state text DEFAULT NULL)
RETURNS TABLE (user_id uuid, address text, name text, state text, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  WITH base AS (
    SELECT u.id,
           lower(trim(u.email)) AS email,
           nullif(trim(u.raw_user_meta_data->>'name'), '') AS name,
           _outreach_norm_phone(u.raw_user_meta_data->>'phone') AS phone,
           CASE WHEN l.user_id IS NULL THEN 'trial' ELSE _license_state(l) END AS state
      FROM auth.users u
      LEFT JOIN director_licenses l ON l.user_id = u.id
  ), picked AS (
    SELECT b.*, CASE WHEN p_channel = 'email' THEN b.email ELSE b.phone END AS addr
      FROM base b
     WHERE (p_state IS NULL OR p_state = '' OR p_state = 'all' OR b.state = p_state)
  )
  SELECT p.id, p.addr, p.name, p.state,
         CASE
           WHEN p.addr IS NULL OR p.addr = '' THEN 'sem_contato'
           WHEN p_channel = 'email' AND p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' THEN 'email_invalido'
           WHEN EXISTS (SELECT 1 FROM outreach_optouts o WHERE o.channel = p_channel AND o.address = p.addr) THEN 'descadastrado'
           ELSE NULL
         END AS reason
    FROM picked p
$$;

-- Contagem para a tela decidir antes de disparar. Vem de count(*) no banco, não de listagem
-- paginada: admin_users corta em 200 por chamada e admin-insights usa listUsers({perPage:
-- 1000}) sem loop, então os dois contariam a menos numa base maior que isso.
CREATE OR REPLACE FUNCTION admin_outreach_audience(p_channel text, p_state text DEFAULT NULL) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  IF p_channel NOT IN ('email', 'whatsapp') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  SELECT json_build_object(
    'channel', p_channel,
    'eligible', count(*) FILTER (WHERE a.reason IS NULL),
    'sem_contato', count(*) FILTER (WHERE a.reason = 'sem_contato'),
    'email_invalido', count(*) FILTER (WHERE a.reason = 'email_invalido'),
    'descadastrado', count(*) FILTER (WHERE a.reason = 'descadastrado'),
    'by_state', (
      SELECT coalesce(json_object_agg(s.state, s.n), '{}'::json) FROM (
        SELECT state, count(*) AS n FROM _outreach_audience(p_channel, p_state) a
         WHERE a.reason IS NULL GROUP BY state
      ) s
    ),
    -- Amostra para a tela mostrar quem vai receber sem carregar a base toda.
    'sample', (
      SELECT coalesce(json_agg(t ORDER BY t.name NULLS LAST), '[]'::json) FROM (
        SELECT a.user_id, a.address, a.name, a.state FROM _outreach_audience(p_channel, p_state) a
         WHERE a.reason IS NULL LIMIT 50
      ) t
    )
  ) INTO r
  FROM _outreach_audience(p_channel, p_state) a;
  RETURN r;
END $$;

-- Lista completa para montar a campanha (só o que pode receber).
CREATE OR REPLACE FUNCTION admin_outreach_audience_list(p_channel text, p_state text DEFAULT NULL, p_limit int DEFAULT 1000)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(t ORDER BY t.name NULLS LAST), '[]'::json) INTO r FROM (
    SELECT a.user_id, a.address, a.name, a.state
      FROM _outreach_audience(p_channel, p_state) a
     WHERE a.reason IS NULL
     LIMIT least(greatest(coalesce(p_limit, 1000), 1), 20000)
  ) t;
  RETURN r;
END $$;

-- ─── Campanhas ───────────────────────────────────────────────────────────────

-- Cria a campanha e enfileira os destinatários numa transação só. Se o enfileiramento
-- falhar, a campanha também não existe: nunca fica uma campanha vazia no histórico.
CREATE OR REPLACE FUNCTION admin_outreach_create(
  p_channel text,
  p_template uuid DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_content_sid text DEFAULT NULL,
  p_variables text[] DEFAULT '{}',
  p_title text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_reply_to text DEFAULT NULL,
  -- Endereços específicos, para o envio individual e para desmarcar gente da lista.
  -- NULL = a base inteira filtrada por p_state.
  p_addresses text[] DEFAULT NULL,
  p_audience jsonb DEFAULT '{}'::jsonb
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_total int;
  v_need_sid boolean := (p_channel = 'whatsapp');
BEGIN
  PERFORM _require_admin();
  IF p_channel NOT IN ('email', 'whatsapp') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF coalesce(trim(p_body), '') = '' AND NOT v_need_sid THEN RAISE EXCEPTION 'body_required'; END IF;
  IF v_need_sid AND coalesce(trim(p_content_sid), '') = '' AND coalesce(trim(p_body), '') = '' THEN
    RAISE EXCEPTION 'body_required';
  END IF;
  IF p_channel = 'email' AND coalesce(trim(p_subject), '') = '' THEN RAISE EXCEPTION 'subject_required'; END IF;

  INSERT INTO outreach_campaigns (
    channel, template_id, title, subject, body, content_sid, variables, reply_to,
    audience, status, created_by
  ) VALUES (
    p_channel, p_template, nullif(trim(p_title), ''), p_subject, coalesce(p_body, ''), p_content_sid,
    coalesce(p_variables, '{}'), nullif(trim(p_reply_to), ''),
    coalesce(p_audience, '{}'::jsonb) || jsonb_build_object('state', p_state, 'addresses', p_addresses),
    'draft', auth.uid()
  ) RETURNING id INTO v_id;

  INSERT INTO outreach_recipients (campaign_id, user_id, address, name, vars)
  SELECT v_id, a.user_id, a.address, a.name, '{}'::jsonb
    FROM _outreach_audience(p_channel, p_state) a
   WHERE a.reason IS NULL
     AND (p_addresses IS NULL OR a.address = ANY (p_addresses))
  ON CONFLICT (campaign_id, address) DO NOTHING;

  SELECT count(*) INTO v_total FROM outreach_recipients WHERE campaign_id = v_id;
  UPDATE outreach_campaigns SET total = v_total WHERE id = v_id;

  PERFORM _audit('outreach_create', NULL,
    json_build_object('campaign', v_id, 'channel', p_channel, 'total', v_total)::jsonb);

  RETURN json_build_object(
    'id', v_id,
    'total', v_total,
    -- Envio individual: diz por que a pessoa não entrou, em vez de criar uma campanha com
    -- zero destinatários e deixar o admin sem saber se foi descadastro ou falta de telefone.
    'skipped', (
      SELECT coalesce(json_agg(json_build_object('address', a.address, 'reason', a.reason)), '[]'::json)
        FROM _outreach_audience(p_channel, p_state) a
       WHERE a.reason IS NOT NULL AND p_addresses IS NOT NULL AND a.address = ANY (p_addresses)
    )
  );
END $$;

-- Toma o lease de execução. Devolve NULL quando outra execução está viva: a tela então diz
-- "esta campanha está sendo enviada em outra aba" em vez de mandar tudo duas vezes.
CREATE OR REPLACE FUNCTION admin_outreach_start(p_campaign uuid, p_seconds int DEFAULT 150)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_token uuid;
BEGIN
  PERFORM _require_admin();
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

CREATE OR REPLACE FUNCTION admin_outreach_pause(p_campaign uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  UPDATE outreach_campaigns SET status = 'paused', run_token = NULL, run_lease_until = NULL
   WHERE id = p_campaign AND status = 'running';
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_cancel(p_campaign uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  UPDATE outreach_campaigns SET status = 'canceled', run_token = NULL, run_lease_until = NULL,
         finished_at = coalesce(finished_at, now())
   WHERE id = p_campaign AND status IN ('draft', 'running', 'paused');
  UPDATE outreach_recipients SET status = 'skipped', lease_until = NULL
   WHERE campaign_id = p_campaign AND status = 'pending';
  PERFORM _audit('outreach_cancel', NULL, json_build_object('campaign', p_campaign)::jsonb);
END $$;

-- ─── Fila: claim e marcação ──────────────────────────────────────────────────
--
-- `admin_outreach_claim` é a única forma de pegar destinatários. Três coisas acontecem aqui,
-- nesta ordem, e todas importam:
--   1. renova o lease de execução e confere que o run_token ainda é de quem chamou;
--   2. devolve para a fila as linhas cujo lease venceu (função morreu no meio do lote) e
--      marca como falha definitiva quem já estourou as tentativas;
--   3. pega até N pendentes com FOR UPDATE SKIP LOCKED e grava o lease de cada uma antes de
--      devolver. Duas chamadas simultâneas pegam linhas diferentes, nunca as mesmas.
CREATE OR REPLACE FUNCTION admin_outreach_claim(
  p_campaign uuid, p_run_token uuid, p_limit int DEFAULT 25
) RETURNS SETOF outreach_recipients
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_max int := least(greatest(coalesce(p_limit, 25), 1), 100);
BEGIN
  PERFORM _require_admin();

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

-- Grava o resultado do lote. `results` é uma lista de {id, status, provider_id, error}.
-- Recebe o run_token para uma execução que perdeu o lease não conseguir sobrescrever o que
-- a execução que assumiu está fazendo.
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
  PERFORM _require_admin();

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

-- ─── Leitura do histórico ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_outreach_list(p_limit int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json) INTO r FROM (
    SELECT c.id, c.channel, c.title, c.subject, c.status, c.total, c.created_at, c.started_at,
           c.finished_at, u.email AS created_by_email,
           (SELECT count(*) FROM outreach_recipients r WHERE r.campaign_id = c.id AND r.status = 'sent') AS sent,
           (SELECT count(*) FROM outreach_recipients r WHERE r.campaign_id = c.id AND r.status = 'failed') AS failed,
           (SELECT count(*) FROM outreach_recipients r WHERE r.campaign_id = c.id AND r.status = 'skipped') AS skipped,
           (SELECT count(*) FROM outreach_recipients r WHERE r.campaign_id = c.id AND r.status IN ('pending', 'sending')) AS pending,
           -- Uma execução morreu e a campanha ficou 'running' sem lease: a tela mostra
           -- "interrompida" em vez de fingir que está enviando.
           (c.status = 'running' AND (c.run_lease_until IS NULL OR c.run_lease_until < now())) AS stalled
      FROM outreach_campaigns c
      LEFT JOIN auth.users u ON u.id = c.created_by
     ORDER BY c.created_at DESC
     LIMIT least(greatest(coalesce(p_limit, 30), 1), 200)
  ) t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_detail(p_campaign uuid, p_only_failed boolean DEFAULT false, p_limit int DEFAULT 200)
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT json_build_object(
    'campaign', (SELECT to_json(t) FROM (
      SELECT c.*, u.email AS created_by_email FROM outreach_campaigns c
        LEFT JOIN auth.users u ON u.id = c.created_by WHERE c.id = p_campaign
    ) t),
    'counts', (SELECT json_build_object(
        'sent', count(*) FILTER (WHERE status = 'sent'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'skipped', count(*) FILTER (WHERE status = 'skipped'),
        'pending', count(*) FILTER (WHERE status IN ('pending', 'sending'))
      ) FROM outreach_recipients WHERE campaign_id = p_campaign),
    'recipients', (SELECT coalesce(json_agg(t ORDER BY t.id), '[]'::json) FROM (
      SELECT id, address, name, status, provider_id, error, attempts, sent_at
        FROM outreach_recipients
       WHERE campaign_id = p_campaign AND (NOT p_only_failed OR status <> 'sent')
       ORDER BY id
       LIMIT least(greatest(coalesce(p_limit, 200), 1), 1000)
    ) t)
  ) INTO r;
  RETURN r;
END $$;

-- ─── Mensagens prontas ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_outreach_templates(p_channel text DEFAULT NULL) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(t ORDER BY t.channel, t.name), '[]'::json) INTO r FROM (
    SELECT id, name, channel, subject, body, variables, twilio_content_sid, approval_status,
           approval_category, active, created_at, updated_at
      FROM outreach_templates
     WHERE (p_channel IS NULL OR p_channel = '' OR channel = p_channel)
  ) t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_template_save(
  p_id uuid, p_name text, p_channel text, p_subject text, p_body text,
  p_variables text[] DEFAULT '{}', p_approval_category text DEFAULT NULL, p_active boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM _require_admin();
  IF p_channel NOT IN ('email', 'whatsapp') THEN RAISE EXCEPTION 'invalid_value'; END IF;
  IF coalesce(trim(p_name), '') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF p_channel = 'email' AND coalesce(trim(p_subject), '') = '' THEN RAISE EXCEPTION 'subject_required'; END IF;
  IF p_channel = 'whatsapp' AND coalesce(trim(p_body), '') = '' THEN RAISE EXCEPTION 'body_required'; END IF;

  IF p_id IS NULL THEN
    INSERT INTO outreach_templates (name, channel, subject, body, variables, approval_category, active)
    VALUES (trim(p_name), p_channel, p_subject, coalesce(p_body, ''), coalesce(p_variables, '{}'),
            p_approval_category, coalesce(p_active, true))
    RETURNING id INTO v_id;
  ELSE
    -- Mudar o texto de um modelo já aprovado invalida a aprovação: a Twilio aprovou o texto
    -- antigo. Volta para 'draft' para ninguém achar que o modelo novo está liberado.
    UPDATE outreach_templates
       SET name = trim(p_name),
           channel = p_channel,
           subject = p_subject,
           body = coalesce(p_body, ''),
           variables = coalesce(p_variables, '{}'),
           approval_category = p_approval_category,
           active = coalesce(p_active, true),
           approval_status = CASE WHEN body IS DISTINCT FROM coalesce(p_body, '') THEN 'draft' ELSE approval_status END,
           twilio_content_sid = CASE WHEN body IS DISTINCT FROM coalesce(p_body, '') THEN NULL ELSE twilio_content_sid END,
           updated_at = now()
     WHERE id = p_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  END IF;
  PERFORM _audit('outreach_template_save', NULL,
    json_build_object('template', v_id, 'channel', p_channel, 'name', trim(p_name))::jsonb);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_template_delete(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  DELETE FROM outreach_templates WHERE id = p_id;
  PERFORM _audit('outreach_template_delete', NULL, json_build_object('template', p_id)::jsonb);
END $$;

-- Grava o que a Edge Function ouviu da Twilio sobre o modelo (ContentSid + aprovação).
CREATE OR REPLACE FUNCTION admin_outreach_template_twilio(
  p_id uuid, p_content_sid text, p_approval_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  UPDATE outreach_templates
     SET twilio_content_sid = nullif(trim(p_content_sid), ''),
         approval_status = CASE
           WHEN p_approval_status IN ('draft','pending','approved','rejected','paused','unknown') THEN p_approval_status
           ELSE 'unknown' END,
         updated_at = now()
   WHERE id = p_id;
END $$;

-- ─── Estado do remetente de WhatsApp ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_outreach_channel_state() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_object_agg(channel, json_build_object(
           'last_sent_at', last_sent_at,
           'sender_sid', sender_sid,
           'sender_status', sender_status,
           'sender_display_name', sender_display_name,
           'sender_checked_at', sender_checked_at
         )), '{}'::json) INTO r
    FROM outreach_channel_state;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_save_sender(
  p_sid text, p_status text, p_display_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  UPDATE outreach_channel_state
     SET sender_sid = nullif(trim(p_sid), ''),
         sender_status = nullif(trim(p_status), ''),
         sender_display_name = nullif(trim(p_display_name), ''),
         sender_checked_at = now()
   WHERE channel = 'whatsapp';
END $$;

-- ─── Descadastro (só service_role) ───────────────────────────────────────────

-- Não é RPC de admin e não é público: recebe o endereço que a Edge Function já validou por
-- HMAC. Ficando fora do alcance de anon/authenticated, ninguém descadastra terceiros.
CREATE OR REPLACE FUNCTION outreach_optout(p_channel text, p_address text, p_reason text DEFAULT 'link')
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_addr text;
BEGIN
  IF p_channel NOT IN ('email', 'whatsapp') OR coalesce(trim(p_address), '') = '' THEN
    RAISE EXCEPTION 'invalid_value';
  END IF;
  v_addr := CASE WHEN p_channel = 'email'
                 THEN lower(trim(p_address))
                 ELSE _outreach_norm_phone(p_address) END;
  IF v_addr IS NULL THEN RAISE EXCEPTION 'invalid_value'; END IF;
  INSERT INTO outreach_optouts (channel, address, reason)
  VALUES (p_channel, v_addr, nullif(trim(p_reason), ''))
  ON CONFLICT (channel, address) DO NOTHING;

  -- Quem pediu para sair não pode continuar na fila de uma campanha em andamento.
  UPDATE outreach_recipients SET status = 'skipped', lease_until = NULL, error = 'optout'
   WHERE address = v_addr AND status IN ('pending', 'sending')
     AND campaign_id IN (SELECT id FROM outreach_campaigns WHERE channel = p_channel AND status IN ('draft', 'running', 'paused'));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_optout_list(p_channel text DEFAULT NULL) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json) INTO r FROM (
    SELECT channel, address, reason, created_at FROM outreach_optouts
     WHERE (p_channel IS NULL OR p_channel = '' OR channel = p_channel)
     LIMIT 1000
  ) t;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION admin_outreach_optout_remove(p_channel text, p_address text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  DELETE FROM outreach_optouts WHERE channel = p_channel AND address = p_address;
  PERFORM _audit('outreach_optout_remove', NULL,
    json_build_object('channel', p_channel, 'address', p_address)::jsonb);
END $$;

-- ─── Mensagens prontas semeadas ──────────────────────────────────────────────
--
-- Texto em pt-BR, tom do produto: sem emoji, sem travessão, direto ao ponto. Variáveis usam
-- {{nome}}, {{dias}} etc. Nos modelos de WhatsApp, o texto-fonte é o mesmo que a Twilio vai
-- receber ao criar o template pela tela; os placeholders viram {{1}}, {{2}} na ordem.

INSERT INTO outreach_templates (name, channel, subject, body, variables, approval_category)
SELECT * FROM (VALUES
  ('Teste terminando', 'email',
   'Seu teste do VS Stage Pro termina em breve',
   E'Oi, {{nome}},\n\nSeu teste grátis do VS Stage Pro termina em {{quando}}.\n\nPara continuar com o programa liberado no palco, é só assinar. Leva um minuto e você não perde os projetos que já montou.\n\n[Ver os planos](https://vsstagepro.com.br/planos)\n\nQualquer dúvida, responda este e-mail.',
   ARRAY['nome', 'quando']::text[], 'UTILITY'),

  ('Versão nova disponível', 'email',
   'Nova versão do VS Stage Pro para baixar',
   E'Oi, {{nome}},\n\nSaiu a versão {{versao}} do VS Stage Pro, com as melhorias que você pediu.\n\nPara atualizar, abra o programa e ele avisa sozinho, ou baixe direto pelo site.\n\n[Baixar a nova versão](https://vsstagepro.com.br/baixar)',
   ARRAY['nome', 'versao']::text[], 'UTILITY'),

  ('Boas-vindas', 'email',
   'Bem-vindo ao VS Stage Pro',
   E'Oi, {{nome}},\n\nSua conta está criada. O VS Stage Pro é o programa que deixa o show no piloto: repertório, click, teleprompter e mesa de som na mesma tela.\n\nBaixe o programa e abra seus primeiros projetos quando quiser.\n\n[Baixar o programa](https://vsstagepro.com.br/baixar)',
   ARRAY['nome']::text[], 'UTILITY'),

  ('Pagamento pendente', 'email',
   'Ficou um pagamento pendente no VS Stage Pro',
   E'Oi, {{nome}},\n\nA assinatura do VS Stage Pro ficou com o pagamento pendente, então o acesso pode ser interrompido.\n\nSe quiser resolver agora, é só entrar na sua conta.\n\n[Abrir minha assinatura](https://vsstagepro.com.br/planos)',
   ARRAY['nome']::text[], 'UTILITY'),

  ('Teste terminando (WhatsApp)', 'whatsapp', NULL,
   E'Oi, {{1}}! Seu teste do VS Stage Pro termina em {{2}}. Para continuar com o programa liberado no palco, assine em vsstagepro.com.br/planos. Responda SAIR para não receber mais mensagens.',
   ARRAY['nome', 'quando']::text[], 'UTILITY'),

  ('Versão nova (WhatsApp)', 'whatsapp', NULL,
   E'Oi, {{1}}! Saiu a versão {{2}} do VS Stage Pro. Abra o programa para atualizar, ou baixe em vsstagepro.com.br/baixar. Responda SAIR para não receber mais mensagens.',
   ARRAY['nome', 'versao']::text[], 'UTILITY'),

  ('Suporte / reencontro (WhatsApp)', 'whatsapp', NULL,
   E'Oi, {{1}}! Aqui é o suporte do VS Stage Pro. Vi que você usou o programa e queria saber se ficou alguma dúvida. Responda esta mensagem que a gente ajuda. Responda SAIR para não receber mais mensagens.',
   ARRAY['nome']::text[], 'UTILITY')
) AS t(name, channel, subject, body, variables, approval_category)
WHERE NOT EXISTS (
  SELECT 1 FROM outreach_templates x WHERE x.name = t.name AND x.channel = t.channel
);

-- ─── Grants ──────────────────────────────────────────────────────────────────

-- Nada aqui é público. `_outreach_norm_phone` e `_outreach_audience` são internos: ficando
-- sem EXECUTE para anon/authenticated, só as funções SECURITY DEFINER e o service role
-- conseguem chamar, e a base de contatos não vira lista pública.
REVOKE EXECUTE ON FUNCTION _outreach_norm_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _outreach_audience(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION outreach_optout(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION outreach_optout(text, text, text) TO service_role;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_outreach_audience(text, text)',
    'admin_outreach_audience_list(text, text, int)',
    'admin_outreach_create(text, uuid, text, text, text, text[], text, text, text, text[], jsonb)',
    'admin_outreach_start(uuid, int)',
    'admin_outreach_pause(uuid)',
    'admin_outreach_cancel(uuid)',
    'admin_outreach_claim(uuid, uuid, int)',
    'admin_outreach_mark(uuid, uuid, jsonb)',
    'admin_outreach_list(int)',
    'admin_outreach_detail(uuid, boolean, int)',
    'admin_outreach_templates(text)',
    'admin_outreach_template_save(uuid, text, text, text, text, text[], text, boolean)',
    'admin_outreach_template_delete(uuid)',
    'admin_outreach_template_twilio(uuid, text, text)',
    'admin_outreach_channel_state()',
    'admin_outreach_save_sender(text, text, text)',
    'admin_outreach_optout_list(text)',
    'admin_outreach_optout_remove(text, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
