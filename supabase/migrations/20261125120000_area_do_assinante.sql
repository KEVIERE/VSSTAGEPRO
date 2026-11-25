/*
  # Área do Assinante (vsstagepro.com.br/area-do-assinante)

  1. bonus_access(): diz se a conta pode usar os bônus.
     - Só LÊ director_licenses. Não usa license_status(), porque ela cria a licença e começa
       o teste grátis de 48 horas de quem ainda não abriu o programa.
     - 'subscriber' com as mesmas regras de conta ativa do license_status(): período pago
       (InfinitePay, PIX ou manual), assinatura antiga do Stripe ou acesso de cortesia
       (cupom). Parceiros (endorse) também usam, com partner = true na resposta.
       Teste grátis, vencido e bloqueado não usam os bônus.
  2. Bucket privado "bonus": um arquivo por pasta com o nome do bônus (bonus/<id>/<arquivo>).
     Sem políticas: só o servidor (service role) lê, e a função bonus-download entrega um
     link temporário apenas para quem bonus_access() diz que é assinante.
*/

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

  -- Parceiro (endorse): liberado enquanto a marca de parceiro estiver ligada
  IF coalesce(v_row.partner, false) THEN
    RETURN json_build_object('status', 'subscriber', 'partner', true);
  END IF;

  IF (v_row.pix_paid_until IS NOT NULL AND v_row.pix_paid_until > now())
     OR v_row.subscription = 'active'
     OR (v_row.comp_until IS NOT NULL AND v_row.comp_until > now()) THEN
    RETURN json_build_object(
      'status', 'subscriber',
      -- greatest() ignora os nulos
      'until', greatest(v_row.pix_paid_until, v_row.current_period_end, v_row.comp_until)
    );
  END IF;

  IF now() < v_row.trial_started_at + make_interval(hours => v_row.trial_hours) THEN
    RETURN json_build_object('status', 'trial');
  END IF;

  RETURN json_build_object('status', 'expired');
END $$;

REVOKE EXECUTE ON FUNCTION bonus_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION bonus_access() FROM anon;
GRANT EXECUTE ON FUNCTION bonus_access() TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('bonus', 'bonus', false)
ON CONFLICT (id) DO NOTHING;
