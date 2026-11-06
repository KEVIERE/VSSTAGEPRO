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
