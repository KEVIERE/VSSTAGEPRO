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
