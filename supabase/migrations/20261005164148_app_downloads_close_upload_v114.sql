/*
# Fecha a liberação temporária do instalador 1.1.4

1. Segurança
- Remove as permissões temporárias de envio e atualização criadas para publicar a versão 1.1.4.
- Os downloads continuam públicos somente para leitura.
*/
DROP POLICY IF EXISTS "temp upload mac 114" ON storage.objects;
DROP POLICY IF EXISTS "temp update mac manifest" ON storage.objects;
DROP POLICY IF EXISTS "temp select mac manifest" ON storage.objects;