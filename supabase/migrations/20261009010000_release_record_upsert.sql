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
