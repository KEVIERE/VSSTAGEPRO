/*
# O produtor grava o que aparece na TV

1. Problema
- O app do produtor chama `producer_set_prompter` a cada mudança de tela
  (`src/lib/prompterApi.ts`, usado por `usePrompterControl`). Essa função nunca existiu no banco.
- Sem ela, nada do que o produtor altera chega à TV: avisos prontos, tempo de show, logo no
  canto, espelhar, tela preta. Na prática o painel só servia para ler o estado.
- O diretor grava por `director_prompter_set_display`, mas exige a chave do diretor, que o
  produtor técnico não tem.

2. New Function
- `producer_set_prompter(p_code, p_prompter)`: grava o estado do display do show do produtor.
  Valida pelo código do produtor com o mesmo limitador de tentativas usado em `producer_state`.

3. Security
- SECURITY DEFINER, mesmo padrão das outras funções do teleprompter.
- Não cria tabela nem mexe em política. Só escreve a coluna `prompters.display` do show cujo
  código de produtor bate.
- Limite de 8000 bytes, igual ao `director_prompter_set_display`, para não aceitar lixo.
*/

CREATE OR REPLACE FUNCTION producer_set_prompter(p_code text, p_prompter jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;

  IF jsonb_typeof(coalesce(p_prompter, 'null'::jsonb)) <> 'object'
     OR octet_length(p_prompter::text) > 8000 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;

  PERFORM _prompter_ensure(v_s.id);
  UPDATE prompters SET display = p_prompter, updated_at = now() WHERE show_id = v_s.id;
  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION producer_set_prompter(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producer_set_prompter(text, jsonb) TO anon, authenticated;
