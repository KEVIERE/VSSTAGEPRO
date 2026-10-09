/*
# Musician notebook: richer sheets and lyrics import

1. Changes
- `musician_save_sheet` now accepts notebooks up to 1.5 MB (was 100 KB) so hand drawings,
  chord charts and staff notes fit. Same ownership checks as before.
- New `musician_song_lyrics(p_code, p_song_id)`: an approved musician reads the teleprompter
  lyric text of one song of their own show, to start a chord chart from it.

2. Security
- Both functions are SECURITY DEFINER and validate the musician credential with `_musician_by_code`,
  which only resolves approved members. Musicians can only read lyrics of their own show and can
  never change them. No table privileges are granted.

3. Notes
1. Existing plain-text sheets keep working; the app reads them as a text page.
*/

CREATE OR REPLACE FUNCTION musician_save_sheet(p_code text, p_sheet uuid, p_song_id text, p_title text, p_content text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians; v_id uuid;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  IF octet_length(coalesce(p_content, '')) > 1500000 OR coalesce(p_song_id, '') = '' THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;
  IF p_sheet IS NULL THEN
    IF (SELECT count(*) FROM sheets WHERE musician_id = v_m.id) >= 500 THEN RETURN json_build_object('error', 'limit'); END IF;
    INSERT INTO sheets(show_id, musician_id, song_id, title, content)
    VALUES (v_m.show_id, v_m.id, left(p_song_id, 120), left(coalesce(p_title, ''), 120), coalesce(p_content, ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE sheets SET title = left(coalesce(p_title, ''), 120), content = coalesce(p_content, ''), updated_at = now()
    WHERE id = p_sheet AND musician_id = v_m.id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN json_build_object('error', 'not_found'); END IF;
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION musician_song_lyrics(p_code text, p_song_id text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians; v_pages jsonb;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  IF coalesce(p_song_id, '') = '' OR length(p_song_id) > 120 THEN RETURN json_build_object('error', 'invalid_input'); END IF;
  SELECT lyrics -> p_song_id INTO v_pages FROM prompters WHERE show_id = v_m.show_id;
  IF v_pages IS NULL OR jsonb_typeof(v_pages) <> 'array' THEN RETURN json_build_object('ok', true, 'texts', '[]'::json); END IF;
  RETURN json_build_object('ok', true, 'texts', coalesce((
    SELECT json_agg(e ->> 'text' ORDER BY ord)
    FROM jsonb_array_elements(v_pages) WITH ORDINALITY AS x(e, ord)
    WHERE coalesce(e ->> 'text', '') <> ''), '[]'::json));
END $$;

REVOKE ALL ON FUNCTION musician_song_lyrics(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musician_song_lyrics(text, text) TO anon, authenticated;
