# -*- coding: utf-8 -*-
"""Confere se os textos de anuncio cabem nos limites de caractere.

Titulo real confirmado pelo oEmbed do Spotify: "Por Que Demorou?" (com interrogancao).
"""

LIMITES = {
    "meta_titulo": 40,
    "meta_texto": 125,
    "meta_descricao": 30,
    "google_titulo": 40,
    "google_descricao": 90,
}

TEXTOS = [
    ("PLANO", "meta_titulo", "Por Que Demorou? - Jonatha e Cristiano"),
    ("PLANO", "meta_titulo", "A música que você vai ouvir 3 vezes"),
    ("PLANO", "meta_titulo", "Nova música romântica pra sua playlist"),
    ("CONFIG cr1", "meta_titulo", "Por Que Demorou? - Jonatha e Cristiano"),
    ("CONFIG cr2", "meta_titulo", "Essa música é sobre chegar atrasado"),
    ("CONFIG cr3", "meta_titulo", "A música que você vai ouvir 3 vezes"),
    ("PLANO", "meta_texto", 'Toda história de amor tem um "por que demorou". A nossa virou música. Ouça o single completo.'),
    ("PLANO", "meta_texto", "Se você já amou alguém que chegou atrasado, essa música é sua. Ouça agora no Spotify."),
    ("PLANO", "meta_texto", "Voz, violão e uma pergunta que todo mundo já fez. Por Que Demorou?, nova faixa."),
    ("CONFIG cr1", "meta_texto", 'Toda história de amor tem um "por que demorou".\nA nossa virou música. Ouça o single completo.'),
    ("CONFIG cr2", "meta_texto", "Se você já amou alguém que chegou na hora errada,\nessa música é sua. Ouça agora."),
    ("CONFIG cr3", "meta_texto", "Por Que Demorou? Jonatha e Cristiano.\nUma pergunta que todo mundo já fez."),
    ("CONFIG cr1", "meta_descricao", "Ouça agora no Spotify"),
    ("CONFIG cr2", "meta_descricao", "Nova música romântica"),
    ("GOOGLE", "google_titulo", "Por Que Demorou? - Jonatha e Cristiano"),
    ("GOOGLE", "google_titulo", "Nova música romântica brasileira"),
    ("GOOGLE", "google_descricao", "O single que fala sobre a pessoa que chegou na hora certa. Ouça no Spotify."),
    ("GOOGLE", "google_descricao", "Voz, violão e uma pergunta que todo mundo já fez. Ouça agora."),
]


def main():
    falhas = 0
    for origem, tipo, texto in TEXTOS:
        limite = LIMITES[tipo]
        n = len(texto)
        folga = limite - n
        if n > limite:
            marca = "ESTOUROU"
            falhas += 1
        else:
            marca = "ok      "
        print("%s %-11s %-15s %3d/%-3d folga %+d" % (marca, origem, tipo, n, limite, folga))
    print()
    print("textos fora do limite: %d" % falhas)


if __name__ == "__main__":
    main()
