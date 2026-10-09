/*
# Only approved members appear as colleagues and can receive shared sheets

1. Modified Functions
- `musician_colleagues`: lists only approved members of the same show.
- `musician_share_sheet`: copies sheets only to approved members of the same show.

2. Security
- Pending or blocked members are invisible to other musicians and cannot receive content.
*/

CREATE OR REPLACE FUNCTION musician_colleagues(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  RETURN json_build_object('colleagues', coalesce((
    SELECT json_agg(json_build_object('id', id, 'name', name, 'instrument', instrument) ORDER BY name)
    FROM musicians WHERE show_id = v_m.show_id AND id <> v_m.id AND status = 'approved'), '[]'::json));
END $$;

CREATE OR REPLACE FUNCTION musician_share_sheet(p_code text, p_sheet uuid, p_targets uuid[]) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians; v_sheet sheets; v_count int;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  SELECT * INTO v_sheet FROM sheets WHERE id = p_sheet AND musician_id = v_m.id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;
  IF coalesce(array_length(p_targets, 1), 0) > 60 THEN RETURN json_build_object('error', 'limit'); END IF;
  INSERT INTO sheets(show_id, musician_id, song_id, title, content, shared_from)
  SELECT v_m.show_id, t.id, v_sheet.song_id, v_sheet.title, v_sheet.content,
         left(v_m.name || CASE WHEN v_m.instrument <> '' THEN ', ' || v_m.instrument ELSE '' END, 120)
  FROM musicians t
  WHERE t.show_id = v_m.show_id AND t.id <> v_m.id AND t.status = 'approved' AND t.id = ANY(p_targets);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('ok', true, 'count', v_count);
END $$;
