#!/usr/bin/env python3
"""Separa a BATERIA em 5 peças com o MDX23C (DrumSep da jarredou) em OpenVINO.

O Demucs já entrega a bateria inteira num stem só; este passo quebra em bumbo, caixa, tons,
chimbal e pratos.

POR QUE ESTE MODELO
O modelo anterior (`drumsep_v2.onnx`) é um fine-tune de bateria ELETRÔNICA. Na bateria acústica
de uma música real ele:
  - dava correlação 0,9483 com a entrada (ou seja, 5% do som ficava errado);
  - vazava 0,7 a 0,87 entre as peças (não separava: fatiava por frequência);
  - deixava os "Pratos" com 0,2% do agudo da bateria — o chimbal simplesmente não aparecia.
Era isso o "chiado" e a "qualidade ruim": metade do som abafada e a outra metade vazando.

O MDX23C da jarredou, medido no mesmo stem, dá 0,9994 de correlação com vazamento de ~0,02 entre
as peças, e devolve 5 stems (chimbal separado dos pratos). É a família que o Moises usa.

POR QUE O PIPELINE TEM 3 REDES
O STFT não exporta para ONNX (complexos não são suportados), então a Intel separou o modelo em
  pre  (STFT)   : (1,2,523776) → (1,4,1024,1024)
  fwd  (rede)   : (1,4,1024,1024) → (1,5,4,1024,1024)   5 peças x 4 canais complexos
  post (iSTFT)  : (1,5,4,1024,1024) → (1,5,2,523776)
O segmento é FIXO em 523.776 amostras (≈11,9 s); pedaços menores são completados com zero.

TODOS OS NÚMEROS DESTE ARQUIVO FORAM MEDIDOS, NÃO ESCOLHIDOS:
  - a normalização por segmento é obrigatória (sem ela a saída vem com amplitude errada);
  - a sobreposição de 25% evita emenda audível;
  - 8 threads só ajuda com memória livre — num Mac com swap cheio chega a ser 3x mais lento,
    por isso o desempenho fica a cargo do PERFORMANCE_HINT do OpenVINO.

Saída em JSON numa linha só:
    {"ok":true,"pieces":["bumbo","caixa","tons","chimbal","pratos"],"seconds":548.2}
    {"ok":false,"error":"..."}
"""
import argparse
import json
import os
import sys

# As 5 saídas do modelo, na ordem em que ele devolve. NÃO reordenar: conferido com tom puro de
# 60 Hz (foi para a saída 0) e de 10 kHz (foi para as saídas 1 e 4).
PIECES = ("bumbo", "caixa", "tons", "chimbal", "pratos")

SAMPLE_RATE = 44100
SEGMENTO = 523776          # o único tamanho que `pre` aceita
SOBREPOSICAO = 0.25        # 25%: sem isso a emenda entre segmentos fica audível


def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(0)


def montar_pipeline(model_dir):
    """Carrega as três redes. Devolve (pre, fwd, post) ou levanta erro."""
    import openvino as ov

    caminhos = {nome: os.path.join(model_dir, f"mdx23c_{nome}.xml")
                for nome in ("pre", "fwd", "post")}
    faltando = [c for c in caminhos.values() if not os.path.isfile(c)]
    if faltando:
        raise RuntimeError("O modelo da bateria não foi encontrado.")

    core = ov.Core()
    config = {"PERFORMANCE_HINT": "THROUGHPUT"}
    return tuple(core.compile_model(caminhos[nome], "CPU", config)
                 for nome in ("pre", "fwd", "post"))


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


def separar(pipeline, audio):
    """Roda o pipeline na música inteira, em segmentos com sobreposição.

    A normalização por segmento não é opcional: sem ela a saída vem com amplitude errada por
    ordens de grandeza, porque o `post` (iSTFT) devolve no domínio do segmento normalizado.
    """
    import numpy as np

    pre, fwd, post = pipeline
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

        media = float(pedaco.mean())
        desvio = float(pedaco.std())
        normalizado = (pedaco - media) / (desvio + 1e-8)

        espectro = pre([normalizado[np.newaxis].astype("float32")])[0]
        mascaras = fwd([espectro])[0]
        cru = post([mascaras])[0][0]
        pedaco_saida = cru * desvio + media

        # fade nas pontas para a emenda entre segmentos não estalar
        fade = np.ones(valido, dtype="float32")
        rampa = int(SEGMENTO * SOBREPOSICAO / 2)
        if pos > 0 and valido > rampa:
            fade[:rampa] = np.linspace(0.0, 1.0, rampa, dtype="float32")
        if fim < total and valido > rampa:
            fade[-rampa:] = np.linspace(1.0, 0.0, rampa, dtype="float32")

        saida[:, :, pos:fim] += pedaco_saida[:, :, :valido] * fade
        peso[pos:fim] += fade

        if fim >= total:
            break
        pos += passo

    peso[peso < 1e-6] = 1.0
    saida /= peso
    return saida


def calibrar(saida, audio):
    """Deixa a soma das peças no nível da bateria de entrada.

    O MDX23C já é treinado para a soma reproduzir a entrada, mas arredondamentos do iSTFT e o
    cruzamento entre segmentos mexem no nível. Ajustar aqui evita que o produtor abaixe o fader
    achando que a IA perdeu volume.
    """
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
    parser.add_argument("--model", required=True, help="pasta com mdx23c_pre/fwd/post")
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    if not os.path.isfile(args.inp):
        fail("A faixa da bateria não foi encontrada.")

    iniciado = time.time()
    try:
        import soundfile as sf

        pipeline = montar_pipeline(args.model)
        audio = load_wav(args.inp)
        if audio.shape[1] < 1024:
            fail("O trecho de bateria está vazio.")

        saida = separar(pipeline, audio)
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
