/* Fecha a liberação temporária do envio do instalador 1.1.0 corrigido; downloads seguem públicos só para leitura. */
drop policy if exists "temp upload mac 110r2" on storage.objects;
drop policy if exists "temp update mac manifest" on storage.objects;
drop policy if exists "temp select mac manifest" on storage.objects;