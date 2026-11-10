import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Save, X } from 'lucide-react';
import type { ProjectSaveStatus, SheetBackend } from '@/lib/musicianTypes';
import { saveOutcome, type SaveOutcome, type SheetSaveResult } from '@/lib/musicianSave';
import type { SaveStatus } from './useNotebook';

type Phase = 'idle' | 'busy' | SaveOutcome['tone'];

const SHOW_RESULT_MS = 3500;

/**
 * Tecla "Salvar" da Área do Músico. Grava o caderno da música na hora e, na Rede Local, pede ao
 * Mac do diretor para gravar o arquivo do projeto. A tecla mostra Salvando / Salvo / Não salvou
 * e a mensagem completa vai para `onResult` (o aviso da tela).
 * Acesa em âmbar quando há alteração que ainda não chegou ao destino.
 */
export default function SaveButton({ saveNow, status, backend, onResult, className = '' }: {
  saveNow: () => Promise<SheetSaveResult>;
  status: SaveStatus;
  backend: SheetBackend;
  onResult: (outcome: SaveOutcome) => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (phase === 'idle' || phase === 'busy') return;
    const t = setTimeout(() => setPhase('idle'), SHOW_RESULT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const run = async () => {
    if (phase === 'busy') return;
    setPhase('busy');
    let outcome: SaveOutcome;
    try {
      const sheet = await saveNow();
      // Rede Local: com o caderno no Mac, grava o arquivo do projeto
      let project: ProjectSaveStatus | null = backend.saveProject ? 'error' : null;
      if (sheet === 'saved' && backend.saveProject) {
        project = await backend.saveProject().catch((): ProjectSaveStatus => 'error');
      }
      outcome = saveOutcome(sheet, project);
    } catch {
      outcome = saveOutcome('offline', backend.saveProject ? 'error' : null);
    }
    if (!alive.current) return;
    setPhase(outcome.tone);
    onResult(outcome);
  };

  const dirty = status === 'pending' || status === 'saving' || status === 'offline';
  const lit = phase === 'ok' ? 'is-lit-green'
    : phase === 'fail' ? 'is-lit-red'
      : phase === 'warn' || (phase === 'idle' && dirty) ? 'is-lit-amber' : '';
  const label = phase === 'busy' ? 'Salvando' : phase === 'ok' || phase === 'warn' ? 'Salvo' : phase === 'fail' ? 'Não salvou' : 'Salvar';
  const Icon = phase === 'busy' ? Loader2 : phase === 'ok' ? Check : phase === 'warn' ? AlertTriangle : phase === 'fail' ? X : Save;

  return (
    <button
      onClick={() => { void run(); }}
      disabled={phase === 'busy'}
      aria-busy={phase === 'busy'}
      title={dirty
        ? 'Há alterações para salvar. Aperte para gravar agora.'
        : `Grava o caderno desta música ${backend.storedIn}${backend.saveProject ? ' e o projeto no Mac do diretor' : ''}.`}
      className={`console-key flex items-center justify-center gap-1.5 h-8 px-2.5 text-[12px] font-semibold flex-shrink-0 ${lit} ${className}`}
    >
      <Icon size={14} className={phase === 'busy' ? 'animate-spin' : ''} />
      <span>{label}</span>
    </button>
  );
}
