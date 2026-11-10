# Configuração pronta para colar nos gerenciadores

**Objetivo:** cliques no link que levam ao single no Spotify.
**Período:** 21 dias a partir da data de início que você escolher.
**Orçamento escolhido:** R$ 5.000,00.

**Dados confirmados da faixa:**

- Título oficial: `Por Que Demorou?` (com interrogação)
- Artista: Jonatha e Cristiano
- Spotify: https://open.spotify.com/track/0xN7r97Jg4LKgUMe5ktZyZ
- YouTube: https://youtu.be/BDWfh_Io5Gg
- Instagram Reel: https://www.instagram.com/reel/Dd_jP68yC3V/

A faixa já está publicada, então os prazos de pré-lançamento não valem mais. As URLs abaixo já estão preenchidas com o link oficial sem o parâmetro `si=`, que é rastreio de compartilhamento e não deve ir para anúncio.

Mantenha as três configurações alinhadas entre si. Esta ficha contém todos os textos nas formas em que as plataformas permitem copiar e colar. Ajuste apenas os itens marcados entre colchetes, que são dados reais da faixa e do artista.

---

## Meta Ads

Campanha: `PKD | Ouvintes BR | Nov2026`
Objetivo: Tráfego
Orçamento: R$ 3.000,00 para o período
Estratégia de lance: menor custo
Posicionamentos: manual
Excluir: Audience Network, Messenger, Facebook Marketplace, Facebook Stories

### Semana 1: um conjunto só, três anúncios dentro dele

**Correção importante de estrutura.** Antes eu propunha três conjuntos desde o dia 0 com R$ 100 por dia. Não cabe. R$ 100 divididos em três conjuntos dá R$ 33 por conjunto, e nesse valor as plataformas não têm dado suficiente para decidir nada. Pior: com três anúncios no mesmo conjunto e verba baixa, o Meta escolhe um vencedor em dois ou três dias e para de entregar os outros. Você não testa nada, só descobre o que ele escolheu sozinho.

A semana 1 tem um único conjunto de anúncios, com três anúncios dentro. O Meta testa os três contra o mesmo público, o que é a comparação limpa que você quer.

**Conjunto único (semana 1): R$ 100,00 por dia**

Público:
- Local: Brasil
- Idade: 24 a 45
- Gênero: todos
- Idioma: português
- Interesses: sertanejo, música sertaneja, música romântica, MPB
- Sem público semelhante. Semelhante só entra na semana 2, quando você já sabe quem respondeu

Posicionamentos:
- Instagram: feed, Reels, Stories
- Facebook: feed, vídeo in-stream, Reels

Os três anúncios dentro dele:
- Anúncio A: vídeo do refrão
- Anúncio B: vídeo da frase falada
- Anúncio C: estático da capa

Deixe a verba distribuída igual. Não mexa por 7 dias.

### Semana 2: dois conjuntos

Só agora divida, e só se a semana 1 deu sinal.

**Conjunto 1 (60% da verba da semana 2): público do vencedor**
- O mesmo público do conjunto único, com o anúncio que ganhou na semana 1
- É a continuação do que funcionou, não um teste novo

**Conjunto 2 (40%): base própria**
Público diferente do conjunto 1. Em ordem de preferência:

1. Semelhante aos seguidores do Instagram do artista (1% a 2%), se o perfil tiver base suficiente
2. Público personalizado por lista de e-mails ou telefones, se houver
3. Sem filtro de interesse, só Brasil 24 a 45, para servir de comparação limpa

Este conjunto nunca deve repetir os interesses do conjunto 1.

### Semana 3: cidade base, se fizer sentido

Só na semana 3, e só se houver base local de verdade. Não ative se o networking local não for o foco.

- Local: [cidade, raio de 40 km]
- Idade: 18 a 55
- Posicionamentos: automáticos
- Verba: sai do conjunto que estiver pior, não de verba nova

### Criativo 1: vídeo do refrão

Arquivo: `video_refrao_15s.mp4` com proporção 9:16, 1080 por 1920. Se você usar o Reel Dd_jP68yC3V no lugar, exporte o arquivo original, não grave a tela: gravação de tela perde qualidade e pode carregar a interface do Instagram.

Título (40 caracteres):
```
Por Que Demorou? - Jonatha e Cristiano
```

Texto principal (125 caracteres):
```
Toda história de amor tem um "por que demorou".
A nossa virou música. Ouça o single completo.
```

Descrição (30 caracteres):
```
Ouça agora no Spotify
```

