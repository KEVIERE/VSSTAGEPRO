import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Mic2, MonitorPlay, Radio, Timer } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import VsLogo from '@/components/VsLogo';

const BENEFITS = [
  { icon: Mic2, text: 'Editor de multitracks com Timecode LTC' },
  { icon: Radio, text: 'Modo Show protegido, com pads de regions' },
  { icon: MonitorPlay, text: 'Área do músico no celular e teleprompter na TV' },
];

// Página isolada que aparece ao clicar no link de confirmação do e-mail: só um card
// confirmando que deu certo, sem abrir o editor, a página de downloads ou a de vendas
// por trás. A pessoa decide, a partir daqui, se quer abrir o app ou voltar ao que estava fazendo.
export default function EmailConfirmedPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  return (
    <div className="min-h-screen bg-logic-bg-deep text-logic-text flex items-center justify-center p-6"
      style={{ background: 'radial-gradient(ellipse at top, #1b1c20 0%, #0a0b0d 70%)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
      </div>
      <div className="relative w-[400px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden animate-[fadeIn_250ms_ease-out]">
        <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
          <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">E-MAIL CONFIRMADO</span>
        </div>
        <div className="px-6 pt-8 pb-7 text-center">
          <div className="mx-auto w-20 h-20 mb-4 flex items-center justify-center">
            <VsLogo size={80} />
          </div>
          <div className="mx-auto w-11 h-11 mb-3 rounded-full bg-logic-lcd-green/15 flex items-center justify-center">
            <CheckCircle2 size={24} className="text-logic-lcd-green" />
          </div>
          <h1 className="text-xl font-semibold">E-mail confirmado!</h1>
          <p className="text-sm text-logic-text-dim mt-2 leading-relaxed">
            {email ? (
              <>Sua conta <span className="text-logic-text">{email}</span> está pronta.</>
            ) : (
              'Sua conta está pronta.'
            )}
            {' '}Abra o VS Stage no seu Mac para aproveitar os benefícios do VS Stage Pro.
          </p>
          {!email && (
            <div className="flex justify-center mt-4">
              <Loader2 size={16} className="animate-spin text-logic-text-muted" />
            </div>
          )}

          <ul className="mt-5 pt-5 border-t border-logic-border space-y-2.5 text-left">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5 text-xs text-logic-text-dim">
                <Icon size={14} className="text-logic-lcd-green shrink-0" />
                {text}
              </li>
            ))}
            <li className="flex items-center gap-2.5 text-xs text-logic-text-dim">
              <Timer size={14} className="text-logic-lcd-green shrink-0" />
              Teste grátis já começa a contar na primeira abertura
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
