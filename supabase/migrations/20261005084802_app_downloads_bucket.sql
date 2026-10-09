/*
  # Bucket de downloads do app

  Bucket público só para baixar os instaladores do VS Stage para Mac.
  Sem políticas de escrita: apenas o servidor (service role) envia arquivos; qualquer pessoa pode baixar pelo link público.
*/
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-downloads', 'app-downloads', true, 524288000, array['application/zip'])
on conflict (id) do nothing;