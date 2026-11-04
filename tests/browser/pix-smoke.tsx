// Tela de assinatura com PIX sem Asaas nem Supabase de verdade: a função pix-checkout é trocada por
// uma falsa. Abrir com o servidor de desenvolvimento: /tests/browser/pix-smoke.html
//   ?cenario=pago (padrão)  pede CPF, mostra o QR Code e confirma na 3ª consulta
//   ?cenario=vencido        o PIX vence enquanto a tela espera
//   ?cenario=valor          o pagamento chega com valor diferente
import { createRoot } from 'react-dom/client';
import SubscribeDialog from '../../src/components/SubscribeDialog';
import { AccessStage } from '../../src/components/access/AccessChrome';
import { supabase } from '../../src/lib/supabaseClient';
import { LICENSE_REFRESH_EVENT } from '../../src/lib/licenseEvents';
import '/src/index.css';

const cenario = new URLSearchParams(location.search).get('cenario') ?? 'pago';

// QR Code de mentira (xadrez), só para ver o tamanho e o enquadramento
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 196;
const g = canvas.getContext('2d')!;
g.fillStyle = '#fff'; g.fillRect(0, 0, 196, 196); g.fillStyle = '#000';
for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) if ((x * 7 + y * 13) % 5 < 2) g.fillRect(x * 7, y * 7, 7, 7);
const image = canvas.toDataURL('image/png').split(',')[1];

let created = 0;
let polls = 0;
const charge = (status: string, plan = 'yearly', amount = 34900) => ({
  id: '0b6f3f7e-6d2a-4b55-9a1e-3f1d2c4b5a69', plan, amount_cents: amount, status,
  expires_at: new Date(Date.now() + 36 * 3600_000).toISOString(),
  access_until: status === 'paid' ? new Date(Date.now() + 365 * 864e5).toISOString() : null,
  payload: status === 'pending' ? '00020101021226820014br.gov.bcb.pix2560qrpix-h.bradesco.com.br/9d36b84f-c70b-478f-b95c-12729b90ca255204000053039865406349.005802BR5905ASAAS6009JOINVILLE62070503***6304ABCD' : null,
  image: status === 'pending' ? image : null,
});
const fail = (error: string) => ({ data: null, error: { context: new Response(JSON.stringify({ error }), { status: 400 }) } });

// supabase.functions cria um cliente novo a cada acesso: troca o invoke no protótipo
(Object.getPrototypeOf(supabase.functions) as { invoke: unknown }).invoke = async (_name: string, { body }: { body: Record<string, unknown> }) => {
  await new Promise((r) => setTimeout(r, 500));
  console.log('[pix-checkout falso]', body);
  if (body.action === 'create') {
    created++;
    if (!body.cpfCnpj && created === 1) return fail('cpf_required');
    if (body.cpfCnpj && String(body.cpfCnpj).replace(/\D/g, '') !== '52998224725') return fail('invalid_cpf');
    return { data: charge('pending', String(body.plan), body.plan === 'monthly' ? 5500 : 34900), error: null };
  }
  polls++;
  if (polls < 3) return { data: charge('pending'), error: null };
  return { data: charge(cenario === 'vencido' ? 'expired' : cenario === 'valor' ? 'amount_mismatch' : 'paid'), error: null };
};
window.addEventListener(LICENSE_REFRESH_EVENT, () => console.log('[licença] conferir de novo'));

createRoot(document.getElementById('root')!).render(
  <AccessStage>
    <SubscribeDialog embedded title="Seu teste grátis terminou" subtitle="Faça sua assinatura para continuar usando o VS Stage Pro." />
  </AccessStage>,
);
