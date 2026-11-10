/*
# Desconectar músico do Show Online

O diretor derruba o músico agora sem tirar ele da lista do show. O aparelho que estava dentro
recebe "disconnected" na próxima consulta e precisa entrar de novo (código pessoal ou conta).
Bloquear e Remover continuam como estão.

1. Modified Tables
- `musicians`
  - `kicked_at` (timestamptz, nullable): hora do último "Desconectar" do diretor.

2. New Functions
- `director_disconnect_musician(p_show, p_key, p_musician)`: exige a chave do diretor; marca a
  hora e apaga o "online" do músico.
- `musician_live(p_code, p_since)`: o mesmo estado que `musician_state`, mas responde
  `disconnected` quando o diretor desconectou depois de `p_since` (a hora em que o aparelho
  entrou, pelo relógio do servidor). Sem `p_since` (aparelho entrando agora) entra normal.

3. Security
- Tabelas continuam fechadas (RLS sem políticas). Acesso só pelas funções SECURITY DEFINER.
- A entrada continua por `_musician_by_code` (código pessoal ou conta aprovada).
*/

ALTER TABLE musicians ADD COLUMN IF NOT EXISTS kicked_at timestamptz;

CREATE OR REPLACE FUNCTION director_disconnect_musician(p_show uuid, p_key text, p_musician uuid) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE musicians SET kicked_at = now(), last_seen = NULL WHERE id = p_musician AND show_id = p_show;
  RETURN json_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION musician_live(p_code text, p_since timestamptz) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians; v_s shows;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  IF p_since IS NOT NULL AND v_m.kicked_at IS NOT NULL AND v_m.kicked_at >= p_since THEN
    -- a consulta acima marcou "online"; o aparelho derrubado não conta
    UPDATE musicians SET last_seen = NULL WHERE id = v_m.id;
    RETURN json_build_object('error', 'disconnected');
  END IF;
  SELECT * INTO v_s FROM shows WHERE id = v_m.show_id;
  RETURN json_build_object(
    'musician', json_build_object('id', v_m.id, 'name', v_m.name, 'instrument', v_m.instrument),
    'show', json_build_object('name', v_s.name, 'setlist', v_s.setlist, 'live', v_s.live, 'live_at', v_s.live_at),
    'server_now', now()
  );
END $$;

REVOKE ALL ON FUNCTION director_disconnect_musician(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION musician_live(text, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION director_disconnect_musician(uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION musician_live(text, timestamptz) TO anon, authenticated;
