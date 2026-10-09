import { useState } from 'react';
import { KeyRound, ArrowRight, ClipboardPaste } from 'lucide-react';
import type { FeedError } from '@/lib/usePrompterFeed';
import { cleanAccessCode } from '@/lib/prompterApi';
import { isLocalClient } from '@/lib/localNetwork';

export default function PrompterAccess({ icon, title, subtitle, error, onSubmit }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  error: string | null;
  onSubmit: (code: string) => void;
}) {
  const [value, setValue] = useState('');
  const [pasteError, setPasteError] = useState(false);
  const local = isLocalClient();
  const codeLength = local ? 6 : 10;
  const clean = cleanAccessCode(value);

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasteError(false);
      setValue(cleanAccessCode(text).slice(0, codeLength));
    } catch {
      setPasteError(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-logic-bg-deep px-4">
      <form
        className="w-full max-w-sm bg-logic-bg-panel border border-logic-border rounded-2xl p-8 shadow-2xl animate-[fadeIn_200ms_ease-out]"
        onSubmit={(e) => { e.preventDefault(); if (clean.length === codeLength) onSubmit(clean); }}
      >
        <div className="w-12 h-12 rounded-xl bg-logic-accent/15 text-logic-accent flex items-center justify-center mb-5">{icon}</div>
        <h1 className="text-xl font-semibold text-logic-text">{title}</h1>
        <p className="text-sm text-logic-text-dim mt-2 leading-relaxed">{subtitle}</p>
        <label htmlFor="access-code" className="block text-xs font-medium text-logic-text-dim mt-6 mb-2">{local ? 'PIN do produtor' : 'Código de acesso'}</label>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted" />
            <input
              id="access-code"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              inputMode={local ? 'numeric' : undefined}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={local ? 'Ex.: 482913' : 'Ex.: ABCDE-12345'}
              className="w-full pl-9 pr-3 py-3 rounded-lg bg-logic-bg-deep border border-logic-border-light text-logic-text tracking-[0.18em] uppercase outline-none focus:border-logic-accent transition-colors placeholder:tracking-normal placeholder:normal-case placeholder:text-logic-text-muted"
            />
          </div>
          <button
            type="button"
            onClick={paste}
            className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg border border-logic-border-light bg-logic-bg-elevated text-sm text-logic-text hover:bg-logic-bg-panel-light hover:border-logic-accent/60 active:scale-[0.97] transition-all"
            title="Colar o código copiado"
          >
            <ClipboardPaste size={15} /> Colar
          </button>
        </div>
        {pasteError && <p className="text-xs text-logic-lcd-amber mt-2">O navegador não deixou colar sozinho. Clique no campo e use Ctrl+V (ou Cmd+V no Mac).</p>}
        {error && <p className="text-sm text-logic-lcd-red mt-3">{error}</p>}
        <button
          type="submit"
          disabled={clean.length !== codeLength}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-logic-accent text-white font-medium hover:bg-logic-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Entrar <ArrowRight size={16} />
        </button>
        <p className="text-xs text-logic-text-muted mt-5 leading-relaxed">
          {local
            ? 'Rede local: peça o PIN do produtor ao diretor musical. Ele aparece no programa do diretor, em Rede Local.'
            : 'Peça o código ao diretor musical. Ele fica no programa do diretor, no menu Arquivo, em Teleprompter.'}
        </p>
      </form>
    </div>
  );
}

export function feedErrorText(err: FeedError): string | null {
  if (err === 'invalid_code') return isLocalClient() ? 'PIN incorreto. Confira com o diretor musical.' : 'Código não encontrado. Confira com o diretor musical.';
  if (err === 'too_many_attempts') return 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.';
  return null;
}