URL de destino:
```
https://open.spotify.com/track/0xN7r97Jg4LKgUMe5ktZyZ?utm_source=meta&utm_medium=paid&utm_campaign=pkd_ouvintes_br&utm_content=video_refrao
```

### Criativo 2: vídeo da frase falada

Título (40 caracteres):
```
Essa música é sobre chegar atrasado
```

Texto principal (125 caracteres):
```
Se você já amou alguém que chegou na hora errada,
essa música é sua. Ouça agora.
```

Descrição (30 caracteres):
```
Nova música romântica
```

URL de destino: o mesmo modelo do criativo 1, trocando `utm_content=video_frase`.

### Criativo 3: estático da capa

Imagem: a capa do single, proporção 4:5, e uma versão 1:1 com a capa sobre fundo desfocado.
Título (40 caracteres):
```
A música que você vai ouvir 3 vezes
```
Texto principal (125 caracteres):
```
Por Que Demorou? Jonatha e Cristiano.
Uma pergunta que todo mundo já fez.
```
URL de destino: o mesmo modelo, com `utm_content=estatico_capa`.

### Regras de decisão

- Dia 7: desligue o criativo cujo custo por clique passar de 2 vezes a média. Mantenha os outros dois. Não decida antes disso: com menos de uma semana de dados você corta o vencedor por acaso.
- Dia 14: desligue tudo que estiver acima da média e concentre o orçamento no criativo vencedor.
- Rode sempre com CBO desligado. O criativo precisa de verba própria para você comparar, não para o algoritmo escolher por você.

---

## Google Ads

Campanha: `PKD | Video | BR | Nov2026`
Subtipo: Vídeo, formato in-feed
Orçamento diário: R$ 59,52 (R$ 1.250 dividido por 21 dias)
Lance: limite de custo por visualização. Campanha de vídeo no Google não é cobrada por clique, e sim por visualização (CPV) ou por impressão (CPM). Confirme qual opção o seu gerenciador oferece antes de definir o valor e use o custo por visualização que o Meta entregar como referência de partida, não um número fixo.

### Grupo de anúncios 1: afinidade musical

Públicos por afinidade:
- Amantes de música
- Fãs de música latina
- Fãs de música pop
- Fãs de música country

Colocações por canal, adicione apenas os que existirem na lista:
- Canais oficiais de artistas de referência do sertanejo romântico
- Playlists e canais de música romântica brasileira

### Grupo de anúncios 2: colocação manual

Não use segmentação por intenção nem palavra-chave negativa: as duas não existem em campanha de vídeo. Este grupo se controla por colocação.

- Públicos por afinidade: fãs de música sertaneja, fãs de música romântica
- Exclusão de canais: canais de cifra, letra, karaokê e aula de violão, se você quiser barrar esse inventário
- Demografia: Brasil, 24 a 45

### Anúncio de vídeo

Os limites de caractere da campanha de vídeo do Google não são os mesmos do Meta e mudam conforme o formato. Antes de colar, veja o contador no próprio gerenciador. Os textos abaixo foram escritos curtos o suficiente para caber nos limites mais usados, mas confira.

Título A:
```
Por Que Demorou? - Jonatha e Cristiano
```
Título B:
```
Nova música romântica brasileira
```

Descrição A:
```
O single que fala sobre a pessoa que chegou na hora certa. Ouça no Spotify.
```
Descrição B:
```
Voz, violão e uma pergunta que todo mundo já fez. Ouça agora.
```

URL final:
```
https://open.spotify.com/track/0xN7r97Jg4LKgUMe5ktZyZ?utm_source=google&utm_medium=paid&utm_campaign=pkd_ouvintes_br&utm_content=video_refrao
```

Nome de exibição: `Jonatha e Cristiano`

---

## Spotify Ads

Campanha: `PKD | Audio 30s | BR`
Objetivo: Alcance ou cliques, conforme as opções mostradas na sua conta
Período: 21 dias, a partir do dia 0
Investimento: R$ 750, o mínimo pode ser maior. Confirme antes de reservar.

**Confirme antes de reservar verba aqui:** o autoatendimento da Spotify mudou de nome de Ad Studio para Spotify Ads Manager, e a lista de países com autoatendimento varia. Cheque em `ads.spotify.com` se o Brasil aparece na sua conta e qual é o mínimo por campanha. Se não aparecer, cancele este bloco do plano e redistribua os R$ 750 para o Meta. A campanha funciona sem o Spotify, só perde o toque dentro do aplicativo.

Segmentação:
- Mercado: Brasil
- Faixa de idade: 25 a 44, se disponível
- Gênero: sertanejo, pop, música brasileira
- Playlist de contexto: romântico, modão, sofrência

