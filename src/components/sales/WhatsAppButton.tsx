import { MessageCircle } from 'lucide-react';
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from '@/lib/support';

/**
 * Botão do WhatsApp que fica sempre no canto da tela do site: um toque abre a conversa com o
 * suporte, já com uma mensagem pronta.
 */
export default function WhatsAppButton({ message = 'Olá! Vim pelo site do VS Stage Pro e gostaria de tirar uma dúvida.' }: { message?: string }) {
  return (
    <a
      href={supportWhatsAppUrl(message)}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed z-40 right-4 bottom-4 sm:right-6 sm:bottom-6 flex items-center gap-2 h-12 pl-3.5 pr-4 rounded-full bg-[#25d366] hover:bg-[#20bd5a] text-white text-sm font-semibold shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-colors"
      aria-label={`Falar com o suporte no WhatsApp: ${SUPPORT_WHATSAPP_DISPLAY}`}
      title={`Suporte no WhatsApp: ${SUPPORT_WHATSAPP_DISPLAY}`}
    >
      <MessageCircle size={22} strokeWidth={2.2} />
      <span className="hidden sm:inline">Fale conosco</span>
    </a>
  );
}
