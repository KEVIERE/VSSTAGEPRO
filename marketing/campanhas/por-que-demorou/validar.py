# -*- coding: utf-8 -*-
"""Valida a coerencia interna dos documentos da campanha.

Roda com: python3 validar.py
Sai com codigo 1 se achar problema.
"""

import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))

LIMITES = {"titulo": 40, "texto": 125, "descricao": 30}

TITULO_OFICIAL = "Por Que Demorou?"

# termos que nao devem aparecer porque foram removidos por estarem errados
PROIBIDOS = [
    ("pixel", "nao existe pixel possivel: o destino e open.spotify.com"),
    ("Ad Studio", "nome antigo, usar Spotify Ads"),
    ("palavra-chave negativa", "negativa nao existe em campanha de video"),
    ("LINK_SINGLE", "placeholder nao preenchido"),
    ("seu-link-do-spotify", "placeholder nao preenchido"),
    ("[link", "placeholder nao preenchido"),
]

# excecoes: onde o termo pode aparecer porque o texto explica por que ele nao vale
EXCECOES = [
    ("negativa", [
        "Não há palavra-chave negativa",
        "não tem palavra-chave negativa",
        "Não use segmentação por intenção nem palavra-chave negativa",
        "não existe em campanha de vídeo",
        "Negativa é recurso de campanha de Rede de Pesquisa",
        "O controle é por colocação",
    ]),
    ("pixel", [
        "nao existe pixel",
        "não existe pixel",
        "não pode instalar pixel",
        "instalar código de rastreio",
    ]),
    ("ad studio", [
        "nome antigo",
        "antigo Ad Studio",
        "Ad Studio passou a se chamar",
        "mudou de nome de Ad Studio",
    ]),
]


def ler(nome):
    caminho = os.path.join(AQUI, nome)
    with open(caminho, encoding="utf-8") as f:
        return f.read()


def checar_titulo(textos):
    falhas = []
    # toda ocorrencia de "Por Que Demorou" precisa vir seguida de "?"
    for nome, txt in textos.items():
        for m in re.finditer(r"Por Que Demorou( ?)([?.!,]?)", txt):
            if m.group(2) != "?":
                linha = txt[:m.start()].count("\n") + 1
                falhas.append("%s:%d titulo sem interrogancao" % (nome, linha))
    return falhas


def checar_proibidos(textos):
    falhas = []
    for nome, txt in textos.items():
        for termo, motivo in PROIBIDOS:
            for m in re.finditer(re.escape(termo), txt, re.I):
                linha = txt[:m.start()].count("\n") + 1
                trecho = txt[max(0, m.start() - 120):m.end() + 120]
                # a linha se explica?
                if any(exc.lower() in trecho.lower() for exc in EXCECOES_BY_TERM(termo)):
                    continue
                falhas.append("%s:%d '%s' (%s)" % (nome, linha, termo, motivo))
    return falhas


def EXCECOES_BY_TERM(termo):
    chave = termo.lower()
    for k, v in EXCECOES:
        if k in chave:
            return v
    return []


# orcamento escolhido pelo usuario. Mudar aqui quando ele mudar de ideia.
META = 3000
GOOGLE = 1250
SPOTIFY = 750
TOTAL = META + GOOGLE + SPOTIFY
DIAS = 21

# semanas do Meta: (nome, dias, valor)
# curva crescente de proposito: a faixa ja esta publicada, entao gastar
# forte no inicio paga por um empurrao de algoritmo que nao existe mais.
ONDAS = [
    ("Descoberta", 7, 700),
    ("Leitura", 7, 1000),
    ("Escala", 7, 1300),
]


