/* Liberação temporária e restrita para enviar o instalador 1.1.0 (removida na migração seguinte). */
create policy "temp upload mac 110" on storage.objects for insert to anon
  with check (bucket_id = 'app-downloads' and (name like 'mac/1.1.0/%' or name = 'mac/manifest.json'));
create policy "temp update mac manifest" on storage.objects for update to anon
  using (bucket_id = 'app-downloads' and name = 'mac/manifest.json')
  with check (bucket_id = 'app-downloads' and name = 'mac/manifest.json');
create policy "temp select mac manifest" on storage.objects for select to anon
  using (bucket_id = 'app-downloads' and name = 'mac/manifest.json');