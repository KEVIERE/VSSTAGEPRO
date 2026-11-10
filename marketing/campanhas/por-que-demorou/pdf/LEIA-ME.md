# PDFs da campanha

Cinco documentos de apresentação, gerados a partir dos arquivos Markdown desta pasta.
O visual segue a identidade do VS Stage (fundo escuro, âmbar) com a logo da dupla na capa.

## Os arquivos

| Arquivo | Páginas | Para quê |
|---|---|---|
| `saida/00-resumo-executivo.pdf` | 3 | Apresentar ao cliente. O plano em uma página, mais o que falta decidir |
| `saida/01-orcamento.pdf` | 4 | Divisão por canal, curva semanal e por que ela é crescente |
| `saida/02-cronograma.pdf` | 4 | O que fazer do dia 0 ao 21, com os dois pontos de decisão |
| `saida/03-criativos.pdf` | 6 | Roteiros de vídeo e áudio, textos prontos, limites conferidos |
| `saida/04-configuracao.pdf` | 6 | Passo a passo por canal, para colar no gerenciador |

Total: 23 páginas em A4 (595 × 842 pt), sem página em branco.

## Como regerar

Três comandos, nesta ordem:

```
node conferir.mjs
```

Confere, por medição no DOM renderizado, se cada página cabe em A4, se o conteúdo não
invade o rodapé, se as imagens carregaram e se **nenhuma webfont** está em uso. Sai com
código 1 se achar problema.

```
node gerar-pdf.mjs
```

Gera os PDFs em `saida/`, usando o Chrome em modo headless. Recusa qualquer arquivo que
saia com webfont embutida, imprime o tamanho de cada PDF e falha se algum não for criado.

```
./verificar-texto.sh
```

Extrai o texto de dentro de cada PDF e confere que as frases principais estão presentes
e inteiras. É o teste que pega o problema descrito abaixo.

## A armadilha das webfonts

**Não use Inter, Oswald nem nenhuma fonte do Google Fonts nestes documentos.**

O Chrome, ao imprimir PDF com webfont carregada da web, grava o texto de um jeito que a
extração lê embaralhado. O PDF fica bonito na tela, mas:

- não é possível copiar o texto
- a busca (Cmd+F) não encontra nada
- leitor de tela lê lixo
- sistemas que indexam PDF, como buscadores e CRMs, recebem texto corrompido

Sintoma real, medido em 06/11/2026: a palavra `INVESTIMENTO TOTAL` saía como
`INVESTIMENTTAL`, e `JONATHA` como `J` + `NATHA`. O texto estava todo lá, na ordem errada.

**A solução aplicada:** o corpo usa `Avenir Next`, que é do sistema, e os títulos usam
`Avenir Next Condensed`. As duas extraem texto correto. Foi testado lado a lado com
Helvetica Neue, Futura e Gill Sans, que também funcionam; Inter, Oswald e qualquer webfont
falham.

Os três scripts acima existem para que o problema não volte sem ser notado: o gerador recusa
o arquivo, e o verificador confere o texto de dentro do PDF já pronto.

## Estrutura

## Estrutura

- `estilo.css` — paleta e tipografia, num arquivo só. Só fonte do sistema
- `assets/logo-branco.png` — logo para fundo escuro, 1400 px de largura, recortado
- `assets/logo-preto.png` — logo para fundo claro, se precisar
- `*.html` — um documento por assunto, cada um autocontido
- `conferir.mjs` — validador de layout, antes de gerar
- `gerar-pdf.mjs` — gerador, recusa webfont
- `verificar-texto.sh` — confere o texto dentro dos PDFs prontos

## Fonte da logo

Arquivos originais em `~/Desktop/DOCs/LOGOS/JONATHA E CRISTIANO/`, 5000 × 2000 px.
Foram recortados (remoção da margem transparente) e reduzidos para 1400 px de largura.
A capa usa a versão de letras brancas e "&" vermelho, que é a que contrasta no fundo escuro.

## O que não foi verificado

O conteúdo dos PDFs veio dos arquivos Markdown, que têm a revisão registrada em
`../NOTAS-VERIFICACAO.md`. O que continua em aberto é externo ao documento:

- Disponibilidade do Spotify Ads no Brasil e investimento mínimo
- Limites de caractere exatos do anúncio in-feed do Google
- Duração máxima e formatos aceitos no áudio do Spotify Ads
- Política vigente do Meta sobre música licenciada
