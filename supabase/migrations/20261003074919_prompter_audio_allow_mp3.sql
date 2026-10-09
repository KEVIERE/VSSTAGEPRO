/*
# Light MP3 reference audio for the teleprompter

1. Storage changes
- Bucket `prompter-audio` now also accepts `audio/mpeg` (MP3). The director's program sends a small mono MP3
  of each song so the producer receives it much faster. Existing WAV files keep working.

2. Security
- No policy changes: the bucket stays private and is only reached through the `prompter-audio` edge function.
*/

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['audio/mpeg', 'audio/wav', 'audio/x-wav']
WHERE id = 'prompter-audio';
