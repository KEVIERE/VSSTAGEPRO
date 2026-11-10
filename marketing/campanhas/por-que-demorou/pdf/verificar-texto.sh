#!/bin/bash
# Verifica se o texto dentro de cada PDF esta legivel e na ordem certa.
#
# Motivo: o Chrome, ao imprimir PDF usando fonte carregada do Google Fonts,
# grava o texto de um jeito que a extracao le embaralhado. O PDF continua
# bonito na tela, mas fica impossivel de copiar, buscar e ler por leitor de
# tela. Aconteceu com o Inter: "INVESTIMENTO TOTAL" virava "INVESTIMENTTAL".
#
# A correcao foi trocar as webfonts por fontes do sistema (Avenir Next e
# Helvetica Neue). Este script garante que o problema nao volte.
#
# A normalizacao do texto (minusculo, sem espaco, sem acento) e feita em
# Python, nao em shell: o "tr" do macOS nao trata letra acentuada maiuscula,
# e a comparacao falharia sem haver problema real no PDF.
#
# Uso: ./verificar-texto.sh

set -u
cd "$(dirname "$0")" || exit 1

EXTRATOR="/tmp/extrair-tudo"

if [ ! -x "$EXTRATOR" ]; then
  echo "compilando extrator de texto..."
  cat > /tmp/extrair-tudo.swift <<'SWIFT'
import Foundation
import PDFKit
let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 1,
      let doc = PDFDocument(url: URL(fileURLWithPath: args[0])) else { exit(1) }
var saida = ""
for i in 0..<doc.pageCount {
    if let p = doc.page(at: i), let s = p.string {
        saida += s + "\n"
    }
}
print(saida)
SWIFT
  swiftc -O /tmp/extrair-tudo.swift -o /tmp/extrair-tudo 2>/dev/null || {
    echo "falhou ao compilar o extrator"
    exit 1
  }
fi

/usr/bin/python3 - "$EXTRATOR" <<'PY'
import subprocess
import sys
import unicodedata

EXTRAIR = sys.argv[1]

# frases obrigatorias por documento. se o texto estiver embaralhado,
# ou se faltar conteudo, a frase nao e encontrada.
CHECAGEM = {
    "00-resumo-executivo.pdf": [
        "O PLANO EM UMA PÁGINA",
        "Onde o dinheiro vai",
        "A DECISÃO MAIS IMPORTANTE DO PLANO",
        "POR QUE NÃO GASTAR FORTE NO COMEÇO",
        "Taxa de salvamento",
        "O que este plano não promete",
    ],
    "01-orcamento.pdf": [
        "Divisão por canal",
        "A curva crescente",
        "A curva é condicional",
        "R$ 238,09",
        # frase longa do corpo: e onde o texto embaralhado quebra primeiro
        "Os diários estão arredondados para o centavo, como o gerenciador pede",
        "Por que 7 dias e não 3",
    ],
    "02-cronograma.pdf": [
        "Antes de começar",
        "Dia 0: ativação",
        "Semana 1: descoberta",
        "Dia 7: primeira decisão",
        "Depois do dia 21",
    ],
    "03-criativos.pdf": [
        "Vídeo principal, 15 segundos",
        "Áudio para Spotify",
        "Textos para Google Ads",
        "Regras de marca",
        "Limites de caractere conferidos",
        "Toda história de amor tem um",
    ],
    "04-configuracao.pdf": [
        "Público do conjunto único",
        "Um conjunto, não três",
        "Não há como rastrear quem clicou no Spotify",
        "Checklist do dia 0",
        "Sequência de ativação",
    ],
}


def normalizar(texto):
    """Minusculo, sem acento, so letras e numeros.

    Remover espaco elimina diferenca de espacamento que a extracao
    de PDF introduz em rotulos com letter-spacing.
    """
    sem_acento = unicodedata.normalize("NFKD", texto)
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    return "".join(c for c in sem_acento.lower() if c.isalnum())


falhas = 0

for nome, frases in CHECAGEM.items():
    caminho = "saida/" + nome
    try:
        bruto = subprocess.run(
            [EXTRAIR, caminho], capture_output=True, text=True, timeout=60
        ).stdout
    except Exception as erro:
        print("x %s: falhou ao extrair (%s)" % (nome, erro))
        falhas += 1
        continue

    if len(bruto) < 1500:
        print("x %s: so %d caracteres. Provavelmente virou imagem"
              % (nome, len(bruto)))
        falhas += 1
        continue

    alvo = normalizar(bruto)
    faltando = [f for f in frases if normalizar(f) not in alvo]

    if faltando:
        print("x %s: %d frase(s) nao encontrada(s) inteira(s)" % (nome, len(faltando)))
        for f in faltando:
            print("    faltou: " + f)
        print("    texto embaralhado? confira se o HTML usa webfont no corpo")
        falhas += 1
    else:
        print("ok %s: %d caracteres, %d frases intactas"
              % (nome, len(bruto), len(frases)))

print("")
if falhas:
    print("%d de %d PDFs com problema de texto" % (falhas, len(CHECAGEM)))
    sys.exit(1)
print("texto legivel e na ordem certa nos %d PDFs" % len(CHECAGEM))
PY
