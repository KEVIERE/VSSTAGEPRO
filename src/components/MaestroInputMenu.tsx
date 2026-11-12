import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, X } from 'lucide-react';
import { LedMeterH } from '@/components/MeterMask';
import { audioRecorder, listInputAudioDevices, type InputAudioDevice, type MaestroInput } from '@/lib/audioRecorder';
import { pickDevice, saveMaestroInput, usableChannel } from '@/lib/maestroInput';

/**
 * Menu do botão do microfone da faixa Maestro: escolhe a placa de áudio e o canal dela (entrada
 * 1, 2...) para gravar a voz. Fica por cima da tela (portal no body): dentro da coluna das
 * faixas ele era cortado na borda. Com o menu aberto o medidor mostra o sinal do canal escolhido,
 * para conferir se é a entrada certa antes de gravar.
 */
export default function MaestroInputMenu({ anchor, input, recording, onChange, onClose }: {
  /** O botão do microfone: o menu abre embaixo dele. */
  anchor: HTMLElement;
  input: MaestroInput;
  recording: boolean;
  onChange: (input: MaestroInput) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [devices, setDevices] = useState<InputAudioDevice[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [channels, setChannels] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });

  // lista as placas (pede a permissão do microfone se vierem sem nome)
  useEffect(() => {
    let alive = true;
    void listInputAudioDevices(true).then(({ devices: list, denied: no }) => {
      if (!alive) return;
      setDevices(list);
      setDenied(no);
      const deviceId = pickDevice(input.deviceId, list);
      if (deviceId !== input.deviceId) {
        const next = { deviceId, channel: 0 };
        saveMaestroInput(next);
        onChange(next);
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // abre a placa escolhida: mostra quantos canais ela tem e o sinal do canal escolhido
  useEffect(() => {
    if (devices === null) return;
    let alive = true;
    setError(null);
    audioRecorder.startMonitoring(input)
      .then((n) => { if (alive) setChannels(n); })
      .catch(() => { if (alive) { setChannels(0); setError('Não consegui abrir essa entrada. Confira se a placa está ligada e se o VS Stage pode usar o microfone.'); } });
    return () => { alive = false; };
  }, [devices, input]);
  useEffect(() => () => { if (!audioRecorder.recording) audioRecorder.stopMonitoring(); }, []);

  // posição: embaixo do botão; sobe se não couber
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = menuRef.current?.offsetHeight ?? 240;
    const left = Math.min(window.innerWidth - 300, Math.max(8, r.left));
    setPos(r.bottom + 4 + h > window.innerHeight - 8 ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  }, [anchor, devices, channels]);

  // fecha clicando fora (o botão do microfone abre e fecha sozinho) ou com Esc
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);

  const choose = (next: MaestroInput) => {
    if (recording) return;
    saveMaestroInput(next);
    onChange(next);
  };
  const channel = usableChannel(input.channel, channels);

  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Entrada da gravação do Maestro"
      className="fixed z-[999] w-[290px] console-face rounded-lg border border-black shadow-[0_12px_40px_rgba(0,0,0,0.85)] overflow-hidden animate-[fadeIn_100ms_ease-out]"
      style={pos}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="console-rail flex items-center gap-2 px-2.5 py-1.5">
        <Mic size={12} className="shrink-0 text-logic-text-dim" />
        <span className="console-legend flex-1 uppercase">Entrada da gravação</span>
        <button type="button" className="p-0.5 rounded text-logic-text-muted hover:text-logic-text" onClick={onClose} aria-label="Fechar" title="Fechar (Esc)">
          <X size={12} />
        </button>
      </div>

      <div className="p-2.5 flex flex-col gap-2.5 text-[11px]">
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Placa de áudio">
          <span className="console-legend">PLACA DE ÁUDIO</span>
          {devices === null ? (
            <span className="text-logic-text-muted py-1">Procurando as entradas...</span>
          ) : devices.length === 0 ? (
            <span className="text-logic-text-muted py-1">Nenhuma entrada de áudio encontrada.</span>
          ) : devices.map((d) => {
            const on = d.deviceId === input.deviceId;
            return (
              <button
                key={d.deviceId || 'padrao'}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={recording}
                onClick={() => choose({ deviceId: d.deviceId, channel: 0 })}
                className={`console-well w-full flex items-center gap-2 px-2 py-1.5 text-left rounded disabled:opacity-60 ${on ? 'text-[#ffd48a]' : 'text-logic-text hover:text-white'}`}
              >
                <span className={`console-led shrink-0 ${on ? 'is-on-amber' : ''}`} />
                <span className="truncate">{d.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1">
          <span className="console-legend">CANAL DA PLACA</span>
          {channels > 0 ? (
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Canal da placa">
              {Array.from({ length: channels }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={channel === i}
                  disabled={recording}
                  onClick={() => choose({ deviceId: input.deviceId, channel: i })}
                  className={`console-key min-w-[30px] h-6 px-1.5 text-[11px] ${channel === i ? 'is-lit-amber' : ''}`}
                  title={`Gravar a entrada ${i + 1} da placa`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-logic-text-muted">{error ? '' : 'Abrindo a placa...'}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="console-legend shrink-0">SINAL</span>
          <div className="console-well flex-1 px-1 py-[3px]">
            <LedMeterH id="input-maestro" width={220} height={5} title="Sinal do canal escolhido: fale no microfone para conferir" />
          </div>
        </div>

        {recording && <p className="text-logic-text-muted leading-snug">Pare a gravação para trocar a entrada.</p>}
        {denied && (
          <p className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber leading-snug">
            Sem permissão para o microfone: os nomes das placas não aparecem. Libere o VS Stage em Ajustes do Sistema, Privacidade e Segurança, Microfone.
          </p>
        )}
        {error && (
          <p className="px-2 py-1.5 rounded bg-logic-lcd-amber/15 border border-logic-lcd-amber/40 text-logic-lcd-amber leading-snug">{error}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
