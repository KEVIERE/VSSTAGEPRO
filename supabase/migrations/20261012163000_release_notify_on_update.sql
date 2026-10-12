-- Atualiza trigger para notificar quando a obrigatoriedade for alterada (UPDATE)
-- ou quando uma nova versão for inserida (INSERT).
DROP TRIGGER IF EXISTS app_releases_notify ON app_releases;
CREATE TRIGGER app_releases_notify AFTER INSERT OR UPDATE ON app_releases
FOR EACH ROW EXECUTE FUNCTION notify_release_event();
