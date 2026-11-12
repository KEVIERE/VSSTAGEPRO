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

# Leitor de letra no programa de teste: o motor embutido só existe no instalador. Se este Mac
# tiver o motor de teste (Python do VS Stage instalado + faster-whisper), usa ele.
MOTOR_LETRA="$HOME/Library/Application Support/VS Stage/motor-letra-teste/bin/python3"
if [ -x "$MOTOR_LETRA" ] && [ -d "/Applications/VS Stage.app/Contents/Resources/ai-engine/torch-cache" ]; then
  export VS_LYRICS_PYTHON="$MOTOR_LETRA"
  export TORCH_HOME="/Applications/VS Stage.app/Contents/Resources/ai-engine/torch-cache"
fi

echo "Abrindo o VS Stage de teste..."
npm start
