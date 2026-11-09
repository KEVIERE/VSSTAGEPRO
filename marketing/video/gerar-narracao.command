#!/bin/zsh
# Gera a narração do vídeo na sua conta da ElevenLabs e monta o áudio final.
# Dois cliques no Finder abrem o Terminal e rodam este arquivo.
#
# A chave NÃO fica no projeto (o repositório é público). Ela é lida de:
#   ~/.elevenlabs-key      (só a chave, nada mais)
# ou da variável ELEVENLABS_API_KEY, se estiver definida.
#
# O que ele faz:
#   1. lê as falas de narracao-texto.json;
#   2. gera cada fala em narracao/c1.mp3, c2.mp3, ...;
#   3. mede a duração de cada uma e grava narracao/tempos.json;
#   4. monta narracao/narracao.mp3 com as pausas do roteiro.
#
# Uso: ./gerar-narracao.command [--listar-vozes]

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

CHAVE="${ELEVENLABS_API_KEY:-}"
if [ -z "$CHAVE" ] && [ -f "$HOME/.elevenlabs-key" ]; then
  CHAVE="$(tr -d ' \n\r' < "$HOME/.elevenlabs-key")"
fi

if [ -z "$CHAVE" ]; then
  echo "Falta a chave da ElevenLabs."
  echo
  echo "1. Abra https://elevenlabs.io/app/settings/api-keys"
  echo "2. Crie (ou copie) uma chave"
  echo "3. Salve só a chave num arquivo:  ~/.elevenlabs-key"
  echo
  echo "   echo 'SUA_CHAVE' > ~/.elevenlabs-key"
  echo "   chmod 600 ~/.elevenlabs-key"
  echo
  exit 1
fi

if [ "$1" = "--listar-vozes" ]; then
  echo "Vozes da sua conta:"
  curl -s -H "xi-api-key: $CHAVE" https://api.elevenlabs.io/v1/voices \
    | /opt/homebrew/bin/node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);for(const v of j.voices||[])console.log(`${v.voice_id}  ${v.name}  (${v.labels?.language||"?"}, ${v.labels?.gender||"?"})`)})'
  exit 0
fi

# Confere a chave antes de gerar qualquer coisa.
echo "Conferindo a chave..."
if ! curl -s -f -H "xi-api-key: $CHAVE" https://api.elevenlabs.io/v1/user > /dev/null; then
  echo "A chave foi recusada pela ElevenLabs. Confira em https://elevenlabs.io/app/settings/api-keys"
  exit 1
fi
echo "Chave ok."

mkdir -p narracao
node gerar-narracao.mjs || exit 1
