/*
# Fecha a liberação temporária do envio 1.1.9

1. Segurança
- Remove as permissões temporárias de envio/atualização criadas para publicar o instalador 1.1.9.
*/
DROP POLICY IF EXISTS "temp upload mac 119" ON storage.objects;
DROP POLICY IF EXISTS "temp update mac manifest" ON storage.objects;
DROP POLICY IF EXISTS "temp select mac manifest" ON storage.objects;