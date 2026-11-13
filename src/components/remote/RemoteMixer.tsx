// Aba "Mixer" do VS Stage Remote: fader, medidor de LEDs, Mudo e Solo de cada canal e o fader do
// master, com os mesmos faders e medidores do Mixer do programa. Pan, anti-clip e roteamento
// ficam só no Mac.
import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { Fader } from '@/components/MixerPanel';
import { LedMeter } from '@/components/MeterMask';
import { volumeToDb } from '@/lib/audioEngine';
import { publishMeters, resetMeters } from '@/lib/meterBus';
import { unpackMeters, type RemoteCommand, type RemoteMeters, type RemoteState } from '@/lib/remoteProtocol';

type Send = (cmd: RemoteCommand) => void;

const SEND_GAP_MS = 70;
const HOLD_MS = 900;
/** sem medidor novo por este tempo (Mac parou, Wi-Fi caiu): as barras apagam */
const METERS_STALE_MS = 1500;

function dbText(v: number): string {
  const db = volumeToDb(v);
  return db === -Infinity ? '-∞' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
}

/**
 * Enquanto o dedo arrasta, o fader segue o dedo (não o eco do Mac, que chega atrasado) e o
 * celular manda no máximo um valor a cada 70 ms. Depois de soltar, volta a mostrar o do Mac.
 */
function useHeldFader(remote: number, push: (v: number) => void) {
  const [held, setHeld] = useState<number | null>(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const release = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (release.current) window.clearTimeout(release.current);
  }, []);
  const onChange = (v: number) => {
    setHeld(v);
    pending.current = v;
    if (release.current) window.clearTimeout(release.current);
    release.current = window.setTimeout(() => setHeld(null), HOLD_MS);
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (pending.current !== null) push(pending.current);
      pending.current = null;
    }, SEND_GAP_MS);
  };
  return { value: held ?? remote, onChange };
}

function Strip({ meterId, name, volume, mute, solo, locked, tone, height, onVolume, onMute, onSolo }: {
  meterId: string; name: string; volume: number; height: number; mute?: boolean; solo?: boolean; locked?: boolean; tone: 'cue' | 'band' | 'master';
  onVolume: (v: number) => void; onMute?: () => void; onSolo?: () => void;
}) {
  const fader = useHeldFader(volume, onVolume);
  return (
    <div className={`console-strip flex flex-col items-center w-[84px] min-w-[84px] border-r border-logic-border-dark py-2 px-1 gap-1.5 ${tone === 'master' ? 'is-selected' : ''}`}>
      {/* visor preto com o nome, igual ao mixer do Mac (a fita creme é só da skin Analógica) */}
      <div className="console-tape console-lcdname w-full h-[26px] flex items-center justify-center px-1" title={name}>
        <div className="line-clamp-2 break-words text-center">{name}</div>
      </div>
      <span className="console-readout font-stage text-[12px] tabular-nums text-logic-lcd-text">{dbText(fader.value)}</span>
      <div className="flex gap-[3px] items-end">
        <div className={`relative ${locked ? 'opacity-50 pointer-events-none' : ''}`}>
          <Fader
            value={fader.value}
            onChange={fader.onChange}
            onDoubleClick={() => fader.onChange(0.8)}
            width={26}
            height={height}
            tone={tone}
          />
          {locked && <Lock size={14} className="absolute top-1 right-1 text-logic-lcd-amber" aria-label="Fader travado no Mac" />}
        </div>
        {/* nível do som agora, igual ao medidor do mixer do Mac */}
        <LedMeter id={meterId} off={mute} height={height} smooth />
      </div>
      {onMute && onSolo ? (
        <div className="flex gap-1.5 mt-1">
          <button className={`console-key w-9 h-10 text-[14px] leading-none ${mute ? 'is-lit-amber' : ''}`} onClick={onMute} aria-pressed={mute} aria-label={mute ? `Tirar o mudo de ${name}` : `Silenciar ${name}`}>M</button>
          <button className={`console-key w-9 h-10 text-[14px] leading-none ${solo ? 'is-lit-amber' : ''}`} onClick={onSolo} aria-pressed={solo} aria-label={solo ? `Desligar o solo de ${name}` : `Solo de ${name}`}>S</button>
        </div>
      ) : <div className="h-10 mt-1" />}
    </div>
  );
}

// espaço do canal fora o fader: fita, visor de dB, teclas M/S e margens
const STRIP_CHROME = 150;

/**
 * Liga os medidores enquanto a aba Mixer está aberta: cada pacote do Mac vai para os medidores
 * deste celular; se parar de chegar, as barras apagam.
 */
function useRemoteMeters(watchMeters: (cb: (m: RemoteMeters) => void) => () => void) {
  useEffect(() => {
    let last = 0;
    const off = watchMeters((m) => {
      last = Date.now();
      publishMeters(unpackMeters(m));
    });
    const stale = window.setInterval(() => {
      if (last && Date.now() - last > METERS_STALE_MS) { last = 0; resetMeters(); }
    }, 500);
    return () => { off(); window.clearInterval(stale); resetMeters(); };
  }, [watchMeters]);
}

export default function RemoteMixer({ state, send, watchMeters }: {
  state: RemoteState;
  send: Send;
  watchMeters: (cb: (m: RemoteMeters) => void) => () => void;
}) {
  useRemoteMeters(watchMeters);
  // o fader cresce até a altura que sobra na tela (celular em pé tem espaço de sobra)
  const boxRef = useRef<HTMLDivElement>(null);
  const [faderH, setFaderH] = useState(230);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setFaderH(Math.max(180, Math.min(440, el.clientHeight - STRIP_CHROME)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="flex flex-col h-full">
      <div ref={boxRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden logic-scroll">
        <div className="flex min-w-fit border-l border-logic-border-dark">
          {state.tracks.map((t) => (
            <Strip
              key={t.id}
              meterId={t.id}
              name={t.name}
              volume={t.volume}
              mute={t.mute}
              solo={t.solo}
              locked={t.locked}
              tone={t.tone}
              height={faderH}
              onVolume={(v) => send({ action: 'volume', trackId: t.id, value: v })}
              // vai o valor que o operador quer: o toque duplo não desfaz
              onMute={() => send({ action: 'mute', trackId: t.id, on: !t.mute })}
              onSolo={() => send({ action: 'solo', trackId: t.id, on: !t.solo })}
            />
          ))}
          <Strip meterId="master" name="Master" volume={state.master} tone="master" height={faderH} onVolume={(v) => send({ action: 'master', value: v })} />
        </div>
      </div>
      <p className="px-4 py-3 text-center text-xs text-logic-text-muted">
        Arraste o fader para cima ou para baixo. Dois toques voltam para 0 dB. A barra ao lado mostra o som de cada canal agora. Pan e roteamento ficam no Mac.
      </p>
    </div>
  );
}
