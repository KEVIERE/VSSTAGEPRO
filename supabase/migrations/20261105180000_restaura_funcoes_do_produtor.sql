/*
# Restaura as funções do produtor que a transferência de conta não trouxe

1. Problema
- Na migração do projeto `xfpkftewsxaxycdwwnnv` para `eknjqqiamuztomdygalv` vieram os arquivos
  de migração, mas não vieram os objetos criados direto no painel do Supabase.
- Faltam no banco em uso:
  - `shows.producer_code` e `shows.screen_code` (colunas que o programa padrão publicado lê);
  - a tabela `lyrics` (o mapa de letras que o painel do produtor devolve);
  - `_show_by_access`, da qual `producer_state`, `producer_set_prompter`,
    `producer_request_lyrics_save` e `producer_request_repertoire` dependem;
  - `screen_state`, `producer_save_lyrics`, `director_prompter_codes` e
    `director_reset_prompter_codes`.
- Efeito: a Área do Produtor inteira não carrega nem salva (avisos prontos, logo, tempo de show,
  espelhar, tela preta), e a tela do palco não abre.

2. O que esta migração faz
- Cria as duas colunas de código em `shows`, com índice único, e preenche os shows existentes.
- Cria a tabela `lyrics`, no formato que `producer_state` e `director_lyrics_restore` esperam.
- Recria `_show_by_access(p_code, p_role)` seguindo o mesmo desenho de `_musician_by_code`,
  que já roda no banco: normaliza o código, confere `allow_code_login`, aplica o limitador de
  tentativas (`_client_addr`, `_record_attempt`, `_too_many_attempts`) e atualiza `last_seen`
  quando faz sentido.
- Recria as cinco funções que faltam, todas SECURITY DEFINER e validadas por código de acesso
  ou pela chave do diretor, como as demais do projeto.

3. Decisão de gravação das letras (importante)
- `prompters.lyrics` é a fonte que a tela do palco (`prompter_screen_state`) e o músico
  (`musician_song_lyrics`) leem. A tabela `lyrics` é a que o painel do produtor devolve e o
  diretor usa para restaurar o projeto.
- `producer_save_lyrics` grava **nos dois lugares**, do mesmo jeito que `producer_set_prompter`
  já grava em `shows.prompter` e em `prompters.display`. Assim as duas pontas veem o mesmo.

4. Segurança
- Nenhuma política de RLS é alterada. As tabelas novas ficam com RLS ligado e sem política,
  então só as funções SECURITY DEFINER chegam nelas.
- `_show_by_access` é interna: sem permissão para anon/authenticated.
- Códigos são gerados com `gen_random_bytes`, com verificação de colisão, como `_new_musician_code`.

5. O que NÃO muda
- `producer_state`, `producer_set_prompter`, `producer_request_lyrics_save` e
  `producer_request_repertoire` não são recriadas: elas já existem no banco e passam a funcionar
  assim que `_show_by_access` existir.
*/

-- ─── Códigos de acesso do produtor e da tela ─────────────────────────────────

ALTER TABLE shows ADD COLUMN IF NOT EXISTS producer_code text;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS screen_code text;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS last_seen timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS shows_producer_code_idx ON shows (producer_code) WHERE producer_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS shows_screen_code_idx ON shows (screen_code) WHERE screen_code IS NOT NULL;

-- Gerador de código de 10 caracteres, no mesmo alfabeto de `_new_show_invite`
-- (sem I, L, O e 0, para não confundir na leitura em voz alta no palco).
CREATE OR REPLACE FUNCTION _new_access_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
    EXIT WHEN NOT EXISTS (SELECT 1 FROM shows WHERE producer_code = result OR screen_code = result);
  END LOOP;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION _new_access_code() FROM PUBLIC, anon, authenticated;

-- Preenche os shows que já existem, para ninguém ficar sem código.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM shows WHERE producer_code IS NULL LOOP
    UPDATE shows SET producer_code = _new_access_code() WHERE id = v_id;
  END LOOP;
  FOR v_id IN SELECT id FROM shows WHERE screen_code IS NULL LOOP
    UPDATE shows SET screen_code = _new_access_code() WHERE id = v_id;
  END LOOP;
END $$;

-- ─── Mapa de letras guardado no projeto ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS lyrics (
  show_id uuid NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  song_id text NOT NULL,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (show_id, song_id)
);

CREATE INDEX IF NOT EXISTS lyrics_show_idx ON lyrics (show_id);

