// Valores que o banco ainda guarda do provedor de cartão antigo (antes da InfinitePay).
// São só contrato com o servidor: a tela nunca mostra esse nome. Vendas e linhas de
// saúde antigas usam esse valor em completed_sales.provider e service_health.service.
export const LEGACY_PROVIDER = 'stripe';

/** Linha de saúde do provedor antigo, que o health-check novo não grava mais. */
export const isLegacyService = (service: string) => service === LEGACY_PROVIDER;
