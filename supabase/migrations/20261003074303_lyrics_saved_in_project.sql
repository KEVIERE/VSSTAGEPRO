/*
# Lyric maps saved into the director's project

1. Modified Tables
- `shows`
  - `lyrics_save_requested_at` (timestamptz, nullable): last time the producer pressed "Salvar no projeto".
  - `lyrics_saved_at` (timestamptz, nullable): last time the director's program copied the lyric maps into the project.

2. New Functions (all SECURITY DEFINER, validated by access code or director key)
- `producer_request_lyrics_save(p_code)`: producer asks the director's program to store the lyric maps in the project.
- `director_lyrics_get(p_show, p_key)`: director reads every lyric map of the show plus the save request/ack times.
- `director_lyrics_ack(p_show, p_key)`: director confirms the maps were stored in the project.
- `director_lyrics_restore(p_show, p_key, p_lyrics)`: director re-uploads maps kept in the project, only for songs that have no map online yet (never overwrites the producer's work).

3. Modified Functions
- `producer_state` now also returns `lyrics_save` { requested_at, saved_at } so the producer sees when the project was updated.

4. Security
- No new table, no policy changes. Each function checks the producer code (with the existing attempt limiter) or the director key before doing anything.
*/

ALTER TABLE shows ADD COLUMN IF NOT EXISTS lyrics_save_requested_at timestamptz;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS lyrics_saved_at timestamptz;

CREATE OR REPLACE FUNCTION producer_request_lyrics_save(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  UPDATE shows SET lyrics_save_requested_at = now() WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'requested_at', now());
END $$;

CREATE OR REPLACE FUNCTION director_lyrics_get(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_s FROM shows WHERE id = p_show;
  RETURN json_build_object(
    'lyrics', coalesce((
      SELECT json_agg(json_build_object('song_id', song_id, 'pages', pages, 'updated_at', updated_at))
      FROM lyrics WHERE show_id = p_show), '[]'::json),
    'requested_at', v_s.lyrics_save_requested_at,
    'saved_at', v_s.lyrics_saved_at
  );
END $$;

CREATE OR REPLACE FUNCTION director_lyrics_ack(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE shows SET lyrics_saved_at = now() WHERE id = p_show;
  RETURN json_build_object('ok', true, 'saved_at', now());
END $$;

CREATE OR REPLACE FUNCTION director_lyrics_restore(p_show uuid, p_key text, p_lyrics jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_item jsonb; v_added int := 0; v_n int;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF jsonb_typeof(coalesce(p_lyrics, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_lyrics) > 400 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_lyrics) LOOP
    IF jsonb_typeof(v_item->'song_id') <> 'string' OR coalesce(v_item->>'song_id', '') = ''
      OR jsonb_typeof(coalesce(v_item->'pages', 'null'::jsonb)) <> 'array'
      OR jsonb_array_length(v_item->'pages') = 0 OR jsonb_array_length(v_item->'pages') > 400
      OR octet_length((v_item->'pages')::text) > 150000 THEN
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM lyrics WHERE show_id = p_show) >= 400 THEN EXIT; END IF;
    INSERT INTO lyrics(show_id, song_id, pages) VALUES (p_show, left(v_item->>'song_id', 120), v_item->'pages')
    ON CONFLICT (show_id, song_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_added := v_added + v_n;
  END LOOP;
  RETURN json_build_object('ok', true, 'added', v_added);
END $$;

CREATE OR REPLACE FUNCTION producer_state(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  RETURN json_build_object(
    'show', json_build_object('name', v_s.name, 'setlist', v_s.setlist, 'live', v_s.live, 'live_at', v_s.live_at),
    'prompter', v_s.prompter,
    'lyrics', coalesce((
      SELECT json_agg(json_build_object('song_id', song_id, 'pages', pages, 'updated_at', updated_at))
      FROM lyrics WHERE show_id = v_s.id), '[]'::json),
    'lyrics_save', json_build_object('requested_at', v_s.lyrics_save_requested_at, 'saved_at', v_s.lyrics_saved_at),
    'server_now', now()
  );
END $$;

REVOKE ALL ON FUNCTION producer_request_lyrics_save(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_lyrics_get(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_lyrics_ack(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_lyrics_restore(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producer_request_lyrics_save(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_lyrics_get(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_lyrics_ack(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_lyrics_restore(uuid, text, jsonb) TO anon, authenticated;
