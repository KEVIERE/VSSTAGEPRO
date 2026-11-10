#!/bin/zsh
# Mede a abertura do programa com o build atual (dist) e grava o resultado.
cd "$(dirname "$0")/.." || exit 1
./desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  ./desktop/medir-boot.js ./dist 1 2>/dev/null | grep '^{' > .medir-novo-out.txt
cat .medir-novo-out.txt
