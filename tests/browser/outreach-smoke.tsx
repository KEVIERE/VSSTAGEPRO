// Aba de Comunicação sem Supabase nem Twilio de verdade: as RPCs e a Edge Function são
// trocadas por respostas falsas. Abrir com o servidor de desenvolvimento:
//   /tests/browser/outreach-smoke.html
//   ?cenario=email      (padrão) e-mail com público, prévia e histórico
//   ?cenario=whatsapp   remetente ainda não liberado (envio bloqueado)
//   ?cenario=online     remetente liberado, com estimativa de tempo
//   ?cenario=erro       falha na contagem de público
import { createRoot } from 'react-dom/client';
import { supabase } from '../../src/lib/supabaseClient';
import OutreachTab from '../../src/components/admin/OutreachTab';
import type { OutreachPerson } from '../../src/components/admin/adminApi';
import '/src/index.css';

const cenario = new URLSearchParams(location.search).get('cenario') ?? 'email';

type Row = Record<string, unknown>;

const PESSOAS = [
  { user_id: 'u1', address: 'ana@exemplo.com', name: 'Ana Souza', state: 'trial' },
  { user_id: 'u2', address: 'bruno@exemplo.com', name: 'Bruno Lima', state: 'active' },
  { user_id: 'u3', address: 'carla@exemplo.com', name: 'Carla Dias', state: 'expired' },
  { user_id: 'u4', address: 'diego@exemplo.com', name: 'Diego Alves', state: 'active' },
  { user_id: 'u5', address: 'elisa@exemplo.com', name: 'Elisa Rocha', state: 'trial' },
];

const AUDIENCIA = {
  channel: 'email',
  eligible: cenario === 'online' ? 812 : 1287,
  sem_contato: 214,
  email_invalido: 9,
  descadastrado: 33,
  by_state: { trial: 640, active: 402, expired: 180, promo: 65 },
  sample: PESSOAS,
};

