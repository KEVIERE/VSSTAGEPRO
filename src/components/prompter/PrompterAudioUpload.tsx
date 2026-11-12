import { useState } from 'react';
import {
  Headphones, Loader2, Check, AlertTriangle, Inbox, PackageCheck, Send, Sparkles, Wifi, Cloud, Square, ListChecks, X,
} from 'lucide-react';
import type { ReferenceSync, RepertoireSong } from '@/lib/useReferenceAutoSync';

const RELEASE_MS = 10 * 60 * 1000;

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Barra fina no estilo do programa: âmbar enquanto anda, verde quando completa. */
function Bar({ value, done }: { value: number; done?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
      <div className={`h-full transition-[width] duration-700 ${done ? 'bg-logic-lcd-green' : 'bg-logic-lcd-amber'}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  );
}

/** Leitor de letra (no Mac do diretor, sem custo): o que está lendo, com barra, e quantas já estão prontas. */
function ReaderLine({ sync }: { sync: ReferenceSync }) {
  const { reader, lyricsReady, lyricsTotal, reading, lyricsFailed, noGuide, readProgress } = sync;
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
    text = noGuide.length
      ? 'Nenhuma música sem letra tem voz na faixa Guia: nada para o leitor ouvir.'
      : 'Todas as músicas já têm letra: nada para o leitor ler.';
    led = noGuide.length ? '' : 'is-on-green';
  } else if (reading) {
    text = `Lendo a letra: ${lyricsReady} de ${lyricsTotal} prontas`;
    led = 'is-on-amber animate-pulse';
  } else {
    text = lyricsReady === lyricsTotal
      ? `Letra pronta nas ${lyricsTotal} ${lyricsTotal === 1 ? 'música' : 'músicas'} com Guia.`
      : `Letra lida em ${lyricsReady} de ${lyricsTotal} músicas. Continua quando o programa estiver parado.`;
    led = lyricsReady === lyricsTotal ? 'is-on-green' : '';
  }
  const pct = readProgress ? Math.round(readProgress.pct * 100) : 0;
  return (
    <div className="mt-3 rounded-md border border-black/60 bg-black/25 px-3 py-2.5 space-y-2">
      <p className={`flex items-start gap-2 text-xs leading-relaxed ${tone}`}>
        {led ? <span className={`console-led mt-1 shrink-0 ${led}`} /> : <Sparkles size={13} className="shrink-0 mt-0.5 text-logic-lcd-amber" />}
        <span>{text}</span>
      </p>
      {reader?.model.state === 'ready' && lyricsTotal > 0 && (
        <Bar value={lyricsReady / lyricsTotal} done={lyricsReady === lyricsTotal} />
      )}
      {reading && (
        // Música que está sendo lida agora: a barra anda conforme o Mac ouve a Guia.
        <div className="space-y-1" aria-live="polite">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 size={12} className="animate-spin text-logic-lcd-amber shrink-0" />
            <span className="flex-1 min-w-0 truncate text-logic-text">Ouvindo a Guia de {reading}</span>
            <span className="tabular-nums text-logic-text-dim">{readProgress ? `${pct}% · ${mmss(readProgress.elapsed)}` : 'começando...'}</span>
          </div>
          <Bar value={readProgress?.pct ?? 0} />
          <p className="text-[11px] text-logic-text-muted">Uns 3 minutos por música. Pode esperar com o programa parado; se der play, a leitura pausa.</p>
        </div>
      )}
      {noGuide.length > 0 && (
        <p className="text-[11px] text-logic-text-muted leading-relaxed">
          Sem faixa Guia, não há voz para ler: {noGuide.join(', ')}.
        </p>
      )}
      {lyricsFailed.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-logic-lcd-amber">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Não consegui ler a letra de: {lyricsFailed.join(', ')}. <button className="underline" onClick={sync.retry}>Tentar de novo</button></span>
        </p>
      )}
    </div>
  );
}

/** Escolha das músicas do envio: o que já está com o produtor, o que falta, e o que mandar de novo. */
function SongPicker({ songs, onSend, onCancel }: { songs: RepertoireSong[]; onSend: (ids: string[]) => void; onCancel: () => void }) {
  const missing = songs.filter((s) => !s.withProducer).map((s) => s.id);
  const [chosen, setChosen] = useState<Set<string>>(() => {
    const pre = songs.filter((s) => s.selected && !s.withProducer).map((s) => s.id);
    return new Set(pre.length ? pre : missing);
  });
  const toggle = (id: string) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const resend = songs.filter((s) => chosen.has(s.id) && s.withProducer).length;

  return (
    <div className="mt-3 rounded-md border-2 border-black bg-black/30 animate-[fadeIn_160ms_ease-out]">
      <div className="console-rail flex flex-wrap items-center gap-2 px-3 h-9 border-b-2 border-black">
        <ListChecks size={13} className="text-logic-lcd-amber" />
        <span className="console-legend flex-1 !text-logic-text">Escolha as músicas</span>
        <button onClick={() => setChosen(new Set(songs.map((s) => s.id)))} className="console-key px-2 h-6 text-[11px]">Todas</button>
        <button onClick={() => setChosen(new Set(missing))} className="console-key px-2 h-6 text-[11px]" title="Só as que ainda não estão com o produtor">Só as que faltam</button>
        <button onClick={() => setChosen(new Set())} className="console-key px-2 h-6 text-[11px]">Nenhuma</button>
      </div>
      <ul className="max-h-[260px] overflow-y-auto logic-scroll divide-y divide-black/50">
        {songs.map((s, i) => {
          const on = chosen.has(s.id);
          return (
            <li key={s.id}>
              <label className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${on ? 'bg-logic-lcd-amber/[0.07]' : 'hover:bg-white/[0.03]'}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="accent-[#f5a524] w-4 h-4 shrink-0" />
                <span className="font-stage text-[11px] tabular-nums w-5 text-logic-text-muted">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-logic-text truncate">{s.name}</span>
                  <span className="block text-[10px] text-logic-text-muted truncate">
                    {s.hasLyrics ? 'já tem letra' : !s.hasGuide ? 'sem Guia: sem letra automática' : s.lyricsRead ? 'letra lida' : 'letra ainda não lida'}
                  </span>
                </span>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border ${
                  s.withProducer ? 'border-logic-lcd-green/40 text-logic-lcd-green'
                    : s.outdated ? 'border-logic-lcd-amber/40 text-logic-lcd-amber'
                      : 'border-logic-border text-logic-text-muted'
                }`}>
                  {s.withProducer ? (on ? 'enviar de novo' : 'com o produtor') : s.outdated ? 'versão antiga' : 'não enviada'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t-2 border-black">
        <span className="flex-1 min-w-[160px] text-[11px] text-logic-text-dim">
          {chosen.size === 0 ? 'Marque as músicas que o produtor vai ouvir.' : `${chosen.size} ${chosen.size === 1 ? 'música' : 'músicas'}${resend ? `, ${resend} de novo` : ''}.`}
        </span>
        <button onClick={onCancel} className="px-2.5 h-8 text-xs text-logic-text-dim hover:text-logic-text">Cancelar</button>
        <button
          onClick={() => onSend([...chosen])}
          disabled={chosen.size === 0}
          className="flex items-center gap-1.5 px-3.5 h-8 rounded-md bg-logic-lcd-amber text-black text-xs font-semibold hover:brightness-110 disabled:opacity-40 transition-all"
        >
          <Send size={13} /> Enviar {chosen.size || ''}
        </button>
      </div>
    </div>
  );
}

export default function PrompterAudioUpload({ sync }: { sync: ReferenceSync }) {
  const { mode, active, starting, halted, ready, total, working, failed, offline, releasedAt, cleared, requestedAt, send, stop, retry, dismissRequest, songs } = sync;
  const [picking, setPicking] = useState(false);
  const allReady = total > 0 && ready === total;
  const where = mode === 'local' ? 'do seu Mac' : 'do servidor';
  const pick = () => setPicking(true);

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

      {/* Pedido do produtor: só um aviso. Quem escolhe e envia é o diretor. */}
      {requestedAt !== null && !picking && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-logic-lcd-amber/50 bg-logic-lcd-amber/10 px-3 py-2.5 animate-[fadeIn_200ms_ease-out]">
          <Inbox size={14} className="shrink-0 text-logic-lcd-amber" />
          <p className="flex-1 min-w-[160px] text-xs font-semibold text-logic-text">O produtor pediu o repertório.</p>
          <button onClick={() => { dismissRequest(); pick(); }} className="console-key is-lit-amber flex items-center gap-1.5 px-3 h-7 text-[11px]">
            <ListChecks size={12} /> Escolher e enviar
          </button>
          <button onClick={dismissRequest} className="console-key px-2 h-7 text-[11px]" title="Fechar aviso">Depois</button>
        </div>
      )}

      {picking ? (
        <SongPicker songs={songs} onCancel={() => setPicking(false)} onSend={(ids) => { setPicking(false); send(ids); }} />
      ) : releasedAt !== null ? (
        <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2.5 ${cleared ? 'border-logic-border bg-black/20' : 'border-logic-lcd-green/40 bg-logic-lcd-green/10'}`}>
          <PackageCheck size={14} className={`shrink-0 ${cleared ? 'text-logic-text-muted' : 'text-logic-lcd-green'}`} />
          <p className="flex-1 min-w-[180px] text-xs text-logic-text leading-relaxed">
            {cleared
              ? `O produtor salvou as letras e o áudio já saiu ${where}. Se ele precisar ouvir de novo, envie de novo.`
              : `O produtor salvou as letras. O áudio sai ${where} às ${clock(releasedAt + RELEASE_MS)}.`}
          </p>
          <button onClick={pick} className="console-key flex items-center gap-1.5 px-3 h-7 text-[11px]">
            <Send size={12} /> Enviar de novo
          </button>
        </div>
      ) : halted ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-logic-border bg-black/20 px-3 py-2.5">
          <Square size={13} className="shrink-0 text-logic-text-muted" />
          <p className="flex-1 min-w-[180px] text-xs text-logic-text leading-relaxed">
            Envio parado. {ready} de {total} {total === 1 ? 'música está' : 'músicas estão'} com o produtor e continuam lá.
          </p>
          <button onClick={() => send()} className="console-key is-lit-amber flex items-center gap-1.5 px-3 h-7 text-[11px]">
            <Send size={12} /> Continuar envio
          </button>
          <button onClick={pick} className="console-key flex items-center gap-1.5 px-3 h-7 text-[11px]">
            <ListChecks size={12} /> Escolher músicas
          </button>
        </div>
      ) : !active ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={pick}
            disabled={songs.length === 0 || starting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-logic-lcd-amber text-black text-sm font-semibold hover:brightness-110 active:scale-[0.98] disabled:opacity-40 transition-all"
          >
            {starting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {starting ? 'Começando o envio...' : 'Enviar repertório para o produtor'}
          </button>
          <span className="text-xs text-logic-text-muted">{songs.length === 0 ? 'Importe músicas no projeto primeiro.' : 'Você escolhe as músicas na próxima tela.'}</span>
        </div>
      ) : (
        <>
          <div className="mt-3"><Bar value={total ? ready / total : 0} done={allReady} /></div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs min-h-[28px]">
            {working ? (
              <span className="flex items-center gap-1.5 text-logic-text min-w-0">
                <Loader2 size={13} className="animate-spin text-logic-lcd-amber shrink-0" />
                <span className="truncate">Enviando {working} ({ready} de {total})</span>
              </span>
            ) : allReady ? (
              <span className="flex items-center gap-1 text-logic-lcd-green"><Check size={13} /> {total} de {total} com o produtor</span>
            ) : (
              <span className="text-logic-text-muted">{ready} de {total} enviadas. O envio pausa enquanto você toca.</span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <button onClick={pick} className="console-key flex items-center gap-1.5 px-2.5 h-7 text-[11px]" title="Mandar mais músicas ou mandar alguma de novo">
                <ListChecks size={12} /> Escolher músicas
              </button>
              <button onClick={stop} className="console-key flex items-center gap-1.5 px-2.5 h-7 text-[11px] hover:!text-logic-lcd-red" title="Para o envio e a leitura da letra agora">
                <X size={12} /> Parar envio
              </button>
            </span>
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
