#!/bin/bash
# Upgrade de produção do VS Stage.
#
# Ordem importa: o site novo fala com funções que precisam existir no banco. Se publicar o
# site antes, o painel do produtor e o botão "Solicitar repertório" quebram para quem já
# estiver usando. Por isso: banco -> Edge Function -> site/instaladores.
#
# Rode de dentro desta pasta, no Terminal do Mac (é onde estão o gh e o login do Supabase):
#   bash scripts/upgrade-producao.sh
#
# Para subir sem publicar o site (só banco e função):
#   bash scripts/upgrade-producao.sh --so-backend

set -u

BRANCH="feat/saidas-estereo"
# Projeto em uso desde 26/10/2026. O antigo, xfpkftewsxaxycdwwnnv (vs-stage), está bloqueado.
PROJECT_REF="eknjqqiamuztomdygalv"
FUNCTIONS=("prompter-audio" "admin-promote" "admin-releases" "outreach-send" "outreach-unsubscribe" "twilio-inbound")

cd "$(dirname "$0")/.." || exit 1
SO_BACKEND=0
[ "${1:-}" = "--so-backend" ] && SO_BACKEND=1

falhou() { echo ""; echo "FALHOU: $1"; echo ""; exit 1; }
etapa()  { echo ""; echo "=== $1 ==="; }

# ---------------------------------------------------------------- 0. checagens
etapa "0. Conferindo o ambiente"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || falhou "não estou numa pasta de repositório git"

ATUAL=$(git rev-parse --abbrev-ref HEAD)
if [ "$ATUAL" != "$BRANCH" ]; then
  falhou "a branch atual é '$ATUAL', e o upgrade sai de '$BRANCH'. Troque com: git switch $BRANCH"
fi

command -v gh >/dev/null 2>&1 || falhou "gh não encontrado. Instale com: brew install gh"
command -v supabase >/dev/null 2>&1 || falhou "supabase CLI não encontrado. Instale com: brew install supabase/tap/supabase"

gh auth status >/dev/null 2>&1 || falhou "gh sem login válido. Rode: gh auth refresh -h github.com -s workflow"
# O CLI 3.x guarda a sessão no keychain do macOS, não em ~/.supabase/access-token (como as
# versões antigas faziam). Por isso não dá para checar arquivo: quem diz se o login vale é o
# `supabase link`, logo abaixo, que falha com mensagem clara quando a sessão expirou.
supabase --version >/dev/null 2>&1 || falhou "o Supabase CLI não roda. Se aparecer 'FileSystem.writeFile ~/.supabase/telemetry.json', rode: export SUPABASE_TELEMETRY=false"

echo "branch:  $ATUAL"
echo "projeto: $PROJECT_REF"

# ---------------------------------------------------------------- 1. testes
etapa "1. Testes e build"
npm test 2>&1 | tail -6
# O npm test sai com erro nos 3 testes de download quando não há internet livre; isso não
# impede a publicação. O build é que decide.
npm run build >/dev/null 2>&1 || falhou "npm run build não passou. Corrija antes de publicar."
echo "build ok"

# ---------------------------------------------------------------- 2. enviar a branch
etapa "2. Enviando a branch para o GitHub"
git push origin "$BRANCH" || falhou "git push falhou"
echo "branch enviada"

# ---------------------------------------------------------------- 3. banco
etapa "3. Aplicando as migrações no banco de produção"
LINK_OUT=$(supabase link --project-ref "$PROJECT_REF" 2>&1)
echo "$LINK_OUT"
if echo "$LINK_OUT" | grep -qi "paused"; then
  falhou "o projeto Supabase está PAUSADO. Nada foi publicado no site (esta é a ordem certa: banco antes do site).
  Despause em: https://supabase.com/dashboard/project/$PROJECT_REF
  Depois rode este script de novo."
fi
echo "$LINK_OUT" | grep -q "FALHOU\|error" && falhou "supabase link falhou. Se for 'Access token not provided', rode: supabase login"
# O CLI 3.x aponta para o banco local por padrão; sem --remote ele procura o Docker.
supabase db push --remote || falhou "supabase db push falhou. Nada foi publicado no site."
echo "banco atualizado"

# ---------------------------------------------------------------- 4. edge functions
etapa "4. Publicando as Edge Functions"
for fn in "${FUNCTIONS[@]}"; do
  echo "--- $fn"
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF" || falhou "deploy de $fn falhou"
done
echo "funções publicadas"

if [ "$SO_BACKEND" = "1" ]; then
  echo ""
  echo "Backend atualizado. O site NÃO foi publicado (--so-backend)."
  exit 0
fi

# ---------------------------------------------------------------- 5. site + instaladores
etapa "5. Disparando o upgrade de produção (site, staging e Mac)"
RUN_URL=$(gh workflow run promote-production.yml --ref "$BRANCH" 2>&1) || falhou "gh workflow run falhou: $RUN_URL"
sleep 6
RUN_ID=$(gh run list --workflow=promote-production.yml --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
[ -z "$RUN_ID" ] && falhou "não achei a execução do workflow"

echo "execução: https://github.com/KEVIERE/VSSTAGEPRO/actions/runs/$RUN_ID"
echo "acompanhando (cerca de 15 minutos)..."
gh run watch "$RUN_ID" --interval 30 --exit-status || falhou "o workflow falhou. Veja: gh run view $RUN_ID"

# ---------------------------------------------------------------- 6. conferir
etapa "6. Conferindo o resultado"
MANIFEST=$(curl -s "https://download.vsstagepro.com.br/mac/manifest.json?t=$(date +%s)")
echo "manifest: $MANIFEST"
echo "$MANIFEST" | grep -q '"version"' || echo "ATENÇÃO: o manifest não trouxe a versão. Confira à mão."

echo ""
echo "Upgrade concluído."
