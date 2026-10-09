import { Headphones, Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import type { ReferenceSync } from '@/lib/useReferenceAutoSync';

export default function PrompterAudioUpload({ sync }: { sync: ReferenceSync }) {
  const { ready, total, working, failed, offline, retry, resendAll } = sync;
  const allReady = total > 0 && ready === total;
  const pct = total ? (ready / total) * 100 : 0;

  return (
    <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3">
      <div className="flex items-center gap-2">
        <Headphones size={15} className="text-logic-accent" />
        <span className="text-sm font-semibold text-logic-text">Áudio das músicas para o produtor</span>
        {total > 0 && <span className="ml-auto text-xs tabular-nums text-logic-text-muted">{ready} de {total} prontas</span>}
      </div>
      <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
        As músicas do projeto vão sozinhas para a aba Letras do produtor, já com o BPM, o tom e os cortes do show. Quando você muda algo que altera o som, a música é atualizada. O envio pausa enquanto você toca.
      </p>

      <div className="h-1.5 mt-3 rounded-full bg-logic-bg-panel overflow-hidden">
        <div className={`h-full transition-[width] duration-500 ${allReady ? 'bg-logic-lcd-green' : 'bg-logic-accent'}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs min-h-[24px]">
        {working ? (
          <span className="flex items-center gap-1.5 text-logic-text min-w-0">
            <Loader2 size={13} className="animate-spin text-logic-accent shrink-0" />
            <span className="truncate">Preparando: {working}</span>
          </span>
        ) : allReady ? (
          <span className="flex items-center gap-1 text-logic-lcd-green"><Check size={13} /> Todas prontas para o produtor</span>
        ) : total === 0 ? (
          <span className="text-logic-text-muted">Importe músicas no projeto para o produtor ouvir.</span>
        ) : (
          <span className="text-logic-text-muted">Aguardando o programa ficar livre para enviar...</span>
        )}
        {total > 0 && !working && (
          <button className="ml-auto flex items-center gap-1 text-logic-text-muted hover:text-logic-text transition-colors" onClick={resendAll} title="Use se o produtor ouvir uma versão antiga">
            <RefreshCw size={12} /> Reenviar todas
          </button>
        )}
      </div>

      {failed.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-logic-lcd-amber mt-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Não foi possível enviar: {failed.join(', ')}. <button className="underline" onClick={retry}>Tentar de novo</button></span>
        </p>
      )}
      {offline && (
        <p className="text-xs text-logic-lcd-red mt-2">Sem conexão com o show online. <button className="underline" onClick={retry}>Tentar de novo</button></p>
      )}
    </div>
  );
}
