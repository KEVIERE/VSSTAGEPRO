# PIX pelo Asaas: como ligar

O cliente escolhe o plano, a tela mostra o QR Code e o código "copia e cola" com o valor certo, e a
assinatura é liberada sozinha quando o PIX cai. Ninguém precisa conferir nada à mão.

**Nunca coloque chaves ou tokens neste repositório (ele é público).** Eles ficam só nos segredos do
Supabase e no painel do Asaas.

## Peças

| Onde | O que faz |
|---|---|
| `supabase/migrations/20261104120000_pix_asaas_payments.sql` | Tabela `pix_payments`, tempo pago na licença (`pix_paid_until`) e a função que libera o tempo uma vez só |
| `supabase/functions/pix-checkout` | Gera o PIX no Asaas e responde a tela que fica conferindo o pagamento |
| `supabase/functions/asaas-webhook` | Recebe o aviso do Asaas, confere o token, confere o pagamento direto no Asaas e libera a assinatura |
| `src/components/PixCheckout.tsx` | Tela do QR Code, usada no programa (`SubscribeDialog`) e no site (`#planos`) |

Regras:
- **Mensal** libera 1 mês e **anual** libera 1 ano. O PIX não se renova sozinho. Pagar de novo soma o tempo
  depois do que ainda falta. Nos últimos 7 dias o programa mostra "Renovar" no topo.
- **Aviso repetido** não libera duas vezes.
- **Valor diferente** do cobrado não libera. O cliente vê "fale com o suporte" e chega um aviso no Telegram.
- **PIX vencido**: vale até 23:59 do dia seguinte. Depois a cobrança é apagada no Asaas e o QR Code deixa de
  valer. Gerar um PIX novo cancela o anterior. Se um PIX vencido for pago mesmo assim, o tempo é liberado.
- **Estorno**: não tira o acesso sozinho. Chega um aviso no Telegram para você decidir no painel do admin.
- O cartão (Stripe) continua funcionando igual.

## Segredos (Supabase → Edge Functions → Secrets)

| Nome | Valor |
|---|---|
| `ASAAS_API_KEY` | Chave de API do Asaas. A de testes começa com `$aact_hmlg_` e a de produção com `$aact_prod_`. O ambiente é escolhido pela chave. |
| `ASAAS_WEBHOOK_TOKEN` | Um texto aleatório de 32 caracteres ou mais. O mesmo valor vai no webhook do Asaas. |
| `ASAAS_ENV` | Opcional. Só para chave antiga sem `_hmlg_`/`_prod_`: `production` ou `sandbox`. |

Cadastre pelo painel do Supabase. Pelo terminal, a chave tem `$` e precisa de aspas simples.

## 1. Teste no sandbox (sem dinheiro de verdade)

1. Crie uma conta de testes em https://sandbox.asaas.com.
2. No sandbox, cadastre uma chave PIX aleatória (menu Pix → Minhas chaves).
3. Integrações → Chaves de API → gere a chave (começa com `$aact_hmlg_`).
4. Gere o token do aviso no Terminal do Mac: `openssl rand -hex 32`.
5. Supabase → SQL Editor: cole o arquivo da migração acima e rode.
6. Supabase → Edge Functions → Secrets: cadastre `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN`.
7. Publique as funções (na pasta do projeto, depois de `npx supabase login`):
   ```bash
   npx supabase functions deploy pix-checkout --project-ref eknjqqiamuztomdygalv --use-api
   npx supabase functions deploy asaas-webhook --project-ref eknjqqiamuztomdygalv --use-api --no-verify-jwt
   ```
8. Asaas sandbox → Integrações → Webhooks → Adicionar:
   - URL: `https://eknjqqiamuztomdygalv.supabase.co/functions/v1/asaas-webhook`
   - Versão da API: v3. Fila de sincronização: ativada.
   - Token de autenticação: o mesmo `ASAAS_WEBHOOK_TOKEN`.
   - Eventos: cobrança recebida, confirmada, vencida, removida e estornada
     (`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_REFUNDED`).
9. Teste: abra `#planos` (ou o programa com uma conta de teste vencida), escolha PIX, digite um CPF válido
   e gere o QR Code. No Asaas sandbox → Cobranças, abra a cobrança e clique em **Confirmar pagamento**.
   Em poucos segundos a tela mostra "Pagamento confirmado".

## 2. Produção

1. A conta Asaas de produção precisa estar aprovada e ter **chave PIX cadastrada**. Sem chave, o QR Code
   vale só até 23:59 do mesmo dia.
2. Antes de trocar a chave, apague os dados do teste (SQL Editor, uma vez só):
   ```sql
   DELETE FROM subscription_events
    WHERE kind = 'subscribed' AND user_id IN (SELECT user_id FROM pix_payments WHERE status = 'paid');
   DELETE FROM completed_sales WHERE provider = 'asaas';
   DELETE FROM checkout_intents WHERE provider = 'asaas';
   UPDATE director_licenses
      SET pix_paid_until = NULL, asaas_customer_id = NULL,
          plan = CASE WHEN subscription = 'active' THEN plan ELSE NULL END
    WHERE pix_paid_until IS NOT NULL OR asaas_customer_id IS NOT NULL;
   DELETE FROM pix_payments;
   ```
3. Troque `ASAAS_API_KEY` pela chave de produção (`$aact_prod_`). As funções não precisam ser publicadas de novo.
4. Crie o mesmo webhook na conta de produção do Asaas (mesma URL, mesmo token e mesmos eventos).
5. Faça o upgrade de produção para a tela nova aparecer no site e no app do Mac.

## Onde olhar quando algo falha

- Supabase → Edge Functions → `asaas-webhook` / `pix-checkout` → Logs.
- Tabela `webhook_events_log` (`source = 'asaas'`): cada aviso recebido e o resultado.
- Asaas → Integrações → Webhooks → Logs. Depois de 15 falhas seguidas o Asaas pausa a fila. Corrija e reative.
- Mesmo se um aviso se perder, a tela do cliente confere direto no Asaas a cada 15 segundos.

Fica de fora por enquanto: um PIX que vence sem renovar não aparece como "cancelamento" no painel do admin.
