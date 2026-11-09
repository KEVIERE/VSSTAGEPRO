#!/bin/bash
# Sobe o VS Stage inteiro para um projeto Supabase novo.
#
# Use quando o projeto atual estiver bloqueado por restrição de organização e você criar
# conta/projeto em outra organização. Reaproveita o repositório: as 60 migrações e as 14
# Edge Functions já estão versionadas, então o banco novo nasce completo.
#
# O que NÃO vem: usuários, licenças, letras e shows antigos. Eles só existem no banco
# bloqueado e não há como exportar sem acesso.
#
#   bash scripts/subir-projeto-novo.sh <ref-do-projeto-novo>
#
# Antes de rodar, crie o projeto em https://supabase.com/dashboard/new

set -u

REF="${1:-}"
[ -z "$REF" ] && { echo "Uso: bash scripts/subir-projeto-novo.sh <ref-do-projeto-novo>"; exit 1; }

cd "$(dirname "$0")/.." || exit 1

falhou() { echo ""; echo "FALHOU: $1"; echo ""; exit 1; }
etapa()  { echo ""; echo "=== $1 ==="; }

etapa "0. Conferindo"
command -v supabase >/dev/null 2>&1 || falhou "supabase CLI nao encontrado"
supabase --version >/dev/null 2>&1 || falhou "o CLI nao roda. Se for erro em ~/.supabase/telemetry.json, rode: export SUPABASE_TELEMETRY=false"
grep -q "\"ref\":\"$REF\"" supabase/.temp/linked-project.json 2>/dev/null || echo "vinculando ao projeto $REF"

etapa "1. Vinculando ao projeto novo"
supabase link --project-ref "$REF" || falhou "supabase link falhou. Confira o ref e se o projeto existe."

etapa "2. Aplicando as 60 migracoes"
supabase db push || falhou "db push falhou. Nada foi publicado no site; o banco novo ficou pela metade, pode rodar de novo (as migracoes sao idempotentes)."
echo "banco criado"

etapa "3. Publicando as 14 Edge Functions"
FUNCS=$(ls supabase/functions | grep -v '^_shared$')
for fn in $FUNCS; do
  echo "--- $fn"
  supabase functions deploy "$fn" --project-ref "$REF" || falhou "deploy de $fn falhou"
done

etapa "4. Secrets das funcoes"
cat <<'AVISO'

As funcoes leem estes secrets no projeto novo (Settings > Edge Functions > Secrets):

  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  -> o proprio projeto ja fornece
  RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
  ASAAS_API_KEY, ASAAS_ENV, ASAAS_WEBHOOK_TOKEN
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_MESSAGING_SERVICE_SID
  REPLICATE_API_TOKEN, GITHUB_PAT, GITHUB_REPO, SITE_URL

Nao tenho como ler os valores antigos: eles estao nos secrets do projeto bloqueado.
Cole os mesmos valores aqui se quiser as cobrancas e os avisos funcionando.

AVISO

etapa "5. Alinhando o codigo ao projeto novo"
ANON=$(supabase projects api-keys --project-ref "$REF" 2>/dev/null | awk '/anon/{print $NF; exit}')
[ -z "$ANON" ] && ANON="PEGUE_A_ANON_KEY_EM_settings/api"

python3 - "$REF" "$ANON" <<'PY'
import re, sys
ref, anon = sys.argv[1], sys.argv[2]
url = f"https://{ref}.supabase.co"

p = 'src/lib/supabaseClient.ts'
s = open(p).read()
s2 = re.sub(r"'https://[a-z0-9]+\.supabase\.co'", f"'{url}'", s, count=1)
if anon != 'PEGUE_A_ANON_KEY_EM_settings/api':
    s2 = re.sub(r"'(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)'", f"'{anon}'", s2, count=1)
open(p, 'w').write(s2)
print('supabaseClient.ts ->', url)

p = '.env'
s = open(p).read()
s2 = re.sub(r'VITE_SUPABASE_URL=.*', f'VITE_SUPABASE_URL={url}', s)
if anon != 'PEGUE_A_ANON_KEY_EM_settings/api':
    s2 = re.sub(r'VITE_SUPABASE_ANON_KEY=.*', f'VITE_SUPABASE_ANON_KEY={anon}', s2)
open(p, 'w').write(s2)
print('.env ->', url)
PY

etapa "6. Faltando do seu lado"
cat <<AVISO

1. Secrets do GitHub (Settings > Secrets and variables > Actions), para o proximo upgrade:
     VITE_SUPABASE_URL=https://$REF.supabase.co
     VITE_SUPABASE_ANON_KEY=<a anon do projeto novo>
     SUPABASE_SERVICE_ROLE_KEY=<a service_role do projeto novo>

2. Nao espelhe os .dmg no Supabase: eles enchem o plano gratuito e pausam o projeto.
   A VPS da Hostinger ja serve os instaladores.

3. Depois de tudo, teste: criar conta, login, publicar um show, abrir o prompter do produtor.

AVISO

echo "Pronto."
