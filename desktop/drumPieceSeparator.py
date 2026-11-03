#!/usr/bin/env python3
"""Separa a BATERIA de um trecho em peças (bumbo, caixa, pratos, tons), como o Moises faz.

Recebe o WAV do stem "bateria" que o Demucs já separou da música e devolve um WAV por peça:

    bumbo.wav      bumbo / kick
    caixa.wav      caixa / caixa (redoblante / snare)
    pratos.wav     pratos e chimbais (cymbals)
    tons.wav       tons e surdos (toms)

Modelo: drumsep (Hybrid Demucs afinado em bateria, MIT), de inagoy/drumsep, exportado em ONNX
por gridshiftstudio/drumsep-onnx. O ONNX Runtime roda em Mac Intel e em chip Apple, então este
passo funciona nos dois instaladores.

Uso (chamado pelo programa Voz, nunca pelo usuário):
    python3 drumPieceSeparator.py --model <pasta> --in bateria.wav --out <pasta de saída>

Sai em JSON numa linha só, para o programa ler:
    {"ok":true,"pieces":["bumbo","caixa","pratos","tons"],"seconds":93.4}
    {"ok":false,"error":"..."}
"""
import argparse
import json
import os
import sys

# 44,1 kHz estéreo; a janela do modelo é uma só inferência de 1.764.000 amostras (40 s).
SAMPLE_RATE = 44100
WINDOW = 1764000
# As 4 saídas do modelo, na ordem em que ele devolve.
PIECES = ("bumbo", "caixa", "pratos", "tons")


def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(0)


def find_model(model_dir):
    """O .onnx dentro da pasta do modelo (a v2 é a afinada para bateria eletrônica)."""
    if not os.path.isdir(model_dir):
        return None
    # a v2 primeiro: é a que acerta mais (bumbo/caixa/pratos)
    for name in ("drumsep_v2.onnx", "drumsep.onnx"):
        path = os.path.join(model_dir, name)
        if os.path.isfile(path) and os.path.getsize(path) > 1024 * 1024:
            return path
    for name in sorted(os.listdir(model_dir)):
        if name.endswith(".onnx") and os.path.getsize(os.path.join(model_dir, name)) > 1024 * 1024:
            return os.path.join(model_dir, name)
    return None


def load_wav(path):
    """WAV → float32 estéreo a 44,1 kHz. Usa soundfile (vem no motor) e cai para o aifc/wave."""
    import numpy as np
    try:
        import soundfile as sf
        data, rate = sf.read(path, dtype="float32", always_2d=True)
    except Exception:
        # sem a soundfile: lê pelo módulo wave, convertendo 8/16/24/32 bits na mão
        import wave
        with wave.open(path, "rb") as w:
            rate = w.getframerate()
            channels = w.getnchannels()
            width = w.getsampwidth()
            frames = w.readframes(w.getnframes())
        raw = np.frombuffer(frames, dtype=np.uint8)
        if width == 2:
            data = np.frombuffer(raw.tobytes(), dtype="<i2").astype("float32") / 32768.0
        elif width == 3:
            # 24 bits: junta 3 bytes em um int32 com sinal (o byte alto é o sinal)
            b = raw.reshape(-1, 3).astype(np.int32)
            v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
            v = np.where(v >= 1 << 23, v - (1 << 24), v)
            data = v.astype("float32") / 8388608.0
        elif width == 4:
            data = np.frombuffer(raw.tobytes(), dtype="<i4").astype("float32") / 2147483648.0
        elif width == 1:
            data = (raw.astype("float32") - 128.0) / 128.0
        else:
            raise ValueError(f"formato de WAV não suportado ({width * 8} bits)")
        data = np.asarray(data, dtype="float32").reshape(-1, channels)

    if rate != SAMPLE_RATE:
        # reamostragem linear: o modelo exige 44,1 kHz (o Demucs já entrega nessa taxa)
        src_index = np.arange(data.shape[0])
        dst_len = int(round(data.shape[0] * SAMPLE_RATE / rate))
        dst_index = np.linspace(0, data.shape[0] - 1, dst_len)
        data = np.stack([np.interp(dst_index, src_index, data[:, c]) for c in range(data.shape[1])], axis=1)
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    elif data.shape[1] > 2:
        data = data[:, :2]
    return np.ascontiguousarray(data[:, :2].T, dtype="float32")  # (2, N)


def write_wav(path, channels):
    """float32 (2, N) → WAV 24 bits (a mesma resolução que o resto do app usa para os stems)."""
    import numpy as np
    try:
        import soundfile as sf
        sf.write(path, channels.T, SAMPLE_RATE, subtype="PCM_24")
        return
    except Exception:
        pass
    import wave
    # 24 bits montado em numpy: (N, 2) → bytes intercalados, sem laço em Python
    ints = np.clip(channels.T, -1.0, 1.0)
    ints = (ints * 8388607.0).astype("<i4").reshape(-1)
    raw = ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()  # descarta o byte alto (little endian)
    with wave.open(path, "wb") as w:
        w.setnchannels(channels.shape[0])
        w.setsampwidth(3)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(raw)


def separate(model_path, in_path, out_dir):
    import numpy as np
    import onnxruntime as ort

    audio = load_wav(in_path)
    total = audio.shape[1]
    if total < 1024:
        fail("O trecho de bateria está vazio.")

    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    # Soma com sobreposição: janelas de 40 s com 1 s de cruzamento, para emenda sem estalo.
    overlap = SAMPLE_RATE
    step = WINDOW - overlap
    out = np.zeros((len(PIECES), 2, total), dtype="float32")
    weight = np.zeros(total, dtype="float32")

    start = 0
    while start < total:
        chunk = audio[:, start:start + WINDOW]
        valid = chunk.shape[1]
        if valid < WINDOW:
            chunk = np.pad(chunk, ((0, 0), (0, WINDOW - valid)))
        # (1, 2, N) — o lote do modelo
        stems = session.run(None, {input_name: chunk[np.newaxis, :, :]})[0]
        stems = np.asarray(stems).reshape(-1, 2, WINDOW)
        if stems.shape[0] < len(PIECES):
            fail(f"O modelo devolveu {stems.shape[0]} faixas (esperava {len(PIECES)}).")

        # janela de fade nas pontas do cruzamento: a soma das duas pontas dá a amplitude original
        fade = np.ones(valid, dtype="float32")
        if start > 0:
            ramp = min(overlap, valid)
            fade[:ramp] = np.linspace(0.0, 1.0, ramp, dtype="float32")
        out[:, :, start:start + valid] += stems[:len(PIECES), :, :valid] * fade[np.newaxis, np.newaxis, :]
        weight[start:start + valid] += fade
        if start + WINDOW >= total:
            break
        start += step

    weight[weight < 1e-6] = 1.0
    out /= weight[np.newaxis, np.newaxis, :]

    os.makedirs(out_dir, exist_ok=True)
    for index, piece in enumerate(PIECES):
        write_wav(os.path.join(out_dir, piece + ".wav"), out[index])
    return total / SAMPLE_RATE


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    model_path = find_model(args.model)
    if not model_path:
        fail("O modelo de separação da bateria não foi encontrado.")
    if not os.path.isfile(args.inp):
        fail("A faixa da bateria não foi encontrada.")

    try:
        seconds = separate(model_path, args.inp, args.out)
    except Exception as err:  # noqa: BLE001 — o app lê a mensagem
        fail(f"Falha ao separar a bateria: {err}")

    print(json.dumps({"ok": True, "pieces": list(PIECES), "seconds": round(seconds, 2)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
