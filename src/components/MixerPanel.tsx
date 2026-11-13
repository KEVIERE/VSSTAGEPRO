import { useStore, ROUTABLE_TRACKS } from '@/store';
import { volumeToDb } from '@/lib/audioEngine';
import { audioEngine } from '@/lib/audioEngine';
import { ChevronDown, ChevronUp, Volume2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { belowTarget, levelTarget, parseTargetDb, songLevelGain, TARGET_DB_MAX, TARGET_DB_MIN } from '@/lib/songLevel';
import { levelProgress, onLevelProgress } from '@/lib/songLevelWatcher';
import { LedMeter } from '@/components/MeterMask';
import OutputMenu from '@/components/OutputMenu';
import TrackContextMenu from '@/components/TrackContextMenu';
import type { Track } from '@/types';
import TimecodeMixerChannel from '@/components/TimecodeMixerChannel';
import { useMeterLevel } from '@/lib/meterBus';
import { gainToFader } from '@/lib/faderScale';
import { useSkin } from '@/lib/useSkin';
import { trackOrderOnScreen, trackPickMode } from '@/lib/trackSelection';
import { GfCap, GfFaderMeter, GfKey, GfKnob, GfScreen, GfTag } from '@/components/GrafitePieces';
import { EsCap, EsDbBoxes, EsKey, EsKnob, EsMeter, EsMeterScale, EsName, esTrackColor } from '@/components/EstudioPieces';
import { OfCap, OfKey, OfKnob, OfMeter, OfName, OfPeak, ofTrackColor } from '@/components/OficinaPieces';

// Volume igual entre os VS: o usuário escolhe um pico em dB e o maior pico de cada música fica
// nele (as mais baixas sobem, as mais altas descem). Ligado, mostra o valor editável: digitar
// outro e apertar Enter aplica na hora.
function LevelMatchButton() {
  const on = useStore((s) => !!s.levelMatch);
  const setLevelMatch = useStore((s) => s.setLevelMatch);
  const setLevelMatchDb = useStore((s) => s.setLevelMatchDb);
  const storedDb = useStore((s) => s.levelMatchDb);
  const target = useStore((s) => levelTarget(s));
  const current = useStore((s) => s.transport.currentSongId ?? s.selectedSongId);
  const gainDb = useStore((s) => (current ? 20 * Math.log10(songLevelGain(s, current)) : 0));
  const progress = useSyncExternalStore(onLevelProgress, levelProgress);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const commit = () => {
    const db = parseTargetDb(draft);
    if (db !== null) setLevelMatchDb(db);
    setEditing(false);
  };

  const targetText = target.toFixed(1);
  const low = useStore((s) => (current ? belowTarget(s, current) : false));
  const title = !on
    ? 'Volume igual entre os VS: clique para o maior pico de todas as músicas ficar no mesmo volume (em dB). As mais baixas sobem e as mais altas descem. Depois de ligado, dá para digitar o pico desejado.'
    : `Volume igual ligado: o maior pico de cada música fica em ${targetText} dB (com os faders em 0 dB).`
      + (progress ? ` Medindo as músicas: ${progress.done} de ${progress.total}.` : '')
      + (current ? ` Esta música: ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB.` : '')
      + (low ? ' Ela é baixa demais para chegar ao pico pedido mesmo subindo +24 dB.' : '')
      + ` Clique no número para escolher o pico (de ${TARGET_DB_MIN} a ${TARGET_DB_MAX} dB). Clique em IGUALAR para desligar.`;

  if (on && editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        onClick={(e) => e.stopPropagation()}
        className="console-readout w-[52px] text-logic-lcd-green outline-none ring-1 ring-logic-lcd-green/70"
        title={`Pico desejado em dB (${TARGET_DB_MIN} a ${TARGET_DB_MAX}; "2" vale como -2). Enter aplica, Esc cancela.`}
        aria-label="Pico desejado em dB"
      />
    );
  }

  // Ligado: "IGUALAR" vira o botão de desligar e embaixo aparece o pico desejado (clicável).
  // Um embaixo do outro: lado a lado não cabem nos 72 px do canal Master.
  return (
    <div className="flex flex-col items-center justify-center gap-0.5">
      <button
        className={`console-key flex items-center gap-1 h-[15px] px-1.5 text-[8.5px] leading-none tabular-nums ${on ? 'text-logic-text' : ''}`}
        onClick={() => setLevelMatch(!on)}
        title={title}
        aria-pressed={on}
      >
        <span className={`console-led ${on ? 'is-on-green' : ''}`} />
        {on && progress ? `${progress.done}/${progress.total}` : 'IGUALAR'}
      </button>
      {on && (
        <button
          className="console-readout console-glow text-logic-lcd-green hover:brightness-125 transition"
          onClick={() => { setDraft(String(storedDb ?? target)); setEditing(true); }}
          title={`Pico de todas as músicas: ${targetText} dB. Clique para digitar outro (${TARGET_DB_MIN} a ${TARGET_DB_MAX} dB).`}
        >
          {`${targetText} dB`}
        </button>
      )}
    </div>
  );
}

// Nível real do sinal em dBFS, em tempo real, com retenção do pico por 1,5 s (como nas mesas):
// verde até -6, amarelo até 0, vermelho em 0 dBFS ou acima.
function LevelReadout({ id, title }: { id: string; title: string }) {
  const level = useMeterLevel(id);
  const hold = useRef({ db: -Infinity, at: 0 });
  const db = level > 1e-5 ? 20 * Math.log10(level) : -Infinity;
  const now = performance.now();
  if (db >= hold.current.db || now - hold.current.at > 1500) hold.current = { db, at: now };
  const shown = hold.current.db;
  // abaixo de -60 dBFS é silêncio: o mostrador apaga (o espaço fica, sem pular o layout)
  const live = shown > -60;
  const tone = shown >= 0 ? 'text-logic-lcd-red' : shown >= -6 ? 'text-logic-lcd-amber' : 'text-logic-lcd-green';
  return (
    <span className={`console-readout console-glow ${live ? tone : ''}`} title={title}>
      {live ? `${shown > 0 ? '+' : ''}${shown.toFixed(1)}` : '\u00a0'}
    </span>
  );
}

