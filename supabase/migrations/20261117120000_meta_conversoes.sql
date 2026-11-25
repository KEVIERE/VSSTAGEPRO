-- Medição de conversões da Meta (Pixel + API de Conversões).
--
-- `meta_tracking`: o que o navegador tinha ao abrir o pagamento (cookies _fbp e _fbc do
-- próprio site, página, IP e navegador). Quando a InfinitePay confirma, a função manda o
-- Purchase para a Meta com esses dados, e a venda fica ligada ao clique no anúncio mesmo
-- que a pessoa tenha pago em outra aba ou no celular. Ver supabase/functions/_shared/metaCapi.ts.
--
-- A tabela pix_payments não tem política para usuários (só o service role lê), então
-- ninguém de fora enxerga esta coluna.
ALTER TABLE pix_payments ADD COLUMN IF NOT EXISTS meta_tracking jsonb;

COMMENT ON COLUMN pix_payments.meta_tracking IS
  'Meta: fbp, fbc, url, ip, ua do momento em que o pagamento foi aberto. Usado no Purchase da API de Conversões.';
