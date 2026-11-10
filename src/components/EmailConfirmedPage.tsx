import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

// Link de confirmação de uma conta criada na Área do Músico (volta com ?musico=1).
// As contas do programa vão direto para a página de downloads (ver confirmLanding.ts).
export default function EmailConfirmedPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-logic-bg-deep text-logic-text flex items-center justify-center p-4">
      <div className="console-face w-full max-w-sm rounded-xl border border-black p-6 text-center shadow-2xl animate-[fadeIn_300ms_ease-out]">
        <CheckCircle2 size={40} className="mx-auto text-logic-lcd-green" />
        <h1 className="mt-3 text-xl font-semibold">Conta confirmada</h1>
        <p className="mt-2 text-sm text-logic-text-dim leading-relaxed">
          {loading ? 'Conferindo...' : email ? `Tudo certo com ${email}.` : 'Seu e-mail foi confirmado.'} Agora é só entrar na Área do Músico.
        </p>
        <button
          onClick={() => window.location.replace(`${window.location.origin}/?musico=1`)}
          className="mt-5 w-full h-11 rounded-lg bg-logic-lcd-green text-black text-sm font-semibold hover:brightness-110 transition"
        >
          Abrir a Área do Músico
        </button>
      </div>
    </div>
  );
}