// Marcas impressas ao lado do fader, na mesma curva do motor de áudio (0 dB = 0,8 no fader)
const FADER_MARKS: { db: number; label: string }[] = [
  { db: 12, label: '+12' }, { db: 6, label: '+6' }, { db: 0, label: '0' },
  { db: -6, label: '−6' }, { db: -12, label: '−12' }, { db: -Infinity, label: '−∞' },
];
const SCALE_W = 14;

// Grafite: escala fina à esquerda do fader, como nas mesas digitais
const GF_SCALE_W = 15;
export const GF_CAP_H = 34;
export const GF_FADER_H = 128;
// Estúdio: capa cinza mais baixa e escala fina à esquerda
export const ES_CAP_H = 32;
export const ES_FADER_H = 128;
export const ES_SCALE_W = 9;
// Oficina: capa clara de 28 px, sem escala ao lado (as marcas ficam dentro do medidor)
export const OF_CAP_H = 30;
export const OF_FADER_H = 150;
export const ES_FADER_W = 16;

/** Valor do fader em dB, como aparece nos visores. */
export function faderDbText(volume: number): string {
  const db = volumeToDb(volume);
  return db === -Infinity ? '-∞' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
}

type CapTone = 'cue' | 'band' | 'master';
// nomes escritos por inteiro para o Tailwind não descartar as classes no build
const CAP_CLASS: Record<CapTone, string> = {
  cue: 'console-cap--cue',
  band: 'console-cap--band',
  master: 'console-cap--master',
};

