import { useState } from 'react';
import { Inbox, Loader2, Check, AlertTriangle, Send } from 'lucide-react';
import { producerRequestRepertoire } from '@/lib/prompterAudio';
import { useNetworkMode } from '@/lib/localNetwork';

/**
 * Pedido do repertório.
 *
 * O áudio chega quando o diretor aperta "Enviar repertório" e sai (do Supabase ou do Mac do
 * diretor) 10 minutos depois de o produtor salvar as letras. Para ouvir de novo, o produtor pede
 * daqui: o pedido aparece como aviso no programa do diretor, que envia de novo. Funciona online
 * e na rede local.
 */
/** Traduz o código que a nuvem devolveu para uma frase que diz o que fazer. */
function explainRequestError(err: unknown): string {
  const codigo = err instanceof Error ? err.message : '';
  switch (codigo) {
    case 'invalid_code':
      return 'O código deste show não vale mais. Peça ao diretor para abrir o link de novo pela Área do Produtor.';
    case 'forbidden':
      return 'Este show está desativado no programa do diretor. Ative o show para poder pedir o repertório.';
    case 'too_many_attempts':
      return 'Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.';
    case 'request_failed':
      return 'O servidor não conseguiu registrar o pedido agora. Tente de novo em instantes.';
    case 'network':
      return 'Sem resposta do servidor. Confira a internet e tente de novo.';
    default:
      return 'Não foi possível enviar o pedido. Confira a internet e tente de novo.';
  }
}

export default function RepertoireRequest({ code, semLetra, total }: {
  code: string;
  /** Músicas do show que ainda não têm letra escrita. */
  semLetra: number;
  total: number;
}) {
  const mode = useNetworkMode();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const ask = async () => {
    setState('sending');
    setMessage(null);
    try {
      await producerRequestRepertoire(code);
      setState('sent');
      setMessage('Pedido enviado. Aparece um aviso no programa do diretor; quando ele enviar, as músicas chegam aqui sozinhas.');
    } catch (err) {
      setState('error');
      // Cada falha tem a sua explicação: antes tudo virava "confira a internet", o que mandava a
      // pessoa conferir a rede quando o problema era o código do show ou o show desativado.
      setMessage(explainRequestError(err));
    }
  };

  const info = `O áudio chega quando o diretor envia o repertório. Depois que você salva as letras ele fica mais 10 minutos e sai ${mode === 'local' ? 'do Mac do diretor' : 'do servidor'}. Para ouvir de novo, peça ao diretor.`;
  return (
    <div className="rounded-lg border border-logic-border bg-logic-bg-panel px-3 py-2">
      <div className="flex items-center gap-3">
        <Inbox size={15} className="text-logic-accent shrink-0" />
        <div className="flex-1 min-w-0" title={info}>
          <p className="text-xs font-semibold text-logic-text">Repertório para ouvir</p>
          <p className="text-[11px] text-logic-text-dim truncate">
            {state === 'sent' ? <span className="text-logic-lcd-green">Pedido enviado ao diretor.</span> : `${semLetra} de ${total} sem letra. O áudio sai 10 min depois de salvar.`}
          </p>
        </div>
        <button
          onClick={ask}
          disabled={state === 'sending'}
          className="h-8 px-3 flex items-center gap-1.5 rounded-md bg-logic-accent hover:bg-logic-accent-hover text-white text-xs font-semibold disabled:opacity-50 transition-all active:scale-[0.98] shrink-0"
          title={info}
        >
          {state === 'sending' ? <Loader2 size={13} className="animate-spin" /> : state === 'sent' ? <Check size={13} /> : <Send size={13} />}
          {state === 'sending' ? 'Pedindo...' : 'Pedir repertório'}
        </button>
      </div>
      {message && state === 'error' && (
        <p className="flex items-start gap-1.5 text-[11px] mt-1.5 leading-relaxed text-logic-lcd-red">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}
