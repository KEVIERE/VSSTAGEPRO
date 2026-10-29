import { useStore, ROUTABLE_TRACKS } from '@/store';
import { volumeToDb } from '@/lib/audioEngine';
import { audioEngine } from '@/lib/audioEngine';
import { ChevronDown, ChevronUp, Volume2, Wand2 } from 'lucide-react';
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { levelTarget, songLevelGain } from '@/lib/songLevel';
import { levelProgress, onLevelProgress } from '@/lib/songLevelWatcher';
import MeterMask from '@/components/MeterMask';
import OutputMenu from '@/components/OutputMenu';
import TimecodeMixerChannel from '@/components/TimecodeMixerChannel';
import { useMeterLevel } from '@/lib/meterBus';

// Mostra quanto o limiter de segurança do master está atuando agora (em dB). Diferente do indicador
// de clip: redução ativa é o limiter funcionando normalmente, não um problema — por isso sem alarme/pulse.
function MasterGrReadout() {
  const gr = useMeterLevel('master-gr'); // valor em dB (0 ou negativo), não é amplitude linear
  const active = gr < -0.05;
  return (
    <div className="flex items-center gap-1" title="Redução de ganho do limiter de segurança do master (dB)">
      <span className={`text-2xs font-mono ${active ? 'text-logic-lcd-amber' : 'text-logic-text-muted opacity-40'}`}>
        GR {active ? gr.toFixed(1) : '0.0'}
      </span>
    </div>
  );
}

// Volume igual entre os VS: liga/desliga e mostra o alvo comum e a medição em andamento.
function LevelMatchButton() {
  const on = useStore((s) => !!s.levelMatch);
  const setLevelMatch = useStore((s) => s.setLevelMatch);
  const target = useStore((s) => levelTarget(s));
  const current = useStore((s) => s.transport.currentSongId ?? s.selectedSongId);
  const gainDb = useStore((s) => (current ? 20 * Math.log10(songLevelGain(s, current)) : 0));
  const progress = useSyncExternalStore(onLevelProgress, levelProgress);
  const label = !on ? 'IGUALAR' : progress ? `${progress.done}/${progress.total}` : target !== null ? `${target.toFixed(0)} LU` : 'IGUALAR';
  const title = !on
    ? 'Volume igual entre os VS: liga para todas as músicas soarem no mesmo volume, sem clipar o master.'
    : `Volume igual ligado. Todas as músicas do show soam em ${target !== null ? target.toFixed(1) + ' LUFS' : '(medindo)'}, com pico máximo de -1 dBTP.`
      + (progress ? ` Medindo as músicas: ${progress.done} de ${progress.total}.` : '')
      + (current ? ` Esta música: ${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB.` : '')
      + ' Clique para desligar.';
  return (
    <button
      className={`font-bold px-1 py-0.5 rounded border transition-colors text-[8px] ${on ? 'bg-logic-lcd-green/20 text-logic-lcd-green border-logic-lcd-green/70' : 'bg-logic-bg-deep text-logic-text-muted border-logic-border-dark hover:text-logic-text'}`}
      onClick={() => setLevelMatch(!on)}
      title={title}
      aria-pressed={on}
    >
      {label}
    </button>
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
    <span className={`text-2xs font-mono tabular-nums h-3 leading-3 ${live ? tone : ''}`} title={title}>
      {live ? `${shown > 0 ? '+' : ''}${shown.toFixed(1)}` : '\u00a0'}
    </span>
  );
}

