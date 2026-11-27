/*
  O teste grátis de 48 horas começa na primeira abertura do programa, não no cadastro.

  Por quê (27/11/2026): no tráfego pago, a pessoa vê o anúncio no iPhone, cria a conta no site e
  só depois vai ao Mac. 24 de 33 contas em teste nunca abriram o programa: o relógio de 48 horas
  corria desde o cadastro no celular e acabava sem uso.

  Como:
  - `director_licenses.trial_started_at` pode ficar vazio: vazio = teste ainda não começou.
  - `_ensure_license` cria a conta sem relógio.
  - `license_status()` só liga o relógio quando o pedido NÃO vem do site (vsstagepro.com.br). O
    programa (Mac ou Windows, inclusive as versões antigas já instaladas) não manda essa origem,
    então liga o teste como sempre: nada muda para quem já usa o app. Pedido do site com o
    relógio vazio recebe { status: 'pending', hours_left: 48 }; o site, para cliente, só mostra
    "Baixe o VS Stage para Mac". Sem cabeçalho de origem conta como programa (falha segura:
    é o comportamento antigo).
  - `_license_state` devolve 'pending' (cadastrou e ainda não abriu o programa) para o painel.
  - `bonus_access` trata 'pending' como teste (o bônus continua aberto a quem acabou de se cadastrar).
  - `admin_extend_trial` com relógio vazio só soma horas ao teste que ainda vai começar.
  - Contas de teste que nunca abriram o programa (nenhum Mac registrado em `account_devices`,
    criadas desde 10/11, quando esse registro passou a existir) voltam para "não começou" e
    ganham as 48 horas cheias quando abrirem. Não mexe em quem pagou, tem bônus, parceiro ou
    está bloqueado.
*/

ALTER TABLE director_licenses ALTER COLUMN trial_started_at DROP NOT NULL;
ALTER TABLE director_licenses ALTER COLUMN trial_started_at DROP DEFAULT;

-- O pedido veio do site? (a origem é mandada pelo navegador em toda chamada ao Supabase)
CREATE OR REPLACE FUNCTION _request_from_site() RETURNS boolean
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_origin text;
BEGIN
  BEGIN
    v_origin := lower(coalesce(
      current_setting('request.headers', true)::json->>'origin',
      current_setting('request.headers', true)::json->>'referer',
      ''));
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  RETURN v_origin LIKE 'https://vsstagepro.com.br%' OR v_origin LIKE 'https://www.vsstagepro.com.br%';
END $$;
REVOKE EXECUTE ON FUNCTION _request_from_site() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _ensure_license(p_user uuid) RETURNS director_licenses
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row director_licenses;
BEGIN
  SELECT * INTO v_row FROM director_licenses WHERE user_id = p_user;
  IF NOT FOUND THEN
    -- sem relógio: o teste começa na primeira abertura do programa (license_status)
    INSERT INTO director_licenses (user_id, trial_started_at) VALUES (p_user, NULL)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_row FROM director_licenses WHERE user_id = p_user;
  END IF;
  RETURN v_row;
