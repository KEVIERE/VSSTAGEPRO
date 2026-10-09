/*
  # Instaladores do Mac em partes

  O limite de arquivo do armazenamento é menor que o .dmg, então cada instalador fica em partes de 45 MB
  mais um manifest.json; a página de download do app junta as partes no navegador.
  Liberação temporária de envio para o anon (removida na migração seguinte).
*/
update storage.buckets
set allowed_mime_types = array['application/octet-stream', 'application/json'],
    file_size_limit = 52428800
where id = 'app-downloads';

create policy "temp upload app downloads" on storage.objects for insert to anon with check (bucket_id = 'app-downloads');