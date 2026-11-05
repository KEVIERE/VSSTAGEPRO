/*
# Corrige duplicação no histórico de versões

1. Problem
- `admin_release_record` sempre fazia INSERT, então cada clique em "Tornar
  obrigatória/opcional" (toggle) ou "Reverter para esta" criava uma nova linha em
  `app_releases` com a MESMA versão/build, em vez de atualizar a existente.
  A aba "Versões" decide qual é a "ATIVA" comparando versão+build com a linha mais
  recente — com várias linhas iguais, várias apareciam marcadas como ativa ao mesmo
  tempo (ou a lista enchia de repetições).

2. Fix
- Troca para UPSERT: uma linha por (version, build). Se já existe, atualiza o
  manifest/publicado-por/data em vez de inserir outra.
*/

-- A tabela já tem linhas repetidas (é o próprio problema acima). A regra de linha única
-- não entra com duplicatas, então fica só a linha mais recente de cada versão+build.
DELETE FROM app_releases a
USING app_releases b
WHERE a.version = b.version
  AND a.build = b.build
  AND (a.published_at, a.id) < (b.published_at, b.id);

ALTER TABLE app_releases DROP CONSTRAINT IF EXISTS app_releases_version_build_key;
ALTER TABLE app_releases ADD CONSTRAINT app_releases_version_build_key UNIQUE (version, build);

CREATE OR REPLACE FUNCTION admin_release_record(p_version text, p_build int, p_manifest jsonb, p_by uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO app_releases (version, build, manifest, published_by, published_at)
  VALUES (p_version, p_build, p_manifest, p_by, now())
  ON CONFLICT (version, build) DO UPDATE
    SET manifest = excluded.manifest,
        published_by = excluded.published_by,
        published_at = excluded.published_at
$$;