const MODELOS = [
  {
    id: 't1', name: 'Teste terminando', channel: 'email',
    subject: 'Seu teste do VS Stage Pro termina em breve',
    body: 'Oi, {{nome}},\n\nSeu teste grátis do VS Stage Pro termina em {{quando}}.\n\nPara continuar com o programa liberado no palco, é só assinar.',
    variables: ['nome', 'quando'], twilio_content_sid: null, approval_status: 'draft',
    approval_category: 'UTILITY', active: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 't2', name: 'Versão nova disponível', channel: 'email',
    subject: 'Nova versão do VS Stage Pro para baixar',
    body: 'Oi, {{nome}},\n\nSaiu a versão {{versao}} do VS Stage Pro.',
    variables: ['nome', 'versao'], twilio_content_sid: null, approval_status: 'draft',
    approval_category: 'UTILITY', active: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'w1', name: 'Teste terminando (WhatsApp)', channel: 'whatsapp', subject: null,
    body: 'Oi, {{1}}! Seu teste do VS Stage Pro termina em {{2}}. Responda SAIR para não receber mais mensagens.',
    variables: ['nome', 'quando'], twilio_content_sid: 'HX1234567890abcdef', approval_status: 'approved',
    approval_category: 'UTILITY', active: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'w2', name: 'Versão nova (WhatsApp)', channel: 'whatsapp', subject: null,
    body: 'Oi, {{1}}! Saiu a versão nova do VS Stage Pro. Responda SAIR para não receber mais mensagens.',
    variables: ['nome'], twilio_content_sid: null, approval_status: 'draft',
    approval_category: 'UTILITY', active: true,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
];

const HISTORICO = [
  {
    id: 'c1', channel: 'email', title: 'Versão nova disponível', subject: 'Nova versão do VS Stage Pro para baixar',
    status: 'done', total: 1180, created_at: new Date(Date.now() - 864e5 * 2).toISOString(),
    started_at: new Date(Date.now() - 864e5 * 2).toISOString(), finished_at: new Date(Date.now() - 864e5 * 2 + 6e4).toISOString(),
    created_by_email: 'voce@vsstagepro.com.br', sent: 1162, failed: 12, skipped: 6, pending: 0, stalled: false,
  },
  {
    id: 'c2', channel: 'whatsapp', title: 'Aviso de teste', subject: null,
    status: 'paused', total: 64, created_at: new Date(Date.now() - 36e5 * 5).toISOString(),
    started_at: new Date(Date.now() - 36e5 * 5).toISOString(), finished_at: null,
    created_by_email: 'voce@vsstagepro.com.br', sent: 21, failed: 3, skipped: 0, pending: 40, stalled: false,
  },
  {
    id: 'c3', channel: 'email', title: 'Mensagem para Ana Souza', subject: 'Uma dúvida rápida',
    status: 'running', total: 1, created_at: new Date(Date.now() - 6e4 * 9).toISOString(),
    started_at: new Date(Date.now() - 6e4 * 9).toISOString(), finished_at: null,
    created_by_email: 'voce@vsstagepro.com.br', sent: 0, failed: 0, skipped: 0, pending: 1, stalled: true,
  },
];

const DETALHE = {
  campaign: { ...HISTORICO[0], body: '', variables: [], content_sid: null, reply_to: null },
  counts: { sent: 1162, failed: 12, skipped: 6, pending: 0 },
  recipients: [
    { id: 1, address: 'ana@exemplo.com', name: 'Ana Souza', status: 'sent', provider_id: 're_1', error: null, attempts: 1, sent_at: new Date().toISOString() },
    { id: 2, address: 'bruno@exemplo.com', name: 'Bruno Lima', status: 'sent', provider_id: 're_2', error: null, attempts: 1, sent_at: new Date().toISOString() },
    { id: 3, address: 'invalido@', name: 'Conta estranha', status: 'failed', provider_id: null, error: 'resend_rejected', attempts: 3, sent_at: null },
    { id: 4, address: 'carla@exemplo.com', name: 'Carla Dias', status: 'skipped', provider_id: null, error: 'optout', attempts: 1, sent_at: null },
  ],
};

const RPC: Record<string, (p?: Row) => unknown> = {
  admin_outreach_audience: () => ({ ...AUDIENCIA, channel: cenario === 'whatsapp' || cenario === 'online' ? 'whatsapp' : 'email' }),
  // No WhatsApp o endereço é o telefone: é o que o botão de conversa manual usa.
  admin_outreach_audience_list: (p) => (p?.p_channel === 'whatsapp'
    ? PESSOAS.map((x, i) => ({ ...x, address: ['+5511985393676', '+5511912345678', '+5511977776666', '+5511955554444', '+5511933332222'][i] }))
    : PESSOAS),
  admin_outreach_templates: (p) => MODELOS.filter((m) => !p?.p_channel || m.channel === p.p_channel),
  admin_outreach_list: () => HISTORICO,
  admin_outreach_detail: () => DETALHE,
  admin_outreach_create: (p) => {
    // Os endereços são o que interessa no teste de seleção: null = base inteira do filtro.
    console.log('[rpc falsa] create addresses', JSON.stringify(p?.p_addresses ?? null), 'state', JSON.stringify(p?.p_state ?? null));
    return { id: 'c-nova', total: 1287, skipped: [] };
  },
  admin_outreach_channel_state: () => ({}),
  admin_outreach_optout_list: () => [],
};

const EDGE: Record<string, (p?: Row) => unknown> = {
  'sender-status': () => ({
    ok: true,
    phone: '+5511985393676',
    online: cenario === 'online',
    sender: cenario === 'online'
      ? { sid: 'XX1', status: 'ONLINE', displayName: 'VS Stage Pro', displayNameStatus: 'APPROVED', pendingDisplayName: null, offlineReasons: [] }
      : {
        sid: 'XX1', status: 'PENDING_VERIFICATION', displayName: 'VS Stage Pro', displayNameStatus: 'PENDING_REVIEW',
        pendingDisplayName: null,
        offlineReasons: ['Nome de exibição em análise pelo WhatsApp'],
      },
  }),
  run: (p) => {
    // Avança um lote por chamada, como o servidor faria. Com `?lento=1` cada lote fica parado
    // até a janela liberar (`window.__liberarLote()`), o que dá controle exato para o teste
    // de pausa: o laço só anda quando o teste manda.
    const lento = new URLSearchParams(location.search).get('lento') === '1';
    const lote = (window as unknown as { __lote?: number }).__lote ?? 0;
    (window as unknown as { __lote?: number }).__lote = lote + 1;
    const enviados = Math.min(1287, (lote + 1) * 100);
    const resposta = {
      ok: true, paused: enviados < 1287, done: enviados >= 1287,
      sent: enviados, failed: lote, left: 1287 - enviados, eta: 'cerca de 40 minutos',
      runToken: 'token-' + p?.campaignId,
    };
    if (!lento) return resposta;
    return new Promise((resolve) => {
      (window as unknown as { __filaLote?: Array<() => void> }).__filaLote ??= [];
      (window as unknown as { __filaLote: Array<() => void> }).__filaLote.push(() => resolve(resposta));
    });
  },
  pause: () => ({ ok: true }),
};

let seq = 0;

// callEdgeFn exige um access_token da sessão antes de chamar a função. Sem isso, toda ação de
// Edge Function falharia com not_authenticated antes de chegar ao fetch falso.
(Object.getPrototypeOf(supabase.auth) as { getSession: unknown }).getSession = async () => ({
  data: { session: { access_token: 'token-de-teste' } },
  error: null,
});

(Object.getPrototypeOf(supabase) as { rpc: unknown }).rpc = async (fn: string, args?: Row) => {
  await new Promise((r) => setTimeout(r, 120));
  const handler = RPC[fn];
  if (!handler) return { data: null, error: { message: `rpc falsa desconhecida: ${fn}` } };
  if (cenario === 'erro' && fn === 'admin_outreach_audience') {
    return { data: null, error: { message: 'not_allowed' } };
  }
  return { data: handler(args), error: null };
};

// callEdgeFn usa fetch direto em /functions/v1/<nome>. Intercepta e responde localmente.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const m = url.match(/\/functions\/v1\/([\w-]+)$/);
  if (m) {
    const body = init?.body ? (JSON.parse(String(init.body)) as Row) : {};
    const handler = EDGE[String(body.action)];
    await new Promise((r) => setTimeout(r, 300));
    // O handler pode devolver uma promise (o `run` em modo lento espera a liberação). Sem o
    // await, o fetch devolveria {} e o motor giraria sem avançar, que é justamente o que o
    // teste de pausa precisa observar.
    const payload = handler
      ? await (handler(body) as unknown)
      : { error: `ação falsa desconhecida: ${String(body.action)}` };
    console.log('[edge falsa]', m[1], body.action, payload);
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input as RequestInfo, init);
};

function Harness() {
  // Simula a escolha da pessoa no drawer de Usuários em um dos cenários.
  const individual: OutreachPerson | null = new URLSearchParams(location.search).get('individual')
    ? { user_id: 'u1', address: 'ana@exemplo.com', name: 'Ana Souza', state: 'trial' }
    : null;
  void seq;
  seq++;
  return (
    <div style={{ minHeight: '100vh', background: '#0a0b0d' }}>
      <div className="max-w-6xl mx-auto p-6">
        <OutreachTab composeTo={individual} onClearCompose={() => {}} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
