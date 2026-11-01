#!/usr/bin/env bash
# Compila o programa de voz do Maestro IA (vs-maestro-voz, Qwen3-TTS pela mlx-audio-swift).
#
# Precisa do Swift 6.3 (Xcode 26.4 ou mais novo): o MLX 0.32 exige essa versão, e só o
# xcodebuild compila os shaders da placa de vídeo que o MLX usa (o `swift build` das ferramentas
# básicas não compila). No GitHub roda na máquina macos-26 (Xcode 26.6). Só existe para Mac com
# chip Apple (arm64): o MLX não roda em Mac Intel.
#
# Resultado em desktop/maestro-voice-helper/build/out:
#   vs-maestro-voz           o programa
#   *.bundle                 recursos que ele procura ao lado (shaders do MLX: default.metallib)
#
# Uso: ./scripts/buildMaestroVoiceHelper.sh
set -euo pipefail

cd "$(dirname "$0")/../maestro-voice-helper"
# o Xcode mais novo que houver (XCODE_APP escolhe um específico)
if [ -z "${XCODE_APP:-}" ]; then
  for x in /Applications/Xcode_26.6.app /Applications/Xcode_26.5.app /Applications/Xcode_26.4.1.app /Applications/Xcode.app; do
    [ -d "$x" ] && { XCODE_APP="$x"; break; }
  done
fi
if [ -n "${XCODE_APP:-}" ] && [ -d "$XCODE_APP" ]; then
  export DEVELOPER_DIR="$XCODE_APP/Contents/Developer"
fi
if ! xcodebuild -version >/dev/null 2>&1; then
  echo "::error::O programa de voz precisa do Xcode 26.4 ou mais novo (xcodebuild). Este Mac só tem as ferramentas básicas."
  exit 1
fi
SWIFT_VER="$(xcrun swift --version 2>/dev/null | sed -nE 's/.*Swift version ([0-9]+\.[0-9]+).*/\1/p' | head -1)"
case "$SWIFT_VER" in
  6.[3-9]*|[7-9].*) ;;
  *) echo "::error::O programa de voz precisa do Swift 6.3 ou mais novo (este Xcode tem o Swift ${SWIFT_VER:-?})"; exit 1 ;;
esac
echo "== Programa de voz do Maestro IA ($(xcodebuild -version | head -1), Swift $SWIFT_VER)"

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
