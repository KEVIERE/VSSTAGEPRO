#!/bin/zsh
# Abre o VS Stage de teste, com as alterações desta pasta.
# Dois cliques no Finder abrem o Terminal e rodam este arquivo.
# O VS Stage instalado e o de teste não rodam juntos (trava de uma janela só
# e a porta 8080), por isso o instalado é fechado antes, do jeito normal.

cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if pgrep -x "VS Stage" >/dev/null; then
  echo "Fechando o VS Stage instalado..."
  osascript -e 'quit app "VS Stage"'
  # Espera fechar: ele pode perguntar se há projeto sem salvar.
  for _ in {1..120}; do
    pgrep -x "VS Stage" >/dev/null || break
    sleep 1
  done
  if pgrep -x "VS Stage" >/dev/null; then
    echo "O VS Stage instalado continua aberto. Feche ele e rode de novo."
    exit 1
  fi
fi

echo "Abrindo o VS Stage de teste..."
npm start
