import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FolderDown, Loader2 } from 'lucide-react';
import LyricsStyleControls from '@/components/prompter/LyricsStyleControls';
import type { PrompterSnapshot, PrompterState } from '@/lib/prompterTypes';

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function LyricsProjectBar({ snap, state, update, onSave }: {
  snap: PrompterSnapshot;
  state: PrompterState;
  update: (fn: (s: PrompterState) => PrompterState) => void;
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
    statusText = `Salvo no projeto às ${hhmm(savedAt)}. Há mudanças depois disso.`;
    tone = 'text-logic-lcd-amber';
  } else if (savedAt) {
    statusText = `Salvo no projeto às ${hhmm(savedAt)}.`;
    tone = 'text-logic-lcd-green';
    Icon = CheckCircle2;
  } else if (justSaved) {
    statusText = 'Letras salvas. Elas já estão no show e na TV do palco.';
    tone = 'text-logic-lcd-green';
    Icon = CheckCircle2;
  }

  return (
    <div className="md:col-span-2 bg-logic-bg-panel border border-logic-border rounded-xl">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-sm font-semibold text-logic-text">Mapa de letras do show</p>
          <p className={`flex items-center gap-1.5 text-xs mt-0.5 leading-relaxed ${tone}`}>
            <Icon size={13} className="shrink-0" /> {statusText}
          </p>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="h-10 px-4 flex items-center gap-2 rounded-lg bg-logic-accent text-white text-sm font-semibold hover:bg-logic-accent-hover active:scale-[0.97] disabled:opacity-60 transition-all"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <FolderDown size={15} />}
          Salvar no projeto
        </button>
      </div>
      <div className="border-t border-logic-border px-4 py-4">
        <p className="text-xs font-semibold tracking-wider uppercase text-logic-text-dim mb-3">Estilo da letra na TV</p>
        <LyricsStyleControls state={state} update={update} />
        <p className="text-[11px] text-logic-text-muted mt-3">As mudanças aparecem na TV na hora. A prévia fica ao lado da música.</p>
      </div>
    </div>
  );
}
