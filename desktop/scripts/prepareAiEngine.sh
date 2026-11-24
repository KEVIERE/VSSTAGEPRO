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
# Leitor de letra (faster-whisper). Entra SEM as dependências opcionais: o PyAV (abrir arquivo de
# áudio) e o onnxruntime (detector de voz) não têm pacote para Mac Intel nem para macOS 11/12, e o
# programa não usa nenhum dos dois (ver desktop/lyricsTranscriber.py).
FASTER_WHISPER_VERSION="1.2.1"
CTRANSLATE2_VERSION="4.9.0"
TOKENIZERS_VERSION="0.21.1"
HF_HUB_VERSION="0.26.5"

echo "======================================================"
echo "Preparando Motor de IA Embutido para Arquitetura: $ARCH"
echo "======================================================"

cd "$(dirname "$0")/.."
ENGINE_DIR="$(pwd)/ai-engine"
rm -rf "$ENGINE_DIR"
mkdir -p "$ENGINE_DIR"

# win-x64: instalador do Windows (roda no Git Bash da máquina Windows do GitHub)
WIN=0
if [ "$ARCH" = "arm64" ]; then
  TAR_ARCH="aarch64-apple-darwin"
  EXPECTED_MACHO="arm64"
  RUN=()
elif [ "$ARCH" = "win-x64" ]; then
  WIN=1
  TAR_ARCH="x86_64-pc-windows-msvc"
  RUN=()
else
  TAR_ARCH="x86_64-apple-darwin"
  EXPECTED_MACHO="x86_64"
  RUN=(arch -x86_64)
fi

STANDALONE_URL="https://github.com/astral-sh/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-${TAR_ARCH}-install_only.tar.gz"
TAR_FILE="${TMPDIR:-/tmp}/python-standalone-${ARCH}.tar.gz"

echo "1. Baixando Python Standalone portátil ($ARCH)..."
curl -fL -sS --retry 3 -o "$TAR_FILE" "$STANDALONE_URL"

echo "2. Extraindo ambiente isolado..."
tar -xzf "$TAR_FILE" -C "$ENGINE_DIR"
rm -f "$TAR_FILE"

if [ "$WIN" = 1 ]; then
  PY_BIN="$ENGINE_DIR/python/python.exe"
else
  PY_BIN="$ENGINE_DIR/python/bin/python3"
  chmod +x "$PY_BIN"
fi

if [ "$ARCH" = "x64" ]; then
  softwareupdate --install-rosetta --agree-to-license 2>/dev/null || true
fi

# O Python do motor tem de ser do processador deste instalador.
if [ "$WIN" = 0 ] && ! file "$ENGINE_DIR/python/bin/python3.11" | grep -q "$EXPECTED_MACHO"; then
  echo "::error::O Python do motor de IA não é $EXPECTED_MACHO"; exit 1
fi

echo "3. Instalando PyTorch $TORCH_VERSION, NumPy $NUMPY_VERSION, Demucs $DEMUCS_VERSION e soundfile $SOUNDFILE_VERSION..."
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet \
  "numpy==$NUMPY_VERSION" "torch==$TORCH_VERSION" "torchaudio==$TORCHAUDIO_VERSION" "demucs==$DEMUCS_VERSION" "soundfile==$SOUNDFILE_VERSION"
echo "3b. Instalando o leitor de letra: faster-whisper $FASTER_WHISPER_VERSION, CTranslate2 $CTRANSLATE2_VERSION..."
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet --no-deps "faster-whisper==$FASTER_WHISPER_VERSION"
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet \
  "ctranslate2==$CTRANSLATE2_VERSION" "tokenizers==$TOKENIZERS_VERSION" "huggingface_hub==$HF_HUB_VERSION" "numpy==$NUMPY_VERSION"
