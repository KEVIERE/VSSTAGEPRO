#!/usr/bin/env python3
"""Separa a BATERIA de um trecho em peças (bumbo, caixa, chimbal, pratos, tons).

Recebe o WAV do stem "bateria" que o Demucs já separou da música e devolve um WAV por peça:

    bumbo.wav      bumbo / kick
    caixa.wav      caixa / redoblante (snare)
    chimbal.wav    chimbal / hi-hat
    pratos.wav     pratos e pratos de condução (cymbals)
    tons.wav       tons e surdos (toms)

Quem faz o trabalho é o `drumsep` (github.com/cukas/drumsep, MIT), embutido na pasta
`desktop/drumsep`. Ele usa processamento de sinal — HPSS, máscaras de frequência e detecção de
transientes — sem rede neural e sem modelo para baixar.

Antes daqui rodava um modelo ONNX (drumsep_v2, 335 MB) que pedia 2,8 GB de RAM por janela de 40 s:
num Mac de 8 GB entrava em swapping e travava o computador no meio do show (relato de 06/11/2026).

Uso (chamado pelo programa, nunca pelo usuário):
    python3 drumPieceSeparator.py --model <pasta ignorada> --in bateria.wav --out <pasta>

Sai em JSON numa linha só, para o programa ler:
    {"ok":true,"pieces":["bumbo","caixa","chimbal","pratos","tons"],"seconds":3.2}
    {"ok":false,"error":"..."}
"""
import argparse
import json
import os
import sys

# As peças na ordem em que a tela mostra. O drumsep devolve estes nomes de arquivo.
PIECES = ("bumbo", "caixa", "chimbal", "pratos", "tons")

# Nomes que o drumsep usa nos arquivos, por peça nossa.
DRUMSEP_NAMES = {
    "bumbo": ("kick", "bumbo"),
    "caixa": ("snare", "caixa"),
    "chimbal": ("hihat", "chimbal", "hi_hat"),
    "pratos": ("cymbals", "pratos"),
    "tons": ("toms", "tons"),
}


def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(0)


def import_drumsep():
    """O drumsep embutido fica ao lado deste script (desktop/drumsep)."""
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import drumsep  # noqa: PLC0415 — precisa do sys.path acima

    return drumsep


def find_piece(out_dir, piece):
    """Acha o WAV de uma peça, aceitando os nomes que o drumsep usa."""
    names = DRUMSEP_NAMES.get(piece, (piece,))
    for name in names:
        for ext in (".wav", ".flac"):
            path = os.path.join(out_dir, name + ext)
            if os.path.isfile(path):
                return path
    return None


def separate_model(model_dir, in_path, out_dir):
    """Mantido por compatibilidade de chamada; o drumsep não usa modelo."""
    return separate(in_path, out_dir)


def separate(in_path, out_dir):
    """Separa a bateria e devolve os segundos processados."""
    drumsep = import_drumsep()
    os.makedirs(out_dir, exist_ok=True)

    drumsep.separate(in_path, output_dir=out_dir)

    # O drumsep grava kick/snare/hihat/cymbals/toms; confere o que realmente saiu.
    achadas = [p for p in PIECES if find_piece(out_dir, p)]
    if not achadas:
        fail("O separador não devolveu as peças da bateria.")
    return {"pieces": achadas}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=False, default=None, help="não usado (compatibilidade)")
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    if not os.path.isfile(args.inp):
        fail("A faixa da bateria não foi encontrada.")

    try:
        import time

        started = time.time()
        resultado = separate(args.inp, args.out)
        seconds = time.time() - started
    except ImportError as err:
        fail(f"O separador de bateria não está instalado nesta versão ({err}).")
    except Exception as err:  # noqa: BLE001 — o app lê a mensagem
        fail(f"Falha ao separar a bateria: {err}")

    print(
        json.dumps(
            {
                "ok": True,
                "pieces": resultado["pieces"],
                "seconds": round(seconds, 2),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
