#!/bin/bash
# Duplo clique para abrir o Stage Download
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Primeira vez: instalando (leva 1 minuto)..."
  python3 -m venv .venv && .venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt
fi
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/ffmpeg ]; then
  echo "Falta o ffmpeg. Instale com:  brew install ffmpeg"; read -p "Enter para sair"; exit 1
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# mantém o yt-dlp atualizado (os sites mudam com frequência)
.venv/bin/pip install -q -U "yt-dlp[default]" >/dev/null 2>&1 &
.venv/bin/python app.py
