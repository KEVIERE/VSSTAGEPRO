/*
# Checar se um e-mail já tem cadastro (sem expor dados)

1. What this does
- `email_exists(email)` — returns only `true`/`false`, whether a confirmed account exists
  for that e-mail. Used on the sign-in screen to tell "wrong password" apart from
  "no account with this e-mail yet", pointing the person to "Create account" instead.

2. Security
- SECURITY DEFINER so it can read `auth.users`, but returns nothing beyond a boolean —
  no email enumeration beyond "exists or not", same trade-off already accepted by
  Supabase's own signup behavior (which also reveals existence via `identities`).
*/

CREATE OR REPLACE FUNCTION email_exists(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
     WHERE lower(email) = lower(trim(p_email))
       AND email_confirmed_at IS NOT NULL
  )
$$;

REVOKE EXECUTE ON FUNCTION email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_exists(text) TO anon, authenticated;
