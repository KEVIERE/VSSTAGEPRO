/*
# Private storage for teleprompter reference audio

1. Storage
- New private bucket `prompter-audio`. Holds one light reference mix per song, at `<show_id>/<song_id>.wav`.
- 40 MB per file, audio only.

2. Security
- No storage policies are added, so the browser (anon/authenticated) cannot list, read or write
  these files directly.
- All access goes through the `prompter-audio` edge function using the service role:
  - upload links only after the director key of the show is verified;
  - playback links only for a valid producer code of that same show.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('prompter-audio', 'prompter-audio', false, 41943040, ARRAY['audio/wav', 'audio/x-wav'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 41943040, allowed_mime_types = ARRAY['audio/wav', 'audio/x-wav'];