def checar_orcamento(textos):
    falhas = []
    config = textos["CONFIG-ANUNCIOS.md"]
    plano = textos["PLANO.md"]

    if TOTAL != 5000:
        falhas.append("orcamento escolhido soma %d, esperado 5000" % TOTAL)

    if sum(v for _, _, v in ONDAS) != META:
        falhas.append("ondas do Meta somam %d, esperado %d" % (sum(v for _, _, v in ONDAS), META))
    if sum(d for _, d, _ in ONDAS) != DIAS:
        falhas.append("ondas cobrem %d dias, esperado %d" % (sum(d for _, d, _ in ONDAS), DIAS))

    # todo valor declarado tem que aparecer nos dois documentos
    esperados = {
        "total": TOTAL,
        "meta": META,
        "google": GOOGLE,
        "spotify": SPOTIFY,
    }
    for nome, valor in esperados.items():
        bruto = "R$ %s" % format(valor, ",d").replace(",", ".")
        if bruto not in config:
            falhas.append("CONFIG: %s (%s) nao aparece" % (nome, bruto))
        if nome == "total" and bruto not in plano:
            falhas.append("PLANO: total (%s) nao aparece" % bruto)

    # diarios
    diarios = {
        "meta": round(META / DIAS, 2),
        "google": round(GOOGLE / DIAS, 2),
        "spotify": round(SPOTIFY / DIAS, 2),
    }
    for nome, valor in diarios.items():
        bruto = format(valor, ".2f").replace(".", ",")
        if bruto not in config:
            falhas.append("CONFIG: diario %s (%s) nao aparece" % (nome, bruto))

    # A tabela mostra os diarios ja arredondados por canal, e a linha de total
    # e a soma do que o usuario ve. Somar os arredondados pode dar um centavo
    # diferente da divisao exata, e e a soma visivel que precisa fechar.
    soma_diaria = round(diarios["meta"] + diarios["google"] + diarios["spotify"], 2)
    if format(soma_diaria, ".2f").replace(".", ",") not in config:
        falhas.append("CONFIG: soma diaria %.2f nao aparece" % soma_diaria)

    # diario de cada onda tem que aparecer
    for nome, dias, valor in ONDAS:
        d = round(valor / dias, 2)
        bruto = format(d, ".2f").replace(".", ",")
        if bruto not in config:
            falhas.append("CONFIG: diario da onda %s (%s) nao aparece" % (nome, bruto))
        if bruto not in plano:
            falhas.append("PLANO: diario da onda %s (%s) nao aparece" % (nome, bruto))

    # valores antigos nao podem ter sobrado
    for velho in ["R$ 1.800", "R$ 85,71", "142,85", "R$ 33,33", "R$ 23,81", "R$ 700,00", "R$ 500,00"]:
        for nome, txt in [("CONFIG", config), ("PLANO", plano)]:
            if velho in txt:
                falhas.append("%s: valor antigo do cenario B ainda presente (%s)" % (nome, velho))

    return falhas


def _num(txt):
    """Converte 'R$ 1.250,00' ou 'R$ 700' em float. None se nao for numero."""
    m = re.search(r"(\d[\d.]*),(\d{2})", txt)
    if m:
        return float(m.group(1).replace(".", "") + "." + m.group(2))
    # valor sem centavos, como "R$ 700" ou "**R$ 3.000**"
    m = re.search(r"(\d[\d.]*)", txt)
    if not m:
        return None
    bruto = m.group(1).rstrip(".")
    # "3.000" e tres mil, nao tres; "21" e vinte e um
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", bruto):
        return float(bruto.replace(".", ""))
    if "." in bruto:
        return None
    return float(bruto)


def _linhas_tabela(txt, marcador):
    """Devolve as linhas da primeira tabela que aparece depois de `marcador`.

    Procura a linha que contem o marcador e, a partir dela, desce ate
    achar a primeira linha que comeca com '|'. Essa e a tabela.
    """
    linhas = txt.split("\n")
    inicio = None
    for i, linha in enumerate(linhas):
        if marcador.lower() in linha.lower():
            inicio = i
            break
    if inicio is None:
        return []

    j = inicio
    while j < len(linhas) and not linhas[j].strip().startswith("|"):
        j += 1
    if j >= len(linhas):
        return []

    tabela = []
    while j < len(linhas) and linhas[j].strip().startswith("|"):
        celulas = [c.strip() for c in linhas[j].strip().strip("|").split("|")]
        tabela.append(celulas)
        j += 1
    return tabela


def checar_tabela_orcamento(textos):
    """Le a tabela de resumo celula por celula.

    Checar presenca de texto nao basta: um valor errado pode aparecer
    repetido em outro lugar e a busca por substring passa batido.
    """
    falhas = []
    config = textos["CONFIG-ANUNCIOS.md"]

    tabela = _linhas_tabela(config, "Resumo de orçamento")
    if not tabela:
        return ["CONFIG: tabela de resumo de orcamento nao encontrada"]

    esperado = {"Meta Ads": META, "Google Ads": GOOGLE, "Spotify Ads": SPOTIFY}
    achados = {}
    total_tabela = None

    for linha in tabela:
        if len(linha) < 3:
            continue
        canal = linha[0]
        if canal.startswith("---") or canal.lower().startswith("canal"):
            continue
        diario = _num(linha[1])
        total = _num(linha[2])

        if "total" in canal.lower():
            total_tabela = total
            if total is not None and total != TOTAL:
                falhas.append(
                    "CONFIG: total da tabela e %s, esperado %s"
                    % (total, TOTAL)
                )
            continue

        for nome, valor in esperado.items():
            if nome.lower() in canal.lower():
                achados[nome] = total
                if total != valor:
                    falhas.append(
                        "CONFIG: %s na tabela mostra %s, esperado %s"
                        % (nome, total, valor)
                    )
                if diario is not None:
                    correto = round(valor / DIAS, 2)
                    if abs(diario - correto) > 0.005:
                        falhas.append(
                            "CONFIG: diario de %s e %s, esperado %s"
                            % (nome, diario, correto)
                        )

    faltando = set(esperado) - set(achados)
    if faltando:
        falhas.append("CONFIG: canais ausentes na tabela de resumo: %s" % ", ".join(sorted(faltando)))

    soma = sum(v for v in achados.values() if v is not None)
    if total_tabela is not None and abs(soma - total_tabela) > 0.005:
        falhas.append(
            "CONFIG: canais somam %s mas o total da tabela diz %s"
            % (soma, total_tabela)
        )

    return falhas


