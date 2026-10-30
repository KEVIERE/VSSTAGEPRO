/*
  # Parceiro / Endorse

  O admin pode marcar um usuário como Parceiro (endorse): ele tem acesso completo como um
  assinante, mas sem pagamento — não entra na receita nem conta como assinatura.

  Só adiciona coisas novas (nenhuma função existente é reescrita):
  - `director_licenses.partner` e `partner_since`.
  - O acesso vem do mesmo caminho do bônus de cortesia (`comp_until`), que `license_status()`
    já libera como acesso completo e que o painel já conta fora da receita.
  - `admin_set_partner(uuid, boolean)`: marca ou tira o parceiro (só admin, com auditoria).
  - `admin_partners()`: lista quem é parceiro, para o painel mostrar o selo.
  - `my_partner_status()`: o próprio usuário descobre se é parceiro, para o app mostrar o selo.
*/

ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS partner boolean NOT NULL DEFAULT false;
ALTER TABLE director_licenses ADD COLUMN IF NOT EXISTS partner_since timestamptz;

-- Parceiro não tem data para acabar: o acesso fica liberado por 100 anos ou até o admin tirar.
CREATE OR REPLACE FUNCTION admin_set_partner(p_user uuid, p_partner boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  IF p_user IS NULL OR p_partner IS NULL THEN RAISE EXCEPTION 'invalid_value'; END IF;
  PERFORM _ensure_license(p_user);
  IF p_partner THEN
    UPDATE director_licenses
       SET partner = true,
           partner_since = coalesce(partner_since, now()),
           comp_until = greatest(coalesce(comp_until, now()), now() + interval '100 years')
     WHERE user_id = p_user;
  ELSE
    -- tira só o acesso que veio do parceiro; um bônus normal que ainda vale continua valendo
    UPDATE director_licenses
       SET partner = false,
           partner_since = NULL,
           comp_until = CASE WHEN partner AND comp_until > now() + interval '50 years' THEN NULL ELSE comp_until END
     WHERE user_id = p_user;
  END IF;
  PERFORM _audit('set_partner', p_user, json_build_object('partner', p_partner)::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_partners() RETURNS TABLE(user_id uuid, partner_since timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM _require_admin();
  RETURN QUERY SELECT l.user_id, l.partner_since FROM director_licenses l WHERE l.partner ORDER BY l.partner_since;
END $$;

CREATE OR REPLACE FUNCTION my_partner_status() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row director_licenses;
BEGIN
  IF auth.uid() IS NULL THEN RETURN json_build_object('partner', false); END IF;
  SELECT * INTO v_row FROM director_licenses WHERE user_id = auth.uid();
  RETURN json_build_object(
    'partner', coalesce(v_row.partner, false) AND NOT coalesce(v_row.blocked, false),
    'partner_since', v_row.partner_since
  );
END $$;

REVOKE EXECUTE ON FUNCTION admin_set_partner(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_partner(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION admin_partners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_partners() TO authenticated;
REVOKE EXECUTE ON FUNCTION my_partner_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION my_partner_status() TO authenticated;