Áudio: `audio_30s.mp3`
Duração: 30 segundos. O formato de áudio do autoatendimento tem limite curto, na casa de 30 segundos, mas confirme a especificação exata (duração máxima, formatos aceitos, taxa de amostragem) na página de especificações da sua conta antes de exportar. O roteiro abaixo foi montado para caber em 30 s com folga de segurança zero, então não acrescente nada.

Roteiro do áudio:
```
[0,0 s a 2,0 s]   Locução: "Por Que Demorou? Jonatha e Cristiano."
[2,0 s a 22,0 s]  Refrão completo, sem corte no meio.
[22,0 s a 27,0 s] Locução: "Toca no Spotify. Está no seu perfil."
[27,0 s a 30,0 s] Assinatura instrumental, sem fala.
```

Regra: nenhuma fala por cima do refrão. O anúncio tem que soar como música, não como propaganda.

URL de destino:
```
https://open.spotify.com/track/0xN7r97Jg4LKgUMe5ktZyZ?utm_source=spotify&utm_medium=paid&utm_campaign=pkd_ouvintes_br&utm_content=audio_30s
```

---

## Resumo de orçamento: R$ 5.000

| Canal | Diário (média) | Total 21 dias | % |
|---|---|---|---|
| Meta Ads | R$ 142,86 | R$ 3.000,00 | 60% |
| Google Ads | R$ 59,52 | R$ 1.250,00 | 25% |
| Spotify Ads (se disponível no Brasil) | R$ 35,71 | R$ 750,00 | 15% |
| **Total** | **R$ 238,09** | **R$ 5.000,00** | 100% |

Os diários da tabela estão arredondados para o centavo, como o gerenciador pede. Somados, dão R$ 238,09, um centavo abaixo dos R$ 238,10 da divisão exata. É arredondamento, não erro de conta.

O diário do Meta é média. O valor real por dia muda conforme a onda, na tabela seguinte.

### Distribuição por onda no Meta

| Semana | Período | Dias | Percentual | Valor | **Diário no Meta** |
|---|---|---|---|---|---|
| Descoberta | dia 0 a 6 | 7 | 23% | R$ 700 | **R$ 100,00** |
| Leitura | dia 7 a 13 | 7 | 33% | R$ 1.000 | **R$ 142,86** |
| Escala | dia 14 a 20 | 7 | 44% | R$ 1.300 | **R$ 185,71** |
| **Total** | 21 dias | 21 | 100% | **R$ 3.000** | média R$ 142,86 |

A coluna do diário é o número que você digita no gerenciador. Ele sobe com o tempo, não é o valor médio. Gasta pouco enquanto descobre qual criativo e qual público funcionam, gasta mais depois que já sabe.

**A semana 3 só acontece se a semana 1 justificar.** Se a taxa de salvamento vier abaixo de 10% ou o custo por clique muito acima do esperado, mantenha em R$ 100 e conserte o criativo. Escalar o que não funciona multiplica o prejuízo.

Ajuste o orçamento diário do conjunto a cada onda. Não deixe fixo do dia 0 ao 20, ou você perde o pico do lançamento, que é quando o algoritmo do Spotify está testando a faixa com público novo.

---

## O que falta preencher

Já resolvido: link do Spotify, título oficial, link do YouTube e link do Reel.

Continua pendente:

- [ ] `[cidade base]`, se a semana 3 usar cidade base
- [ ] Duração real da faixa e o segundo em que o refrão começa. Use o Reel que já existe como referência: se ele usa um trecho, veja qual.
- [ ] O verso da letra que explica o título, para o texto na tela
- [ ] A capa final do single, em alta. A do Spotify está em 300 por 300 no oEmbed; peça o arquivo original ao distribuidor.
- [ ] Data de início da campanha

## Sobre o Reel que já existe

O Reel em https://www.instagram.com/reel/Dd_jP68yC3V/ já é um criativo pronto. Antes de gravar qualquer coisa nova:

1. Veja a retenção dele no Instagram Insights. Se passar de 50% nos primeiros 3 segundos, você já tem o criativo vencedor e não precisa produzir outro.
2. Se estiver abaixo, o problema é o gancho inicial, e a versão do refrão nos primeiros 2,5 segundos resolve.
3. Não descarte o Reel: mesmo com retenção baixa, ele serve de prova social no anúncio, e o público que já viu tende a clicar mais no primeiro contato pago.

O Reel também pode ser reaproveitado como anúncio no Meta sem regravação, desde que esteja em 9:16 e sem marca d'água de outro aplicativo na área visível.
