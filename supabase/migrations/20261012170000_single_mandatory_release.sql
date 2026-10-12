-- Garante que apenas a versão ativa mais recente possa ter obrigatoriedade.
-- Versões antigas no histórico não devem reter flag required=true.

-- 1. Limpa obrigatoriedade de versões antigas existentes
WITH latest AS (
  SELECT id FROM app_releases ORDER BY published_at DESC LIMIT 1
)
UPDATE app_releases
   SET manifest = jsonb_set(manifest, '{required}', 'false'::jsonb)
 WHERE id NOT IN (SELECT id FROM latest)
   AND (manifest->>'required')::boolean = true;

-- 2. Atualiza admin_release_record para desmarcar obrigatoriedade de versões anteriores
-- sempre que uma versão for salva com required = true.
CREATE OR REPLACE FUNCTION admin_release_record(p_version text, p_build int, p_manifest jsonb, p_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Se esta versão estiver sendo definida como obrigatória, remove a obrigatoriedade de todas as outras
  IF coalesce((p_manifest->>'required')::boolean, false) = true THEN
    UPDATE app_releases
       SET manifest = jsonb_set(manifest, '{required}', 'false'::jsonb)
     WHERE (version != p_version OR build != p_build)
       AND coalesce((manifest->>'required')::boolean, false) = true;
  END IF;

  INSERT INTO app_releases (version, build, manifest, published_by, published_at)
  VALUES (p_version, p_build, p_manifest, p_by, now())
  ON CONFLICT (version, build) DO UPDATE
    SET manifest = excluded.manifest,
        published_by = excluded.published_by,
        published_at = excluded.published_at;
END $$;
