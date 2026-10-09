/*
# Liberação temporária para enviar o instalador 1.1.6

1. Mudanças
- Permite, por poucos minutos, enviar apenas arquivos dentro de `mac/1.1.6/` e atualizar `mac/manifest.json` no depósito `app-downloads`.
2. Segurança
- Restrito a esses caminhos; removido na migração seguinte (close_upload_v116).
*/
DROP POLICY IF EXISTS "temp upload mac 116" ON storage.objects;
CREATE POLICY "temp upload mac 116" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'app-downloads' AND (name LIKE 'mac/1.1.6/%' OR name = 'mac/manifest.json'));
DROP POLICY IF EXISTS "temp update mac manifest" ON storage.objects;
CREATE POLICY "temp update mac manifest" ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'app-downloads' AND name = 'mac/manifest.json')
  WITH CHECK (bucket_id = 'app-downloads' AND name = 'mac/manifest.json');
DROP POLICY IF EXISTS "temp select mac manifest" ON storage.objects;
CREATE POLICY "temp select mac manifest" ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'app-downloads' AND name = 'mac/manifest.json');