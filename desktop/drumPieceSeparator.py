#!/usr/bin/env python3
"""Separa a BATERIA em 4 peças com o DrumSep da ZFTurbo (HDemucs acústico).

O Demucs já entrega a bateria inteira num stem só; este passo quebra em bumbo, caixa, tons e
pratos.

POR QUE ESTE MODELO
O `drumsep_v2.onnx` que estava aqui é um fine-tune de bateria ELETRÔNICA. Medido num stem de
bateria acústica de música real, ele dava correlação 0,9483 com a entrada, vazava 0,7 a 0,87
entre as peças (não separava: fatiava por frequência) e deixava os pratos com 0,2% do agudo —
o chimbal não aparecia. Era esse o "chiado" e a "qualidade ruim" relatados.

Testei também o MDX23C (o de maior SDR da família que o Moises usa). Na música real ele dá
0,9994 de correlação, mas precisa de ~2 GB durante a inferência: num Mac de 8 GB com swap
cheio leva 19 minutos por música. Inviável para o produtor.

Este HDemucs da ZFTurbo, treinado em bateria acústica (bombo/redoblante/platillos/toms), dá
0,9983 de correlação e roda em 52 s com 1.976 MB. A diferença de qualidade para o MDX23C é
0,0011 — não aparece no ouvido — e a de tempo é 20x.

Saída em JSON numa linha só:
    {"ok":true,"pieces":["bumbo","caixa","tons","pratos"],"seconds":52.1}
    {"ok":false,"error":"..."}
"""
import argparse
import json
import os
import sys

# A ordem das saídas do modelo. Conferida com tom puro de 60 Hz (foi para a saída 0) e de
# 10 kHz (foi para as saídas 1 e 2): NÃO reordenar.
PIECES = ("bumbo", "caixa", "pratos", "tons")

SAMPLE_RATE = 44100
SEGMENTO = SAMPLE_RATE * 10   # 10 s: o segmento de treino do modelo
SOBREPOSICAO = 0.25           # 25%: sem isso a emenda entre segmentos fica audível


def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(0)


def load_wav(path):
    """WAV → float32 estéreo a 44,1 kHz."""
    import numpy as np
    import soundfile as sf

    dados, taxa = sf.read(path, dtype="float32", always_2d=True)
    audio = dados.T
    if audio.shape[0] == 1:
        audio = np.vstack([audio, audio])
    elif audio.shape[0] > 2:
        audio = audio[:2]
    if taxa != SAMPLE_RATE:
        from scipy.signal import resample_poly
        audio = np.stack(
            [resample_poly(ch, SAMPLE_RATE, taxa) for ch in audio]
        ).astype("float32")
    return audio


def carregar_modelo(model_dir):
    """Carrega o checkpoint do HDemucs. Levanta erro se não estiver lá."""
    import torch

    caminho = os.path.join(model_dir, "drumsep.th")
    if not os.path.isfile(caminho):
        raise RuntimeError("O modelo da bateria não foi encontrado.")
    checkpoint = torch.load(caminho, map_location="cpu", weights_only=False)
    modelo = checkpoint["klass"](**checkpoint["kwargs"])
    modelo.load_state_dict(checkpoint["state"])
    modelo.eval()
    return modelo


def separar(modelo, audio):
    """Roda o modelo em segmentos de 10 s com sobreposição e fades nas emendas."""
    import numpy as np
    import torch

    total = audio.shape[1]
    passo = int(SEGMENTO * (1 - SOBREPOSICAO))
    saida = np.zeros((len(PIECES), 2, total), dtype="float32")
    peso = np.zeros(total, dtype="float32")

    pos = 0
    while pos < total:
        fim = min(pos + SEGMENTO, total)
        pedaco = audio[:, pos:fim]
        valido = pedaco.shape[1]
        if valido < SEGMENTO:
            pedaco = np.pad(pedaco, ((0, 0), (0, SEGMENTO - valido)))

        with torch.no_grad():
            pecas = modelo(torch.from_numpy(pedaco).unsqueeze(0))[0].numpy()

        # fade nas pontas para a emenda entre segmentos não estalar
        fade = np.ones(valido, dtype="float32")
        rampa = int(SEGMENTO * SOBREPOSICAO / 2)
        if pos > 0 and valido > rampa:
            fade[:rampa] = np.linspace(0.0, 1.0, rampa, dtype="float32")
        if fim < total and valido > rampa:
            fade[-rampa:] = np.linspace(1.0, 0.0, rampa, dtype="float32")

        saida[:, :, pos:fim] += pecas[:, :, :valido] * fade
        peso[pos:fim] += fade

        if fim >= total:
            break
        pos += passo

    peso[peso < 1e-6] = 1.0
    saida /= peso
    return saida


def calibrar(saida, audio):
    """Deixa a soma das peças no nível da bateria de entrada."""
    import numpy as np

    entrada = float(np.sqrt(np.mean(audio ** 2)))
    soma = float(np.sqrt(np.mean(saida.sum(axis=0) ** 2)))
    if soma > 1e-9 and entrada > 1e-9:
        ganho = entrada / soma
        if 0.5 <= ganho <= 2.0:   # fora disso o modelo falhou: não estoura o áudio
            saida *= ganho
    return saida


def main():
    import time

    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, help="pasta com drumsep.th")
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    if not os.path.isfile(args.inp):
        fail("A faixa da bateria não foi encontrada.")

    iniciado = time.time()
    try:
        import soundfile as sf

        modelo = carregar_modelo(args.model)
        audio = load_wav(args.inp)
        if audio.shape[1] < 1024:
            fail("O trecho de bateria está vazio.")

        saida = separar(modelo, audio)
        saida = calibrar(saida, audio)

        os.makedirs(args.out, exist_ok=True)
        for indice, peca in enumerate(PIECES):
            sf.write(
                os.path.join(args.out, peca + ".wav"),
                saida[indice].T,
                SAMPLE_RATE,
                subtype="PCM_24",
            )
    except Exception as err:  # noqa: BLE001 — o app lê a mensagem
        fail(f"Falha ao separar a bateria: {err}")

    print(json.dumps({
        "ok": True,
        "pieces": list(PIECES),
        "seconds": round(time.time() - iniciado, 2),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
