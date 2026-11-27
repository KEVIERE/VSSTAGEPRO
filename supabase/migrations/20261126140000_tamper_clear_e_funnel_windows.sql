/*
  # Limpar histórico de crack + funil com Windows

  1. admin_tamper_clear(): apaga os registros de crack/anomalia (heartbeats marcados
     como tampered ou com motivo) mantendo os Macs bloqueados intocados. Só admin.
  2. admin_funnel(): passa a contar quem abriu o programa por plataforma. O heartbeat
     manda arch ('arm64'/'x64' no Mac; no Windows o Electron manda 'x64' também, então
     a plataforma vem do user agent interno: arm64/x64 com SO darwin = Mac Intel/Apple
     Silicon; win32 = Windows. Como o banco não tem o SO, o app passa a mandar a
     coluna "os" ("mac" | "win"); migração compatível: usa "os" se vier, senão conta
     tudo como Mac (comportamento de antes).
     - win10/win11: contados pelo campo "osVersion" ("10" | "11") mandado pelo app.
*/

CREATE OR REPLACE FUNCTION admin_tamper_clear() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_deleted int;
BEGIN
  PERFORM _require_admin();
  DELETE FROM app_heartbeats
  WHERE tampered = true OR reason IS NOT NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  PERFORM _audit('clear_tamper_history', NULL, json_build_object('deleted', v_deleted)::jsonb);
  RETURN v_deleted;
END $$;

REVOKE EXECUTE ON FUNCTION admin_tamper_clear() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_tamper_clear() TO service_role;

-- Colunas novas do heartbeat: sistema operacional e versão do Windows (opcionais)
ALTER TABLE app_heartbeats ADD COLUMN IF NOT EXISTS os text;
ALTER TABLE app_heartbeats ADD COLUMN IF NOT EXISTS os_version text;

-- Funil: macs abrindo, Windows 10 e Windows 11 abrindo (contas distintas, últimos N dias)
CREATE OR REPLACE FUNCTION admin_funnel(p_days int DEFAULT 30) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_signups int;
  v_confirmed int;
  v_app_opened int;
  v_stage_used int;
  v_subscribed int;
  v_mac int;
  v_win10 int;
  v_win11 int;
BEGIN
  PERFORM _require_admin();

  SELECT count(*) INTO v_signups
  FROM auth.users WHERE created_at >= v_since;

  SELECT count(*) INTO v_confirmed
  FROM auth.users WHERE created_at >= v_since AND email_confirmed_at IS NOT NULL;

  SELECT count(DISTINCT user_id) INTO v_app_opened
  FROM feature_usage
  WHERE created_at >= v_since AND feature = 'app_open';

  SELECT count(DISTINCT user_id) INTO v_stage_used
  FROM feature_usage
  WHERE created_at >= v_since AND feature IN ('play', 'show_mode', 'mixer', 'local_network', 'broadcast');

  SELECT count(DISTINCT user_id) INTO v_subscribed
  FROM completed_sales
  WHERE created_at >= v_since;

  -- Quem abriu o programa por plataforma: o heartbeat só é enviado pelo programa aberto,
  -- então um Mac/Windows distinto com sinal no período = uma instalação que abriu.
  WITH hb AS (
    SELECT DISTINCT ON (h.hw_id) h.hw_id, h.os, h.os_version, h.arch
      FROM app_heartbeats h
     WHERE h.created_at >= v_since
     ORDER BY h.hw_id, h.created_at DESC
  )
  SELECT
    count(*) FILTER (WHERE COALESCE(hb.os, CASE WHEN hb.arch IN ('arm64','x64') THEN 'mac' END) = 'mac'),
    count(*) FILTER (WHERE hb.os = 'win' AND hb.os_version = '10'),
    count(*) FILTER (WHERE hb.os = 'win' AND hb.os_version = '11')
  INTO v_mac, v_win10, v_win11
  FROM hb;

  RETURN json_build_object(
    'days', v_days,
    'signups', v_signups,
    'confirmed', v_confirmed,
    'app_opened', v_app_opened,
    'stage_used', v_stage_used,
    'subscribed', v_subscribed,
    'app_opened_mac', v_mac,
    'app_opened_win10', v_win10,
    'app_opened_win11', v_win11
  );
END $$;
