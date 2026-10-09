/*
# Private storage for the band logo shown on the teleprompter stage screen

1. Storage
- New private bucket `show-logos`. One logo per show, at `<show_id>/logo`.
- 5 MB per file. Only PNG, SVG and JPEG images are accepted.

2. Security
- No storage policies are added, so the browser cannot list, read or write these files directly.
- All access goes through the `prompter-audio` edge function using the service role:
  - upload/remove only after the director key of the show is verified;
  - viewing links only for a valid producer or screen code of that same show (or the director).
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('show-logos', 'show-logos', false, 5242880, ARRAY['image/png', 'image/svg+xml', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/png', 'image/svg+xml', 'image/jpeg'];
