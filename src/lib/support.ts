// Contato e suporte do VS Stage Pro: o WhatsApp do dono do projeto. Todo botão de suporte ou
// contato do site usa este número (trocar aqui troca em todos).

/** Número no formato do WhatsApp (país + DDD + número, só dígitos). */
export const SUPPORT_WHATSAPP_NUMBER = '5511985393676';

/** Como o número aparece na tela. */
export const SUPPORT_WHATSAPP_DISPLAY = '(11) 98539-3676';

/** Link que abre a conversa no WhatsApp, já com uma mensagem pronta (opcional). */
export function supportWhatsAppUrl(message?: string): string {
  const text = message?.trim();
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Mensagem pronta de quem chama o suporte pelo site. */
export const SITE_SUPPORT_MESSAGE = 'Olá! Vim pelo site do VS Stage Pro e gostaria de tirar uma dúvida.';

/** Número só com dígitos, do formato +55DDDNÚMERO (E.164) para o link do WhatsApp. */
export function waDigits(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

/**
 * Link que abre a conversa com UMA pessoa, já com o texto pronto.
 *
 * É o caminho sem custo: o dono do projeto clica, confere o texto no WhatsApp e aperta
 * enviar. Serve para mandar para poucas pessoas hoje, sem conta de API, sem template
 * aprovado e sem risco de o número de suporte ser bloqueado por disparo em massa.
 */
export function personWhatsAppUrl(phone: string | null | undefined, message: string): string | null {
  const d = waDigits(phone);
  const text = message?.trim();
  // Sem telefone válido, devolve null: cair no número do suporte mandaria a mensagem do
  // usuário para o dono do projeto, que é pior do que não ter o botão.
  if (!d) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
