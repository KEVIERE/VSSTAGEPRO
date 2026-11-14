// Saúde dos pagamentos pela InfinitePay (PIX e cartão) para o monitoramento do admin.
// Contas puras, sem rede (testadas em tests/infinitepay-admin.test.mjs); quem consulta o
// banco e a API é a função health-check.
//
// A checagem nunca cria link de pagamento: ela só confere, em modo leitura, o último
// pedido já pago (POST /payment_check) ou, sem pedido pago, se o servidor deles responde.

export type InfinitePayApiProbe =
  | { ok: boolean; status: number }
  | { ok: false; status: null; error: string };

export type InfinitePayHealthInput = {
  /** Quais segredos existem (só se existem, nunca o valor). */
  env: { apiKey: boolean; handle: boolean; webhookUrl: boolean };
  /** Hora do último pagamento confirmado, se houver. */
  lastPaidAt: string | null;
  /** Hora do último aviso recebido no webhook, se houver. */
  lastWebhookAt?: string | null;
  /** Links que venceram nas últimas 24 h sem pagamento (informativo). */
  expiredUnpaid24h: number;
  /** Pagamentos com valor menor que o cobrado nos últimos 7 dias. */
  mismatch7d: number;
  /** Resultado da consulta à API, ou null quando não deu para testar. */
  api: InfinitePayApiProbe | null;
  latencyMs: number;
  now: Date;
};

export type InfinitePayHealth = {
  service: 'infinitepay';
  status: 'up' | 'down' | 'degraded';
  latencyMs: number;
  detail: string;
};

/** "há 5 min", "há 2 h", "há 3 dias". */
export function ago(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

export function infinitePayHealth(i: InfinitePayHealthInput): InfinitePayHealth {
  const faltando = [
    !i.env.apiKey && 'INFINITEPAY_API_KEY',
    !i.env.handle && 'INFINITEPAY_HANDLE',
    !i.env.webhookUrl && 'INFINITEPAY_WEBHOOK_URL',
  ].filter(Boolean) as string[];

  let status: InfinitePayHealth['status'] = 'up';
  const partes: string[] = [];

  if (faltando.length) {
    status = 'degraded';
    partes.push(`Falta configurar nos segredos: ${faltando.join(', ')}`);
  }

  const api = i.api;
  if (!api) {
    if (!faltando.length) partes.push('API não testada');
  } else if (api.status === null) {
    status = 'down';
    // o erro cru (em inglês) fica só no log da função; o admin vê o texto em português
    partes.push('InfinitePay não respondeu (sem resposta em alguns segundos ou erro de rede)');
  } else if (api.status === 401 || api.status === 403) {
    status = 'down';
    partes.push(`A InfinitePay recusou a chave (HTTP ${api.status})`);
  } else if (api.status >= 500) {
    status = 'down';
    partes.push(`InfinitePay fora do ar (HTTP ${api.status})`);
  } else if (!api.ok) {
    if (status === 'up') status = 'degraded';
    partes.push(`Conferência de pagamento respondeu HTTP ${api.status}`);
  } else if (!faltando.length) {
    partes.push('Link e confirmação de pagamento operando');
  }

  if (i.mismatch7d > 0) {
    if (status === 'up') status = 'degraded';
    partes.push(`${i.mismatch7d} ${i.mismatch7d === 1 ? 'pagamento' : 'pagamentos'} com valor menor que o cobrado em 7 dias: conferir no admin`);
  }

  const pago = ago(i.lastPaidAt, i.now);
  partes.push(pago ? `Último pagamento confirmado ${pago}` : 'Nenhum pagamento confirmado ainda');
  const aviso = ago(i.lastWebhookAt, i.now);
  if (aviso) partes.push(`último aviso recebido ${aviso}`);
  if (i.expiredUnpaid24h > 0) {
    partes.push(`${i.expiredUnpaid24h} ${i.expiredUnpaid24h === 1 ? 'link vencido' : 'links vencidos'} sem pagamento em 24 h`);
  }

  return { service: 'infinitepay', status, latencyMs: i.latencyMs, detail: partes.join('. ') + '.' };
}