ALTER TABLE lyrics ENABLE ROW LEVEL SECURITY;

-- ─── Quem está do outro lado do código ───────────────────────────────────────

/*
`p_role` aceita 'producer' ou 'screen'. Hoje o programa chama sempre com 'producer'; o outro
valor fica pronto para a tela do palco usar o mesmo caminho.
*/
CREATE OR REPLACE FUNCTION _show_by_access(p_code text, p_role text) RETURNS shows
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_client text := _client_addr();
  v_norm text;
  v_s shows;
BEGIN
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  IF v_norm = '' THEN RETURN NULL; END IF;

  IF _too_many_attempts(v_client) THEN RAISE EXCEPTION 'too_many_attempts'; END IF;

  IF p_role = 'screen' THEN
    SELECT s.* INTO v_s FROM shows s
    WHERE s.screen_code = v_norm AND s.allow_code_login;
  ELSE
    SELECT s.* INTO v_s FROM shows s
    WHERE s.producer_code = v_norm AND s.allow_code_login;
  END IF;

  IF NOT FOUND THEN
    PERFORM _record_attempt(v_client);
    RETURN NULL;
  END IF;

  -- Mesmo carimbo de presença usado pelos músicos, sem escrever a cada consulta.
  IF v_s.last_seen IS NULL OR v_s.last_seen < now() - interval '10 seconds' THEN
    UPDATE shows SET last_seen = now() WHERE id = v_s.id;
  END IF;

  RETURN v_s;
END $$;

REVOKE ALL ON FUNCTION _show_by_access(text, text) FROM PUBLIC, anon, authenticated;

-- ─── Estado da tela do palco pelo código da tela ─────────────────────────────

/*
O programa chama `screen_state` (e não `prompter_screen_state`, que é a versão antiga por chave
privada). Devolve o mesmo formato de `producer_state`, para a tela reaproveitar a leitura.
*/
CREATE OR REPLACE FUNCTION screen_state(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'screen');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_screen'); END IF;
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

REVOKE ALL ON FUNCTION screen_state(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION screen_state(text) TO anon, authenticated;

-- ─── Letras salvas pelo produtor ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION producer_save_lyrics(p_code text, p_song_id text, p_pages jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;

  IF coalesce(p_song_id, '') = '' OR length(p_song_id) > 120
     OR jsonb_typeof(coalesce(p_pages, 'null'::jsonb)) <> 'array'
     OR octet_length(p_pages::text) > 60000 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;

  -- A tela do palco e o músico leem daqui.
  PERFORM _prompter_ensure(v_s.id);
  UPDATE prompters
     SET lyrics = jsonb_set(lyrics, ARRAY[p_song_id], p_pages, true), updated_at = now()
   WHERE show_id = v_s.id;

  IF octet_length((SELECT lyrics::text FROM prompters WHERE show_id = v_s.id)) > 2000000 THEN
    RAISE EXCEPTION 'too_large';
  END IF;

  -- O painel do produtor e a restauração do projeto leem daqui.
  INSERT INTO lyrics (show_id, song_id, pages, updated_at)
  VALUES (v_s.id, left(p_song_id, 120), p_pages, now())
  ON CONFLICT (show_id, song_id) DO UPDATE
    SET pages = excluded.pages, updated_at = now();

  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION producer_save_lyrics(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producer_save_lyrics(text, text, jsonb) TO anon, authenticated;

-- ─── Códigos do produtor e da tela, para o diretor ───────────────────────────

CREATE OR REPLACE FUNCTION director_prompter_codes(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_s FROM shows WHERE id = p_show;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  -- Gera só o que faltar: quem já tem código continua com o mesmo.
  IF v_s.producer_code IS NULL THEN
    UPDATE shows SET producer_code = _new_access_code() WHERE id = p_show;
  END IF;
  IF v_s.screen_code IS NULL THEN
    UPDATE shows SET screen_code = _new_access_code() WHERE id = p_show;
  END IF;

  SELECT * INTO v_s FROM shows WHERE id = p_show;
  RETURN json_build_object('producer_code', v_s.producer_code, 'screen_code', v_s.screen_code);
END $$;

CREATE OR REPLACE FUNCTION director_reset_prompter_codes(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  UPDATE shows
     SET producer_code = _new_access_code(),
         screen_code = _new_access_code()
   WHERE id = p_show;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;
  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION director_prompter_codes(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_reset_prompter_codes(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION director_prompter_codes(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_reset_prompter_codes(uuid, text) TO anon, authenticated;
