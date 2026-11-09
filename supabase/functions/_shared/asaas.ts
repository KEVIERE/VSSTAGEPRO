// Chamadas à API do Asaas (https://docs.asaas.com). A chave vai no header access_token.
import { asaasBaseUrl } from './pix.ts';

export type AsaasPayment = {
  id: string;
  status: string;
  value: number;
  deleted?: boolean;
  billingType?: string;
  customer?: string;
  externalReference?: string | null;
};

export type AsaasPixQrCode = { encodedImage: string; payload: string; expirationDate?: string };

export class AsaasError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asaasClient(apiKey: string, env?: string | null, fetchFn: typeof fetch = fetch) {
  const base = asaasBaseUrl(apiKey, env);

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
        // o Asaas exige User-Agent nas contas criadas a partir de 13/06/2024
        'User-Agent': 'VSStagePro/1.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
    if (!res.ok) {
      const first = (data as { errors?: Array<{ code?: string; description?: string }> } | null)?.errors?.[0];
      throw new AsaasError(res.status, first?.code ?? `http_${res.status}`, first?.description ?? text.slice(0, 200));
    }
    return data as T;
  }

  return {
    createCustomer: (c: { name: string; email?: string; cpfCnpj: string; externalReference: string }) =>
      // notificationDisabled: o Asaas não manda e-mail/SMS próprio; o VS Stage mostra o QR Code na tela
      call<{ id: string }>('POST', '/customers', { ...c, notificationDisabled: true }),
    createPixPayment: (p: { customer: string; value: number; dueDate: string; description: string; externalReference: string }) =>
      call<AsaasPayment>('POST', '/payments', { ...p, billingType: 'PIX' }),
    getPixQrCode: (paymentId: string) => call<AsaasPixQrCode>('GET', `/payments/${encodeURIComponent(paymentId)}/pixQrCode`),
    getPayment: (paymentId: string) => call<AsaasPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`),
    deletePayment: (paymentId: string) => call<unknown>('DELETE', `/payments/${encodeURIComponent(paymentId)}`),
  };
}

export type AsaasClient = ReturnType<typeof asaasClient>;
