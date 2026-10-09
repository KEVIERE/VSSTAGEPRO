/* Release notifications and update policy.
   release_events intentionally contains no customer/admin data and is readable by
   installed clients so Supabase Realtime can notify every open desktop app. */
CREATE TABLE IF NOT EXISTS release_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version text NOT NULL,
  build int NOT NULL,
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE release_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_events_read ON release_events;
CREATE POLICY release_events_read ON release_events FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION notify_release_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO release_events (version, build, required)
  VALUES (NEW.version, NEW.build, coalesce((NEW.manifest->>'required')::boolean, false));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS app_releases_notify ON app_releases;
CREATE TRIGGER app_releases_notify AFTER INSERT ON app_releases
FOR EACH ROW EXECUTE FUNCTION notify_release_event();

ALTER TABLE release_events REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.release_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
