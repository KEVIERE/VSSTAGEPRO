/* Remove a liberação temporária de envio do bucket app-downloads. */
drop policy if exists "temp upload app downloads" on storage.objects;