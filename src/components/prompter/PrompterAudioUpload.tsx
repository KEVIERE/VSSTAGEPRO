import { Headphones, Loader2, Check, AlertTriangle, RefreshCw, Inbox, PackageCheck, Send, Sparkles, Wifi, Cloud } from 'lucide-react';
import type { ReferenceSync } from '@/lib/useReferenceAutoSync';

const RELEASE_MS = 10 * 60 * 1000;

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Linha do leitor de letra (no Mac do diretor, sem custo). */
function ReaderLine({ sync }: { sync: ReferenceSync }) {
  const { reader, lyricsReady, lyricsTotal, reading, lyricsFailed } = sync;
  let text: string;
  let tone = 'text-logic-text-dim';
  let led = '';
  if (!reader) {
    text = 'Letra automática: precisa do VS Stage para Mac na versão mais nova.';
  } else if (reader.model.state === 'error') {
    text = `Leitor de letra: ${reader.model.error ?? 'o download falhou'}. Tentando de novo sozinho.`;
    tone = 'text-logic-lcd-amber';
  } else if (reader.model.state !== 'ready') {
    const pct = Math.round((reader.model.progress ?? 0) * 100);
    text = reader.model.state === 'paused'
      ? `Leitor de letra: download pausado enquanto a música toca (${pct}%).`
      : `Baixando o leitor de letra, uma vez só (1,6 GB): ${pct}%.`;
    led = 'is-on-amber animate-pulse';
  } else if (lyricsTotal === 0) {
    text = 'Todas as músicas já têm letra: nada para o leitor ler.';
    led = 'is-on-green';
  } else if (reading) {
    text = `Lendo a letra de ${reading}... (${lyricsReady} de ${lyricsTotal} prontas)`;
    led = 'is-on-amber animate-pulse';
  } else {
    text = lyricsReady === lyricsTotal
      ? `Letra pronta nas ${lyricsTotal} ${lyricsTotal === 1 ? 'música' : 'músicas'} sem letra.`
      : `Letra lida em ${lyricsReady} de ${lyricsTotal} músicas sem letra. Continua quando o programa estiver parado.`;
    led = lyricsReady === lyricsTotal ? 'is-on-green' : '';
  }
  return (
    <div className="mt-2 space-y-1">
      <p className={`flex items-start gap-2 text-xs leading-relaxed ${tone}`}>
        {led ? <span className={`console-led mt-1 shrink-0 ${led}`} /> : <Sparkles size={13} className="shrink-0 mt-0.5 text-logic-lcd-amber" />}
        <span>{text}</span>
      </p>
      {lyricsFailed.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-logic-lcd-amber">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Não consegui ler a letra de: {lyricsFailed.join(', ')}. <button className="underline" onClick={sync.retry}>Tentar de novo</button></span>
        </p>
      )}
    </div>
  );
}

