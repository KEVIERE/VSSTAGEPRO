import { Headphones, Loader2, Check, AlertTriangle, RefreshCw, Inbox, PackageCheck } from 'lucide-react';
import type { ReferenceSync } from '@/lib/useReferenceAutoSync';

export default function PrompterAudioUpload({ sync, lyricsDone }: {
  sync: ReferenceSync;
  /** Músicas que o produtor já escreveu a letra — o que fica de fora num pedido novo. */
  lyricsDone: string[];
}) {
  const { ready, total, working, failed, offline, released, requestedAt, retry, resendAll, dismissRequest } = sync;
  const allReady = total > 0 && ready === total;
  const pct = total ? (ready / total) * 100 : 0;
  const missing = Math.max(0, total - lyricsDone.length);

  return (
    <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3">
      <div className="flex items-center gap-2">
        <Headphones size={15} className="text-logic-accent" />
        <span className="text-sm font-semibold text-logic-text">Áudio das músicas para o produtor</span>
        {total > 0 && <span className="ml-auto text-xs tabular-nums text-logic-text-muted">{ready} de {total} prontas</span>}
      </div>
      <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
        As músicas do projeto vão sozinhas para a aba Letras do produtor, já com o BPM, o tom e os cortes do show. O envio pausa enquanto você toca.
      </p>

      {/* Pedido do produtor: o programa já está enviando sozinho o que falta letra. */}
      {requestedAt !== null && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-logic-accent/40 bg-logic-accent/10 px-3 py-2.5 animate-[fadeIn_200ms_ease-out]">
          <Inbox size={14} className="shrink-0 mt-0.5 text-logic-accent" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-logic-text">Repertório pedido pelo produtor</p>
            <p className="text-xs text-logic-text-dim mt-0.5 leading-relaxed">
              {working
                ? `Enviando ${working}...`
                : missing > 0
                  ? `Já enviei as ${missing} ${missing === 1 ? 'música que ainda não tinha' : 'músicas que ainda não tinham'} letra.`
                  : 'Todas as músicas já tinham letra: nada a enviar. Se quiser que o produtor ouça alguma de novo, use "Reenviar todas" abaixo.'}
            </p>
          </div>
          <button onClick={dismissRequest} className="console-key flex items-center justify-center px-2 h-6 text-[11px] shrink-0" title="Fechar aviso">
            OK
          </button>
        </div>
      )}

      {/* Áudio liberado: o produtor salvou as letras e o espaço foi devolvido. */}
      {released && requestedAt === null ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-logic-lcd-green/40 bg-logic-lcd-green/10 px-3 py-2.5">
          <PackageCheck size={14} className="shrink-0 mt-0.5 text-logic-lcd-green" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-logic-text">Áudio liberado do Supabase</p>
            <p className="text-xs text-logic-text-dim mt-0.5 leading-relaxed">
              O produtor salvou as letras. O áudio de referência sai do storage sozinho 10 minutos depois e não é mais reenviado — é o que evita encher a memória à toa. Para mandar de novo, use "Reenviar todas"; ou espere o produtor pedir.
            </p>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

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
