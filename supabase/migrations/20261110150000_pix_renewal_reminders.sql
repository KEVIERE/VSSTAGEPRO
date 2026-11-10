/*
# Aviso por e-mail antes do PIX vencer (3, 2 e 1 dia antes)

O PIX não renova sozinho. A função `pix-renewal-reminder` manda um e-mail quando faltam
3, 2 e 1 dia para `director_licenses.pix_paid_until`. Assinatura recorrente (cartão),
parceiro e conta bloqueada não recebem (a regra fica em supabase/functions/_shared/pixReminder.ts).

- `pix_renewal_reminders`: um registro por aviso (pessoa + vencimento + dias). É o que
  impede o mesmo aviso de sair duas vezes. Quem renova ganha vencimento novo e, com ele,
  avisos novos no ciclo seguinte.
- `pix_reminder_candidates()`: quem vence nos próximos 4 dias (a função escolhe quem recebe).
- `pix_reminder_claim(...)`: reserva o aviso antes de enviar; falha anterior pode tentar de novo.
- A senha do agendamento nasce aqui, aleatória, no Vault do Supabase. Não passa pelo
  repositório (que é público) e nem precisa ser configurada a mão.
- `pg_cron` chama a função de hora em hora, das 9h às 20h de Brasília (12h a 23h UTC).
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS pix_renewal_reminders (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paid_until timestamptz NOT NULL,
  days_before int NOT NULL CHECK (days_before IN (1, 2, 3)),
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'failed')),
  provider_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (user_id, paid_until, days_before)
);
ALTER TABLE pix_renewal_reminders ENABLE ROW LEVEL SECURITY;
-- sem política: só o servidor (service_role) lê e escreve

CREATE OR REPLACE FUNCTION pix_reminder_candidates()
RETURNS TABLE(user_id uuid, email text, name text, plan text, pix_paid_until timestamptz,
              subscription text, partner boolean, blocked boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.user_id, u.email::text, (u.raw_user_meta_data->>'name')::text, l.plan, l.pix_paid_until,
         l.subscription, l.partner, l.blocked
    FROM director_licenses l
    JOIN auth.users u ON u.id = l.user_id
   WHERE l.pix_paid_until > now()
     AND l.pix_paid_until <= now() + interval '4 days';
$$;

-- Reserva o aviso. Devolve true só para quem pode enviar agora: aviso novo, ou um que falhou
-- (ou ficou preso em "enviando") há mais de 30 minutos.
CREATE OR REPLACE FUNCTION pix_reminder_claim(p_user uuid, p_paid_until timestamptz, p_days int)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  INSERT INTO pix_renewal_reminders (user_id, paid_until, days_before)
  VALUES (p_user, p_paid_until, p_days)
  ON CONFLICT (user_id, paid_until, days_before) DO UPDATE
     SET status = 'sending', created_at = now(), error = NULL
   WHERE pix_renewal_reminders.status <> 'sent'
     AND pix_renewal_reminders.created_at < now() - interval '30 minutes'
  RETURNING true INTO v_ok;
  RETURN coalesce(v_ok, false);
END $$;

CREATE OR REPLACE FUNCTION pix_reminder_done(p_user uuid, p_paid_until timestamptz, p_days int,
                                             p_provider_id text, p_error text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE pix_renewal_reminders
     SET status = CASE WHEN p_error IS NULL THEN 'sent' ELSE 'failed' END,
         provider_id = p_provider_id,
         error = left(p_error, 300),
         sent_at = CASE WHEN p_error IS NULL THEN now() ELSE NULL END
   WHERE user_id = p_user AND paid_until = p_paid_until AND days_before = p_days;
$$;

-- Senha do agendamento: aleatória, criada uma vez no Vault.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pix_reminder_cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'pix_reminder_cron_secret',
      'Senha que o agendamento manda para a função pix-renewal-reminder'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pix_reminder_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(p_secret, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'pix_reminder_cron_secret' AND decrypted_secret = p_secret
  );
$$;

REVOKE EXECUTE ON FUNCTION pix_reminder_candidates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION pix_reminder_claim(uuid, timestamptz, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION pix_reminder_done(uuid, timestamptz, int, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION pix_reminder_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pix_reminder_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION pix_reminder_claim(uuid, timestamptz, int) TO service_role;
GRANT EXECUTE ON FUNCTION pix_reminder_done(uuid, timestamptz, int, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION pix_reminder_secret_ok(text) TO service_role;

-- De hora em hora, das 9h às 20h de Brasília. O mesmo nome substitui o agendamento anterior.
SELECT cron.schedule(
  'pix-renewal-reminder',
  '0 12-23 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://eknjqqiamuztomdygalv.supabase.co/functions/v1/pix-renewal-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pix_reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
