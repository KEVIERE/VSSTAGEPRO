// Aviso automático do Asaas: quando o PIX é pago, libera a assinatura sozinho.
// Configurar no Asaas: Integrações → Webhooks → URL desta função + token de autenticação
// (o mesmo valor do segredo ASAAS_WEBHOOK_TOKEN no Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { asaasClient } from '../_shared/asaas.ts';
import { handleAsaasWebhook } from '../_shared/asaasWebhook.ts';
import { applyPixPayment, closePendingPix } from '../_shared/pixDb.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const asaas = asaasClient(Deno.env.get('ASAAS_API_KEY') ?? '', Deno.env.get('ASAAS_ENV'));

Deno.serve((req) =>
  handleAsaasWebhook(req, {
    token: Deno.env.get('ASAAS_WEBHOOK_TOKEN'),
    getPayment: (id) => asaas.getPayment(id),
    applyPayment: (id, cents) => applyPixPayment(admin, id, cents),
    closePending: (id, status) => closePendingPix(admin, id, status),
    deletePayment: async (id) => { await asaas.deletePayment(id); },
    log: async (eventType, ok, detail) => {
      const { error } = await admin.from('webhook_events_log').insert({
        source: 'asaas', event_type: eventType, status: ok ? 'ok' : 'error', detail: detail.slice(0, 500),
      });
      if (error) console.error('asaas-webhook log', error);
      if (!ok) console.error('asaas-webhook', eventType, detail);
    },
    alert: async (text) => {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/telegram-alert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ message: text }),
        });
      } catch (e) {
        console.error('asaas-webhook telegram', e);
      }
    },
  })
);
