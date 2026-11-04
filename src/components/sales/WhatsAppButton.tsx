import { MessageCircle } from 'lucide-react';
import { SITE_SUPPORT_MESSAGE, SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from '@/lib/support';

/**
 * Botão do WhatsApp que fica sempre no canto da tela do site: um toque abre a conversa com o
 * suporte, já com uma mensagem pronta. Tecla de aço da mesa, com o ícone verde do WhatsApp.
 * O estilo fica aqui (e não no sales.css) porque a página de preços também usa o botão.
 */
export default function WhatsAppButton({ message = SITE_SUPPORT_MESSAGE }: { message?: string }) {
  return (
    <a
      href={supportWhatsAppUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed z-40 right-4 bottom-4 sm:right-6 sm:bottom-6 flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full text-sm font-semibold text-[#e7e2d6] bg-[linear-gradient(180deg,#30353b,#1d2024)] shadow-[0_0_0_1px_rgba(231,226,214,0.1),inset_0_1px_0_rgba(255,255,255,0.1),0_14px_34px_-10px_rgba(0,0,0,0.9)] hover:brightness-125 transition-[filter] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#ffab1f]"
      aria-label={`Falar com o suporte no WhatsApp: ${SUPPORT_WHATSAPP_DISPLAY}`}
      title={`Suporte no WhatsApp: ${SUPPORT_WHATSAPP_DISPLAY}`}
    >
      <MessageCircle size={21} strokeWidth={2.2} className="text-[#25d366]" aria-hidden="true" />
      <span className="hidden sm:inline">Fale conosco</span>
    </a>
  );
}