def checar_tabela_ondas(textos):
    """Le a tabela de ondas e confere diario e soma.

    Le pelo nome da coluna, nao pela posicao: as duas tabelas do projeto
    (CONFIG e PLANO) tem colunas em ordens diferentes.
    """
    falhas = []
    for nome_arq in ["CONFIG-ANUNCIOS.md", "PLANO.md"]:
        txt = textos[nome_arq]
        tabela = _linhas_tabela(txt, "Diário no Meta")
        if not tabela:
            falhas.append("%s: tabela de ondas nao encontrada" % nome_arq)
            continue

        cabecalho = [c.replace("*", "").lower() for c in tabela[0]]
        idx = {}

        def classificar(i, c):
            # ordem importa: testar "diario" antes de "dias" e "periodo"
            if "diário" in c or "diario" in c:
                idx["diario"] = i
            elif "semana" in c or "onda" in c:
                idx["nome"] = i
            elif "valor" in c or "investimento" in c:
                idx["valor"] = i
            elif "percentual" in c or "%" == c:
                idx["pct"] = i
            elif "dias" in c or "período" in c or "periodo" in c:
                # pode ser coluna de dias ("7") ou de faixa ("dia 0 a 6")
                idx["dias"] = i

        for i, c in enumerate(cabecalho):
            classificar(i, c)

        if not all(k in idx for k in ("nome", "dias", "valor", "diario")):
            falhas.append(
                "%s: colunas da tabela de ondas nao reconhecidas: %s"
                % (nome_arq, cabecalho)
            )
            continue

        achadas = {}
        for linha in tabela[1:]:
            if len(linha) <= max(idx.values()):
                continue
            semana = linha[idx["nome"]]
            if set(semana) <= set("-* "):
                continue
            if "total" in semana.lower():
                continue

            bruto_dias = linha[idx["dias"]]
            # "dia 0 a 6" tem 7 dias, nao 0
            faixa = re.findall(r"\d+", bruto_dias)
            if len(faixa) == 2:
                dias = int(faixa[1]) - int(faixa[0]) + 1
            elif len(faixa) == 1:
                dias = int(faixa[0])
            else:
                continue

            valor = _num(linha[idx["valor"]])
            diario = _num(linha[idx["diario"]])
            if valor is None or diario is None:
                falhas.append("%s: onda %s com valor ilegivel" % (nome_arq, semana))
                continue

            achadas[semana] = (dias, valor, diario)
            correto = round(valor / dias, 2)
            if abs(diario - correto) > 0.005:
                falhas.append(
                    "%s: onda %s mostra diario %s, mas %s/%d = %s"
                    % (nome_arq, semana, diario, valor, dias, correto)
                )

        if not achadas:
            falhas.append("%s: nenhuma onda legivel na tabela" % nome_arq)
            continue

        soma_valor = sum(v[1] for v in achadas.values())
        soma_dias = sum(v[0] for v in achadas.values())
        if abs(soma_valor - META) > 0.005:
            falhas.append(
                "%s: ondas somam %s, esperado %s" % (nome_arq, soma_valor, META)
            )
        if soma_dias != DIAS:
            falhas.append(
                "%s: ondas cobrem %d dias, esperado %d" % (nome_arq, soma_dias, DIAS)
            )

    return falhas


def checar_referencias_orfas(textos):
    """Aponta referencia a coisa que nao existe mais no material.

    Exemplo: "metas do cenario escolhido" quando as projecoes foram removidas.
    """
    falhas = []
    for nome, txt in textos.items():
        for frase, motivo in [
            ("metas do cenário", "as projecoes de resultado foram removidas"),
            ("faixa esperada", "as projecoes de resultado foram removidas"),
            ("cenário A", "os cenarios alternativos foram removidos"),
            ("cenário C", "os cenarios alternativos foram removidos"),
            ("Cenário B", "os cenarios alternativos foram removidos"),
            ("primeiros 3 dias", "a leitura passou a ser semanal"),
        ]:
            if frase.lower() in txt.lower():
                falhas.append("%s: referencia orfa '%s' (%s)" % (nome, frase, motivo))
    return falhas


