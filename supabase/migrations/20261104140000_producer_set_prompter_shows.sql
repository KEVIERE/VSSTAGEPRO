/*
# Avisos prontos: o produtor gravava num lugar e a leitura buscava em outro

1. Problema
- `producer_state` (o que o painel do produtor lê a cada segundo) devolve `v_s.prompter`, isto é,
  a coluna `shows.prompter`.
- `producer_set_prompter`, criada em `20261104090000`, gravava em `prompters.display`, outra
  tabela. O aviso era gravado, mas a leitura seguinte trazia o estado de antes.
- Efeito na tela: o aviso pronto aparecia por ~2,5 s (o escudo de eco de `usePrompterControl`,
  que ignora a cópia do servidor por 2,5 s depois de uma alteração local) e sumia sozinho. O
  mesmo acontecia com tempo de show, espelhar, tela preta e logo no canto.
- Nenhuma migração do repositório criava `shows.prompter`; a coluna existe no banco em uso, feita
  fora do histórico. Esta migração passa a declará-la, para o repositório reproduzir o banco.

2. Mudanças
- `shows.prompter` (jsonb): declarada com IF NOT EXISTS (não mexe no que já existe).
- `producer_set_prompter` grava **nos dois lugares**: em `shows.prompter`, que é onde o painel lê,
  e em `prompters.display`, que é o caminho que a tela do palco usa. Assim as duas pontas veem o
  mesmo estado.
- Limite de tamanho de 8000 para 60000 bytes. Com 8000, cerca de 40 avisos programados já
  estouravam o limite e, a partir daí, *toda* gravação do produtor era recusada pelo banco, sem
  que o painel mostrasse motivo. Medido no pior caso que a própria tela permite (30 avisos
  prontos de 200 caracteres, 20 no histórico, 100 programados): 44 KB. O limite fica acima disso
  com folga.

3. O que NÃO muda
- `producer_state` não é recriada. A versão em uso no banco não está no repositório e
  reescrevê-la pelo arquivo do repositório poderia apagar mudanças feitas fora dele.

4. Segurança
- SECURITY DEFINER, validado pelo código do produtor com o mesmo limitador de tentativas usado em
  `producer_state`. Nenhuma tabela nova e nenhuma política alterada.
*/

ALTER TABLE shows ADD COLUMN IF NOT EXISTS prompter jsonb;

CREATE OR REPLACE FUNCTION producer_set_prompter(p_code text, p_prompter jsonb) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_s shows;
BEGIN
  v_s := _show_by_access(p_code, 'producer');
  IF v_s.id IS NULL THEN RETURN json_build_object('error', 'invalid_code'); END IF;

  IF jsonb_typeof(coalesce(p_prompter, 'null'::jsonb)) <> 'object'
     OR octet_length(p_prompter::text) > 60000 THEN
    RETURN json_build_object('error', 'invalid_input');
  END IF;

  -- onde o painel do produtor lê (era o que faltava)
  UPDATE shows SET prompter = p_prompter WHERE id = v_s.id;
  -- onde a tela do palco lê
  PERFORM _prompter_ensure(v_s.id);
  UPDATE prompters SET display = p_prompter, updated_at = now() WHERE show_id = v_s.id;
  RETURN json_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION producer_set_prompter(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producer_set_prompter(text, jsonb) TO anon, authenticated;