END $$;
REVOKE EXECUTE ON FUNCTION _ensure_license(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _license_state(l director_licenses) RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN l.blocked THEN 'blocked'
    WHEN l.subscription = 'active' THEN 'active'
    WHEN l.pix_paid_until IS NOT NULL AND l.pix_paid_until > now() THEN 'active'
    WHEN l.comp_until IS NOT NULL AND l.comp_until > now() THEN 'promo'
    WHEN l.trial_started_at IS NULL THEN 'pending'
    WHEN now() < l.trial_started_at + make_interval(hours => l.trial_hours) THEN 'trial'
    ELSE 'expired'
  END
$$;
REVOKE EXECUTE ON FUNCTION _license_state(director_licenses) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION license_status() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row director_licenses;
  v_end timestamptz;
  v_hours int;
  v_paid_before boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('status', 'anonymous'); END IF;
  v_row := _ensure_license(v_uid);

  IF v_row.blocked THEN
    RETURN json_build_object('status', 'blocked', 'reason', v_row.blocked_reason);
  END IF;

  -- Período pago (PIX ou cartão pela InfinitePay, ou tempo manual): sem renovação automática.
  IF v_row.pix_paid_until IS NOT NULL AND v_row.pix_paid_until > now()
     AND NOT (v_row.subscription = 'active' AND v_row.current_period_end IS NOT NULL
              AND v_row.current_period_end > v_row.pix_paid_until) THEN
    RETURN json_build_object(
      'status', 'active', 'subscription', 'pix',
      'plan', v_row.plan, 'current_period_end', v_row.pix_paid_until
    );
  END IF;

  IF v_row.subscription = 'active' THEN
    RETURN json_build_object(
      'status', 'active', 'subscription', 'active',
      'plan', v_row.plan, 'current_period_end', v_row.current_period_end
    );
  END IF;

  IF v_row.comp_until IS NOT NULL AND v_row.comp_until > now() THEN
    RETURN json_build_object('status', 'active', 'subscription', 'promo', 'plan', 'promo', 'current_period_end', v_row.comp_until);
  END IF;

  -- Teste ainda não começou: o site só informa; o programa liga o relógio agora.
  IF v_row.trial_started_at IS NULL THEN
    IF _request_from_site() THEN
      RETURN json_build_object(
        'status', 'pending',
        'hours_left', v_row.trial_hours,
        'days_left', ceil(v_row.trial_hours / 24.0)::int
      );
    END IF;
    UPDATE director_licenses SET trial_started_at = now()
     WHERE user_id = v_uid AND trial_started_at IS NULL
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      SELECT * INTO v_row FROM director_licenses WHERE user_id = v_uid;
    END IF;
  END IF;

  v_end := v_row.trial_started_at + make_interval(hours => v_row.trial_hours);
  v_hours := greatest(0, ceil(extract(epoch from (v_end - now())) / 3600)::int);

  IF now() < v_end THEN
    RETURN json_build_object(
      'status', 'trial',
      'trial_started_at', v_row.trial_started_at,
      'ends_at', v_end,
      'hours_left', v_hours,
      'days_left', ceil(v_hours / 24.0)::int
    );
  END IF;

  -- Vencido: diz se foi o período pago ou o teste grátis que terminou.
  v_paid_before := v_row.pix_paid_until IS NOT NULL OR _affiliate_has_paid(v_uid);
  RETURN json_build_object(
    'status', 'expired',
    'trial_started_at', v_row.trial_started_at,
    'ends_at', v_end,
    'reason', CASE WHEN v_paid_before THEN 'paid_period_over' ELSE 'trial_over' END,
    'paid_before', v_paid_before,
    'had_paid', v_paid_before,
    'paid_until', CASE WHEN v_paid_before THEN coalesce(v_row.pix_paid_until, v_row.current_period_end) END,
    'last_plan', CASE WHEN v_paid_before AND v_row.plan IN ('monthly', 'yearly') THEN v_row.plan END
  );
END $$;
REVOKE EXECUTE ON FUNCTION license_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION license_status() TO authenticated;

CREATE OR REPLACE FUNCTION bonus_access() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row director_licenses;
BEGIN
  IF v_uid IS NULL THEN RETURN json_build_object('status', 'anonymous'); END IF;

  SELECT * INTO v_row FROM director_licenses WHERE user_id = v_uid;
  IF NOT FOUND THEN RETURN json_build_object('status', 'none'); END IF;

  IF v_row.blocked THEN RETURN json_build_object('status', 'blocked'); END IF;

  IF coalesce(v_row.partner, false) THEN
    RETURN json_build_object('status', 'subscriber', 'partner', true);
  END IF;

  IF (v_row.pix_paid_until IS NOT NULL AND v_row.pix_paid_until > now())
     OR v_row.subscription = 'active'
     OR (v_row.comp_until IS NOT NULL AND v_row.comp_until > now()) THEN
    RETURN json_build_object(
      'status', 'subscriber',
      'until', greatest(v_row.pix_paid_until, v_row.current_period_end, v_row.comp_until)
    );
  END IF;

  -- teste que ainda não começou (cadastrou e não abriu o programa) conta como teste
  IF v_row.trial_started_at IS NULL
     OR now() < v_row.trial_started_at + make_interval(hours => v_row.trial_hours) THEN
    RETURN json_build_object('status', 'trial');
  END IF;

  RETURN json_build_object('status', 'expired');
END $$;
REVOKE EXECUTE ON FUNCTION bonus_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bonus_access() FROM anon;
GRANT EXECUTE ON FUNCTION bonus_access() TO authenticated;

CREATE OR REPLACE FUNCTION admin_extend_trial(p_user uuid, p_hours int) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row director_licenses; v_end timestamptz;
BEGIN
  PERFORM _require_admin();
  IF p_hours IS NULL OR p_hours = 0 OR abs(p_hours) > 24 * 3650 THEN RAISE EXCEPTION 'invalid_value'; END IF;
  v_row := _ensure_license(p_user);
  IF v_row.trial_started_at IS NULL THEN
    -- teste ainda não começou: muda o tamanho do teste que vai começar
    UPDATE director_licenses SET trial_hours = greatest(0, trial_hours + p_hours) WHERE user_id = p_user;
  ELSE
    IF p_hours > 0 THEN
      v_end := greatest(now(), v_row.trial_started_at + make_interval(hours => v_row.trial_hours)) + make_interval(hours => p_hours);
    ELSE
      v_end := v_row.trial_started_at + make_interval(hours => greatest(0, v_row.trial_hours + p_hours));
    END IF;
    UPDATE director_licenses
       SET trial_hours = greatest(0, ceil(extract(epoch from (v_end - trial_started_at)) / 3600)::int)
     WHERE user_id = p_user;
  END IF;
  PERFORM _audit('extend_trial', p_user, json_build_object('hours', p_hours)::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION admin_extend_trial(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_extend_trial(uuid, int) TO authenticated;

-- Contas de teste que nunca abriram o programa: o teste volta a ser "não começou", com 48 h.
UPDATE director_licenses l
   SET trial_started_at = NULL,
       trial_hours = greatest(l.trial_hours, 48)
 WHERE l.trial_started_at IS NOT NULL
   AND NOT coalesce(l.blocked, false)
   AND NOT coalesce(l.partner, false)
   AND l.subscription IS DISTINCT FROM 'active'
   AND l.pix_paid_until IS NULL
   AND l.current_period_end IS NULL
   AND l.comp_until IS NULL
   AND l.created_at >= '2026-11-10'
   AND NOT EXISTS (SELECT 1 FROM account_devices d WHERE d.user_id = l.user_id);

-- Toda conta nova já nasce com a licença "teste não começou" (antes ela só existia depois da
-- primeira conferência). Assim o painel e as listas de contato veem quem cadastrou e não abriu.
CREATE OR REPLACE FUNCTION _license_on_signup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.director_licenses (user_id, trial_started_at) VALUES (NEW.id, NULL)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW; -- nunca impede o cadastro
END $$;
REVOKE EXECUTE ON FUNCTION _license_on_signup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS license_on_signup ON auth.users;
CREATE TRIGGER license_on_signup AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION _license_on_signup();

-- Contas antigas que nunca passaram pela conferência ganham a linha agora, também sem relógio.
INSERT INTO director_licenses (user_id, trial_started_at)
SELECT u.id, NULL FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM director_licenses l WHERE l.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;
