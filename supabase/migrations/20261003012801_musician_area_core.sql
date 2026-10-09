/*
# Musician Area: shows, personal musician codes, and sheets

1. New Tables
- `shows`: one online show published by the director.
  - `id` (uuid), `name` (text), `director_key_hash` (text, sha256 of the director's private key),
    `setlist` (jsonb, songs/blocks published by the director), `live` (jsonb, transport snapshot),
    `live_at` (timestamptz, server time of the snapshot), `created_at`.
- `musicians`: band members of a show, each with a personal access code.
  - `id`, `show_id` (fk shows), `name`, `instrument`, `code` (unique, 8 chars), `last_seen`, `created_at`.
- `sheets`: chord/lyrics sheets owned by one musician.
  - `id`, `show_id`, `musician_id` (owner), `song_id` (text, song in the setlist), `title`, `content` (text),
    `shared_from` (text, "Name, Instrument" when received from a colleague), `updated_at`, `created_at`.
- `code_attempts`: failed code entries per client address, used to block guessing.

2. Security
- RLS enabled on every table with NO policies: direct table access by anon/authenticated is denied.
- All access goes through SECURITY DEFINER functions:
  - director_* functions require the show id + the director private key (hash compared server-side).
  - musician_* functions require a valid personal code; each musician only reaches their own sheets.
  - Repeated wrong codes from the same address are blocked for 10 minutes.

3. Notes
1. Sharing a sheet creates an independent copy for each chosen colleague.
2. Regenerating a code immediately invalidates the previous one.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS shows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Show',
  director_key_hash text NOT NULL,
  setlist jsonb NOT NULL DEFAULT '{}'::jsonb,
  live jsonb NOT NULL DEFAULT '{}'::jsonb,
  live_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS musicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  name text NOT NULL,
  instrument text NOT NULL DEFAULT '',
  code text NOT NULL UNIQUE,
  last_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS musicians_show_idx ON musicians(show_id);

CREATE TABLE IF NOT EXISTS sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  musician_id uuid NOT NULL REFERENCES musicians(id) ON DELETE CASCADE,
  song_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  shared_from text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheets_musician_idx ON sheets(musician_id);

CREATE TABLE IF NOT EXISTS code_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS code_attempts_client_idx ON code_attempts(client, attempted_at);

ALTER TABLE shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE musicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON shows, musicians, sheets, code_attempts FROM anon, authenticated;

-- helpers (not callable by clients)
CREATE OR REPLACE FUNCTION _new_musician_code() RETURNS text
LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  result text;
  i int;
BEGIN
  LOOP
    bytes := gen_random_bytes(8);
    result := '';
    FOR i IN 0..7 LOOP
      result := result || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM musicians WHERE code = result);
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _director_ok(p_show uuid, p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT EXISTS (
    SELECT 1 FROM shows
    WHERE id = p_show AND director_key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex')
  );
$$;

CREATE OR REPLACE FUNCTION _musician_by_code(p_code text) RETURNS musicians
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_client text;
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row musicians;
BEGIN
  v_client := coalesce(
    split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1),
    'unknown');
  IF v_client = '' THEN v_client := 'unknown'; END IF;

  IF (SELECT count(*) FROM code_attempts
      WHERE client = v_client AND attempted_at > now() - interval '10 minutes') >= 15 THEN
    RAISE EXCEPTION 'too_many_attempts';
  END IF;

  SELECT * INTO v_row FROM musicians WHERE code = v_norm;
  IF NOT FOUND THEN
    INSERT INTO code_attempts(client) VALUES (v_client);
    DELETE FROM code_attempts WHERE attempted_at < now() - interval '1 day';
    RETURN NULL;
  END IF;

  IF v_row.last_seen IS NULL OR v_row.last_seen < now() - interval '10 seconds' THEN
    UPDATE musicians SET last_seen = now() WHERE id = v_row.id;
  END IF;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION _new_musician_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _director_ok(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _musician_by_code(text) FROM PUBLIC, anon, authenticated;

-- director functions
CREATE OR REPLACE FUNCTION create_show(p_name text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_key text := encode(gen_random_bytes(24), 'hex');
  v_id uuid;
BEGIN
  INSERT INTO shows(name, director_key_hash)
  VALUES (left(coalesce(nullif(trim(p_name), ''), 'Show'), 120), encode(digest(v_key, 'sha256'), 'hex'))
  RETURNING id INTO v_id;
  RETURN json_build_object('show_id', v_id, 'director_key', v_key);
END $$;

CREATE OR REPLACE FUNCTION director_publish(p_show uuid, p_key text, p_name text, p_setlist jsonb, p_live jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF octet_length(coalesce(p_setlist, '{}'::jsonb)::text) > 200000 OR octet_length(coalesce(p_live, '{}'::jsonb)::text) > 4000 THEN
    RETURN json_build_object('error', 'too_large');
  END IF;
  UPDATE shows SET
    name = left(coalesce(nullif(trim(p_name), ''), name), 120),
    setlist = coalesce(p_setlist, setlist),
    live = coalesce(p_live, live),
    live_at = now()
  WHERE id = p_show;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_list_musicians(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  RETURN json_build_object('musicians', coalesce((
    SELECT json_agg(json_build_object(
      'id', id, 'name', name, 'instrument', instrument, 'code', code,
      'online', last_seen IS NOT NULL AND last_seen > now() - interval '30 seconds'
    ) ORDER BY created_at)
    FROM musicians WHERE show_id = p_show), '[]'::json));
END $$;

CREATE OR REPLACE FUNCTION director_add_musician(p_show uuid, p_key text, p_name text, p_instrument text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF coalesce(trim(p_name), '') = '' THEN RETURN json_build_object('error', 'name_required'); END IF;
  IF (SELECT count(*) FROM musicians WHERE show_id = p_show) >= 60 THEN RETURN json_build_object('error', 'limit'); END IF;
  INSERT INTO musicians(show_id, name, instrument, code)
  VALUES (p_show, left(trim(p_name), 60), left(trim(coalesce(p_instrument, '')), 40), _new_musician_code())
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION director_regenerate_code(p_show uuid, p_key text, p_musician uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE musicians SET code = _new_musician_code(), last_seen = NULL
  WHERE id = p_musician AND show_id = p_show;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_remove_musician(p_show uuid, p_key text, p_musician uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  DELETE FROM musicians WHERE id = p_musician AND show_id = p_show;
  RETURN json_build_object('ok', true);
END $$;

-- musician functions
CREATE OR REPLACE FUNCTION musician_state(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians; v_s shows;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  SELECT * INTO v_s FROM shows WHERE id = v_m.show_id;
  RETURN json_build_object(
    'musician', json_build_object('id', v_m.id, 'name', v_m.name, 'instrument', v_m.instrument),
    'show', json_build_object('name', v_s.name, 'setlist', v_s.setlist, 'live', v_s.live, 'live_at', v_s.live_at),
    'server_now', now()
  );
END $$;

CREATE OR REPLACE FUNCTION musician_sheets(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  RETURN json_build_object('sheets', coalesce((
    SELECT json_agg(json_build_object(
      'id', id, 'song_id', song_id, 'title', title, 'content', content,
      'shared_from', shared_from, 'updated_at', updated_at
    ) ORDER BY updated_at DESC)
    FROM sheets WHERE musician_id = v_m.id), '[]'::json));
END $$;

CREATE OR REPLACE FUNCTION musician_save_sheet(p_code text, p_sheet uuid, p_song_id text, p_title text, p_content text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians; v_id uuid;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  IF octet_length(coalesce(p_content, '')) > 100000 OR coalesce(p_song_id, '') = '' THEN
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

CREATE OR REPLACE FUNCTION musician_delete_sheet(p_code text, p_sheet uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  DELETE FROM sheets WHERE id = p_sheet AND musician_id = v_m.id;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION musician_colleagues(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  RETURN json_build_object('colleagues', coalesce((
    SELECT json_agg(json_build_object('id', id, 'name', name, 'instrument', instrument) ORDER BY name)
    FROM musicians WHERE show_id = v_m.show_id AND id <> v_m.id), '[]'::json));
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
  WHERE t.show_id = v_m.show_id AND t.id <> v_m.id AND t.id = ANY(p_targets);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('ok', true, 'count', v_count);
END $$;

REVOKE ALL ON FUNCTION create_show(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_publish(uuid, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_list_musicians(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_add_musician(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_regenerate_code(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_remove_musician(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_sheets(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_save_sheet(text, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_delete_sheet(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_colleagues(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_share_sheet(text, uuid, uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_show(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_publish(uuid, text, text, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_list_musicians(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_add_musician(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_regenerate_code(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_remove_musician(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_state(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_sheets(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_save_sheet(text, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_delete_sheet(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_colleagues(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_share_sheet(text, uuid, uuid[]) TO anon, authenticated;
