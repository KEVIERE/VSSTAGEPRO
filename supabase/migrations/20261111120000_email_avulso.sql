-- E-mail avulso da área de Comunicação.
--
-- O admin digita endereços quaisquer (não precisam ser usuários), assunto e texto, e envia.
-- Quem envia é a Edge Function outreach-send (ação direct-send), com a service_role: ela
-- confere que quem chamou é admin, manda pelo Resend e grava aqui um registro por envio, com
-- o resultado de cada destinatário.
--
-- O remetente é escolhido na tela, mas só dentro de @vsstagepro.com.br (domínio verificado no
-- Resend). Para a resposta ir a outra caixa, como um Gmail, serve o "Responder para".
--
-- A tabela não tem política de RLS: ninguém lê nem grava direto. A leitura é pelo RPC
-- admin_direct_email_list, que exige admin.

CREATE TABLE IF NOT EXISTS outreach_direct_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- "Nome <local@vsstagepro.com.br>": o remetente escolhido na tela.
  from_address text,
  subject text NOT NULL,
  body text NOT NULL,
  reply_to text,
  total int NOT NULL DEFAULT 0,
  sent int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  -- [{ address, status: 'sent' | 'failed', error, providerId }]
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_direct_emails_created_idx
  ON outreach_direct_emails (created_at DESC);

ALTER TABLE outreach_direct_emails ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION admin_direct_email_list(p_limit int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(t ORDER BY t.created_at DESC), '[]'::json) INTO r FROM (
    SELECT d.id, d.from_address, d.subject, d.body, d.reply_to, d.total, d.sent, d.failed, d.recipients,
           d.created_at, u.email AS sent_by_email
    FROM outreach_direct_emails d
    LEFT JOIN auth.users u ON u.id = d.sent_by
    ORDER BY d.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 30), 200))
  ) t;
  RETURN r;
END $$;

REVOKE EXECUTE ON FUNCTION admin_direct_email_list(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_direct_email_list(int) TO authenticated;
