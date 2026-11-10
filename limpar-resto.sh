#!/bin/bash
# Segunda rodada: apaga o que ficou de fora do limpar-espaco.sh.
# Total previsto: cerca de 27 GB.
# Rode no Terminal. Feche o Chrome antes de comecar.

set -u
antes=$(df -k /System/Volumes/Data | awk 'NR==2 {print $4}')

app_aberto() {
  local alvo
  alvo=$(readlink "$1" 2>/dev/null) || return 1
  [ -n "$alvo" ] && [ -S "$alvo" ]
}

apagar() {
  local rotulo="$1"
  local caminho="$2"
  if [ -e "$caminho" ]; then
    local tam
    tam=$(du -sh "$caminho" 2>/dev/null | awk '{print $1}')
    rm -rf "$caminho" 2>/dev/null
    if [ -e "$caminho" ]; then
      echo "  FALHOU  $rotulo ($tam)"
    else
      echo "  apagado $rotulo ($tam)"
    fi
  else
    echo "  nao existe $rotulo"
  fi
}

confirma() {
  printf "  %s [s/N] " "$1"
  read -r r
  case "$r" in s|S|sim|SIM) return 0 ;; *) return 1 ;; esac
}

echo "=== 1. Cache do Chrome (5,7 GB) ==="
if app_aberto "$HOME/Library/Application Support/Google/Chrome/SingletonSocket"; then
  echo "  PULADO: o Chrome esta aberto. Feche ele e rode de novo."
else
  apagar "Cache do Chrome" "$HOME/Library/Caches/Google/Chrome"
fi

echo
echo "=== 2. DICloak (2,9 GB) ==="
echo "  Apaga os perfis dos navegadores. So faca se nao usa mais."
if confirma "Apagar DICloak?"; then
  apagar "DICloak browsers" "$HOME/Library/Application Support/DICloak/browsers"
else
  echo "  PULADO: DICloak"
fi

echo
echo "=== 3. Maquina virtual do Claude (11 GB) ==="
echo "  Ela e baixada de novo quando precisar. Nao afeta seus projetos."
echo "  ATENCAO: se o Claude Desktop estiver aberto, isso quebra a sessao."
if confirma "Apagar a VM do Claude?"; then
  apagar "VM do Claude" "$HOME/Library/Application Support/Claude-3p/vm_bundles"
else
  echo "  PULADO: VM do Claude"
fi

echo
echo "=== 4. Midia do WhatsApp (8,1 GB) ==="
echo "  Fotos, videos e audios das conversas. NAO tem volta."
echo "  Alternativa mais segura: WhatsApp > Configuracoes >"
echo "  Armazenamento e dados, onde voce escolhe por conversa."
if confirma "Apagar TODA a midia do WhatsApp?"; then
  apagar "Midia do WhatsApp" "$HOME/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/Message/Media"
else
  echo "  PULADO: midia do WhatsApp"
fi

depois=$(df -k /System/Volumes/Data | awk 'NR==2 {print $4}')
liberado=$(( depois - antes ))
echo
if [ "$liberado" -ge 1048576 ]; then
  echo "=== Resultado: $(( liberado / 1024 / 1024 )) GB liberados ==="
elif [ "$liberado" -ge 1024 ]; then
  echo "=== Resultado: $(( liberado / 1024 )) MB liberados ==="
else
  echo "=== Resultado: nada liberado ==="
fi
df -h /System/Volumes/Data | tail -1
