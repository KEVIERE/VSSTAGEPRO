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

# O programa de teste anterior (desta pasta) também precisa fechar: só abre um de cada vez, e o
# novo fechava sozinho, deixando o antigo aberto sem as mudanças. Fecha do jeito normal (ele
# pergunta se há projeto sem salvar).
TESTE="$(pwd)/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if pgrep -f "$TESTE" >/dev/null; then
  echo "Fechando o VS Stage de teste que estava aberto..."
  osascript -e 'quit app id "com.github.Electron"'
  for _ in {1..120}; do
    pgrep -f "$TESTE" >/dev/null || break
    sleep 1
  done
  if pgrep -f "$TESTE" >/dev/null; then
    echo "O VS Stage de teste continua aberto. Feche ele (Cmd+Q no Electron) e rode de novo."
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

# Vozes de digitar do Maestro (Feminina, Masculina e Henrique) no programa de teste: o programa de
# voz de IA só vem no instalador (desktop/maestro-voice-engine fica vazio aqui). Sem ele, essas
# vozes não falavam no teste. Usa o do VS Stage instalado; o modelo baixado é o mesmo dos dois.
MOTOR_VOZ="/Applications/VS Stage.app/Contents/Resources/maestro-voice-engine"
if [ -x "$MOTOR_VOZ/vs-maestro-voz" ] && [ -d "$MOTOR_VOZ/voices" ]; then
  export VS_MAESTRO_ENGINE_DIR="$MOTOR_VOZ"
fi

echo "Abrindo o VS Stage de teste..."
npm start
