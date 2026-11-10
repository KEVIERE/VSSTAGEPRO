// Lê o endereço da página de volta da InfinitePay (sem dependências, testado em tests/pix.test.mjs).
//
// O link é criado com redirect_url = https://vsstagepro.com.br/?pagamento=<código>#assinatura
// e a InfinitePay acrescenta receipt_url, order_nsu, slug, capture_method e transaction_nsu.
// A documentação dela não diz onde: pode ser antes do # (?pagamento=…&order_nsu=…#assinatura)
// ou depois dele (#assinatura?order_nsu=… ou #assinatura&order_nsu=…). Por isso lê os dois lugares.
//
// Esses valores vêm do navegador e qualquer um pode mexer neles: servem só para o servidor
// perguntar à InfinitePay (/payment_check). Nada é liberado por causa deles.
import type { PixReturnCodes } from './pixCheckout';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SAFE_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

export type PixReturnInfo = {
  /** Nosso código do pedido (pix_payments.id), ou null em link gerado antes desta versão. */
  id: string | null;
  codes: PixReturnCodes;
  /** Como a pessoa pagou, segundo a InfinitePay: 'pix' ou 'credit_card'. */
  method: string | null;
};

export function readPixReturn(search: string, hash: string): PixReturnInfo {
  const h = hash.replace(/^#/, '');
  const cut = h.search(/[?&]/);
  const tail = cut >= 0 ? h.slice(cut + 1) : '';
  // "?" no meio (acréscimo feito sem cuidado) vira separador, como "&".
  const params = new URLSearchParams(`${search.replace(/^\?/, '')}&${tail}`.replace(/\?/g, '&'));

  const read = (key: string) => {
    const v = params.get(key);
    return v && SAFE_RE.test(v) ? v : undefined;
  };

  const id = params.get('pagamento')?.match(UUID_RE)?.[0]?.toLowerCase() ?? null;
  const codes: PixReturnCodes = {};
  const orderNsu = read('order_nsu');
  const transactionNsu = read('transaction_nsu');
  const slug = read('slug');
  if (orderNsu) codes.order_nsu = orderNsu;
  if (transactionNsu) codes.transaction_nsu = transactionNsu;
  if (slug) codes.slug = slug;

  return { id, codes, method: read('capture_method') ?? null };
}

/** O endereço é a volta de um pagamento, mesmo que o "#assinatura" tenha se perdido no caminho. */
export const isPixReturnSearch = (search: string) => /[?&]pagamento=/.test(search);
