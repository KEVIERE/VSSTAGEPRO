// Envio de e-mail em massa pelo Resend, sem dependências externas (testável em tests/).
//
// O endpoint é POST https://api.resend.com/emails/batch com um array JSON de até 100 e-mails.
// A resposta é POSICIONAL: data[i] corresponde ao e-mail i do array enviado. Isso é o que
// permite ligar cada resultado ao destinatário certo, mas só se a ordem for preservada em
// todos os passos. Por isso o lote é montado a partir de um array já ordenado e nunca é
// reordenado nem filtrado entre a montagem e a leitura da resposta.

export type ResendItem = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  headers?: Record<string, string>;
};

export type ResendResult =
  | { kind: 'sent'; index: number; providerId: string }
  | { kind: 'rejected'; index: number; error: string }
  | { kind: 'retry'; index: number; error: string };

export const RESEND_ENDPOINT = 'https://api.resend.com/emails/batch';

/**
 * Remetente da comunicação em massa. Separado do noreply@ do Supabase Auth de propósito:
 * quem responde um aviso cai numa caixa lida por gente, e denúncia de spam num endereço
 * transacional derrubaria a confirmação de conta junto.
 */
export const DEFAULT_FROM = 'VS Stage Pro <avisos@vsstagepro.com.br>';

/** Cabeçalhos que fazem o Gmail e o Outlook mostrarem o botão nativo de descadastro. */
export function unsubscribeHeaders(unsubUrl: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Lê a resposta do batch e devolve um resultado por item, na ordem recebida.
 *
 * Três desfechos, e tratá-los todos como falha seria errado:
 *  - 2xx: cada item tem id próprio. Item sem id é tratado como retry, nunca como enviado.
 *  - 400/422: o lote inteiro foi rejeitado e o Resend não diz qual item era o ruim. Quem
 *    chama deve dividir o lote em dois até isolar o culpado (ver `shouldSplit`).
 *  - 5xx/429/timeout: o lote pode ter saído em parte. Devolver para a fila é o certo: o pior
 *    caso vira duplicata, e duplicata é melhor que perder o aviso.
 */
export function readBatchResponse(status: number, payload: unknown, count: number): ResendResult[] {
  if (status >= 200 && status < 300) {
    const data = (payload as { data?: Array<{ id?: string; error?: string }> } | null)?.data;
    const out: ResendResult[] = [];
    for (let i = 0; i < count; i++) {
      const item = Array.isArray(data) ? data[i] : undefined;
      if (item?.id) out.push({ kind: 'sent', index: i, providerId: item.id });
      else out.push({ kind: 'retry', index: i, error: item?.error ?? 'resend_unconfirmed' });
    }
    return out;
  }

  const message = errorMessage(payload);
  if (status === 400 || status === 413 || status === 422) {
    return Array.from({ length: count }, (_, i) => ({ kind: 'rejected', index: i, error: message }));
  }
  return Array.from({ length: count }, (_, i) => ({ kind: 'retry', index: i, error: message }));
}

/** Mensagem do Resend, no formato que ela vem ({ message } ou { error: { message } }). */
export function errorMessage(payload: unknown): string {
  const p = payload as { message?: string; error?: string | { message?: string } | null } | null;
  if (!payload) return 'resend_error';
  if (typeof p?.error === 'string') return p.error.slice(0, 200);
  if (p?.error && typeof p.error === 'object' && p.error.message) return String(p.error.message).slice(0, 200);
  if (typeof p?.message === 'string') return p.message.slice(0, 200);
  return 'resend_error';
}

/**
 * Um lote rejeitado inteiro pode esconder um único endereço ruim. Dividir em dois e tentar
 * de novo isola o culpado sem descartar os outros 99. Abaixo de 2 itens não há o que dividir:
 * aí é falha de verdade.
 */
export function shouldSplit(results: ResendResult[], count: number): boolean {
  if (count < 2) return false;
  return results.length > 0 && results.every((r) => r.kind === 'rejected');
}

/**
 * Chave de idempotência do lote. O Resend aceita o header, mas o endpoint de batch não o
 * documenta, então nada aqui depende dele: serve para uma tentativa repetida do mesmo lote
 * não virar envio duplicado, se o serviço passar a honrar a chave.
 */
export async function batchIdempotencyKey(campaignId: string, firstId: number | string, lastId: number | string): Promise<string> {
  const raw = `${campaignId}:${firstId}:${lastId}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Só o que o Resend precisa, para o payload não vazar campo interno da fila. */
export function toResendItem(input: {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
  unsubUrl?: string;
}): ResendItem {
  return {
    from: input.from || DEFAULT_FROM,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
    ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    ...(input.unsubUrl ? { headers: unsubscribeHeaders(input.unsubUrl) } : {}),
  };
}