// Fader profissional de estúdio (Logic Pro 11 / Pro Tools):
// Curso geométrico exato em pixels — onde o mouse arrasta é exatamente onde o cap do fader se posiciona.
// Zero descompasso com inputs nativos de range.
function Fader({
  value,
  onChange,
  onDoubleClick,
  width = 20,
  height = 120,
}: {
  value: number;
  onChange: (v: number) => void;
  onDoubleClick?: () => void;
  width?: number;
  height?: number;
}) {
  const capHeight = 12;
  const travel = height - capHeight;
  const pct = Math.max(0, Math.min(1, value / 1.5));
  const bottomPx = pct * travel;

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

  return (
    <div
      className="relative bg-logic-bg-deep rounded-sm border border-logic-border-dark cursor-ns-resize select-none overflow-hidden"
      style={{ width: `${width}px`, height: `${height}px` }}
      onPointerDown={handleDown}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
      title={`Fader: ${dbLabel} dB. Arraste para ajustar (Shift: ajuste fino). Duplo clique: 0 dB.`}
    >
      {/* Pista do fader com centro rebaixado */}
      <div className="absolute left-1/2 -translate-x-1/2 top-1.5 bottom-1.5 w-1 rounded-full bg-black/60 border border-white/5 pointer-events-none" />
      {/* Linha de referência de 0 dB (volume 0.8 / 1.5 = 53.33% do curso) */}
      <div
        className="absolute left-0 right-0 h-px bg-white/30 pointer-events-none"
        style={{ bottom: `${(0.8 / 1.5) * travel + capHeight / 2}px` }}
      />
      {/* Cap do fader metálico de estúdio com marcação luminosa central */}
      <div
        className="absolute left-0.5 right-0.5 rounded-sm bg-gradient-to-b from-[#4a4a50] via-[#2a2a2e] to-[#1e1e22] border border-white/20 shadow-md pointer-events-none flex items-center justify-center"
        style={{ height: `${capHeight}px`, bottom: `${bottomPx}px` }}
      >
        <div className="w-full h-0.5 bg-logic-text shadow-[0_0_2px_rgba(255,255,255,0.8)]" />
      </div>
    </div>
  );
}

