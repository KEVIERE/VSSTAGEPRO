#!/usr/bin/env bash
# Monta a pasta maestro-voice-engine, que vai dentro do instalador do Mac:
#
#  - vs-maestro-voz: o programa de voz do Maestro IA (Qwen3-TTS pela mlx-audio-swift, sobre o MLX)
#    e os recursos que ele procura ao lado (*.bundle, com os shaders da placa de vídeo);
#  - voices/: as duas vozes de IA (feminina e masculina), criadas por IA, que não pertencem a
#    ninguém. Cada uma é um trecho de referência de ~8 s (.wav) com o texto dele (.txt).
#
# O modelo Qwen3-TTS (~1,8 GB) NÃO vai no instalador: o app baixa uma vez, em silêncio
# (desktop/maestro-voice-model.json, maestroVoiceDownload.js).
# Só o instalador de Mac com chip Apple leva o programa: o MLX não roda em Intel. O Intel leva só um
# LEIA-ME, e lá a fala usa a voz do Mac.
#
# Uso:
#   ./scripts/prepareMaestroVoice.sh arm64            programa já compilado em maestro-voice-helper/build/out
#                                                     (./scripts/buildMaestroVoiceHelper.sh, precisa do Xcode 26.3)
#   ./scripts/prepareMaestroVoice.sh arm64 --from-ci  baixa o programa do último workflow do GitHub que passou
#                                                     ("Programa de voz do Maestro IA"), para testar num Mac sem Xcode
#   ./scripts/prepareMaestroVoice.sh x64
set -euo pipefail

ARCH="${1:-$(uname -m)}"
[ "$ARCH" = "x86_64" ] && ARCH="x64"
FROM_CI="${2:-}"

cd "$(dirname "$0")/.."
OUT="$(pwd)/maestro-voice-engine"
BUILT="$(pwd)/maestro-voice-helper/build/out"
VOICES="$(pwd)/maestro-voices"

rm -rf "$OUT"
mkdir -p "$OUT"
touch "$OUT/.gitkeep"

echo "== Motor de voz do Maestro IA ($ARCH)"

if [ "$ARCH" != "arm64" ]; then
  cat > "$OUT/LEIA-ME.txt" <<'EOF'
A voz brasileira de IA do Maestro (Qwen3-TTS) precisa de Mac com chip Apple.
Neste instalador (Intel) as falas do Maestro IA usam a voz do Mac.
EOF
  echo "   Intel: sem o programa de voz (a fala usa a voz do Mac)"
  exit 0
fi

# 1. o programa de voz (arm64)
if [ "$FROM_CI" = "--from-ci" ]; then
  echo "1. Baixando o programa de voz compilado pelo GitHub..."
  RUN_ID="$(gh run list --workflow maestro-voice-helper.yml --status success --limit 1 --json databaseId -q '.[0].databaseId')"
  [ -n "$RUN_ID" ] || { echo "::error::Nenhum workflow do programa de voz passou ainda no GitHub"; exit 1; }
  rm -rf "$BUILT"
  mkdir -p "$BUILT"
  gh run download "$RUN_ID" -n vs-maestro-voz -D "$BUILT"
  chmod +x "$BUILT/vs-maestro-voz"
fi
if [ ! -x "$BUILT/vs-maestro-voz" ]; then
  echo "::error::Falta o programa de voz. Compile com ./scripts/buildMaestroVoiceHelper.sh (Xcode 26.3) ou use --from-ci."
  exit 1
fi
echo "1. Programa de voz: $(file -b "$BUILT/vs-maestro-voz" | cut -c1-60)"
cp -R "$BUILT"/. "$OUT"/
if ! file "$OUT/vs-maestro-voz" | grep -q arm64; then
  echo "::error::O programa de voz não é arm64"; exit 1
fi
if ! find "$OUT" -name 'default.metallib' | grep -q .; then
  echo "::error::Faltam os shaders do MLX (default.metallib) junto do programa de voz"; exit 1
fi

# 2. as duas vozes de IA (referência + texto)
echo "2. Vozes de IA..."
mkdir -p "$OUT/voices"
for v in feminina masculina henrique; do
  [ -s "$VOICES/$v.wav" ] && [ -s "$VOICES/$v.txt" ] || { echo "::error::Falta a voz $v em desktop/maestro-voices ($v.wav e $v.txt)"; exit 1; }
  cp "$VOICES/$v.wav" "$VOICES/$v.txt" "$OUT/voices/"
done
[ -f "$VOICES/LEIA-ME.txt" ] && cp "$VOICES/LEIA-ME.txt" "$OUT/voices/"

du -sh "$OUT"
