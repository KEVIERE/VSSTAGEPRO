# O que foi verificado e o que não foi

Terceira revisão. Nesta rodada testei os links de verdade, além de reler os arquivos.

## Confirmado com dado externo

| Dado | Valor confirmado | Fonte |
|---|---|---|
| Título oficial | `Por Que Demorou?` (com interrogação) | oEmbed do Spotify |
| Artista | Jonatha e Cristiano | oEmbed do Spotify |
| Título no YouTube | `POR QUE DEMOROU? - JONATHA E CRISTIANO` | oEmbed do YouTube |
| Canal do YouTube | `Jonatha e Cristiano`, @jonathaecristiano | oEmbed do YouTube |
| Link do Spotify com UTM | resolve para a mesma faixa | oEmbed com os parâmetros |

O teste do link com UTM foi feito passando a URL inteira parametrizada para o oEmbed do Spotify, que devolveu o título `Por Que Demorou?`. Isso prova que os parâmetros não quebram a resolução da faixa.

## Verificado por medição

`conta-caracteres.py`, medindo os 18 textos de anúncio. Resultado: nenhum fora do limite.

O mais apertado é o título do criativo 1, com 38 de 40 e folga de 2. Qualquer acréscimo estoura.

O script teve um falso positivo na última rodada: eu havia classificado a locução do áudio como campo de descrição de 30 caracteres, e ela deu 37. Locução de áudio não tem limite de caractere. Removida da lista.

Aritmética:

- Total cenário B: 1.800 + 700 + 500 = 3.000
- Diário Meta: 1.800 / 21 = 85,71
- Diário Google: 700 / 21 = 33,33
- Diário Spotify: 500 / 21 = 23,81
- Soma diária: 142,85
- Ondas do Meta: 540 + 540 + 720 = 1.800

## Erros encontrados e corrigidos

Primeira revisão: CBO contraditório, cobrança por clique em vídeo do Google, diário errado, público de ouvintes inexistente, projeções como benchmark, nome do produto Spotify, especificação de áudio inventada, limites do Google copiados do Meta.

Segunda revisão: tabela quebrada, contagem por `awk` errada, título sem interrogação, soma diária errada, segundo público inexistente, UTM como rastreável no Spotify, pré-lançamento tratado como executável.

Terceira revisão, agora:

16. **Discovery misturado com campanha de vídeo.** O plano colocava "YouTube in-feed + Discovery" no orçamento e mandava segmentar por intenção de pesquisa dentro de campanha de vídeo. São tipos de campanha diferentes, com inventário e criativo diferentes. Discovery saiu do plano.

17. **Negativa em campanha de vídeo.** Aparecia no PLANO, no CONFIG e no CRONOGRAMA. Negativa é recurso de Rede de Pesquisa. Em vídeo o controle é por colocação. Corrigido nos três arquivos.

18. **Três pontos do título ainda sem interrogação.** O texto do criativo 3 no CONFIG, a locução do áudio no CONFIG e a locução no PLANO. Agora todas as ocorrências têm a interrogação, verificado por varredura.

19. **Seção de lacunas desatualizada.** O PLANO ainda listava "link do single" e "existe vídeo gravado" como pendentes, e pedia para confirmar o distribuidor para o pitch editorial, que já não é possível. Reescrita.

20. **Checklist do dia 0 pedia conferência impossível.** Mandava conferir "UTMs nos três canais", que não é conferível no Spotify, e "faixa publicada em todos os países", que já está feito. Trocada por itens executáveis.

21. **Falta de instrução sobre o arquivo do Reel.** Adicionado aviso para exportar o original e não gravar a tela.

Quarta revisão, agora, com validador automático:

22. **Pixel do Meta no Spotify.** O plano mandava montar remarketing de "quem clicou no link" usando pixel da página de destino. Não existe: o destino é `open.spotify.com`, domínio do Spotify, onde você não pode instalar código de rastreio. O mesmo erro já tinha aparecido duas vezes em formas menores e voltou. Substituído pelo que realmente funciona: público de visualização de vídeo, semelhante a partir de seguidores e lista própria.

23. **Conjunto 2 repetia o público do conjunto 1.** O documento dizia literalmente "Mesmo público do conjunto 1. O que difere é o criativo". Isso faz os dois conjuntos disputarem o mesmo leilão, encarece a entrega e não gera aprendizado. Trocado por base própria.

24. **Semelhante em dois lugares ao mesmo tempo.** O PLANO mandava usar semelhante no conjunto 1 e o CONFIG no conjunto 1 também, enquanto o conjunto 2 era a repetição. Reorganizado: semelhante só no conjunto 2.

## Como isso passou três revisões

Os erros 22, 23 e 24 são de conteúdo, não de forma. Reler procurando inconsistência não pega esse tipo: cada trecho, lido sozinho, parece correto. O que pega é checagem automatizada com regra explícita.

Por isso criei `validar.py`, que roda no projeto e verifica:

- toda ocorrência do título tem a interrogação
- nenhum placeholder sobrou
- nenhum termo removido por estar errado voltou, como pixel ou Ad Studio
- a aritmética de orçamento fecha
- não há linha de separador de tabela duplicada
- o conjunto 2 não repete o conjunto 1

