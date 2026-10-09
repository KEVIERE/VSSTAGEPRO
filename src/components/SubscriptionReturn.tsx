import { CheckCircle2, XCircle } from 'lucide-react';
import VsLogo from '@/components/VsLogo';

// Página que o Stripe abre no navegador depois do pagamento (ou se a pessoa desistir).
export default function SubscriptionReturn() {
  const ok = window.location.hash.startsWith('#assinatura-ok');
  return (
    <div className="fixed inset-0 bg-logic-bg-deep text-logic-text flex items-center justify-center p-6 overflow-y-auto">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
      </div>
      <div className="relative w-[420px] max-w-full bg-logic-bg-panel border border-logic-border-light rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center px-4 h-9 border-b border-logic-border bg-logic-bg-elevated">
          <span className="text-2xs font-semibold tracking-widest text-logic-text-muted">ASSINATURA</span>
        </div>
        <div className="px-6 py-7 text-center">
          <div className="mx-auto w-20 h-20 mb-4 flex items-center justify-center">
            <VsLogo size={80} />
          </div>
          {ok ? (
            <>
              <h1 className="text-xl font-semibold flex items-center justify-center gap-2">
                <CheckCircle2 size={20} className="text-logic-lcd-green" /> Assinatura confirmada
              </h1>
              <p className="text-sm text-logic-text-dim leading-relaxed mt-2">
                Obrigado! Volte para o VS Stage Pro — o programa libera sozinho em alguns segundos.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold flex items-center justify-center gap-2">
                <XCircle size={20} className="text-logic-lcd-red" /> Pagamento não concluído
              </h1>
              <p className="text-sm text-logic-text-dim leading-relaxed mt-2">
                Nada foi cobrado. Você pode voltar ao VS Stage Pro e tentar de novo quando quiser.
              </p>
            </>
          )}
          <a
            href="#programa"
            className="mt-6 w-full py-2.5 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition flex items-center justify-center"
          >
            Abrir o VS Stage Pro
          </a>
        </div>
      </div>
    </div>
  );
}
