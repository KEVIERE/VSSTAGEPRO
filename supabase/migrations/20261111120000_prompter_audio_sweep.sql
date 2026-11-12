/*
# Áudio do produtor: some do Supabase 10 minutos depois de o produtor salvar, sempre

Antes a limpeza só acontecia quando alguém (o programa do diretor ou a página do produtor)
chamava a função `prompter-audio`. Se os dois fechassem logo depois do "Salvar", o áudio
ficava no storage até alguém abrir de novo. Agora o banco chama a limpeza sozinho.

- `prompter_audio_expired_shows()`: shows com áudio no bucket `prompter-audio` cujo produtor
  salvou as letras há mais de 10 minutos (e sem envio novo do diretor depois disso).
- A função `prompter-audio-sweep` apaga a pasta desses shows pela API do Storage (o Supabase
  não deixa apagar arquivo direto pelo SQL).
- `pg_cron` chama a função a cada 5 minutos, com a senha do Vault no cabeçalho x-cron-secret.
  A senha nasce aqui, aleatória, e não passa pelo repositório (que é público).
- O bucket passa a aceitar também `application/json`: a letra lida pelo Mac do diretor
  (`<show>/<musica>.words.json`) vai junto com o áudio e some junto com ele.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['audio/mpeg', 'audio/wav', 'audio/x-wav', 'application/json']
WHERE id = 'prompter-audio';

CREATE OR REPLACE FUNCTION prompter_audio_expired_shows()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, storage
AS $$
  SELECT s.id
    FROM shows s
   WHERE s.produced_audio_released_at IS NOT NULL
     AND s.produced_audio_released_at < now() - interval '10 minutes'
     AND s.repertoire_requested_at IS NULL
     AND EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'prompter-audio'
          AND o.name LIKE s.id::text || '/%'
     );
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'prompter_sweep_cron_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'prompter_sweep_cron_secret',
      'Senha do agendamento que apaga o áudio do produtor (prompter-audio-sweep)'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION prompter_sweep_secret_ok(p_secret text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(p_secret, '') <> '' AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'prompter_sweep_cron_secret' AND decrypted_secret = p_secret
  );
$$;

REVOKE EXECUTE ON FUNCTION prompter_audio_expired_shows() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prompter_sweep_secret_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION prompter_audio_expired_shows() TO service_role;
GRANT EXECUTE ON FUNCTION prompter_sweep_secret_ok(text) TO service_role;

-- A cada 5 minutos. O mesmo nome substitui o agendamento anterior.
SELECT cron.schedule(
  'prompter-audio-sweep',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://eknjqqiamuztomdygalv.supabase.co/functions/v1/prompter-audio-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'prompter_sweep_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);