export default function PrompterAudioUpload({ sync }: { sync: ReferenceSync }) {
  const { mode, active, starting, ready, total, working, failed, offline, releasedAt, cleared, requestedAt, send, retry, resendAll, dismissRequest } = sync;
  const allReady = total > 0 && ready === total;
  const pct = total ? (ready / total) * 100 : 0;
  const where = mode === 'local' ? 'do seu Mac' : 'do servidor';

  if (!mode) {
    return (
      <div className="rounded-lg border border-logic-border-dark bg-logic-bg-deep px-4 py-3 text-xs text-logic-text-dim">
        Para enviar o repertório ao produtor, publique o show online ou ligue a rede local.
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-black console-face px-4 py-3">
      <div className="flex items-center gap-2">
        <Headphones size={15} className="text-logic-lcd-amber" />
        <span className="text-sm font-semibold text-logic-text">Repertório para o produtor</span>
        <span className="ml-auto flex items-center gap-1 console-legend !text-[10px]">
          {mode === 'local' ? <Wifi size={11} /> : <Cloud size={11} />} {mode === 'local' ? 'Rede local' : 'Online'}
        </span>
      </div>
      <p className="text-xs text-logic-text-dim mt-1.5 leading-relaxed">
        O áudio de cada música vai para a aba Letras do produtor, com o BPM, o tom e os cortes do show, e com a letra lida pelo seu Mac.
        Fica lá até o produtor salvar as letras; 10 minutos depois sai {where}.
      </p>

      {/* Pedido do produtor: só um aviso. Quem envia é o diretor. */}
      {requestedAt !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-logic-lcd-amber/50 bg-logic-lcd-amber/10 px-3 py-2.5 animate-[fadeIn_200ms_ease-out]">
          <Inbox size={14} className="shrink-0 text-logic-lcd-amber" />
          <p className="flex-1 min-w-[160px] text-xs font-semibold text-logic-text">O produtor pediu o repertório.</p>
          <button onClick={() => { dismissRequest(); send(); }} className="console-key is-lit-amber flex items-center gap-1.5 px-3 h-7 text-[11px]">
            <Send size={12} /> Enviar agora
          </button>
          <button onClick={dismissRequest} className="console-key px-2 h-7 text-[11px]" title="Fechar aviso">Depois</button>
        </div>
      )}

      {releasedAt !== null ? (
        <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 ${cleared ? 'border-logic-border bg-black/20' : 'border-logic-lcd-green/40 bg-logic-lcd-green/10'}`}>
          <PackageCheck size={14} className={`shrink-0 ${cleared ? 'text-logic-text-muted' : 'text-logic-lcd-green'}`} />
          <p className="flex-1 min-w-[180px] text-xs text-logic-text leading-relaxed">
            {cleared
              ? `O produtor salvou as letras e o áudio já saiu ${where}. Se ele precisar ouvir de novo, envie de novo.`
              : `O produtor salvou as letras. O áudio sai ${where} às ${clock(releasedAt + RELEASE_MS)}.`}
          </p>
          <button onClick={send} className="console-key flex items-center gap-1.5 px-3 h-7 text-[11px]">
            <Send size={12} /> Enviar de novo
          </button>
        </div>
      ) : !active ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={send}
            disabled={total === 0 || starting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-logic-lcd-amber text-black text-sm font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
          >
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {starting ? 'Começando o envio...' : 'Enviar repertório para o produtor'}
          </button>
          <span className="text-xs text-logic-text-muted">{total === 0 ? 'Importe músicas no projeto primeiro.' : `${total} ${total === 1 ? 'música' : 'músicas'} no projeto`}</span>
        </div>
      ) : (
        <>
          <div className="h-1.5 mt-3 rounded-full bg-black/40 overflow-hidden">
            <div className={`h-full transition-[width] duration-500 ${allReady ? 'bg-logic-lcd-green' : 'bg-logic-lcd-amber'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs min-h-[24px]">
            {working ? (
              <span className="flex items-center gap-1.5 text-logic-text min-w-0">
                <Loader2 size={13} className="animate-spin text-logic-lcd-amber shrink-0" />
                <span className="truncate">Enviando: {working}</span>
              </span>
            ) : allReady ? (
              <span className="flex items-center gap-1 text-logic-lcd-green"><Check size={13} /> {total} de {total} com o produtor</span>
            ) : (
              <span className="text-logic-text-muted">{ready} de {total} enviadas. O envio pausa enquanto você toca.</span>
            )}
            {!working && (
              <button className="ml-auto flex items-center gap-1 text-logic-text-muted hover:text-logic-text transition-colors" onClick={resendAll} title="Use se o produtor ouvir uma versão antiga">
                <RefreshCw size={12} /> Reenviar todas
              </button>
            )}
          </div>
          <ReaderLine sync={sync} />
        </>
      )}

      {failed.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-logic-lcd-amber mt-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Não foi possível enviar: {failed.join(', ')}. <button className="underline" onClick={retry}>Tentar de novo</button></span>
        </p>
      )}
      {offline && (
        <p className="text-xs text-logic-lcd-red mt-2">
          {mode === 'local'
            ? 'A rede local não respondeu.'
            : 'O servidor não aceitou o envio. Confira a internet; se continuar, o servidor ainda está na versão antiga (falta publicar a atualização).'} <button className="underline" onClick={retry}>Tentar de novo</button>
        </p>
      )}
    </div>
  );
}
