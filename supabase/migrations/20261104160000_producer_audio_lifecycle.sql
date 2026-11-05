/*
# Ciclo de vida do áudio de referência do produtor

1. Problema
- O áudio de referência (MP3 leve de cada música) só saía do storage quando o diretor apertava
  "OK" no aviso de letras prontas. Enquanto isso ficava ocupando espaço, e bastava reabrir o
  programa para o envio automático notar a pasta vazia e subir tudo de novo.
- O produtor não tinha como pedir o repertório de volta depois de liberado.

2. Mudanças
- `shows.produced_audio_released_at` (timestamptz): quando o produtor salvou as letras no
  projeto. A Edge Function usa essa marca para apagar o áudio com folga curta.
- `shows.repertoire_requested_at` (timestamptz): quando o produtor pediu o repertório de novo.
- `producer_request_lyrics_save`: passa a marcar também `produced_audio_released_at`.
- `producer_request_repertoire(p_code)`: novo pedido do produtor.
- `director_take_repertoire_request(p_show, p_key)`: o programa do diretor pega o pedido (devolve
  o carimbo e apaga a marca, para não repetir o envio a cada consulta).
- `director_repertoire_state(p_show, p_key)`: o diretor lê a marca de liberação, para saber se o
  envio automático deve ficar quieto.

3. Segurança
- SECURITY DEFINER, validadas pelo código do produtor (com o limitador de tentativas) ou pela
  chave do diretor. Nenhuma tabela nova e nenhuma política alterada.
*/

ALTER TABLE shows ADD COLUMN IF NOT EXISTS produced_audio_released_at timestamptz;
ALTER TABLE shows ADD COLUMN IF NOT EXISTS repertoire_requested_at timestamptz;

CREATE OR REPLACE FUNCTION producer_request_lyrics_save(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  -- O aviso de letras prontas e a marca que libera o áudio de referência andam juntos:
  -- foi o produtor quem disse "terminei de escrever".
  UPDATE shows
     SET lyrics_save_requested_at = now(),
         produced_audio_released_at = now()
   WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'requested_at', now());
END $$;

CREATE OR REPLACE FUNCTION producer_request_repertoire(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  -- Pedir o repertório também desfaz a liberação: o áudio vai voltar ao storage.
  UPDATE shows
     SET repertoire_requested_at = now(),
         produced_audio_released_at = NULL
   WHERE id = v_s.id;
  RETURN json_build_object('ok', true, 'requested_at', now());
END $$;

CREATE OR REPLACE FUNCTION director_take_repertoire_request(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_at timestamptz;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  SELECT repertoire_requested_at INTO v_at FROM shows WHERE id = p_show;
  IF v_at IS NULL THEN RETURN json_build_object('requested_at', NULL); END IF;
  -- devolve e apaga: o programa age uma vez só por pedido
  UPDATE shows SET repertoire_requested_at = NULL WHERE id = p_show;
  RETURN json_build_object('requested_at', v_at);
END $$;

CREATE OR REPLACE FUNCTION director_repertoire_state(p_show uuid, p_key text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  IF NOT _director_ok(p_show, p_key) THEN RETURN json_build_object('error', 'forbidden'); END IF;
  SELECT * INTO v_s FROM shows WHERE id = p_show;
  RETURN json_build_object(
    'released_at', v_s.produced_audio_released_at,
    'requested_at', v_s.repertoire_requested_at
  );
END $$;

REVOKE ALL ON FUNCTION producer_request_lyrics_save(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION producer_request_repertoire(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_take_repertoire_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION director_repertoire_state(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producer_request_lyrics_save(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION producer_request_repertoire(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_take_repertoire_request(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION director_repertoire_state(uuid, text) TO anon, authenticated;