def checar_estrutura_semana1(textos):
    """A semana 1 tem verba para um conjunto so, nao tres.

    Tres conjuntos a R$ 100/dia dao R$ 33 por conjunto, e nesse valor as
    plataformas nao decidem nada. Esta checagem impede o erro de voltar.
    """
    falhas = []
    for nome, txt in textos.items():
        # "Antes eu propunha três conjuntos desde o dia 0" e a frase que
        # documenta a correcao, entao nao conta como erro.
        for velho in ["Conjunto 3: cidade base (15%)",
                      "Conjunto 1: amplo (60% do orçamento",
                      "testa os 3 criativos e os 2 conjuntos"]:
            if velho in txt:
                falhas.append(
                    "%s: estrutura de 3 conjuntos na semana 1 ('%s') nao cabe na verba"
                    % (nome, velho)
                )
        if "três conjuntos desde o dia" in txt and "Antes eu propunha" not in txt:
            falhas.append(
                "%s: estrutura de 3 conjuntos na semana 1 nao cabe na verba" % nome
            )
    return falhas


def checar_datas_decisao(textos):
    """As datas de decisao tem que ser as da curva crescente: 7 e 14.

    Antes o plano decidia no dia 4 com 3 dias de dado, o que e cedo demais.
    Esta checagem impede que a data antiga volte, e tambem impede que
    sobrem instrucoes de decidir em 3 dias, que contradizem a curva.
    """
    falhas = []
    for nome, txt in textos.items():
        for velho in ["no dia 4", "Dia 4:", "dia 4:", "no dia 9", "Dia 9:"]:
            if velho in txt:
                falhas.append("%s: decisao no '%s' (antigo, decidir cedo demais)" % (nome, velho))
        for velho in ["por 3 dias e mantenha", "Rode as duas por 3 dias",
                      "decidir em 3 dias", "corte em 3 dias"]:
            if velho in txt and "Não corte em 3 dias" not in txt:
                falhas.append(
                    "%s: instrucao de decidir em 3 dias ('%s') contradiz a curva semanal"
                    % (nome, velho)
                )
    return falhas


def checar_tabelas(textos):
    falhas = []
    for nome, txt in textos.items():
        linhas = txt.split("\n")
        for i in range(len(linhas) - 1):
            a, b = linhas[i], linhas[i + 1]
            if re.match(r"^\|[-:| ]+\|$", a.strip()) and re.match(r"^\|[-:| ]+\|$", b.strip()):
                falhas.append("%s:%d linha de separador duplicada" % (nome, i + 2))
    return falhas


def checar_publicos_duplicados(textos):
    """Conjunto 2 nao pode ter o mesmo publico do Conjunto 1."""
    falhas = []
    for nome, txt in textos.items():
        if "Mesmo público do conjunto 1" in txt:
            falhas.append(
                "%s: Conjunto 2 repete o publico do Conjunto 1, o que gera "
                "sobreposicao e os dois conjuntos disputam o mesmo leilao" % nome
            )
    return falhas


def autoteste():
    """Prova que as checagens detectam erro de verdade.

    Se uma checagem nunca falhar, ela nao serve para nada.
    """
    falso = {"x.md": "Título: Por Que Demorou sem interrogacao\n| a | b |\n|---|---|\n|---|---|\n"
                      "use o pixel aqui\nConjunto 2: Mesmo público do conjunto 1\n"}
    achou = 0
    achou += len(checar_titulo(falso))
    achou += len(checar_tabelas(falso))
    achou += len(checar_proibidos(falso))
    achou += len(checar_publicos_duplicados(falso))

    if achou < 4:
        print("AUTOTESTE FALHOU: as checagens nao detectam erro plantado (achou %d)" % achou)
        return 1
    print("autoteste ok: %d problemas plantados foram detectados" % achou)
    return 0


def main():
    # NOTAS-VERIFICACAO.md fica de fora: ele cita os erros de proposito,
    # ao descrever o que foi corrigido. Incluir ele geraria falso positivo.
    nomes = ["PLANO.md", "CONFIG-ANUNCIOS.md", "CRONOGRAMA.md"]
    textos = {n: ler(n) for n in nomes}

    falha_teste = autoteste()
    if falha_teste:
        return falha_teste
    print()

    todas = []
    todas += checar_titulo(textos)
    todas += checar_proibidos(textos)
    todas += checar_orcamento(textos)
    todas += checar_tabelas(textos)
    todas += checar_publicos_duplicados(textos)
    todas += checar_datas_decisao(textos)
    todas += checar_tabela_orcamento(textos)
    todas += checar_tabela_ondas(textos)
    todas += checar_estrutura_semana1(textos)
    todas += checar_referencias_orfas(textos)

    if todas:
        print("PROBLEMAS ENCONTRADOS: %d" % len(todas))
        for f in todas:
            print("  - " + f)
        return 1

    print("nenhum problema encontrado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
