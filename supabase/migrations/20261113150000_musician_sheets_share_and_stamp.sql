/*
# Cadernos da Área do Músico (Show Online): envio sem apagar o caderno do colega, consulta leve
# de cadernos novos e caderno sem duplicar

1. Modified Tables
- `sheets`
  - `received_at` (timestamptz, pode ser nulo): hora em que a cópia chegou de um colega. Igual a
    `updated_at` quer dizer cópia em que o músico não mexeu; qualquer gravação dele
    (`musician_save_sheet`) muda `updated_at` e o caderno passa a ser trabalho dele.
  - Cópias que já existiam e nunca foram editadas (`updated_at = created_at`: os dois saem do
    mesmo INSERT do envio) ganham `received_at = updated_at`. As editadas ficam protegidas.

2. Modified Functions
- `musician_share_sheet`: antes cada envio criava mais uma cópia, e a cópia nova (a mais
  recente) tomava o lugar do caderno do colega na tela; a próxima edição dele gravava por cima do
  caderno antigo. Agora, para cada colega aprovado:
  - já tem caderno desta música feito por ele, ou cópia em que mexeu: fica como está e o id dele
    volta em `skipped`;
  - só tem cópia recebida e nunca editada: troca o conteúdo da mais recente;
  - não tem nada: cria a cópia.
  Responde `count` (quantos receberam) e `skipped` (ids de quem ficou com o dele).
- `musician_save_sheet` (a versão de 1,5 MB): sem `p_sheet` (caderno feito sem conexão ou no
  outro aparelho), grava no caderno desta música que o músico já tem, em vez de criar outro.

3. New Functions
- `musician_sheets_stamp(p_code)`: quantos cadernos o músico tem e a hora do mais recente. A Área
  do Músico confere isso a cada 10 s e só baixa a lista inteira (com as fotos) quando muda.

4. Security
- Todas SECURITY DEFINER, com a entrada por `_musician_by_code` (código pessoal ou conta
  aprovada). Tabelas continuam fechadas (RLS sem políticas).

5. Notes
- Aplicar com o upgrade de produção, antes de publicar o site (banco, funções, site). O site
  funciona com e sem esta migração: sem `skipped` ninguém aparece como pulado, e sem
  `musician_sheets_stamp` a lista segue como antes.
*/

ALTER TABLE sheets ADD COLUMN IF NOT EXISTS received_at timestamptz;

UPDATE sheets SET received_at = updated_at
WHERE shared_from IS NOT NULL AND received_at IS NULL AND updated_at = created_at;

CREATE OR REPLACE FUNCTION musician_share_sheet(p_code text, p_sheet uuid, p_targets uuid[]) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_m musicians;
  v_sheet sheets;
  v_from text;
  v_target uuid;
  v_copy uuid;
  v_ok int := 0;
  v_skipped uuid[] := '{}';
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  SELECT * INTO v_sheet FROM sheets WHERE id = p_sheet AND musician_id = v_m.id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;
  IF coalesce(array_length(p_targets, 1), 0) > 60 THEN RETURN json_build_object('error', 'limit'); END IF;
  v_from := left(v_m.name || CASE WHEN v_m.instrument <> '' THEN ', ' || v_m.instrument ELSE '' END, 120);

  FOR v_target IN
    SELECT t.id FROM musicians t
    WHERE t.show_id = v_m.show_id AND t.id <> v_m.id AND t.status = 'approved' AND t.id = ANY(p_targets)
  LOOP
    -- trabalho do colega nesta música (caderno dele, cópia em que mexeu ou cópia sem a hora da
    -- chegada): não mexe
    IF EXISTS (
      SELECT 1 FROM sheets s
      WHERE s.musician_id = v_target AND s.song_id = v_sheet.song_id
        AND (s.shared_from IS NULL OR s.received_at IS NULL OR s.received_at <> s.updated_at)
    ) THEN
      v_skipped := v_skipped || v_target;
      CONTINUE;
    END IF;
    -- só cópias recebidas e nunca editadas: troca a mais recente (é a que aparece na tela dele)
    SELECT s.id INTO v_copy FROM sheets s
    WHERE s.musician_id = v_target AND s.song_id = v_sheet.song_id
    ORDER BY s.updated_at DESC
    LIMIT 1;
    IF v_copy IS NOT NULL THEN
      UPDATE sheets
      SET title = v_sheet.title, content = v_sheet.content, shared_from = v_from, received_at = now(), updated_at = now()
      WHERE id = v_copy;
    ELSE
      INSERT INTO sheets(show_id, musician_id, song_id, title, content, shared_from, received_at, updated_at)
      VALUES (v_m.show_id, v_target, v_sheet.song_id, v_sheet.title, v_sheet.content, v_from, now(), now());
    END IF;
    v_ok := v_ok + 1;
  END LOOP;

  RETURN json_build_object('ok', true, 'count', v_ok, 'skipped', to_json(v_skipped));
END $$;

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
    -- sem id (feito sem conexão ou no outro aparelho): o caderno desta música que ele já tem
    SELECT id INTO v_id FROM sheets
    WHERE musician_id = v_m.id AND song_id = left(p_song_id, 120) AND shared_from IS NULL
    ORDER BY updated_at DESC
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE sheets SET title = left(coalesce(p_title, ''), 120), content = coalesce(p_content, ''), updated_at = now()
      WHERE id = v_id;
    ELSE
      IF (SELECT count(*) FROM sheets WHERE musician_id = v_m.id) >= 500 THEN RETURN json_build_object('error', 'limit'); END IF;
      INSERT INTO sheets(show_id, musician_id, song_id, title, content)
      VALUES (v_m.show_id, v_m.id, left(p_song_id, 120), left(coalesce(p_title, ''), 120), coalesce(p_content, ''))
      RETURNING id INTO v_id;
    END IF;
  ELSE
    UPDATE sheets SET title = left(coalesce(p_title, ''), 120), content = coalesce(p_content, ''), updated_at = now()
    WHERE id = p_sheet AND musician_id = v_m.id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RETURN json_build_object('error', 'not_found'); END IF;
  END IF;
  RETURN json_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION musician_sheets_stamp(p_code text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_m musicians;
BEGIN
  v_m := _musician_by_code(p_code);
  IF v_m.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;
  RETURN (SELECT json_build_object('n', count(*), 'at', max(updated_at)) FROM sheets WHERE musician_id = v_m.id);
END $$;

REVOKE ALL ON FUNCTION musician_sheets_stamp(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION musician_sheets_stamp(text) TO anon, authenticated;
