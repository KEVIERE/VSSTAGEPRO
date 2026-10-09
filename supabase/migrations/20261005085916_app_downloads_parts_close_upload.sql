/* Fecha o envio temporário do bucket app-downloads; downloads continuam públicos só para leitura. */
drop policy if exists "temp upload app downloads" on storage.objects;