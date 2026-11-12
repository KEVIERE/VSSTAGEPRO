import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FolderDown, Loader2 } from 'lucide-react';
import type { PrompterSnapshot } from '@/lib/prompterTypes';

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function LyricsProjectBar({ snap, onSave }: {
  snap: PrompterSnapshot;
  onSave: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // Confirmação que aparece logo depois do clique, antes de o programa do
  // diretor confirmar: o produtor precisa saber na hora que o envio saiu.
  const [justSaved, setJustSaved] = useState(false);

  const { requestedAt, savedAt } = snap.lyricsSave;
  const waiting = !!requestedAt && (!savedAt || Date.parse(savedAt) < Date.parse(requestedAt));
  const lastEdit = snap.lyrics.reduce((max, l) => Math.max(max, Date.parse(l.updated_at) || 0), 0);
  const changed = !!savedAt && lastEdit > Date.parse(savedAt);

  // Some sozinho: a confirmação é um aviso, não um novo estado permanente.
  useEffect(() => {
    if (!justSaved) return;
    const id = window.setTimeout(() => setJustSaved(false), 6000);
    return () => window.clearTimeout(id);
  }, [justSaved]);

  // Quando o diretor confirma, a confirmação do clique já cumpriu o papel.
  useEffect(() => { if (savedAt && !waiting) setJustSaved(false); }, [savedAt, waiting]);

  const save = async () => {
    setBusy(true);
    setError(false);
    try {
      await onSave();
      setJustSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  let statusText = 'As letras ainda não foram salvas no projeto do diretor.';
  let tone = 'text-logic-text-dim';
  let Icon = Clock;
  if (error) {
    statusText = 'Não foi possível salvar. Confira a internet e tente de novo.';
    tone = 'text-logic-lcd-red';
  } else if (waiting) {
    // Enquanto o programa do diretor não confirma, a pessoa já sabe que o
    // envio saiu daqui — antes ela lia "aguardando" e ficava na dúvida se
    // tinha mesmo funcionado.
    statusText = justSaved
      ? 'Letras enviadas. O programa do diretor guarda no projeto assim que estiver aberto.'
      : 'Enviado. Aguardando o programa do diretor estar aberto para guardar no projeto.';
    tone = 'text-logic-lcd-amber';
  } else if (savedAt && changed) {
    statusText = `Entregue ao programa do diretor às ${hhmm(savedAt)}. Há mudanças depois disso.`;
    tone = 'text-logic-lcd-amber';
  } else if (savedAt) {
    statusText = `Entregue ao programa do diretor às ${hhmm(savedAt)}. Ele grava no arquivo do projeto.`;
    tone = 'text-logic-lcd-green';
    Icon = CheckCircle2;
  } else if (justSaved) {
    statusText = 'Letras salvas. Elas já estão no show e na TV do palco.';
    tone = 'text-logic-lcd-green';
    Icon = CheckCircle2;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-logic-border bg-logic-bg-panel px-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-logic-text">Mapa de letras do show</p>
        <p className={`flex items-center gap-1.5 text-[11px] leading-snug truncate ${tone}`} title={statusText}>
          <Icon size={12} className="shrink-0" /> <span className="truncate">{statusText}</span>
        </p>
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="h-8 px-3 flex items-center gap-1.5 rounded-md bg-logic-accent text-white text-xs font-semibold hover:bg-logic-accent-hover active:scale-[0.97] disabled:opacity-60 transition-all shrink-0"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}
        Salvar no projeto
      </button>
    </div>
  );
}
