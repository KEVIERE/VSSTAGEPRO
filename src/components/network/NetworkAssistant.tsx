import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { localBridge, type CheckAction, type NetworkCheck } from '@/lib/localNetwork';

const ACTION_LABEL: Record<CheckAction, string> = {
  router: 'Abrir o roteador',
  firewall: 'Abrir o firewall do Mac',
  network: 'Abrir Wi-Fi do Mac',
  sharing: 'Abrir Compartilhamento',
};

const STEPS: [string, string][] = [
  ['Ligue o roteador na tomada', 'Ele não precisa de internet. Se tiver, tudo bem, o show não depende dela.'],
  ['Conecte o Mac ao roteador', 'De preferência por cabo de rede, que é mais estável no palco. Pelo Wi-Fi também funciona.'],
  ['Coloque todos no mesmo Wi-Fi', 'Celulares dos músicos, tablet do produtor e o computador da TV entram na rede do roteador.'],
  ['Desligue o isolamento de aparelhos', 'No roteador, procure "Isolamento de AP", "Client isolation" ou "Rede de convidados" e deixe desligado. Ele impede os aparelhos de se enxergarem.'],
  ['Opcional: reserve um IP fixo para o Mac', 'Em "DHCP" ou "Reserva de endereço", fixe o IP do Mac. O nome .local já resolve na maioria dos casos.'],
];

export default function NetworkAssistant() {
  const bridge = localBridge();
  const [checks, setChecks] = useState<NetworkCheck[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const run = useCallback(async () => {
    if (!bridge) return;
    setRunning(true);
    setError(null);
    try {
      setChecks(await bridge.networkCheck());
    } catch {
      setError('Não consegui testar a rede agora. Tente de novo.');
    } finally {
      setRunning(false);
    }
  }, [bridge]);

  useEffect(() => { run(); }, [run]);

  const failed = checks?.filter((c) => c.status === 'fail').length ?? 0;
  const warned = checks?.filter((c) => c.status === 'warn').length ?? 0;
  const ready = !!checks && !running && failed === 0;

  return (
    <div className="p-5 space-y-4">
      {checks && !running && (
        <div className={`flex items-center gap-3 p-3 rounded-lg border animate-[fadeIn_200ms_ease-out] ${ready ? 'bg-logic-lcd-green/10 border-logic-lcd-green/30' : 'bg-logic-lcd-red/10 border-logic-lcd-red/30'}`}>
          {ready ? <CheckCircle2 size={20} className="text-logic-lcd-green shrink-0" /> : <XCircle size={20} className="text-logic-lcd-red shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${ready ? 'text-logic-lcd-green' : 'text-logic-lcd-red'}`}>{ready ? 'Rede pronta' : 'Falta pouco'}</p>
            <p className="text-2xs text-logic-text-dim mt-0.5">
              {ready
                ? (warned > 0 ? 'Tudo funcionando. Veja as dicas em amarelo para deixar ainda mais estável.' : 'Músicos, produtor e TV já podem entrar pelo QR code.')
                : `${failed} ${failed === 1 ? 'item precisa' : 'itens precisam'} de atenção. Siga a orientação de cada um e teste de novo.`}
            </p>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {running && !checks && (
          <li className="flex items-center gap-2 p-4 text-xs text-logic-text-dim"><Loader2 size={14} className="animate-spin text-logic-accent" /> Testando a rede do palco...</li>
        )}
        {checks?.map((c) => (
          <li key={c.id} className="flex items-start gap-3 p-3 rounded-lg bg-logic-bg-deep border border-logic-border-dark">
            <StatusIcon status={c.status} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-logic-text">{c.label}</p>
              <p className="text-2xs text-logic-text-dim mt-0.5 leading-relaxed">{c.detail}</p>
            </div>
            {c.action && c.status !== 'ok' && (
              <button
                className="shrink-0 flex items-center gap-1 px-2 h-6 rounded border border-logic-border text-2xs text-logic-text hover:border-logic-accent/60 hover:bg-logic-bg-panel-light transition-colors"
                onClick={() => bridge?.openAction(c.action as CheckAction)}
              >
                <ExternalLink size={10} /> {ACTION_LABEL[c.action]}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-logic-lcd-red">{error}</p>}

      <div className="flex justify-end">
        <button
          className="flex items-center gap-1.5 px-3 h-8 rounded bg-logic-accent text-white text-xs font-medium hover:brightness-110 disabled:opacity-50 transition"
          onClick={run} disabled={running}
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Testar de novo
        </button>
      </div>

      <section className="border border-logic-border-dark rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-3 h-9 text-xs font-medium text-logic-text hover:bg-logic-bg-panel-light transition-colors"
          onClick={() => setGuideOpen((v) => !v)}
          aria-expanded={guideOpen}
        >
          Como montar a rede do palco
          <ChevronDown size={14} className={`text-logic-text-muted transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
        </button>
        {guideOpen && (
          <ol className="px-3 pb-3 space-y-3 animate-[fadeIn_150ms_ease-out]">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="w-5 h-5 shrink-0 rounded-full bg-logic-bg-deep border border-logic-border text-2xs font-semibold text-logic-text-dim flex items-center justify-center">{i + 1}</span>
                <span>
                  <span className="block text-xs font-medium text-logic-text">{t}</span>
                  <span className="block text-2xs text-logic-text-dim leading-relaxed mt-0.5">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function StatusIcon({ status }: { status: NetworkCheck['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={16} className="text-logic-lcd-green shrink-0 mt-0.5" />;
  if (status === 'warn') return <AlertTriangle size={16} className="text-logic-lcd-amber shrink-0 mt-0.5" />;
  return <XCircle size={16} className="text-logic-lcd-red shrink-0 mt-0.5" />;
}
