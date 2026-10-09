/* Fecha a liberação temporária do envio do instalador 1.1.0; downloads seguem públicos só para leitura. */
drop policy if exists "temp upload mac 110" on storage.objects;
drop policy if exists "temp update mac manifest" on storage.objects;
drop policy if exists "temp select mac manifest" on storage.objects;