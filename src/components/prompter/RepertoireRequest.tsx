import { useState } from 'react';
import { Inbox, Loader2, Check, AlertTriangle, Send } from 'lucide-react';
import { producerRequestRepertoire } from '@/lib/prompterAudio';
import { useNetworkMode } from '@/lib/localNetwork';

/**
 * Pedido do repertório de volta.
 *
 * O áudio de referência sai do Supabase quando o produtor salva as letras. Se depois precisar
 * escrever outra letra, ele pede daqui: o programa do diretor recebe o pedido sozinho e envia
 * só as músicas que ainda não têm letra.
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

  // Na rede local o áudio de referência não passa pela nuvem: o envio não existe nesse modo.
  if (mode === 'local') {
    return (
      <div className="rounded-xl border border-logic-border bg-logic-bg-panel p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-logic-text"><Inbox size={15} className="text-logic-accent" /> Repertório para ouvir</p>
        <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
          Na Rede Local o áudio vem do Mac do diretor, sem passar pela nuvem — não há nada para pedir nem para apagar.
        </p>
      </div>
    );
  }

  const ask = async () => {
    setState('sending');
    setMessage(null);
    try {
      await producerRequestRepertoire(code);
      setState('sent');
      setMessage('Pedido enviado. O programa do diretor manda as músicas que faltam letra assim que estiver aberto. Esta lista se atualiza sozinha.');
    } catch (err) {
      setState('error');
      // Cada falha tem a sua explicação: antes tudo virava "confira a internet", o que mandava a
      // pessoa conferir a rede quando o problema era o código do show ou o show desativado.
      setMessage(explainRequestError(err));
    }
  };

  return (
    <div className="rounded-xl border border-logic-border bg-logic-bg-panel p-4">
      <div className="flex items-center gap-2">
        <Inbox size={15} className="text-logic-accent" />
        <p className="text-sm font-semibold text-logic-text">Repertório para ouvir</p>
        <span className="ml-auto text-2xs tabular-nums text-logic-text-muted">{semLetra} de {total} sem letra</span>
      </div>

      <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
        {semLetra === 0
          ? 'Todas as músicas já têm letra. As músicas para ouvir saem do servidor depois que você salva, para não ocupar espaço. Se precisar refazer alguma letra, peça o repertório de novo.'
          : `As músicas descem sozinhas depois que você salva as letras. Faltam ${semLetra} ${semLetra === 1 ? 'música' : 'músicas'} sem letra: peça o repertório para ouvi-las.`}
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          onClick={ask}
          disabled={state === 'sending'}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-logic-accent hover:bg-logic-accent-hover text-white text-sm font-semibold disabled:opacity-50 transition-all active:scale-[0.98]"
        >
          {state === 'sending' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {state === 'sending' ? 'Pedindo...' : 'Solicitar repertório'}
        </button>
        {state === 'sent' && (
          <span className="flex items-center gap-1.5 text-xs text-logic-lcd-green"><Check size={13} /> Pedido enviado</span>
        )}
      </div>

      {message && (
        <p className={`flex items-start gap-1.5 text-xs mt-2 leading-relaxed ${state === 'error' ? 'text-logic-lcd-red' : 'text-logic-text-dim'}`}>
          {state === 'error' && <AlertTriangle size={13} className="shrink-0 mt-0.5" />}
          <span>{message}</span>
        </p>
      )}
    </div>
  );
}
