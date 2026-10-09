/*
# Musician accounts with permanent director approval

1. Modified Tables
- `shows`
  - `invite_code` (text, unique): one invite code per show, shared with the whole band.
  - `allow_code_login` (boolean, default true): director can switch off the old personal-code entry.
- `musicians`
  - `user_id` (uuid, nullable, fk auth.users): the account linked to this band member.
  - `status` (text, default 'approved'): 'pending' (waiting for director), 'approved', 'blocked'.
    Existing members stay approved.
  - unique (show_id, user_id): one membership per account per show.

2. Security
- Tables remain closed to clients (RLS on, no policies). All access via SECURITY DEFINER functions.
- `_musician_by_code` now accepts either a personal code or "acct:<membership id>".
  The account form only resolves when the membership belongs to auth.uid() and is approved.
  Personal codes only work for approved members and when the show allows code login.
- New member_* functions require a signed-in account (auth.uid()); members can never set their own status.
- New director_* functions (invite, approve/block, code-login switch) require the director key.

3. Notes
1. One account can belong to several shows (one membership row per show).
2. Claiming an old code links that membership (and its sheets) to the account.
3. Join attempts with wrong invite codes count toward the same guess-blocking limit.
*/

ALTER TABLE shows ADD COLUMN IF NOT EXISTS invite_code text;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS allow_code_login boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS shows_invite_code_key ON shows(invite_code);

