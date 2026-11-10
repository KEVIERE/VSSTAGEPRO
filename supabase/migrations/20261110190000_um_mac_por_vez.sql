/*
# Um Mac por vez em cada conta

A conta abre o programa em um Mac de cada vez. Quem entra em outro Mac recebe a pergunta
"aceita desconectar o outro computador?". Aceitando, o Mac antigo perde o acesso na próxima
conferência dele (volta para a tela de entrada). Recusando, nada muda.

Sem internet o programa usa a última conferência guardada no Mac (licença sem internet), então
o Mac desconectado só fica sabendo na próxima conferência com internet.

1. New Tables
- `account_devices`: os Macs de cada conta.
  - `user_id` (uuid, dono, apaga junto com a conta)
  - `device_id` (text, código do Mac gerado pelo programa a partir do número da placa)
  - `device_name` (text, nome do Mac, para a pergunta mostrar qual é o outro)
  - `active` (boolean, este é o Mac liberado agora; no máximo um por conta)
  - `session_id` (text, sessão de login que está usando este Mac)
  - `replaced_session_id` (text, sessão derrubada quando outro Mac entrou)
  - `last_seen`, `replaced_at`, `created_at` (timestamptz)

2. New Functions
- `device_claim(p_device, p_name, p_take)`: o programa chama a cada conferência da conta.
  Responde `ok` (este Mac está liberado), `conflict` (outro Mac está com a conta; `p_take`
  true toma o lugar dele) ou `replaced` (esta sessão foi derrubada por outro Mac).
- `device_release(p_device)`: "Sair da conta" neste Mac libera a vaga, para o próximo Mac
  entrar sem pergunta. Só vale para a sessão que está com a vaga.

3. Security
- RLS ligado, sem políticas: a tabela só é lida e escrita pelas funções SECURITY DEFINER.
- As funções só atendem quem está logado (auth.uid()) e só mexem nos Macs da própria conta.
*/

CREATE TABLE IF NOT EXISTS account_devices (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text,
  active boolean NOT NULL DEFAULT false,
  session_id text,
  replaced_session_id text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_devices_one_active ON account_devices (user_id) WHERE active;

ALTER TABLE account_devices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION device_claim(p_device text, p_name text DEFAULT NULL, p_take boolean DEFAULT false) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
  v_device text := left(btrim(coalesce(p_device, '')), 128);
  v_name text := nullif(left(btrim(coalesce(p_name, '')), 80), '');
  v_active account_devices;
  v_me account_devices;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  IF v_device = '' THEN RETURN json_build_object('error', 'invalid_device'); END IF;

  -- duas conferências da mesma conta ao mesmo tempo esperam uma pela outra
  PERFORM pg_advisory_xact_lock(hashtext('account_devices:' || v_uid::text));

  SELECT * INTO v_active FROM account_devices WHERE user_id = v_uid AND active;
  SELECT * INTO v_me FROM account_devices WHERE user_id = v_uid AND device_id = v_device;

  IF v_active.device_id IS NOT NULL AND v_active.device_id <> v_device THEN
    IF NOT coalesce(p_take, false) THEN
      -- esta mesma sessão estava liberada aqui e outro Mac tomou o lugar: sai da conta
      IF v_sid IS NOT NULL AND v_me.replaced_session_id = v_sid THEN
        RETURN json_build_object('status', 'replaced', 'other_name', v_active.device_name);
      END IF;
      RETURN json_build_object('status', 'conflict', 'other_name', v_active.device_name, 'other_seen', v_active.last_seen);
    END IF;
    UPDATE account_devices
       SET active = false, replaced_session_id = session_id, replaced_at = now()
     WHERE user_id = v_uid AND device_id = v_active.device_id;
  END IF;

  INSERT INTO account_devices (user_id, device_id, device_name, active, session_id, last_seen)
  VALUES (v_uid, v_device, v_name, true, v_sid, now())
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET device_name = coalesce(EXCLUDED.device_name, account_devices.device_name),
        active = true,
        session_id = EXCLUDED.session_id,
        replaced_session_id = NULL,
        replaced_at = NULL,
        last_seen = now();

  RETURN json_build_object('status', 'ok');
END $$;

CREATE OR REPLACE FUNCTION device_release(p_device text) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid text := nullif(auth.jwt() ->> 'session_id', '');
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('error', 'not_authenticated'); END IF;
  UPDATE account_devices
     SET active = false
   WHERE user_id = v_uid
     AND device_id = left(btrim(coalesce(p_device, '')), 128)
     AND active
     AND session_id IS NOT DISTINCT FROM v_sid;
  RETURN json_build_object('ok', true);
END $$;

-- o Supabase dá EXECUTE a anon em toda função nova do schema public: só quem está logado chama
REVOKE ALL ON FUNCTION device_claim(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION device_release(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION device_claim(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION device_release(text) TO authenticated;
