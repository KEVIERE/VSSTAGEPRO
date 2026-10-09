/*
# Teleprompter: lyrics pages per song and the stage screen controlled by the producer

1. New Tables
- `prompters` (one row per show)
  - `show_id` (uuid, pk, fk shows): the show this teleprompter belongs to.
  - `lyrics` (jsonb): map songId -> array of pages { id, at (seconds), text, kind }.
  - `display` (jsonb): what the stage screen shows (lyrics, clock, show time, playlist, notice, blackout, font size...).
  - `screen_key_hash` (text, nullable): sha256 of the private key embedded in the TV screen link.
  - `updated_at` (timestamptz).

2. Security
- RLS enabled with NO policies, all privileges revoked: clients never touch the table directly.
- director_prompter_* functions require the show id + director key (same check as other director functions).
- prompter_screen_* functions require the private screen key; they only return the current and next song lyrics,
  and may only change the `display` settings (never lyrics).

3. Notes
1. Generating a new screen link immediately invalidates the previous one.
2. Size limits: 60 KB of lyrics per song, 8 KB of display settings.
*/

CREATE TABLE IF NOT EXISTS prompters (
  show_id uuid PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
  lyrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  display jsonb NOT NULL DEFAULT '{}'::jsonb,
  screen_key_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prompters_screen_key_idx ON prompters(screen_key_hash);

ALTER TABLE prompters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON prompters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION _prompter_ensure(p_show uuid) RETURNS prompters
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v prompters;
BEGIN
  INSERT INTO prompters(show_id) VALUES (p_show) ON CONFLICT (show_id) DO NOTHING;
  SELECT * INTO v FROM prompters WHERE show_id = p_show;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION _prompter_ensure(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION director_prompter_get(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v prompters;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  v := _prompter_ensure(p_show);
  RETURN json_build_object('lyrics', v.lyrics, 'display', v.display, 'has_screen', v.screen_key_hash IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION director_prompter_save_song(p_show uuid, p_key text, p_song text, p_pages jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF coalesce(p_song, '') = '' OR length(p_song) > 120 OR jsonb_typeof(coalesce(p_pages, 'null'::jsonb)) <> 'array'
     OR octet_length(p_pages::text) > 60000 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;
  PERFORM _prompter_ensure(p_show);
  UPDATE prompters SET lyrics = jsonb_set(lyrics, ARRAY[p_song], p_pages, true), updated_at = now()
  WHERE show_id = p_show;
  IF octet_length((SELECT lyrics::text FROM prompters WHERE show_id = p_show)) > 2000000 THEN
    RAISE EXCEPTION 'too_large';
  END IF;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_prompter_set_display(p_show uuid, p_key text, p_display jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF jsonb_typeof(coalesce(p_display, 'null'::jsonb)) <> 'object' OR octet_length(p_display::text) > 8000 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;
  PERFORM _prompter_ensure(p_show);
  UPDATE prompters SET display = p_display, updated_at = now() WHERE show_id = p_show;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_prompter_new_screen(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_key text := encode(gen_random_bytes(24), 'hex');
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  PERFORM _prompter_ensure(p_show);
  UPDATE prompters SET screen_key_hash = encode(digest(v_key, 'sha256'), 'hex') WHERE show_id = p_show;
  RETURN json_build_object('screen_key', v_key);
END $$;

CREATE OR REPLACE FUNCTION prompter_screen_state(p_screen text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v prompters; v_s shows; v_cur text; v_next text;
BEGIN
  SELECT * INTO v FROM prompters
  WHERE screen_key_hash IS NOT NULL AND screen_key_hash = encode(digest(coalesce(p_screen, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN json_build_object('error', 'invalid_screen'); END IF;
  SELECT * INTO v_s FROM shows WHERE id = v.show_id;
  v_cur := v_s.live->>'currentSongId';
  v_next := v_s.live->>'nextSongId';
  RETURN json_build_object(
    'show', json_build_object('name', v_s.name, 'setlist', v_s.setlist, 'live', v_s.live, 'live_at', v_s.live_at),
    'display', v.display,
    'lyrics', json_build_object(
      'current', CASE WHEN v_cur IS NULL THEN NULL ELSE v.lyrics->v_cur END,
      'next', CASE WHEN v_next IS NULL THEN NULL ELSE v.lyrics->v_next END),
    'server_now', now()
  );
END $$;

CREATE OR REPLACE FUNCTION prompter_screen_set_display(p_screen text, p_display jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF jsonb_typeof(coalesce(p_display, 'null'::jsonb)) <> 'object' OR octet_length(p_display::text) > 8000 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;
  UPDATE prompters SET display = p_display, updated_at = now()
  WHERE screen_key_hash IS NOT NULL AND screen_key_hash = encode(digest(coalesce(p_screen, ''), 'sha256'), 'hex');
  IF NOT FOUND THEN RETURN json_build_object('error', 'invalid_screen'); END IF;
  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION director_prompter_get(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_prompter_save_song(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_prompter_set_display(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_prompter_new_screen(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION prompter_screen_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION prompter_screen_set_display(text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION director_prompter_get(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_prompter_save_song(uuid, text, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_prompter_set_display(uuid, text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_prompter_new_screen(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION prompter_screen_state(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION prompter_screen_set_display(text, jsonb) TO anon, authenticated;