ALTER TABLE musicians ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE musicians ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'musicians_status_check') THEN
    ALTER TABLE musicians ADD CONSTRAINT musicians_status_check CHECK (status IN ('pending', 'approved', 'blocked'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS musicians_show_user_key ON musicians(show_id, user_id);
CREATE INDEX IF NOT EXISTS musicians_user_idx ON musicians(user_id);

CREATE OR REPLACE FUNCTION _new_show_invite() RETURNS text
LANGUAGE plpgsql SET search_path = public, extensions AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  result text;
  i int;
BEGIN
  LOOP
    bytes := gen_random_bytes(10);
    result := '';
    FOR i IN 0..9 LOOP
      result := result || substr(alphabet, (get_byte(bytes, i) % 31) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM shows WHERE invite_code = result);
  END LOOP;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION _client_addr() RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, extensions AS $$
DECLARE v text;
BEGIN
  v := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  IF coalesce(v, '') = '' THEN v := 'unknown'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION _too_many_attempts(p_client text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT (SELECT count(*) FROM code_attempts
          WHERE client = p_client AND attempted_at > now() - interval '10 minutes') >= 15;
$$;

CREATE OR REPLACE FUNCTION _record_attempt(p_client text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  INSERT INTO code_attempts(client) VALUES (p_client);
  DELETE FROM code_attempts WHERE attempted_at < now() - interval '1 day';
$$;

CREATE OR REPLACE FUNCTION _musician_by_code(p_code text) RETURNS musicians
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_client text := _client_addr();
  v_norm text;
  v_row musicians;
  v_member uuid;
BEGIN
  IF coalesce(p_code, '') LIKE 'acct:%' THEN
    IF auth.uid() IS NULL THEN RETURN NULL; END IF;
    BEGIN
      v_member := substr(p_code, 6)::uuid;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    SELECT * INTO v_row FROM musicians
    WHERE id = v_member AND user_id = auth.uid() AND status = 'approved';
    IF NOT FOUND THEN RETURN NULL; END IF;
  ELSE
    v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
    IF _too_many_attempts(v_client) THEN RAISE EXCEPTION 'too_many_attempts'; END IF;
    SELECT m.* INTO v_row FROM musicians m JOIN shows s ON s.id = m.show_id
    WHERE m.code = v_norm AND m.status = 'approved' AND s.allow_code_login;
    IF NOT FOUND THEN
      PERFORM _record_attempt(v_client);
      RETURN NULL;
    END IF;
  END IF;

  IF v_row.last_seen IS NULL OR v_row.last_seen < now() - interval '10 seconds' THEN
    UPDATE musicians SET last_seen = now() WHERE id = v_row.id;
  END IF;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION _new_show_invite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _client_addr() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _too_many_attempts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _record_attempt(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _musician_by_code(text) FROM PUBLIC, anon, authenticated;

-- director: list now includes status and account info
CREATE OR REPLACE FUNCTION director_list_musicians(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  RETURN json_build_object('musicians', coalesce((
    SELECT json_agg(json_build_object(
      'id', id, 'name', name, 'instrument', instrument, 'code', code,
      'status', status, 'has_account', user_id IS NOT NULL, 'created_at', created_at,
      'online', last_seen IS NOT NULL AND last_seen > now() - interval '30 seconds'
    ) ORDER BY created_at)
    FROM musicians WHERE show_id = p_show), '[]'::json));
END $$;

CREATE OR REPLACE FUNCTION director_invite(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE shows SET invite_code = _new_show_invite() WHERE id = p_show AND invite_code IS NULL;
  SELECT * INTO v_s FROM shows WHERE id = p_show;
  RETURN json_build_object('invite_code', v_s.invite_code, 'allow_code_login', v_s.allow_code_login);
END $$;

CREATE OR REPLACE FUNCTION director_reset_invite(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE shows SET invite_code = _new_show_invite() WHERE id = p_show;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_set_code_login(p_show uuid, p_key text, p_allow boolean) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE shows SET allow_code_login = coalesce(p_allow, true) WHERE id = p_show;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_set_status(p_show uuid, p_key text, p_musician uuid, p_status text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF p_status NOT IN ('approved', 'blocked') THEN RETURN json_build_object('error', 'invalid_input'); END IF;
  UPDATE musicians SET status = p_status, last_seen = CASE WHEN p_status = 'blocked' THEN NULL ELSE last_seen END
  WHERE id = p_musician AND show_id = p_show;
  RETURN json_build_object('ok', true);
END $$;

-- member (signed-in account) functions
CREATE OR REPLACE FUNCTION member_memberships() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_signed_in'); END IF;
  RETURN json_build_object('memberships', coalesce((
    SELECT json_agg(json_build_object(
      'id', m.id, 'show_name', s.name, 'status', m.status, 'name', m.name, 'instrument', m.instrument
    ) ORDER BY m.created_at DESC)
    FROM musicians m JOIN shows s ON s.id = m.show_id
    WHERE m.user_id = auth.uid()), '[]'::json));
END $$;

CREATE OR REPLACE FUNCTION member_join(p_invite text, p_name text, p_instrument text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_client text := _client_addr();
  v_norm text := upper(regexp_replace(coalesce(p_invite, ''), '[^A-Za-z0-9]', '', 'g'));
  v_show shows;
  v_existing musicians;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_signed_in'); END IF;
  IF coalesce(trim(p_name), '') = '' THEN RETURN json_build_object('error', 'name_required'); END IF;
  IF _too_many_attempts(v_client) THEN RETURN json_build_object('error', 'too_many_attempts'); END IF;

  SELECT * INTO v_show FROM shows WHERE invite_code = v_norm;
  IF NOT FOUND THEN
    PERFORM _record_attempt(v_client);
    RETURN json_build_object('error', 'invalid_invite');
  END IF;

  SELECT * INTO v_existing FROM musicians WHERE show_id = v_show.id AND user_id = auth.uid();
  IF FOUND THEN
    RETURN json_build_object('ok', true, 'id', v_existing.id, 'status', v_existing.status);
  END IF;

  IF (SELECT count(*) FROM musicians WHERE show_id = v_show.id) >= 60
     OR (SELECT count(*) FROM musicians WHERE show_id = v_show.id AND status = 'pending') >= 30 THEN
    RETURN json_build_object('error', 'limit');
  END IF;

  INSERT INTO musicians(show_id, name, instrument, code, user_id, status)
  VALUES (v_show.id, left(trim(p_name), 60), left(trim(coalesce(p_instrument, '')), 40),
          _new_musician_code(), auth.uid(), 'pending')
  RETURNING id INTO v_id;
  RETURN json_build_object('ok', true, 'id', v_id, 'status', 'pending');
END $$;

CREATE OR REPLACE FUNCTION member_claim_code(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_signed_in'); END IF;
  IF coalesce(p_code, '') LIKE 'acct:%' THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  IF v_m.user_id = auth.uid() THEN RETURN json_build_object('ok', true, 'id', v_m.id); END IF;
  IF v_m.user_id IS NOT NULL THEN RETURN json_build_object('error', 'already_claimed'); END IF;
  IF EXISTS (SELECT 1 FROM musicians WHERE show_id = v_m.show_id AND user_id = auth.uid()) THEN
    RETURN json_build_object('error', 'already_member');
  END IF;
  UPDATE musicians SET user_id = auth.uid() WHERE id = v_m.id;
  RETURN json_build_object('ok', true, 'id', v_m.id);
END $$;

CREATE OR REPLACE FUNCTION member_update_profile(p_name text, p_instrument text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('error', 'not_signed_in'); END IF;
  IF coalesce(trim(p_name), '') = '' THEN RETURN json_build_object('error', 'name_required'); END IF;
  UPDATE musicians SET name = left(trim(p_name), 60), instrument = left(trim(coalesce(p_instrument, '')), 40)
  WHERE user_id = auth.uid();
  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION director_list_musicians(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_invite(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_reset_invite(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_set_code_login(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_set_status(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION member_memberships() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION member_join(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION member_claim_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION member_update_profile(text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION director_list_musicians(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_invite(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_reset_invite(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_set_code_login(uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_set_status(uuid, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION member_memberships() TO authenticated;
GRANT EXECUTE ON FUNCTION member_join(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION member_claim_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION member_update_profile(text, text) TO authenticated;
