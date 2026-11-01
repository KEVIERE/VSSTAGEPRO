#!/usr/bin/env bash
# Compila o programa de voz do Maestro IA (vs-maestro-voz, Qwen3-TTS pela mlx-audio-swift).
#
# Precisa do Xcode 26.3 (Swift 6.2): só o xcodebuild compila os shaders da placa de vídeo que o
# MLX usa; o `swift build` das ferramentas básicas não compila. No GitHub roda em macos-15, que
# tem o Xcode 26.3 em /Applications/Xcode_26.3.app. Só existe para Mac com chip Apple (arm64):
# o MLX não roda em Mac Intel.
#
# Resultado em desktop/maestro-voice-helper/build/out:
#   vs-maestro-voz           o programa
#   *.bundle                 recursos que ele procura ao lado (shaders do MLX: default.metallib)
#
# Uso: ./scripts/buildMaestroVoiceHelper.sh
set -euo pipefail

cd "$(dirname "$0")/../maestro-voice-helper"
XCODE_APP="${XCODE_APP:-/Applications/Xcode_26.3.app}"
if [ -d "$XCODE_APP" ]; then
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "::error::O programa de voz precisa do Xcode 26.3 (xcodebuild). Este Mac só tem as ferramentas básicas."
  exit 1
fi
echo "== Programa de voz do Maestro IA ($(xcodebuild -version | head -1))"

DD="build/dd"
OUT="build/out"
rm -rf "$OUT"
mkdir -p "$OUT"

xcodebuild \
  -scheme vs-maestro-voz \
  -configuration Release \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$DD" \
  -skipPackagePluginValidation \
  -skipMacroValidation \
  ONLY_ACTIVE_ARCH=YES \
  build | tail -n 25

PROD="$DD/Build/Products/Release"
cp "$PROD/vs-maestro-voz" "$OUT/"
# recursos dos pacotes (o MLX procura o default.metallib num .bundle ao lado do programa)
find "$PROD" -maxdepth 1 -name '*.bundle' -exec cp -R {} "$OUT/" \;

if ! file "$OUT/vs-maestro-voz" | grep -q arm64; then
  echo "::error::O programa de voz não saiu para arm64"; exit 1
fi
if ! find "$OUT" -name 'default.metallib' | grep -q .; then
  echo "::error::Faltam os shaders do MLX (default.metallib) junto do programa de voz"; exit 1
fi
codesign --force --sign - "$OUT/vs-maestro-voz"

cat > "$OUT/LEIA-ME.txt" <<EOF
vs-maestro-voz: programa de voz do Maestro IA do VS Stage.
Roda o modelo Qwen3-TTS (Alibaba, licença Apache-2.0) pela biblioteca mlx-audio-swift (MIT),
https://github.com/Blaizzy/mlx-audio-swift, sobre o MLX da Apple (MIT), https://github.com/ml-explore/mlx-swift.
O modelo não vai no instalador: o app baixa uma vez (desktop/maestro-voice-model.json).
EOF
du -sh "$OUT"
ls -la "$OUT"
