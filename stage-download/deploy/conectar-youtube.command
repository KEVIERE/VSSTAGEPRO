#!/bin/bash
# Stage Download no site: entra no YouTube com uma conta, como o próprio YouTube pede quando
# responde "confirme que você não é um robô".
#
# Antes de rodar:
#   1. No Google Chrome, crie um perfil novo (ícone do perfil > Adicionar).
#   2. Nesse perfil, entre no YouTube com uma conta Google criada SÓ para isso.
#      Não use a sua conta pessoal: o Google pode bloquear a conta usada num servidor.
#   3. Feche o Chrome.
# Depois, dois cliques neste arquivo. Ele pergunta qual perfil do Chrome usar.
#
# O que ele faz: lê os cookies do YouTube desse perfil (o macOS pede a senha do Mac para
# liberar o "Chrome Safe Storage"), manda para o servidor do site e apaga a cópia daqui.
set -e
cd "$(dirname "$0")/.."
PY=".venv/bin/python"
[ -x "$PY" ] || PY="/Users/$USER/Documents/VS STAGE PROJECT/project/stage-download/.venv/bin/python"
[ -x "$PY" ] || { echo "Não achei o Python do Stage Download. Abra o iniciar.command uma vez antes."; read -r -p "Enter para sair"; exit 1; }

echo "Perfis do Chrome neste Mac:"
ls -1 "$HOME/Library/Application Support/Google/Chrome" | grep -E '^(Default|Profile [0-9]+)$' | while read -r p; do
  n=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['profile']['name'])" "$HOME/Library/Application Support/Google/Chrome/$p/Preferences" 2>/dev/null || echo "?")
  echo "  $p  ($n)"
done
read -r -p "Digite o perfil da conta do YouTube (ex.: Profile 2): " PERFIL
[ -n "$PERFIL" ] || exit 1

TMP=$(mktemp -t ytcookies)
trap 'rm -f "$TMP"' EXIT
"$PY" -m yt_dlp --cookies-from-browser "chrome:$PERFIL" --cookies "$TMP" --skip-download --quiet \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" || { echo "Não consegui ler os cookies desse perfil."; read -r -p "Enter para sair"; exit 1; }
grep -q "youtube.com" "$TMP" || { echo "Esse perfil não tem login no YouTube."; read -r -p "Enter para sair"; exit 1; }
# só os cookies do YouTube e do Google vão para o servidor
grep -E '^#|youtube\.com|google\.com' "$TMP" > "$TMP.yt" && mv "$TMP.yt" "$TMP"

KEY="$HOME/.ssh/id_ed25519_hostinger"
scp -q -i "$KEY" -o IdentitiesOnly=yes "$TMP" root@179.236.66.251:/etc/stage-download/youtube-cookies.txt
ssh -i "$KEY" -o IdentitiesOnly=yes root@179.236.66.251 'chgrp stagedl /etc/stage-download/youtube-cookies.txt; chmod 640 /etc/stage-download/youtube-cookies.txt; cp /etc/stage-download/youtube-cookies.txt /tmp/yt-teste.txt; timeout 60 /opt/stage-download/venv/bin/yt-dlp --cookies /tmp/yt-teste.txt -f bestaudio --simulate --print "YouTube respondeu: %(title)s" "https://www.youtube.com/watch?v=yydNF8tuVmU" 2>&1 | tail -1; rm -f /tmp/yt-teste.txt'
echo ""
echo "Pronto. O Stage Download do site agora entra no YouTube com essa conta."
read -r -p "Enter para fechar"