// Fader de mesa: escala impressa à esquerda, fenda no painel e a capa com frisos.
// Curso exato em pixels: onde o mouse arrasta é onde a capa fica.
export function Fader({
  value,
  onChange,
  onDoubleClick,
  width = 24,
  height = 120,
  tone = 'band',
}: {
  value: number;
  onChange: (v: number) => void;
  onDoubleClick?: () => void;
  width?: number;
  height?: number;
  tone?: CapTone;
}) {
  const skin = useSkin();
  const grafite = skin === 'grafite';
  const estudio = skin === 'estudio';
  const oficina = skin === 'oficina';
  const capHeight = grafite ? GF_CAP_H : estudio ? ES_CAP_H : oficina ? OF_CAP_H : 22;
  const travel = height - capHeight;
  const pct = Math.max(0, Math.min(1, value / 1.5));
  const bottomPx = pct * travel;
  const markY = (db: number) => (gainToFader(db === -Infinity ? 0 : Math.pow(10, db / 20)) / 1.5) * travel + capHeight / 2;

  // Fader relativo, como nas mesas: clicar não pula o volume — ele só anda o quanto o mouse
  // arrasta (encostar sem querer no palco não muda nada). Shift: ajuste fino (10× mais lento).
  const handleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startValue = value;
    let lastY = startY;
    let acc = startValue;

    const move = (ev: PointerEvent) => {
      const dy = lastY - ev.clientY;
      lastY = ev.clientY;
      acc += (dy / travel) * 1.5 * (ev.shiftKey ? 0.1 : 1);
      acc = Math.max(0, Math.min(1.5, acc));
      onChange(Math.round(acc * 1000) / 1000);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const db = volumeToDb(value);
  const dbLabel = db === -Infinity ? '-∞' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;

  if (oficina) {
    // Oficina: só a fenda escura e a capa clara de frisos (as marcas de dB ficam no medidor)
    return (
      <div
        className="of-fader relative cursor-ns-resize select-none"
        style={{ width: `${width}px`, height: `${height}px`, touchAction: 'none' }}
        onPointerDown={handleDown}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
        title={`Fader: ${dbLabel} dB. Arraste para ajustar (Shift: ajuste fino). Duplo clique: 0 dB.`}
      >
        <div className="of-slot absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ top: `${capHeight / 2 - 6}px`, bottom: `${capHeight / 2 - 6}px` }} />
        <OfCap tone={tone} className="absolute left-0 pointer-events-none" style={{ width: '100%', height: `${capHeight}px`, bottom: `${bottomPx}px` }} />
      </div>
    );
  }

  if (estudio) {
    // Estúdio: régua de risquinhos à esquerda (o 0 dB num traço branco maior), trilho fino e a
    // capa cinza translúcida por cima
    const ticks = Math.max(2, Math.floor(travel / 5));
    return (
      <div
        className="es-fader relative flex cursor-ns-resize select-none"
        style={{ width: `${width + ES_SCALE_W}px`, height: `${height}px`, touchAction: 'none' }}
        onPointerDown={handleDown}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
        title={`Fader: ${dbLabel} dB. Arraste para ajustar (Shift: ajuste fino). Duplo clique: 0 dB.`}
      >
        <div className="relative h-full pointer-events-none" style={{ width: `${ES_SCALE_W}px` }}>
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <i key={i} className="es-ruler-tick" style={{ bottom: `${capHeight / 2 + (i * travel) / ticks}px` }} />
          ))}
          <i className="es-ruler-unity" style={{ bottom: `${markY(0)}px` }} />
        </div>
        <div className="relative h-full pointer-events-none" style={{ width: `${width}px` }}>
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <i key={i} className="es-ruler-tick is-left" style={{ bottom: `${capHeight / 2 + (i * travel) / ticks}px` }} />
          ))}
          <div className="es-slot absolute left-1/2 -translate-x-1/2" style={{ top: `${capHeight / 2 - 2}px`, bottom: `${capHeight / 2 - 2}px` }} />
          <EsCap tone={tone} className="absolute left-0" style={{ width: '100%', height: `${capHeight}px`, bottom: `${bottomPx}px` }} />
        </div>
      </div>
    );
  }

  if (grafite) {
    // Grafite: escala fina à esquerda, fenda escura e a capa preta fosca com a linha acesa
    return (
      <div
        className="gf-fader relative flex cursor-ns-resize select-none"
        style={{ width: `${width + GF_SCALE_W}px`, height: `${height}px`, touchAction: 'none' }}
        onPointerDown={handleDown}
        onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
        title={`Fader: ${dbLabel} dB. Arraste para ajustar (Shift: ajuste fino). Duplo clique: 0 dB.`}
      >
        <div className="relative h-full pointer-events-none" style={{ width: `${GF_SCALE_W}px` }}>
          {FADER_MARKS.map((m) => (
            <span key={m.label} className={`gf-scale ${m.db === 0 ? 'is-unity' : ''}`} style={{ bottom: `${markY(m.db)}px` }}>
              {m.label}<i className="gf-scale-tick" />
            </span>
          ))}
        </div>
        <div className="relative h-full pointer-events-none" style={{ width: `${width}px` }}>
          <div className="gf-slot absolute left-1/2 -translate-x-1/2" style={{ top: `${capHeight / 2 - 3}px`, bottom: `${capHeight / 2 - 3}px` }} />
          <GfCap tone={tone} className="absolute left-0" style={{ width: '100%', height: `${capHeight}px`, bottom: `${bottomPx}px` }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="console-faderbed relative flex cursor-ns-resize select-none"
      style={{ width: `${SCALE_W + width}px`, height: `${height}px`, touchAction: 'none' }}
      onPointerDown={handleDown}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      title={`Fader: ${dbLabel} dB. Arraste para ajustar (Shift: ajuste fino). Duplo clique: 0 dB.`}
    >
      {/* Escala em dB impressa no painel */}
      <div className="relative h-full pointer-events-none" style={{ width: `${SCALE_W}px` }}>
        {FADER_MARKS.map((m) => (
          <span key={m.label} className={`console-scale ${m.db === 0 ? 'is-unity' : ''}`} style={{ bottom: `${markY(m.db)}px` }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative h-full pointer-events-none" style={{ width: `${width}px` }}>
        {FADER_MARKS.map((m) => (
          <div key={m.label} className={`console-tick ${m.db === 0 ? 'is-unity' : ''}`} style={{ bottom: `${markY(m.db)}px` }} />
        ))}
        {/* Fenda do fader */}
        <div
          className="console-slot absolute left-1/2 -translate-x-1/2"
          style={{ top: `${capHeight / 2 - 2}px`, bottom: `${capHeight / 2 - 2}px` }}
        />
        {/* rastro de luz do volume na fenda (só a skin padrão desenha) */}
        <div className="console-faderfill absolute left-1/2 -translate-x-1/2" style={{ bottom: `${capHeight / 2}px`, height: `${bottomPx}px` }} />
        {/* Capa do fader */}
        <div
          className={`console-cap ${CAP_CLASS[tone]} absolute left-0 right-0`}
          style={{ height: `${capHeight}px`, bottom: `${bottomPx}px` }}
        />
      </div>
    </div>
  );
}

// Arrastar o knob de pan para os lados; duplo clique volta ao centro.
function panKnobProps(trackId: string, pan: number, setPan: (id: string, v: number) => void) {
  return {
    onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); setPan(trackId, 0); },
    onMouseDown: (e: React.MouseEvent) => {
      e.stopPropagation();
      const startX = e.clientX;
      const onMove = (ev: MouseEvent) => {
        const delta = (ev.clientX - startX) / 50;
        setPan(trackId, Math.max(-1, Math.min(1, pan + delta)));
      };
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    title: `Pan: ${pan > 0 ? 'R' : pan < 0 ? 'L' : 'C'} ${Math.abs(Math.round(pan * 100))} (duplo clique = centro)`,
  };
}

/** Estúdio: os nomes das linhas do mixer na lateral (Pan, dB, Mute / Solo, Nome), como nas DAWs. */
function EsRowLabels() {
  return (
    <div className="es-rowlabels flex flex-col items-end w-[62px] min-w-[62px] py-1.5 pr-2 gap-[3px]" aria-hidden="true">
      <span className="h-[20px]">Saída</span>
      <span className="h-[28px]">Pan</span>
      <span className="h-[16px]">dB</span>
      <span className="mt-auto" style={{ height: ES_FADER_H }} />
      <span className="h-[18px]">Mute / Solo</span>
      <span className="h-[28px] -mb-1.5">Nome</span>
    </div>
  );
}

function MixerChannel({ trackId, index, onMenu: openMenu }: {
  trackId: string;
  index: number;
  /** Botão direito no canal: o mesmo menu da faixa na timeline (cor, nome...). */
  onMenu: (track: Track, x: number, y: number) => void;
}) {
  const track = useStore((s) => s.tracks.find((t) => t.id === trackId));
  const setVolume = useStore((s) => s.setVolume);
  const setPan = useStore((s) => s.setPan);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const toggleAntiClip = useStore((s) => s.toggleAntiClip);
  const clearClipIndicator = useStore((s) => s.clearClipIndicator);
  const isPicked = useStore((s) => s.selectedTrackIds.includes(trackId));
  const pickTrack = useStore((s) => s.pickTrack);
  // clique escolhe este canal; ⌘ soma ou tira; Shift vai do último clicado até este
  const onPick = (e: React.MouseEvent) => pickTrack(trackId, trackPickMode(e), trackOrderOnScreen('data-mixer-track'));
  const onMenu = (e: React.MouseEvent) => {
    if (!track) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(track, e.clientX, e.clientY);
  };
  const skin = useSkin();
  const grafite = skin === 'grafite';

  if (!track) return null;

  const isSelected = isPicked;
  const isClipping = track.clipIndicator;

  if (skin === 'oficina') {
    // Oficina (editor clássico): em cima, a parte tingida na cor do canal com a saída em pílula e o
    // knob branco; embaixo, escura, o volume, o fader cromado, o medidor e os botões M / S / AC; no
    // pé, o nome na cor do canal e o número numa faixa colorida.
    const color = ofTrackColor(track.color, index);
    return (
      <div
        className={`console-strip of-strip flex flex-col items-center w-[72px] min-w-[72px] cursor-pointer relative ${isSelected ? 'is-selected' : ''}`}
        style={{ '--ch': color } as React.CSSProperties}
        data-mixer-track={track.id}
        onClick={onPick}
        onContextMenu={onMenu}
      >
        <div className="of-top w-full flex flex-col items-center gap-[4px] px-[4px] pt-[5px] pb-[6px]">
          <OutputMenu track={track} />
          <div className="w-[26px] h-[26px] relative cursor-ew-resize select-none" {...panKnobProps(track.id, track.pan, setPan)}>
            <OfKnob value={track.pan} className="absolute inset-0 w-full h-full pointer-events-none" />
          </div>
        </div>
        <div className="w-full flex items-center px-[6px] pt-[3px] h-[15px]" title={`Fader: ${faderDbText(track.volume)} dB`}>
          <OfPeak meterId={track.id} title="Pico do sinal agora (dBFS, últimos 1,5 s)" />
        </div>
        <div className="flex items-start gap-[3px] mt-auto mb-[4px]">
          <Fader
            value={track.volume}
            onChange={(v) => setVolume(track.id, v)}
            onDoubleClick={() => setVolume(track.id, 0.8)}
            width={16}
            height={OF_FADER_H}
            tone={track.isSubgroup && track.id !== 'track-guia' ? 'band' : 'cue'}
          />
          <div style={{ marginTop: 4 }}>
            <OfMeter
              id={track.id}
              height={OF_FADER_H - 8}
              off={track.mute}
              clipping={isClipping}
              onClick={(e) => { e.stopPropagation(); if (isClipping) clearClipIndicator(track.id); }}
            />
          </div>
          <div className="flex flex-col gap-[4px]" style={{ marginTop: 4 }}>
            <OfKey
              label="M"
              kind="m"
              lit={track.mute}
              onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
              title={track.mute ? 'Canal mudo: clique para voltar' : 'Silenciar o canal'}
            />
            <OfKey
              label="S"
              kind="s"
              lit={track.solo}
              onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
              title={track.solo ? 'Solo ligado: clique para desligar' : 'Ouvir só este canal (solo)'}
            />
            <OfKey
              label="AC"
              kind="fx"
              lit={track.antiClip || isClipping}
              alert={!track.antiClip && isClipping}
              pulse={!track.antiClip && isClipping}
              onClick={(e) => { e.stopPropagation(); toggleAntiClip(track.id); }}
              title={track.antiClip
                ? 'Anti-Clip ligado: a saída deste canal não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
                : 'Anti-Clip desligado: clique para limitar a saída deste canal em -0,1 dBFS, sem mudar o volume do resto.'}
            />
          </div>
        </div>
        <OfName name={track.name} number={index + 1} color={color} selected={isSelected} title={track.name} />
      </div>
    );
  }

  if (skin === 'estudio') {
    // Estúdio (DAW do Mac): pan, caixinhas de dB, fader com o medidor, M / S / AC e o nome
    // embaixo na cor da faixa.
    const color = esTrackColor(track.color, index);
    return (
      <div
        className={`console-strip es-strip flex flex-col items-center w-[72px] min-w-[72px] py-1.5 px-[4px] gap-[3px] cursor-pointer relative ${isSelected ? 'is-selected' : ''}`}
        data-mixer-track={track.id}
        onClick={onPick}
        onContextMenu={onMenu}
      >
        <OutputMenu track={track} />
        <div className="w-[28px] h-[28px] relative cursor-ew-resize select-none" {...panKnobProps(track.id, track.pan, setPan)}>
          <EsKnob value={track.pan} className="absolute inset-0 w-full h-full pointer-events-none" />
        </div>
        <EsDbBoxes volume={track.volume} meterId={track.id} title="Volume do fader e pico do sinal agora (dBFS, últimos 1,5 s)" />
        <div className="flex items-start gap-[2px] mt-auto">
          <Fader
            value={track.volume}
            onChange={(v) => setVolume(track.id, v)}
            onDoubleClick={() => setVolume(track.id, 0.8)}
            width={ES_FADER_W}
            height={ES_FADER_H}
            tone={track.isSubgroup && track.id !== 'track-guia' ? 'band' : 'cue'}
          />
          <div className="flex gap-[1px]" style={{ marginTop: ES_CAP_H / 2 }}>
            <EsMeterScale height={ES_FADER_H - ES_CAP_H} />
            <EsMeter
              id={track.id}
              height={ES_FADER_H - ES_CAP_H}
              off={track.mute}
              clipping={isClipping}
              onClick={(e) => { e.stopPropagation(); if (isClipping) clearClipIndicator(track.id); }}
            />
          </div>
        </div>
        <div className="flex gap-[2px] w-full">
          <EsKey
            label="M"
            tone="mute"
            lit={track.mute}
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
            title={track.mute ? 'Canal mudo: clique para voltar' : 'Silenciar o canal'}
          />
          <EsKey
            label="S"
            tone="solo"
            lit={track.solo}
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
            title={track.solo ? 'Solo ligado: clique para desligar' : 'Ouvir só este canal (solo)'}
          />
          <EsKey
            label="AC"
            tone={!track.antiClip && isClipping ? 'alert' : 'on'}
            lit={track.antiClip || isClipping}
            pulse={!track.antiClip && isClipping}
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); toggleAntiClip(track.id); }}
            title={track.antiClip
              ? 'Anti-Clip ligado: a saída deste canal não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
              : 'Anti-Clip desligado: clique para limitar a saída deste canal em -0,1 dBFS, sem mudar o volume do resto.'}
          />
        </div>
        <EsName name={track.name} color={color} title={track.name} />
      </div>
    );
  }

  if (grafite) {
    // Grafite (mesa digital): tela do canal, encoder com anel de LED, teclas SOLO / MUTE / CLIP que
    // acendem por dentro e, embaixo, o fader com o medidor fino ao lado.
    return (
      <div
        className={`console-strip gf-strip flex flex-col items-center w-[72px] min-w-[72px] py-1.5 px-[3px] gap-[3px] cursor-pointer relative ${isSelected ? 'is-selected' : ''}`}
        style={{ '--ch': track.color } as React.CSSProperties}
        data-mixer-track={track.id}
        onClick={onPick}
        onContextMenu={onMenu}
      >
        <OutputMenu track={track} />
        <GfScreen
          number={index + 1}
          name={track.name}
          value={faderDbText(track.volume)}
          color={track.color}
          pan={track.pan}
          tags={<><GfTag on={track.solo} tone="solo">S</GfTag><GfTag on={track.mute} tone="mute">M</GfTag></>}
        />
        <div className="w-[30px] h-[30px] relative cursor-ew-resize select-none" {...panKnobProps(track.id, track.pan, setPan)}>
          <GfKnob value={track.pan} color={track.color} className="absolute inset-0 w-full h-full pointer-events-none" />
        </div>
        <div className="flex gap-[2px] w-full">
          <GfKey
            label="SOLO"
            tone="solo"
            lit={track.solo}
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
            title={track.solo ? 'Solo ligado: clique para desligar' : 'Ouvir só este canal (solo)'}
          />
          <GfKey
            label="MUTE"
            tone="mute"
            lit={track.mute}
            className="flex-1"
            onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
            title={track.mute ? 'Canal mudo: clique para voltar' : 'Silenciar o canal'}
          />
          <GfKey
            label="CLIP"
            tone={!track.antiClip && isClipping ? 'mute' : 'clip'}
            lit={track.antiClip || isClipping}
            pulse={!track.antiClip && isClipping}
            className="w-[17px]"
            onClick={(e) => { e.stopPropagation(); toggleAntiClip(track.id); }}
            title={track.antiClip
              ? 'Anti-Clip ligado: a saída deste canal não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
              : 'Anti-Clip desligado: clique para limitar a saída deste canal em -0,1 dBFS, sem mudar o volume do resto.'}
          />
        </div>
        <div className="flex items-start gap-[3px] mt-auto">
          <Fader
            value={track.volume}
            onChange={(v) => setVolume(track.id, v)}
            onDoubleClick={() => setVolume(track.id, 0.8)}
            width={24}
            height={GF_FADER_H}
            tone={track.isSubgroup && track.id !== 'track-guia' ? 'band' : 'cue'}
          />
          <div style={{ marginTop: GF_CAP_H / 2 }}>
            <GfFaderMeter
              id={track.id}
              height={GF_FADER_H - GF_CAP_H}
              off={track.mute}
              clipping={isClipping}
              onClick={(e) => { e.stopPropagation(); if (isClipping) clearClipIndicator(track.id); }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`console-strip flex flex-col items-center w-[72px] min-w-[72px] border-r border-logic-border-dark py-1.5 px-1 gap-[3px] cursor-pointer transition-colors duration-75 relative
        ${isSelected ? 'is-selected' : ''}`}
      data-mixer-track={track.id}
        onClick={onPick}
        onContextMenu={onMenu}
    >
      <OutputMenu track={track} />

      {/* Knob de pan */}
      <div className="w-7 h-7 relative cursor-ew-resize select-none" {...panKnobProps(track.id, track.pan, setPan)}>
        <PanKnob pan={track.pan} />
      </div>

      {/* Nome do canal na fita crepe, inteiro em até 2 linhas */}
      <div className="console-tape console-lcdname w-full h-[22px] flex items-center justify-center px-1" title={track.name}>
        <span className="line-clamp-2 break-words text-center">{track.name}</span>
      </div>

      {/* Fader (com a escala) e medidor */}
      <div className="flex gap-[3px] items-end">
        <Fader
          value={track.volume}
          onChange={(v) => setVolume(track.id, v)}
          onDoubleClick={() => setVolume(track.id, 0.8)}
          width={24}
          height={120}
          tone={track.isSubgroup && track.id !== 'track-guia' ? 'band' : 'cue'}
        />
        <LedMeter
          stereo
          id={track.id}
          off={track.mute}
          clipping={isClipping}
          onClick={(e) => { e.stopPropagation(); if (isClipping) clearClipIndicator(track.id); }}
          title={isClipping ? 'Clique para apagar o indicador de clip' : undefined}
        />
      </div>

      <LevelReadout id={track.id} title="Nível do sinal agora (dBFS, pico das últimas 1,5 s). Em silêncio fica apagado." />

      {/* Anti-clip: liga/desliga o limitador de pico do canal em -0,1 dBFS. O LED verde mostra que está ligado. */}
      <button
        className={`console-key flex items-center gap-1 h-[15px] px-1.5 text-[8.5px] leading-none ${
          !track.antiClip && isClipping ? 'is-lit-red animate-pulse' : ''
        } ${track.antiClip ? 'text-logic-text' : ''}`}
        onClick={(e) => { e.stopPropagation(); toggleAntiClip(track.id); }}
        aria-pressed={track.antiClip}
        title={track.antiClip
          ? 'Anti-Clip ligado: a saída deste canal não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
          : 'Anti-Clip desligado: clique para limitar a saída deste canal em -0,1 dBFS, sem mudar o volume do resto.'}
      >
        <span className={`console-led ${track.antiClip ? 'is-on-green' : ''}`} />
        ANTI-CLIP
      </button>

      {/* Teclas M (mudo) e S (solo): acendem quando ligadas */}
      <div className="flex gap-1">
        <button
          className={`console-key w-6 h-[18px] text-[11px] leading-none ${track.mute ? 'is-lit-amber' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
          aria-pressed={track.mute}
          title={track.mute ? 'Canal mudo: clique para voltar' : 'Silenciar o canal'}
        >M</button>
        <button
          className={`console-key w-6 h-[18px] text-[11px] leading-none ${track.solo ? 'is-lit-amber' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
          aria-pressed={track.solo}
          title={track.solo ? 'Solo ligado: clique para desligar' : 'Ouvir só este canal (solo)'}
        >S</button>
      </div>
    </div>
  );
}

// Knob de pan da skin padrão: anel de LEDs brancos acendendo do centro até o pan, corpo em preto
// piano com aro cinza e o ponteiro aceso.
const PAN_LEDS = 13;

function PanKnob({ pan }: { pan: number }) {
  const v = Math.max(-1, Math.min(1, pan));
  const pos = ((v + 1) / 2) * (PAN_LEDS - 1);
  const mid = (PAN_LEDS - 1) / 2;
  return (
    <svg viewBox="0 0 28 28" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      <defs>
        <radialGradient id="vs-pan-body" cx="45%" cy="32%" r="72%">
          <stop offset="0" stopColor="#3a3a3e" />
          <stop offset="0.6" stopColor="#141415" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
        <linearGradient id="vs-pan-rim" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#bdbdc4" stopOpacity="0.6" />
          <stop offset="1" stopColor="#3a3a3e" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      {Array.from({ length: PAN_LEDS }, (_, i) => {
        const a = ((-135 + (i / (PAN_LEDS - 1)) * 270 - 90) * Math.PI) / 180;
        const lit = i === mid || (pos >= mid ? i >= mid && i <= pos + 0.01 : i <= mid && i >= pos - 0.01);
        const color = i === mid ? '#f2f2f5' : '#d0d0d6';
        return (
          <circle
            key={i}
            cx={14 + 12.6 * Math.cos(a)} cy={14 + 12.6 * Math.sin(a)} r={0.95}
            fill={lit ? color : '#232326'}
            style={lit ? { filter: `drop-shadow(0 0 1.5px ${color})` } : undefined}
          />
        );
      })}
      <circle cx="14" cy="14.7" r="9.4" fill="#000" opacity="0.55" />
      <circle cx="14" cy="14" r="9.2" fill="url(#vs-pan-body)" />
      <circle cx="14" cy="14" r="9.2" fill="none" stroke="url(#vs-pan-rim)" strokeWidth="0.8" />
      <ellipse cx="12.6" cy="10.4" rx="4.4" ry="2.1" fill="#fff" opacity="0.07" />
      <g transform={`rotate(${v * 135} 14 14)`}>
        <rect x="13.35" y="5.8" width="1.3" height="5.2" rx="0.65" fill="#f2f2f5" style={{ filter: 'drop-shadow(0 0 1.2px rgba(255,255,255,0.8))' }} />
      </g>
    </svg>
  );
}

export default function MixerPanel() {
  const mixerVisible = useStore((s) => s.mixerVisible);
  const toggleMixer = useStore((s) => s.toggleMixer);
  const tracks = useStore((s) => s.tracks);
  const magicRoutingActive = useStore((s) => s.magicRoutingActive);
  const toggleMagicRouting = useStore((s) => s.toggleMagicRouting);
  const masterVolume = useStore((s) => s.masterVolume);
  const masterClipPeak = useStore((s) => s.masterClipPeak);
  const setMasterVolume = useStore((s) => s.setMasterVolume);
  const clearMasterClipIndicator = useStore((s) => s.clearMasterClipIndicator);
  const masterAntiClip = useStore((s) => !!s.masterAntiClip);
  const toggleMasterAntiClip = useStore((s) => s.toggleMasterAntiClip);
  const masterIsClipping = masterClipPeak >= 1;
  const skin = useSkin();
  // menu da faixa (cor, nome...) aberto com o botão direito num canal
  const [trackMenu, setTrackMenu] = useState<{ track: Track; x: number; y: number } | null>(null);
  const grafite = skin === 'grafite';

  const allChannels = useMemo(() => {
    const result: string[] = [];
    for (const id of ROUTABLE_TRACKS) {
      const track = tracks.find((t) => t.id === id);
      if (!track) continue;
      // só canais de topo: subgrupos e tracks soltas (filhas tocam pelo canal do pai)
      if (track.parentId) continue;
      result.push(track.id);
    }
    return result;
  }, [tracks]);

  if (!mixerVisible) {
    return (
      <div
        className="flex items-center justify-center h-7 bg-logic-bg-deep border-t border-logic-border-dark cursor-pointer hover:bg-logic-bg-panel transition-colors"
        onClick={toggleMixer}
      >
        <div className="flex items-center gap-2 text-2xs text-logic-text-muted uppercase tracking-wider">
          <ChevronUp size={12} />
          <Volume2 size={12} />
          <span>Mostrar Mixer</span>
        </div>
      </div>
    );
  }

  return (
    <div className="console-face console-screws flex flex-col shrink-0 border-t border-black overflow-hidden" style={{ height: '300px', maxHeight: '60%' }}>
      {/* Trilho de cima */}
      <div
        className="console-rail flex items-center justify-between px-3 h-7 cursor-pointer"
        onClick={toggleMixer}
      >
        <div className="flex items-center gap-2">
          <Volume2 size={13} className="text-logic-text-dim" />
          <span className="font-stage text-[13px] font-semibold tracking-wide text-logic-text-dim">Mixer</span>
        </div>
        <button className="text-logic-text-muted hover:text-logic-text transition-colors" aria-label="Esconder o mixer">
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Canais */}
      <div className="console-bed flex-1 flex overflow-x-auto overflow-y-hidden logic-scroll min-h-0">
        <div className="flex mx-auto min-w-fit border-l border-r border-logic-border-dark">
          {skin === 'estudio' && <EsRowLabels />}
          <TimecodeMixerChannel />
          {allChannels.map((trackId, i) => (
            <MixerChannel key={trackId} trackId={trackId} index={i} onMenu={(track, x, y) => setTrackMenu({ track, x, y })} />
          ))}

          {skin === 'oficina' ? (
            // Master da Oficina: em cima, cinza, o IGUALAR e o roteamento mágico; embaixo o fader
            <div className="console-strip of-strip is-master flex flex-col items-center w-[72px] min-w-[72px]" style={{ '--ch': '#8f8f8f' } as React.CSSProperties}>
              <div className="of-top w-full flex flex-col items-center gap-[4px] px-[4px] pt-[5px] pb-[6px]">
                <div className="min-h-[20px] flex items-center justify-center">
                  <LevelMatchButton />
                </div>
                <button
                  className={`console-key flex items-center justify-center w-[26px] h-[24px] ${magicRoutingActive ? 'is-lit-green animate-pulse' : ''}`}
                  onClick={() => toggleMagicRouting()}
                  aria-pressed={magicRoutingActive}
                  title="Roteamento mágico: Guia/Click/Maestro → L e Banda → R. O timecode não é alterado. Clique novamente para restaurar."
                >
                  <Wand2 size={12} />
                </button>
              </div>
              <div className="w-full flex items-center px-[6px] pt-[3px] h-[15px]" title={`Fader: ${faderDbText(masterVolume)} dB`}>
                <OfPeak meterId="master" title="Pico da saída agora (dBFS, depois do limiter)" />
              </div>
              <div className="flex items-start gap-[3px] mt-auto mb-[4px]">
                <Fader
                  value={masterVolume}
                  onChange={(v) => { setMasterVolume(v); audioEngine.setMasterVolume(v); }}
                  onDoubleClick={() => { setMasterVolume(0.8); audioEngine.setMasterVolume(0.8); }}
                  width={16}
                  height={OF_FADER_H}
                  tone="master"
                />
                <div style={{ marginTop: 4 }}>
                  <OfMeter
                    id="master"
                    height={OF_FADER_H - 8}
                    clipping={masterIsClipping}
                    onClick={() => { if (masterIsClipping) clearMasterClipIndicator(); }}
                  />
                </div>
                <div className="flex flex-col gap-[4px]" style={{ marginTop: 4 }}>
                  <OfKey
                    label="AC"
                    kind="fx"
                    lit={masterAntiClip || masterIsClipping}
                    alert={!masterAntiClip && masterIsClipping}
                    pulse={!masterAntiClip && masterIsClipping}
                    onClick={toggleMasterAntiClip}
                    title={masterAntiClip
                      ? 'Anti-Clip ligado: a saída do master não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
                      : 'Anti-Clip desligado: clique para limitar a saída do master em -0,1 dBFS, sem mexer no fader.'}
                  />
                </div>
              </div>
              <OfName name="MASTER" number="M" color="#8f8f8f" />
            </div>
          ) : skin === 'estudio' ? (
            // Master da Estúdio: IGUALAR em cima, roteamento mágico, dB, fader, AC e o nome
            <div className="console-strip es-strip is-master flex flex-col items-center w-[72px] min-w-[72px] py-1.5 px-[4px] gap-[3px]">
              <div className="min-h-[20px] flex items-center justify-center">
                <LevelMatchButton />
              </div>
              <button
                className={`console-key flex items-center justify-center w-[28px] h-[28px] !rounded-full ${magicRoutingActive ? 'is-lit-blue animate-pulse' : ''}`}
                onClick={() => toggleMagicRouting()}
                aria-pressed={magicRoutingActive}
                title="Roteamento mágico: Guia/Click/Maestro → L e Banda → R. O timecode não é alterado. Clique novamente para restaurar."
              >
                <Wand2 size={13} />
              </button>
              <EsDbBoxes volume={masterVolume} meterId="master" title="Volume do master e pico da saída agora (dBFS, depois do limiter)" />
              <div className="flex items-start gap-[2px] mt-auto">
                <Fader
                  value={masterVolume}
                  onChange={(v) => { setMasterVolume(v); audioEngine.setMasterVolume(v); }}
                  onDoubleClick={() => { setMasterVolume(0.8); audioEngine.setMasterVolume(0.8); }}
                  width={ES_FADER_W}
                  height={ES_FADER_H}
                  tone="master"
                />
                <div className="flex gap-[1px]" style={{ marginTop: ES_CAP_H / 2 }}>
                  <EsMeterScale height={ES_FADER_H - ES_CAP_H} />
                  <EsMeter
                    id="master"
                    height={ES_FADER_H - ES_CAP_H}
                    clipping={masterIsClipping}
                    onClick={() => { if (masterIsClipping) clearMasterClipIndicator(); }}
                  />
                </div>
              </div>
              <div className="flex gap-[2px] w-full">
                <EsKey
                  label="ANTI-CLIP"
                  tone={!masterAntiClip && masterIsClipping ? 'alert' : 'on'}
                  lit={masterAntiClip || masterIsClipping}
                  pulse={!masterAntiClip && masterIsClipping}
                  className="flex-1"
                  onClick={toggleMasterAntiClip}
                  title={masterAntiClip
                    ? 'Anti-Clip ligado: a saída do master não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
                    : 'Anti-Clip desligado: clique para limitar a saída do master em -0,1 dBFS, sem mexer no fader.'}
                />
              </div>
              <EsName name="Master" color="#636366" />
            </div>
          ) : grafite ? (
            // Master da Grafite: tela vermelha, roteamento mágico, IGUALAR, CLIP e o fader
            <div className="console-strip gf-strip is-master flex flex-col items-center w-[72px] min-w-[72px] py-1.5 px-[3px] gap-[3px]">
              <div className="min-h-[20px] flex items-center justify-center">
                <LevelMatchButton />
              </div>
              <GfScreen
                number="LR"
                name="MASTER"
                value={faderDbText(masterVolume)}
                color="#ff4d42"
                tags={<GfTag on={masterAntiClip} tone="clip">L</GfTag>}
              />
              <button
                className={`console-key flex items-center justify-center w-[28px] h-[28px] !rounded-full ${magicRoutingActive ? 'is-lit-amber animate-pulse' : ''}`}
                onClick={() => toggleMagicRouting()}
                aria-pressed={magicRoutingActive}
                title="Roteamento mágico: Guia/Click/Maestro → L e Banda → R. O timecode não é alterado. Clique novamente para restaurar."
              >
                <Wand2 size={13} />
              </button>
              <div className="flex gap-[2px] w-full">
                <GfKey
                  label="ANTI-CLIP"
                  tone={!masterAntiClip && masterIsClipping ? 'mute' : 'clip'}
                  lit={masterAntiClip || masterIsClipping}
                  pulse={!masterAntiClip && masterIsClipping}
                  className="flex-1"
                  onClick={toggleMasterAntiClip}
                  title={masterAntiClip
                    ? 'Anti-Clip ligado: a saída do master não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
                    : 'Anti-Clip desligado: clique para limitar a saída do master em -0,1 dBFS, sem mexer no fader.'}
                />
              </div>
              <div className="flex items-start gap-[3px] mt-auto">
                <Fader
                  value={masterVolume}
                  onChange={(v) => { setMasterVolume(v); audioEngine.setMasterVolume(v); }}
                  onDoubleClick={() => { setMasterVolume(0.8); audioEngine.setMasterVolume(0.8); }}
                  width={24}
                  height={GF_FADER_H}
                  tone="master"
                />
                <div style={{ marginTop: GF_CAP_H / 2 }}>
                  <GfFaderMeter
                    id="master"
                    height={GF_FADER_H - GF_CAP_H}
                    clipping={masterIsClipping}
                    onClick={() => { if (masterIsClipping) clearMasterClipIndicator(); }}
                  />
                </div>
              </div>
            </div>
          ) : (
          // Master: módulo separado, mais escuro, com capa de fader vermelha.
          // O topo repete as duas linhas dos canais (saída + knob de pan, aqui o LR mágico) para
          // a fita, o fader, a tecla ANTI-CLIP e o M/S caírem nas mesmas alturas dos outros.
          <div className="console-strip flex flex-col items-center w-[72px] min-w-[72px] bg-black/25 border-l-2 border-black py-1.5 px-1 gap-[3px]">
          {/* mesma altura do seletor de saída dos canais (2xs: 14px de linha + py-0.5 + borda) */}
          <div className="h-[20px] flex items-center justify-center text-[9px] font-bold tracking-wider text-logic-text-dim" title="Saída: a do Dispositivo de Áudio escolhido">
            SAÍDA
          </div>

          {/* Botão mágico: roteia Guia/Click/Maestro → L (1) e Banda → R (2).
              h-7 = knob de pan dos canais, para a fita e o fader caírem nas mesmas linhas. */}
          <button
            className={`console-key flex items-center justify-center w-7 h-7 !rounded-full ${
              magicRoutingActive ? 'is-lit-amber animate-pulse' : ''
            }`}
            onClick={() => toggleMagicRouting()}
            aria-pressed={magicRoutingActive}
            title="Roteamento mágico: Guia/Click/Maestro → L e Banda → R. O timecode não é alterado. Clique novamente para restaurar."
          >
            <Wand2 size={14} />
          </button>

          {/* mesma altura da fita dos canais (h-[22px]): a fita do master não pode levantar o fader */}
          <div className="console-tape console-lcdname w-full h-[22px] flex items-center justify-center px-1.5 text-[11.5px] tracking-wide">MASTER</div>

          <div className="flex gap-[3px] items-end">
            <Fader
              value={masterVolume}
              onChange={(v) => {
                setMasterVolume(v);
                audioEngine.setMasterVolume(v);
              }}
              onDoubleClick={() => {
                setMasterVolume(0.8);
                audioEngine.setMasterVolume(0.8);
              }}
              width={24}
              height={120}
              tone="master"
            />
            {/* mesma escala dos canais */}
            <LedMeter
              stereo
              id="master"
              clipping={masterIsClipping}
              onClick={() => { if (masterIsClipping) clearMasterClipIndicator(); }}
              title={masterIsClipping ? 'Clique para apagar o indicador de clip' : undefined}
            />
          </div>

          <LevelReadout id="master" title="Nível de saída do master agora (dBFS, pico das últimas 1,5 s, depois do limiter)" />

          {/* Anti-clip: o mesmo dos canais — liga/desliga o limitador de pico do master em -0,1 dBFS. LED verde = ligado. */}
          <button
            className={`console-key flex items-center gap-1 h-[15px] px-1.5 text-[8.5px] leading-none ${
              !masterAntiClip && masterIsClipping ? 'is-lit-red animate-pulse' : ''
            } ${masterAntiClip ? 'text-logic-text' : ''}`}
            onClick={toggleMasterAntiClip}
            aria-pressed={masterAntiClip}
            title={masterAntiClip
              ? 'Anti-Clip ligado: a saída do master não passa de -0,1 dBFS (limitador de pico). Clique para desligar.'
              : 'Anti-Clip desligado: clique para limitar a saída do master em -0,1 dBFS, sem mexer no fader.'}
          >
            <span className={`console-led ${masterAntiClip ? 'is-on-green' : ''}`} />
            ANTI-CLIP
          </button>

          {/* Mesma altura das teclas M/S dos canais: o IGUALAR fica embaixo do ANTI-CLIP. */}
          <div className="flex gap-1 h-[18px] items-center justify-center">
            <LevelMatchButton />
          </div>

          </div>
          )}
        </div>
      </div>
      {trackMenu && (
        <TrackContextMenu track={trackMenu.track} x={trackMenu.x} y={trackMenu.y} onClose={() => setTrackMenu(null)} />
      )}
    </div>
  );
}