function MixerChannel({ trackId }: { trackId: string }) {
  const track = useStore((s) => s.tracks.find((t) => t.id === trackId));
  const setVolume = useStore((s) => s.setVolume);
  const setPan = useStore((s) => s.setPan);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleSolo = useStore((s) => s.toggleSolo);
  const selectTrack = useStore((s) => s.selectTrack);
  const applyAntiClip = useStore((s) => s.applyAntiClip);
  const clearClipIndicator = useStore((s) => s.clearClipIndicator);
  const selectedTrackId = useStore((s) => s.selectedTrackId);

  if (!track) return null;

  const isSelected = selectedTrackId === track.id;
  const isClipping = track.clipIndicator;

  return (
    <div
      className={`flex flex-col items-center w-[72px] min-w-[72px] bg-logic-bg-panel border-r border-logic-border-dark py-1.5 px-1 gap-1 cursor-pointer transition-colors duration-75 relative
        ${isSelected ? 'bg-logic-bg-panel-light' : 'hover:bg-logic-bg-panel-light'}`}
      onClick={() => selectTrack(track.id)}
    >
      <OutputMenu track={track} />

      {/* Pan knob (Pro Tools style) */}
      <div
        className="w-7 h-7 relative cursor-ew-resize select-none"
        onDoubleClick={(e) => { e.stopPropagation(); setPan(track.id, 0); }}
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startPan = track.pan;
          const onMove = (ev: MouseEvent) => {
            const delta = (ev.clientX - startX) / 50;
            setPan(track.id, Math.max(-1, Math.min(1, startPan + delta)));
          };
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
        title={`Pan: ${track.pan > 0 ? 'R' : track.pan < 0 ? 'L' : 'C'} ${Math.abs(Math.round(track.pan * 100))} (duplo clique = centro)`}
      >
        <svg viewBox="0 0 28 28" className="absolute inset-0 w-full h-full pointer-events-none">
          <circle cx="14" cy="14" r="12.5" fill="#1a1a1c" stroke="#3a3a3e" strokeWidth="1" />
          <circle cx="14" cy="14" r="12.5" fill="none" stroke="#000" strokeWidth="0.5" opacity="0.6" />
          <circle cx="14" cy="14" r="9" fill="#26262a" stroke="#111" strokeWidth="0.5" />
          {track.pan !== 0 && (
            <path
              d={(() => {
                const angle = track.pan * 135;
                const toXY = (deg: number) => {
                  const rad = ((deg - 90) * Math.PI) / 180;
                  return [14 + 11.5 * Math.cos(rad), 14 + 11.5 * Math.sin(rad)];
                };
                const [x1, y1] = toXY(0);
                const [x2, y2] = toXY(angle);
                const sweep = angle > 0 ? 1 : 0;
                return `M ${x1} ${y1} A 11.5 11.5 0 0 ${sweep} ${x2} ${y2}`;
              })()}
              fill="none"
              stroke="#30d158"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
          <g style={{ transform: `rotate(${track.pan * 135}deg)`, transformOrigin: '14px 14px' }}>
            <line x1="14" y1="14" x2="14" y2="6" stroke="#e8e8e8" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        </svg>
      </div>

      {/* Track name */}
      {/* nome inteiro em até 2 linhas (antes cortava "Contrabaixo 1", "Percussão 2"...) */}
      <span className="text-[9px] leading-[11px] h-[22px] text-logic-text-dim w-full text-center break-words line-clamp-2 overflow-hidden" title={track.name}>
        {track.name}
      </span>

      {/* Meter + Fader */}
      <div className="flex gap-1 items-end">
        {/* Peak meter (dBFS) */}
        <div
          className="relative w-3 h-[120px] bg-logic-bg-deep rounded-sm border border-logic-border-dark overflow-hidden"
          onClick={(e) => { e.stopPropagation(); if (isClipping) clearClipIndicator(track.id); }}
          title={isClipping ? 'Clique para apagar o indicador de clip' : undefined}
        >
          <div
            className="absolute inset-0"
            style={{
              background: track.mute
                ? '#555'
                : 'linear-gradient(to top, #30d158 0%, #30d158 62.5%, #ffd60a 75%, #ffd60a 93.75%, #ff453a 95.8%, #ff453a 100%)',
            }}
          />
          <MeterMask id={track.id} className="bg-logic-bg-deep" />
          {isClipping && (
            <div
              className="absolute top-0 left-0 right-0 h-1 cursor-pointer"
              style={{ background: '#ff453a', boxShadow: '0 0 5px #ff453a' }}
            />
          )}
        </div>

        {/* Fader */}
        <Fader
          value={track.volume}
          onChange={(v) => setVolume(track.id, v)}
          onDoubleClick={() => setVolume(track.id, 0.8)}
          width={20}
          height={120}
        />
      </div>

      <LevelReadout id={track.id} title="Nível do sinal agora (dBFS, pico das últimas 1,5 s). Em silêncio fica apagado." />

      {/* Anti-clip */}
      <button
        className={`font-bold px-1 py-0.5 rounded border transition-colors duration-75 ${
          isClipping
            ? 'text-[8px] bg-logic-lcd-red text-black border-logic-lcd-red hover:bg-logic-lcd-amber hover:border-logic-lcd-amber animate-pulse'
            : 'text-[8px] bg-logic-bg-deep text-logic-text-muted border-logic-border-dark opacity-60 cursor-default'
        }`}
        onClick={(e) => { e.stopPropagation(); if (isClipping) applyAntiClip(track.id); }}
        title="Anti-Clip: baixa o fader só o necessário para o pico mais alto ficar 0,3 dB abaixo do clip"
      >
        ANTI-CLIP
      </button>

      {/* M/S buttons */}
      <div className="flex gap-1">
        <button
          className={`w-5 h-5 text-2xs font-bold rounded transition-colors duration-75 ${
            track.mute ? 'bg-logic-lcd-amber text-black' : 'bg-logic-bg-deep text-logic-text-muted'
          }`}
          onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
        >M</button>
        <button
          className={`w-5 h-5 text-2xs font-bold rounded transition-colors duration-75 ${
            track.solo ? 'bg-logic-lcd-amber text-black' : 'bg-logic-bg-deep text-logic-text-muted'
          }`}
          onClick={(e) => { e.stopPropagation(); toggleSolo(track.id); }}
        >S</button>
      </div>
    </div>
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
  const applyAntiClipMaster = useStore((s) => s.applyAntiClipMaster);
  const masterIsClipping = masterClipPeak >= 1;

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
    <div className="flex flex-col shrink-0 bg-logic-bg-panel border-t border-logic-border-dark overflow-hidden" style={{ height: '300px', maxHeight: '60%' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 h-7 bg-logic-bg-deep border-b border-logic-border-dark cursor-pointer"
        onClick={toggleMixer}
      >
        <div className="flex items-center gap-2">
          <Volume2 size={13} className="text-logic-text-dim" />
          <span className="text-xs font-medium text-logic-text-dim uppercase tracking-wider">Mixer</span>
        </div>
        <button className="text-logic-text-muted hover:text-logic-text transition-colors">
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Channels */}
      <div className="flex-1 flex overflow-x-auto overflow-y-hidden logic-scroll min-h-0">
        <div className="flex mx-auto min-w-fit border-l border-r border-logic-border-dark">
          <TimecodeMixerChannel />
          {allChannels.map((trackId) => (
            <MixerChannel key={trackId} trackId={trackId} />
          ))}

          {/* Master channel */}
          <div className="flex flex-col items-center w-[72px] min-w-[72px] bg-logic-bg-deep border-l-2 border-logic-border-light py-1.5 px-1 gap-1">
          <span className="text-2xs text-logic-lcd-amber font-bold truncate w-full text-center px-1 py-0.5 border border-transparent">MASTER</span>

          {/* Botão mágico: roteia Guia/Click/Maestro → L (1) e Banda → R (2) */}
          <button
            className={`flex items-center justify-center w-7 h-7 rounded-full border transition-colors duration-75 ${
              magicRoutingActive
                ? 'bg-logic-lcd-amber text-black border-logic-lcd-amber animate-pulse'
                : 'bg-logic-bg-panel text-logic-text-muted hover:text-logic-text border-logic-border-light'
            }`}
            onClick={() => toggleMagicRouting()}
            title="Roteamento mágico: Guia/Click/Maestro → L e Banda → R. O timecode não é alterado. Clique novamente para restaurar."
          >
            <Wand2 size={14} />
          </button>

          <div className="flex gap-1 items-end">
            {/* Peak meter (dBFS), mesma escala dos canais */}
            <div
              className="relative w-3 h-[120px] bg-logic-bg-deep rounded-sm border border-logic-border-dark overflow-hidden"
              onClick={() => { if (masterIsClipping) clearMasterClipIndicator(); }}
              title={masterIsClipping ? 'Clique para apagar o indicador de clip' : undefined}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(to top, #30d158 0%, #30d158 62.5%, #ffd60a 75%, #ffd60a 93.75%, #ff453a 95.8%, #ff453a 100%)',
                }}
              />
              <MeterMask id="master" className="bg-[#1c1c1c]" />
              {masterIsClipping && (
                <div
                  className="absolute top-0 left-0 right-0 h-1 cursor-pointer"
                  style={{ background: '#ff453a', boxShadow: '0 0 5px #ff453a' }}
                />
              )}
            </div>

            {/* Fader */}
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
              width={20}
              height={120}
            />
          </div>

          <LevelReadout id="master" title="Nível de saída do master agora (dBFS, pico das últimas 1,5 s, depois do limiter)" />
          <MasterGrReadout />
          <LevelMatchButton />

          {/* Anti-clip */}
          <button
            className={`font-bold px-1 py-0.5 rounded border transition-colors duration-75 text-[8px] ${
              masterIsClipping
                ? 'bg-logic-lcd-red text-black border-logic-lcd-red hover:bg-logic-lcd-amber hover:border-logic-lcd-amber animate-pulse'
                : 'bg-logic-bg-deep text-logic-text-muted border-logic-border-dark opacity-60 cursor-default'
            }`}
            onClick={() => { if (masterIsClipping) { applyAntiClipMaster(); audioEngine.setMasterVolume(useStore.getState().masterVolume); } }}
            title="Anti-Clip: baixa o fader master só o necessário para o pico mais alto (antes do limiter) ficar 0,3 dB abaixo do clip"
          >
            ANTI-CLIP
          </button>

          </div>
        </div>
      </div>
    </div>
  );
}