O validador tem autoteste: ele planta quatro erros num texto falso e confirma que os detecta. Sem isso, um validador quebrado passaria como se o material estivesse limpo. Rode com:

```
cd "marketing/campanhas/por-que-demorou" && python3 validar.py
```

Quinta revisão, checando se a verba sustenta a estrutura:

25. **Três conjuntos com orçamento de um.** A estrutura pedia três conjuntos de anúncios desde o dia 0, com R$ 100 por dia no Meta. Isso dá R$ 33 por conjunto. Nesse valor as plataformas não têm dado para decidir nada, e pior: com três anúncios no mesmo conjunto e verba baixa, o Meta escolhe um vencedor em dois ou três dias e para de entregar os outros. O teste que você pagou não acontece.

Corrigido: semana 1 com um conjunto único e três anúncios dentro dele. A divisão em dois conjuntos passa para a semana 2, quando já existe sinal. Cidade base só na semana 3.

26. **Três trechos que ainda descreviam a estrutura antiga.** A tabela de ondas dizia "testa os 3 criativos e os 2 conjuntos", o texto sobre aprendizado falava em verba dividida em dois conjuntos, e o CRONOGRAMA mandava comparar dois conjuntos no dia 7. Todos corrigidos.

Adicionada checagem no validador para impedir que a estrutura de três conjuntos na semana 1 volte. Testada com sabotagem.

## O que o validador não pega

Vale registrar, porque é a limitação importante. O validador confere número, data, texto e presença de termo proibido. Ele não confere **se o plano faz sentido economicamente**. Os erros 22, 23, 24 e 25 passaram por várias rodadas porque cada trecho, lido sozinho, estava correto. O que os pegou foi eu calcular quanto a verba realmente compra e comparar com o que a estrutura exigia.

Esse tipo de erro só aparece com conta na mão, não com regex. Depois de cinco revisões, considero que a checagem mecânica saturou: ela vai continuar dizendo "nenhum problema" enquanto o material já está consistente consigo mesmo.

Sexta revisão, procurando referência órfã depois da reestruturação:

27. **"Compare com as metas do cenário escolhido" no fechamento.** As projeções de resultado foram removidas do plano, então essa linha do dia 21 mandava comparar com algo que não existe mais. Trocado pelo que faz sentido: comparar com os números da semana 1, que custaram R$ 700 justamente para descobrir o que funciona.

28. **"Crie público semelhante ao conjunto que performou melhor" nos dias 8 a 13.** Na semana 1 existe um conjunto só, então não há "conjunto que performou melhor" para se basear. Trocado pela instrução real: montar o segundo conjunto na semana 2.

29. **"Primeiros 3 dias" no PLANO.** Sobrou da lógica antiga de decidir em 3 dias. A leitura passou a ser semanal. Corrigido.

30. **"Se o conjunto 3 for usado" na lista de pendências.** O conjunto 3 virou semana 3 e cidade base é opcional. Reescrito.

Duas checagens novas no validador, ambas testadas com sabotagem: referência a coisa removida (metas, cenários, 3 dias) e estrutura de três conjuntos na semana 1.

## Sinal de que já passou do ponto

O `validar.py` tem agora 18 KB, do mesmo tamanho do `PLANO.md` inteiro. A ferramenta de conferência ficou tão grande quanto o que ela confere.

Isso não é bom sinal. O validador nasceu para pegar três ou quatro erros recorrentes. Depois de seis rodadas ele acumulou regras para cada erro específico que eu já cometi, incluindo exceções para as frases que explicam os próprios erros. Manter isso passa a custar mais do que vale: cada nova regra cria risco novo de falso positivo, e eu já gastei duas rodadas consertando o consertador.

O que ele faz bem, e vale manter: confere número, tabela, data e placeholder. São erros objetivos, que uma máquina pega melhor que uma pessoa. O que ele não faz, e nunca vai fazer, é julgar se o plano compra o que promete, ou se uma frase contradiz outra em raciocínio, não em número.

Recomendação prática: parar de revisar o documento por revisar. O material está consistente. O que falta é informação de fora, e isso nenhuma revisão interna resolve.

## Não verificado

Segue aberto. As ferramentas de busca e leitura de página foram bloqueadas pelo modo automático em todas as tentativas, nas três revisões.

- Disponibilidade do Spotify Ads no Brasil e investimento mínimo
- Limites de caractere do anúncio in-feed do Google
- Duração máxima e formatos aceitos no áudio do Spotify Ads
- Política vigente do Meta sobre música licenciada
- Retenção do Reel, que só o Instagram Insights mostra
- Duração, BPM e segundo do refrão da faixa

## Firme e estimativa

Firme: título, artista, links, contagem de caractere e aritmética de orçamento.

Estimativa sem base documental: todas as faixas de impressões, cliques, ouvintes e custo por ouvinte.

Não executável nesta faixa: pitch editorial, pré-save e todo o bloco de dias negativos do cronograma.