# Voz de IA do Maestro no processador (Mac Intel, Catalina e Windows): Qwen3-TTS em PyTorch.
# No Apple Silicon a voz roda pelo programa em Swift (MLX) e isto não vai junto.
# Versões travadas: as últimas com pacote pronto para Mac Intel (numba/llvmlite/onnxruntime).
# O transformers 4.57 pede tokenizers 0.22 e huggingface_hub 0.34+: sobem aqui (o faster-whisper
# aceita os dois; o teste do leitor de letra logo abaixo confere).
if [ "$ARCH" != "arm64" ]; then
  echo "3b. Instalando o motor de voz do Maestro (qwen-tts 0.1.1)..."
  ${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet --no-deps "qwen-tts==0.1.1"
  ${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet --only-binary=:all: \
    "transformers==4.57.3" "accelerate==1.12.0" "librosa==0.11.0" "einops==0.8.2" "sox==1.4.1" \
    "numba==0.60.0" "llvmlite==0.43.0" "onnxruntime==1.19.2" \
    "tokenizers==0.22.2" "huggingface_hub==0.36.2"
fi
# nenhuma dependência do Demucs pode ter trocado a versão do NumPy por baixo
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -m pip install --no-cache-dir --quiet --no-deps "numpy==$NUMPY_VERSION"

echo "4. Baixando os pesos da rede neural htdemucs_6s..."
export TORCH_HOME="$ENGINE_DIR/torch-cache"
mkdir -p "$TORCH_HOME/hub/checkpoints"
# Cópia nossa na VPS: o build não depende do servidor da Meta (em 11/11/2026 o certificado
# dele venceu e derrubou o instalador). O SHA-256 completo garante que é o mesmo arquivo;
# se a cópia falhar, o Demucs baixa do endereço original logo abaixo.
MODEL_FILE="5c90dfd2-34c22ccb.th"
MODEL_SHA256="34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd"
MODEL_URL="https://download.vsstagepro.com.br/ai-models/demucs/$MODEL_FILE"
MODEL_PATH="$TORCH_HOME/hub/checkpoints/$MODEL_FILE"
if curl -fL -sS --retry 3 -o "$MODEL_PATH.part" "$MODEL_URL" \
  && [ "$( (command -v shasum >/dev/null && shasum -a 256 "$MODEL_PATH.part" || sha256sum "$MODEL_PATH.part") | cut -d' ' -f1)" = "$MODEL_SHA256" ]; then
  mv "$MODEL_PATH.part" "$MODEL_PATH"
  echo "   pesos baixados da nossa cópia e conferidos"
else
  rm -f "$MODEL_PATH.part"
  echo "::warning::A cópia dos pesos na VPS falhou ou não confere; baixando do servidor original"
fi
# Python do Windows não entende caminho do Git Bash (/d/a/...) em variável de ambiente
[ "$WIN" = 1 ] && TORCH_HOME="$(cygpath -w "$TORCH_HOME")" && export TORCH_HOME
${RUN[@]+"${RUN[@]}"} "$PY_BIN" -c "import demucs.pretrained; demucs.pretrained.get_model('htdemucs_6s')"
# Windows (Git Bash) não tem shasum; usa sha256sum, como na conferência da cópia acima
[ "$( (command -v shasum >/dev/null && shasum -a 256 "$MODEL_PATH" || sha256sum "$MODEL_PATH") | cut -d' ' -f1 | tr -d '\\')" = "$MODEL_SHA256" ] || { echo "::error::Os pesos do htdemucs_6s não conferem"; exit 1; }

echo "5. Teste: versões e separação real de 3 s de áudio (WAV e MP3), do mesmo jeito que o programa chama..."
# Mac de usuário comum: sem ffmpeg nem nada instalado além do sistema
if [ "$WIN" = 1 ]; then
  # Windows precisa do SYSTEMROOT e do PATH do sistema para carregar as DLLs
  CLEAN_ENV=(env TORCH_HOME="$TORCH_HOME")
else
  CLEAN_ENV=(env -i HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" PATH="/usr/bin:/bin:/usr/sbin:/sbin" TORCH_HOME="$TORCH_HOME")
fi
"${CLEAN_ENV[@]}" ${RUN[@]+"${RUN[@]}"} "$PY_BIN" - <<'PY'
import numpy, torch, torchaudio, soundfile, platform
assert numpy.__version__.startswith("1."), f"NumPy {numpy.__version__} não é 1.x"
torch.from_numpy(numpy.zeros(4, dtype="float32"))  # o ponto exato que quebrou na 1.2.8
assert "soundfile" in torchaudio.list_audio_backends(), torchaudio.list_audio_backends()
assert "MP3" in soundfile.available_formats(), "libsndfile sem MP3"
print("python", platform.machine(), "| torch", torch.__version__, "| numpy", numpy.__version__, "| libsndfile", soundfile.__libsndfile_version__)
PY
# O leitor de letra abre do mesmo jeito que o programa abre (sem PyAV e sem onnxruntime).
"${CLEAN_ENV[@]}" ${RUN[@]+"${RUN[@]}"} "$PY_BIN" -I - <<'PY'
import sys, types
try:
    import av  # noqa: F401
except Exception:
    sys.modules["av"] = types.ModuleType("av")
import ctranslate2, numpy
from faster_whisper import WhisperModel  # noqa: F401
assert numpy.__version__.startswith("1."), f"NumPy {numpy.__version__} não é 1.x"
print("leitor de letra ok | ctranslate2", ctranslate2.__version__)
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

if [ "$ARCH" != "arm64" ]; then
  echo "6. Teste: o motor de voz do Maestro abre..."
  "${CLEAN_ENV[@]}" ${RUN[@]+"${RUN[@]}"} "$PY_BIN" -c "import numpy, torch, transformers; from qwen_tts import Qwen3TTSModel; assert numpy.__version__ == '1.26.4', numpy.__version__; print('qwen-tts ok | transformers', transformers.__version__)"
fi

echo "✓ Motor de IA para $ARCH embutido, testado e pronto!"
