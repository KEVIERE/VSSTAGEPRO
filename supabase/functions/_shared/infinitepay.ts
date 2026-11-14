// Cliente da API da InfinitePay (Checkout Integrado).
//
// O fluxo é diferente do Asaas: a InfinitePay não devolve o QR Code do PIX nem o
// código copia-e-cola. Ela cria um LINK de pagamento e o cliente paga lá dentro,
// escolhendo PIX ou cartão. Por isso a tela do site redireciona em vez de mostrar
// o QR: é o único jeito com a API deles.
//
// Sem sandbox: o botão "Testar API" da documentação cria um link REAL na conta.
// O teste é um pagamento de R$ 1,00, estornado depois pelo app.

export const INFINITEPAY_API_BASE = 'https://api.checkout.infinitepay.io';
const BASE = INFINITEPAY_API_BASE;

export class InfinitePayError extends Error {
  // Campos atribuídos no corpo (e não como "parameter property"): o Node roda os
  // testes em modo strip-only e não aceita aquele atalho do TypeScript.
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `infinitepay_${status}`);
    this.name = 'InfinitePayError';
    this.status = status;
    this.body = body;
  }
}

export type InfinitePayItem = {
  quantity: number;
  /** Valor em CENTAVOS. R$ 10,00 = 1000. */
  price: number;
  description: string;
};

export type InfinitePayOptions = {
  /** Até quantas parcelas o vendedor absorve a taxa (0 a 12). */
  assured_installments?: number;
  require_delivery_address?: boolean;
  /** Bloqueia a reutilização do link depois de pago. */
  single_payment?: boolean;
  /** ISO 8601, no futuro e dentro de 1 ano. */
  valid_until?: string;
  /** O cartão é sempre aceito; só o PIX pode ser desligado. */
  payment_methods_enabled?: ('credit_card' | 'pix')[];
  discounts?: { pix?: number; credit_card?: number };
};

export type CreateLinkInput = {
  /** InfiniteTag sem o "$". Dispensável quando há API Key. */
  handle?: string;
  items: InfinitePayItem[];
  /** Identificador do pedido no nosso sistema. */
  order_nsu?: string;
  redirect_url?: string;
  /** String simples (avisa só aprovação) ou lista de eventos. */
  webhook_url?: string;
  customer?: { name?: string; email?: string; phone_number?: string };
  options?: InfinitePayOptions;
};

export type CreatedLink = { url: string };

export type PaymentCheckInput = {
  handle?: string;
  order_nsu?: string;
  transaction_nsu?: string;
  slug?: string;
};

export type PaymentCheck = {
  success: boolean;
  paid: boolean;
  /** Valor original da cobrança, em centavos. */
  amount?: number;
  /** Pode ser MAIOR que `amount` quando o cliente parcelou com taxas. */
  paid_amount?: number;
  installments?: number;
  capture_method?: string;
};

/** Corpo que a InfinitePay envia no webhook. */
export type WebhookBody = {
  invoice_slug?: string;
  amount?: number;
  paid_amount?: number;
  installments?: number;
  capture_method?: string;
  transaction_nsu?: string;
  order_nsu?: string;
  receipt_url?: string;
  items?: unknown[];
};

/** Forma de pagamento que guardamos: 'pix', 'credit_card' ou null (desconhecida). */
export type CaptureMethod = 'pix' | 'credit_card';

/**
 * Normaliza o capture_method que o /payment_check devolve. Só 'pix' e 'credit_card'
 * entram no banco; qualquer outro texto vira null, para a tela não mostrar lixo.
 */
export function normalizeCaptureMethod(value: unknown): CaptureMethod | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'pix') return 'pix';
  if (v === 'credit_card' || v === 'credit' || v === 'card') return 'credit_card';
  return null;
}

/** Número de parcelas entre 1 e 24, ou null. */
export function normalizeInstallments(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : null;
}

/**
 * Comprovante que o aviso traz. O aviso não tem assinatura, então só aceitamos um
 * endereço https da própria InfinitePay: um aviso forjado não consegue pôr um link
 * qualquer no painel do admin.
 */
export function safeReceiptUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    const ours = host === 'infinitepay.io' || host.endsWith('.infinitepay.io')
      || host === 'infinitepay.com.br' || host.endsWith('.infinitepay.com.br');
    return u.protocol === 'https:' && ours ? u.toString() : null;
  } catch {
    return null;
  }
}

/** O que o servidor grava junto com a liberação: sempre vindo da conferência, nunca do aviso. */
export type Confirmation = {
  transactionNsu: string | null;
  slug: string | null;
  captureMethod: CaptureMethod | null;
  installments: number | null;
  receiptUrl: string | null;
};

export function infinitePayClient(apiKey: string, fetchFn: typeof fetch = fetch) {
  async function call<T>(method: string, path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // A chave vai SÓ no servidor, neste header. Com ela, a handle é dispensável.
    if (apiKey) headers['X-Api-Key'] = apiKey;

    const res = await fetchFn(`${BASE}${path}`, {
      method,
      headers,
      body: JSON.stringify(body),
    });

    const texto = await res.text();
    let dados: unknown = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    if (!res.ok) throw new InfinitePayError(res.status, dados);
    return dados as T;
  }

  return {
    criarLink: (input: CreateLinkInput) => call<CreatedLink>('POST', '/links', input),

    /**
     * Confirma um pagamento. O webhook da InfinitePay NÃO tem assinatura, então
     * esta consulta é a única forma de saber que o aviso é verdadeiro: um
     * terceiro pode forjar o POST, mas não consegue forjar esta resposta.
     */
    conferirPagamento: (input: PaymentCheckInput) => call<PaymentCheck>('POST', '/payment_check', input),
  };
}

export type InfinitePayClient = ReturnType<typeof infinitePayClient>;
