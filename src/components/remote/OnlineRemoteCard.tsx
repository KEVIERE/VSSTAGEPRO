// Cartão do VS Stage Remote no Show Online (programa do Mac): liga o Remote, mostra o QR e o
// link para o celular e quantos celulares estão conectados.
import { useEffect, useState } from 'react';
import { Copy, RefreshCw, Smartphone } from 'lucide-react';
import {
  disableOnlineRemote, enableOnlineRemote, onlineRemoteLink, renewOnlineRemote, useOnlineRemoteConfig, useOnlineRemotePhones,
} from '@/lib/onlineRemote';
import { useNetworkMode } from '@/lib/localNetwork';

export default function OnlineRemoteCard() {
  const config = useOnlineRemoteConfig();
  const phones = useOnlineRemotePhones();
  const mode = useNetworkMode();
  const on = !!config?.on;
  const link = config ? onlineRemoteLink(config.key) : '';
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);

  useEffect(() => {
    if (!on || !link) { setQr(null); return; }
    let alive = true;
    import('qrcode')
      .then((m) => m.toDataURL(link, { margin: 1, width: 256, errorCorrectionLevel: 'M' }))
      .then((url) => { if (alive) setQr(url); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [on, link]);

  useEffect(() => {
    if (!confirmRenew) return;
    const id = window.setTimeout(() => setConfirmRenew(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmRenew]);

  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="console-face rounded-lg border border-black overflow-hidden mb-4">
      <div className="console-rail flex items-center gap-2 px-4 h-9">
        <Smartphone size={14} className="text-logic-lcd-green" />
        <span className="font-stage text-[14px] font-semibold tracking-wide text-logic-text">VS Stage Remote</span>
        <span className="ml-auto flex items-center gap-1.5 console-legend">
          <span className={`console-led ${on && phones > 0 ? 'is-on-green' : ''}`} />
          {!on ? 'Desligado' : phones === 0 ? 'Nenhum celular' : phones === 1 ? '1 celular' : `${phones} celulares`}
        </span>
      </div>
      <div className="p-4">
        {mode === 'local' ? (
          <p className="text-xs text-logic-text-dim leading-relaxed">
            O programa está na Rede Local: o VS Stage Remote fica na tela Rede Local, com QR e PIN próprios.
          </p>
        ) : !on ? (
          <div className="flex items-center gap-3">
            <p className="flex-1 text-xs text-logic-text-dim leading-relaxed">
              Controle o Modo Show pelo celular, em pé: tocar, parar, fluxo, lista, ajustes e mixer. Funciona pela internet.
            </p>
            <button className="console-key is-lit-amber h-9 px-3 text-[13px] shrink-0" onClick={enableOnlineRemote}>Ligar</button>
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="console-display p-1.5 shrink-0 w-[132px] h-[132px] flex items-center justify-center">
              {qr ? <img src={qr} alt="QR do VS Stage Remote" className="w-full h-full rounded-[2px]" /> : <span className="console-legend">QR</span>}
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              <p className="text-xs text-logic-text-dim leading-relaxed">
                Aponte a câmera do celular para o QR. Quem tiver este link controla o show: mande só para quem opera.
              </p>
              <div className="flex items-center gap-1.5">
                <span className="flex-1 min-w-0 truncate text-xs font-mono text-logic-lcd-amber console-well px-2.5 py-1.5">{link}</span>
                <button className="console-key h-8 px-2 text-[12px] flex items-center gap-1 shrink-0" onClick={copy}>
                  <Copy size={12} /> {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  className={`console-key h-8 px-2.5 text-[12px] flex items-center gap-1 ${confirmRenew ? 'is-lit-amber' : ''}`}
                  onClick={() => { if (confirmRenew) { renewOnlineRemote(); setConfirmRenew(false); } else setConfirmRenew(true); }}
                  title="O link antigo para de funcionar e os celulares conectados saem"
                >
                  <RefreshCw size={12} /> {confirmRenew ? 'Confirma?' : 'Gerar novo link'}
                </button>
                <button className="console-key h-8 px-2.5 text-[12px]" onClick={disableOnlineRemote}>Desligar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
