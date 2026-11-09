# Área de Comunicação (e-mail em massa e WhatsApp)

Aba **Comunicação** no painel admin (`#admin?aba=outreach`). Dois canais:

- **E-mail** pelo Resend. Já funciona: o domínio `vsstagepro.com.br` está verificado e a
  chave `RESEND_API_KEY` já está nos secrets (é a mesma usada no health-check).
- **WhatsApp** pela Twilio. A conta existe (é a mesma do SMS de confirmação de cadastro),
  mas o **número ainda precisa ser registrado como remetente de WhatsApp**.

## Secrets que precisam existir no Supabase

```bash
supabase secrets set OUTREACH_UNSUB_SECRET="<32 caracteres aleatórios>" --project-ref eknjqqiamuztomdygalv
supabase secrets set TWILIO_WHATSAPP_FROM="+5511985393676" --project-ref eknjqqiamuztomdygalv
supabase secrets set OUTREACH_FROM_EMAIL="VS Stage Pro <avisos@vsstagepro.com.br>" --project-ref eknjqqiamuztomdygalv
```

- `OUTREACH_UNSUB_SECRET` assina o link de descadastro. Sem ele, o link não é gerado.
  Trocar esse valor invalida todos os links já enviados.
- `TWILIO_WHATSAPP_FROM` é o número que envia no WhatsApp, em formato `+55DDDNÚMERO`.
  `TWILIO_ACCOUNT_SID` e `TWILIO_AUTH_TOKEN` já existem.
- `OUTREACH_FROM_EMAIL` é opcional. O padrão é `avisos@vsstagepro.com.br`, separado do
  `noreply@` do login de propósito: resposta de usuário cai numa caixa lida por gente, e uma
  denúncia de spam não derruba a confirmação de conta junto.

## Registrar o número no WhatsApp (só o dono do projeto pode fazer)

A aba mostra o estado real do remetente, mas a parte que a Meta exige não dá para fazer pelo
sistema. O caminho mais curto, que a própria Twilio recomenda para um número só:

1. **Portfólio Meta Business.** Entre em `business.facebook.com` com a conta que vai
   administrar o número. Se não tiver, crie. Confirme o e-mail e o telefone do negócio.
2. **Confirme que o número está livre no WhatsApp.** Se ele já usa WhatsApp normal num
   celular, precisa sair do app antes (o WhatsApp permite um número em um só lugar).
3. **Console da Twilio → Messaging → Senders → WhatsApp → Create new sender.**
   - escolha "Use my own number" e informe o número;
   - clique em "Continue with Facebook" e conclua o pop-up (é aqui que a WABA é criada);
   - confirme a solicitação de acesso da Twilio à sua conta Meta.
4. **Receba o código.** A Meta manda um código por SMS ou ligação para o número. Digite na
   tela de Remetente, no painel admin (ou no Console da Twilio).
5. **Nome de exibição.** `VS Stage Pro`. A Meta revisa o nome; se reprovar, o número fica
   limitado a 250 conversas iniciadas por dia até corrigir.

O estado do remetente aparece no painel: `DRAFT`, `PENDING_VERIFICATION`, `TWILIO_REVIEW`,
`ONLINE`. Enquanto não estiver `ONLINE`, o botão de envio em massa fica desabilitado com a
explicação.

### Se você quiser fazer pela API em vez do Console

A tela já faz isso quando o número é informado: envia `POST` para
`https://messaging.twilio.com/v2/Channels/Senders` com `sender_id: whatsapp:+55...`,
`profile.name` e `configuration.waba_id` + `verification_method`. Só funciona depois que a
WABA existir (passo 3 acima), porque é o pop-up da Meta que a cria.

## Templates de WhatsApp

Fora de uma conversa aberta nas últimas 24 horas, o WhatsApp só entrega **mensagem pronta
aprovada**. Por isso:

1. Aba Comunicação → WhatsApp → Mensagens prontas → escreva o texto com `{{nome}}` etc.
2. **Criar na Twilio** gera o modelo (Content API).
3. **Enviar para aprovação** manda para a Meta revisar. Costuma levar até um dia útil.
4. **Consultar estado** atualiza o resultado.

Os textos já semeados pela migração nascem como rascunho e precisam passar por 2 a 4.

A categoria **Aviso (UTILITY)** é a certa para prazo de teste, versão nova e pagamento.
**Marketing** é mais rígida e pode ser recusada se o conteúdo for de aviso.

## Limites que vêm do provedor, não do sistema

- **WhatsApp: uma mensagem a cada 3 segundos por número.** Mil números levam cerca de 50
  minutos, e a aba precisa ficar aberta. Fechar pausa a campanha; o histórico retoma.
- **Resend: 100 e-mails por chamada, 10 chamadas por segundo por equipe.** Mil e-mails saem
  em poucos segundos.
- Endereço que já deu bounce ou denunciou spam fica na **lista de supressão do Resend** e o
  envio é pulado, respondendo como sucesso. O histórico mostra o id de cada envio para você
  conferir o que realmente saiu.

## Descadastro

- Todo e-mail leva link de sair no rodapé e os cabeçalhos `List-Unsubscribe`, que fazem o
  Gmail e o Outlook mostrarem o botão nativo.
- Quem responde **SAIR**, **PARAR** ou **STOP** no WhatsApp entra na lista na hora (webhook
  `twilio-inbound`, com a assinatura `X-Twilio-Signature` conferida).
- Quem está na lista **não entra em nenhuma campanha seguinte**. A aba mostra quantos foram
  barrados antes de você disparar.
- Para reverter (a pessoa pediu para voltar), use `admin_outreach_optout_remove`.

## Ordem de publicação

```bash
bash scripts/upgrade-producao.sh --so-backend
```

Isso aplica a migração e publica as três funções novas (`outreach-send`,
`outreach-unsubscribe`, `twilio-inbound`). Depois o upgrade completo leva a tela ao ar.
