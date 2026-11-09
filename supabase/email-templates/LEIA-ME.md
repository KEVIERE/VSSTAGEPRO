# Modelos de e-mail

Os quatro modelos (`confirmation`, `recovery`, `email_change`, `magic_link`) valem para o
**ambiente local** enquanto estiverem apenas em `supabase/config.toml`. O projeto publicado
**não** lê esse arquivo: o que está no ar é o que foi enviado com

```bash
supabase config push --remote
```

Até 06/11/2026 os três modelos (redefinir senha, troca de e-mail e link mágico) estavam com o
conteúdo padrão do Supabase, sem logo e com assunto em inglês, porque nunca tinham sido
enviados ao projeto. Quem redefinia a senha recebia "Reset your password". Depois de qualquer
mudança aqui, rode o `config push` e confira com `supabase config diff --remote` (deve mostrar
zero diferenças em `template`).

## Avatar redondo ao lado do remetente

A logo dentro do corpo do e-mail é o `icon-192.png`, servido pelo site. O avatar **redondo**
que o Gmail mostra ao lado do nome do remetente é outra coisa: chama-se BIMI e exige, além de
DMARC em enforcement (`p=quarantine` ou `p=reject`; hoje o domínio usa `p=none`):

- um certificado de marca pago (VMC, para marca registrada, ou CMC), emitido por autoridade
  certificadora — não há caminho gratuito;
- o logo em SVG no perfil **Tiny PS** (sem filtros, sem máscaras, traçado convertido);
- o registro DNS `default._bimi.vsstagepro.com.br`.

O `logo-nova.svg` do site não serve para BIMI: usa 9 filtros e 1 máscara, que o formato proíbe.

## Topo em imagem

O topo dos cinco pontos de envio é uma imagem: a captura real do mixer (`public/site/mixer.jpg`)
com a marca fundida nela por degradê. Gerada por

```bash
node scripts/gerar-topo-email.mjs
```

e servida pelo site em `public/email-topo.jpg` (960px de largura, o dobro da coluna de 480).
Se a captura ou a logo mudarem, basta rodar o script de novo.

## Armadilha das duas colunas

A tabela do e-mail tem duas colunas por causa da faixa de acento de 3px na borda esquerda.
Qualquer `<tr>` que ocupe a largura toda precisa de `colspan="2"`, senão a célula cai na
coluna estreita e o conteúdo é esmagado — foi assim que a imagem do topo saiu a 3px de
largura, e antes disso a logo saiu 183px fora do centro.

Ao mexer no HTML, meça a largura exibida no navegador, não confie na aparência da captura:
`document.querySelector('img').getBoundingClientRect().width`.
