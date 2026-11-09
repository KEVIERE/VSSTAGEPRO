#!/usr/bin/env bash
# Monta o motor de IA (Python + PyTorch + Demucs) que vai dentro do instalador do Mac.
# Versões TRAVADAS e iguais nos dois processadores: o PyTorch 2.2.2 é o último com pacote
# para Mac Intel, e ele só funciona com NumPy 1.x — sem travar, o pip trazia o NumPy 2 e a
# separação falhava com "Numpy is not available" (versão 1.2.8).
# No fim, o motor separa de verdade um trecho de áudio de teste: se não funcionar, o build para.
set -euo pipefail

ARCH="${1:-$(uname -m)}"
TORCH_VERSION="2.2.2"
TORCHAUDIO_VERSION="2.2.2"
NUMPY_VERSION="1.26.4"
DEMUCS_VERSION="4.0.1"
# Leitura/gravação de áudio embutida (libsndfile incluso: WAV, MP3, FLAC...). Sem ela o
# torchaudio não tem como gravar as faixas separadas e o Mac do usuário não tem ffmpeg.
SOUNDFILE_VERSION="0.12.1"

echo "======================================================"
echo "Preparando Motor de IA Embutido para Arquitetura: $ARCH"
echo "======================================================"

cd "$(dirname "$0")/.."
ENGINE_DIR="$(pwd)/ai-engine"
rm -rf "$ENGINE_DIR"
mkdir -p "$ENGINE_DIR"

if [ "$ARCH" = "arm64" ]; then
  TAR_ARCH="aarch64"
  EXPECTED_MACHO="arm64"
  RUN=()
else
  TAR_ARCH="x86_64"
  EXPECTED_MACHO="x86_64"
  RUN=(arch -x86_64)
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

# O Python do motor tem de ser do processador deste instalador.
if ! file "$ENGINE_DIR/python/bin/python3.11" | grep -q "$EXPECTED_MACHO"; then
  echo "::error::O Python do motor de IA não é $EXPECTED_MACHO"; exit 1
fi

echo "3. Instalando PyTorch $TORCH_VERSION, NumPy $NUMPY_VERSION, Demucs $DEMUCS_VERSION e soundfile $SOUNDFILE_VERSION..."
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet \
  "numpy==$NUMPY_VERSION" "torch==$TORCH_VERSION" "torchaudio==$TORCHAUDIO_VERSION" "demucs==$DEMUCS_VERSION" "soundfile==$SOUNDFILE_VERSION"
# nenhuma dependência do Demucs pode ter trocado a versão do NumPy por baixo
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet --no-deps "numpy==$NUMPY_VERSION"

echo "4. Baixando os pesos da rede neural htdemucs_6s..."
export TORCH_HOME="$ENGINE_DIR/torch-cache"
mkdir -p "$TORCH_HOME"
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs_6s')"

echo "5. Teste: versões e separação real de 3 s de áudio (WAV e MP3), do mesmo jeito que o programa chama..."
# Mac de usuário comum: sem ffmpeg nem nada instalado além do sistema
CLEAN_ENV=(env -i HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PATH="/usr/bin:/bin:/usr/sbin:/sbin" TORCH_HOME="$TORCH_HOME")
"${CLEAN_ENV[@]}" ${RUN[@]+"${RUN[@]}"} "$PY_BIN" - <<'PY'
import numpy, torch, torchaudio, soundfile, platform
assert numpy.__version__.startswith("1."), f"NumPy {numpy.__version__} não é 1.x"
torch.from_numpy(numpy.zeros(4, dtype="float32"))  # o ponto exato que quebrou na 1.2.8
assert "soundfile" in torchaudio.list_audio_backends(), torchaudio.list_audio_backends()
assert "MP3" in soundfile.available_formats(), "libsndfile sem MP3"
print("python", platform.machine(), "| torch", torch.__version__, "| numpy", numpy.__version__, "| libsndfile", soundfile.__libsndfile_version__)
PY
TEST_DIR=$(mktemp -d)
"${CLEAN_ENV[@]}" ${RUN[@]+"${RUN[@]}"} "$PY_BIN" - "$TEST_DIR" <<'PY'
import sys, numpy, soundfile
sr = 44100
t = numpy.arange(sr * 3) / sr
sig = (0.3 * numpy.sin(2 * numpy.pi * 220 * t) + 0.1 * numpy.random.default_rng(1).standard_normal(t.size)).astype("float32")
stereo = numpy.stack([sig, sig], 1)
soundfile.write(sys.argv[1] + "/teste.wav", stereo, sr, subtype="PCM_16")
soundfile.write(sys.argv[1] + "/testemp3.mp3", stereo, sr, format="MP3")
PY
for NAME in teste.wav testemp3.mp3; do
  "${CLEAN_ENV[@]}" ${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m demucs.separate -n htdemucs_6s -o "$TEST_DIR/out" "$TEST_DIR/$NAME"
  BASE="${NAME%.*}"
  for STEM in vocals bass drums other guitar piano; do
    [ -s "$TEST_DIR/out/htdemucs_6s/$BASE/$STEM.wav" ] || { echo "::error::A separação de teste ($NAME) não gerou $STEM.wav"; exit 1; }
  done
  echo "   ✓ $NAME separado nas 6 faixas"
done
rm -rf "$TEST_DIR"

echo "✓ Motor de IA para $ARCH embutido, testado e pronto!"
