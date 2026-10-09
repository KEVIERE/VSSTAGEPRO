/*
# Histórico de versões publicadas do app Mac

1. What this does
- `app_releases` — one row per manifest ever published to the `app-downloads` bucket
  (version, build number, the full manifest JSON, who published it and when).
  Used by the admin "Versões" tab to list past releases and roll back to any of them.
- `admin_releases_list()` — lists releases, newest first.
- `admin_release_record(version, build, manifest)` — called by the publish/rollback
  edge function (service role) right after it writes `mac/manifest.json`, so every
  publish — whether a forward release or a rollback — leaves a row here.

2. Security
- RLS on, no public policies: only read through `admin_releases_list()` (admin-gated),
  only written by the service role (edge function), never directly by the client.
*/

CREATE TABLE IF NOT EXISTS app_releases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version text NOT NULL,
  build int NOT NULL,
  manifest jsonb NOT NULL,
  published_by uuid REFERENCES auth.users(id),
  published_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS app_releases_published_at_idx ON app_releases (published_at DESC);

CREATE OR REPLACE FUNCTION admin_releases_list(p_limit int DEFAULT 50) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r json;
BEGIN
  PERFORM _require_admin();
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) INTO r FROM (
    SELECT version, build, manifest, published_at,
           (SELECT email FROM auth.users WHERE id = published_by) AS published_by_email
      FROM app_releases
     ORDER BY published_at DESC
     LIMIT greatest(1, least(p_limit, 200))
  ) t;
  RETURN r;
END $$;

REVOKE EXECUTE ON FUNCTION admin_releases_list(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_releases_list(int) TO authenticated;

-- Chamada só pela edge function (service role) depois de publicar o manifest no Storage.
CREATE OR REPLACE FUNCTION admin_release_record(p_version text, p_build int, p_manifest jsonb, p_by uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO app_releases (version, build, manifest, published_by) VALUES (p_version, p_build, p_manifest, p_by)
$$;

REVOKE EXECUTE ON FUNCTION admin_release_record(text, int, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_release_record(text, int, jsonb, uuid) TO service_role;
