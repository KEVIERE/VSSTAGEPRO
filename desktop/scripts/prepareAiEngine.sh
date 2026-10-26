#!/usr/bin/env bash
set -e

ARCH="$1"
if [ -z "$ARCH" ]; then
  ARCH=$(uname -m)
fi

echo "======================================================"
echo "Preparando Motor de IA Embutido para Arquitetura: $ARCH"
echo "======================================================"

cd "$(dirname "$0")/.."
ENGINE_DIR="$(pwd)/ai-engine"
rm -rf "$ENGINE_DIR"
mkdir -p "$ENGINE_DIR"

if [ "$ARCH" = "arm64" ]; then
  TAR_ARCH="aarch64"
  EXEC_CMD=""
else
  TAR_ARCH="x86_64"
  EXEC_CMD="arch -x86_64"
fi

STANDALONE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-${TAR_ARCH}-apple-darwin-install_only.tar.gz"
TAR_FILE="/tmp/python-standalone-${ARCH}.tar.gz"

echo "1. Baixando Python Standalone portátil ($ARCH)..."
/usr/bin/curl -fL -sS --retry 3 -o "$TAR_FILE" "$STANDALONE_URL"

echo "2. Extraindo ambiente isolado..."
/usr/bin/tar -xzf "$TAR_FILE" -C "$ENGINE_DIR"
rm -f "$TAR_FILE"

PY_BIN="$ENGINE_DIR/python/bin/python3"
chmod +x "$PY_BIN"

if [ "$ARCH" = "x64" ]; then
  softwareupdate --install-rosetta --agree-to-license 2>/dev/null || true
fi

echo "3. Instalando Torch e Demucs no ambiente embutido..."
$EXEC_CMD "$PY_BIN" -m pip install --no-cache-dir --quiet torch torchaudio demucs || \
python3 -m pip install --target "$ENGINE_DIR/python/lib/python3.11/site-packages" --platform macosx_11_0_x86_64 --only-binary=:all: --python-version 311 torch torchaudio demucs

echo "4. Pré-carregando pesos da rede neural htdemucs_6s..."
export TORCH_HOME="$ENGINE_DIR/torch-cache"
mkdir -p "$TORCH_HOME"
$EXEC_CMD "$PY_BIN" -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs_6s')" 2>/dev/null || true

echo "✓ Motor de IA para $ARCH embutido e pronto com sucesso!"
