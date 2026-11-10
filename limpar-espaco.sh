#!/bin/bash
# Limpeza de espaço no Mac do Jonatha.
# Roda de dentro do Terminal, com o Claude Desktop fechado.
# Cada item é apagado em separado e mostra quanto liberou.

set -u
antes=$(df -k /System/Volumes/Data | awk 'NR==2 {print $4}')

# App aberto? Testa o socket de trava que o proprio app cria.
# O pgrep nao serve aqui porque pode estar bloqueado pelo sandbox.
app_aberto() {
  local socket="$1"
  local alvo
  alvo=$(readlink "$socket" 2>/dev/null) || return 1
  [ -n "$alvo" ] && [ -S "$alvo" ]
}

apagar() {
  local rotulo="$1"
  local caminho="$2"
  if [ -e "$caminho" ]; then
    local tam
    tam=$(du -sh "$caminho" 2>/dev/null | awk '{print $1}')
    rm -rf "$caminho"
    if [ -e "$caminho" ]; then
      echo "  FALHOU  $rotulo ($tam)"
    else
      echo "  apagado $rotulo ($tam)"
    fi
  else
    echo "  nao existe $rotulo"
  fi
}

echo "=== 1. Caches de ferramentas (se recriam sozinhos) ==="
apagar "uv (Python)"              "$HOME/.cache/uv"
apagar "huggingface modelos"      "$HOME/.cache/huggingface/hub"
apagar "pnpm"                     "$HOME/Library/Caches/pnpm"
apagar "npm"                      "$HOME/.npm/_cacache"
apagar "Homebrew"                 "$HOME/Library/Caches/Homebrew"
apagar "node-gyp"                 "$HOME/Library/Caches/node-gyp"
apagar "Melodyne"                 "$HOME/Library/Caches/com.celemony.melodyne"
apagar "Adobe"                    "$HOME/Library/Caches/Adobe"
apagar "Atualizacoes app Claude"  "$HOME/Library/Caches/com.anthropic.claudefordesktop.ShipIt"
apagar "Chrome-headless"          "$HOME/Library/Application Support/Google/Chrome-headless"
apagar "Chrome-headless cache"    "$HOME/Library/Caches/Google/Chrome-headless"

echo
echo "=== 2. Cache do Chrome (precisa do Chrome fechado) ==="
if app_aberto "$HOME/Library/Application Support/Google/Chrome/SingletonSocket"; then
  echo "  PULADO: o Chrome esta aberto. Feche e rode de novo."
else
  apagar "Cache do Chrome" "$HOME/Library/Caches/Google/Chrome"
fi

echo
echo "=== 3. DICloak (navegador anti-detect) ==="
# O DICloak nao deixa socket de trava, entao nao da para detectar sozinho.
echo "  Confira antes: o DICloak precisa estar FECHADO."
printf "  Continuar? [s/N] "
read -r resposta
case "$resposta" in
  s|S|sim|SIM) apagar "DICloak browsers" "$HOME/Library/Application Support/DICloak/browsers" ;;
  *) echo "  PULADO: DICloak browsers" ;;
esac

echo
echo "=== 4. Maquina virtual do Claude Desktop ==="
echo "  (a sessao atual usa ela; feche o Claude Desktop antes e rode de novo"
echo "   se quiser apagar; ele baixa de novo quando precisar)"
echo "  Para apagar mesmo assim, descomente a linha abaixo:"
# apagar "VM do Claude" "$HOME/Library/Application Support/Claude-3p/vm_bundles"

echo
echo "=== 5. Midia do WhatsApp ==="
echo "  A pasta tem fotos, videos e audios de conversas. Recomendo limpar"
echo "  pelo proprio WhatsApp (Configuracoes > Armazenamento e dados)."
echo "  Para apagar tudo pelo Terminal, descomente:"
# apagar "Midia do WhatsApp" "$HOME/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media"

depois=$(df -k /System/Volumes/Data | awk 'NR==2 {print $4}')
liberado_kb=$(( depois - antes ))
if [ "$liberado_kb" -ge 1048576 ]; then
  echo
  echo "=== Resultado: $(( liberado_kb / 1024 / 1024 )) GB liberados ==="
elif [ "$liberado_kb" -ge 1024 ]; then
  echo
  echo "=== Resultado: $(( liberado_kb / 1024 )) MB liberados ==="
else
  echo
  echo "=== Resultado: nada liberado ==="
fi
df -h /System/Volumes/Data | tail -1
