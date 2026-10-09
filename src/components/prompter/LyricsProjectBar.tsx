import { useState } from 'react';
import { CheckCircle2, Clock, FolderDown, Loader2 } from 'lucide-react';
import LyricsStyleControls from '@/components/prompter/LyricsStyleControls';
import { lyricFontCss, type PrompterSnapshot, type PrompterState } from '@/lib/prompterTypes';

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

  const { requestedAt, savedAt } = snap.lyricsSave;
  const waiting = !!requestedAt && (!savedAt || Date.parse(savedAt) < Date.parse(requestedAt));
  const lastEdit = snap.lyrics.reduce((max, l) => Math.max(max, Date.parse(l.updated_at) || 0), 0);
  const changed = !!savedAt && lastEdit > Date.parse(savedAt);

  const save = async () => {
    setBusy(true);
    setError(false);
    try {
      await onSave();
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
    statusText = 'Enviado. Aguardando o programa do diretor estar aberto para guardar no projeto.';
    tone = 'text-logic-lcd-amber';
  } else if (savedAt && changed) {
    statusText = `Salvo no projeto às ${hhmm(savedAt)}. Há mudanças depois disso.`;
    tone = 'text-logic-lcd-amber';
  } else if (savedAt) {
    statusText = `Tudo salvo no projeto às ${hhmm(savedAt)}.`;
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
      <div className="border-t border-logic-border px-4 py-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
        <div>
          <p className="text-xs font-semibold tracking-wider uppercase text-logic-text-dim mb-3">Estilo da letra na TV</p>
          <LyricsStyleControls state={state} update={update} />
        </div>
        <div className="flex flex-col">
          <p className="text-xs text-logic-text-dim mb-2">Prévia</p>
          <div className="flex-1 min-h-[140px] rounded-lg bg-black ring-1 ring-logic-border-light flex items-center px-5 py-4 overflow-hidden">
            <p
              className="w-full font-semibold whitespace-pre-line transition-all duration-200"
              style={{ color: state.lyricColor, fontFamily: lyricFontCss(state.lyricFont), textAlign: state.lyricAlign, fontSize: `${Math.round(26 * state.fontScale)}px`, lineHeight: 1.2 }}
            >
              {'Essa é a letra\nque vai aparecer na TV'}
            </p>
          </div>
          <p className="text-[11px] text-logic-text-muted mt-2">As mudanças aparecem na TV na hora.</p>
        </div>
      </div>
    </div>
  );
}
