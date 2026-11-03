/*
# Foto de perfil do músico

1. Modified Tables
- `musicians`
  - `avatar` (text, nullable): foto pequena em JPEG (data URL), no máximo 16 000 caracteres (~12 KB).
    Quem tem conta: a foto vale para todos os shows da conta.

2. New Functions
- `musician_avatar(p_code)`: a foto do próprio músico. Lida uma vez ao entrar na Área do Músico.
- `musician_set_avatar(p_code, p_avatar)`: troca a foto (ou apaga, com null).
- `director_musician_avatars(p_show, p_key)`: as fotos dos músicos do show, para o programa do diretor.
  Lida quando a janela do Show online abre; fica fora da lista que o programa consulta a cada 5 segundos,
  para não aumentar o tráfego.

3. Security
- Tabelas continuam fechadas (RLS sem políticas); acesso só por estas funções SECURITY DEFINER.
- Músico: só mexe na própria foto (código pessoal ou conta aprovada, via `_musician_by_code`).
- Diretor: só lê fotos do próprio show (chave do diretor, via `_director_ok`).
*/

ALTER TABLE musicians ADD COLUMN IF NOT EXISTS avatar text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'musicians_avatar_check') THEN
    ALTER TABLE musicians ADD CONSTRAINT musicians_avatar_check
      CHECK (avatar IS NULL OR (length(avatar) <= 16000 AND avatar LIKE 'data:image/jpeg;base64,%'));
  END IF;
END $$;

-- foto de uma linha: a dela ou, para quem tem conta, a de outro show da mesma conta
CREATE OR REPLACE FUNCTION _musician_avatar_of(p_row musicians) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT coalesce(p_row.avatar, (
    SELECT a.avatar FROM musicians a
    WHERE p_row.user_id IS NOT NULL AND a.user_id = p_row.user_id AND a.avatar IS NOT NULL
    LIMIT 1
  ));
$$;

CREATE OR REPLACE FUNCTION musician_avatar(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  RETURN json_build_object('avatar', _musician_avatar_of(v_m));
END $$;

CREATE OR REPLACE FUNCTION musician_set_avatar(p_code text, p_avatar text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_m musicians;
  v_avatar text := nullif(p_avatar, '');
BEGIN
  IF v_avatar IS NOT NULL AND (length(v_avatar) > 16000 OR v_avatar NOT LIKE 'data:image/jpeg;base64,%') THEN
    RETURN json_build_object('error', 'invalid_avatar');
  END IF;
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  IF v_m.user_id IS NOT NULL THEN
    UPDATE musicians SET avatar = v_avatar WHERE user_id = v_m.user_id;
  ELSE
    UPDATE musicians SET avatar = v_avatar WHERE id = v_m.id;
  END IF;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION director_musician_avatars(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  RETURN json_build_object('avatars', coalesce((
    SELECT json_object_agg(m.id, x.avatar)
    FROM musicians m
    CROSS JOIN LATERAL (SELECT _musician_avatar_of(m) AS avatar) x
    WHERE m.show_id = p_show AND x.avatar IS NOT NULL
  ), '{}'::json));
END $$;

REVOKE ALL ON FUNCTION _musician_avatar_of(musicians) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION musician_avatar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_set_avatar(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_musician_avatars(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION musician_avatar(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_set_avatar(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_musician_avatars(uuid, text) TO anon, authenticated;
