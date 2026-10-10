import { useStore, ROUTABLE_TRACKS } from '@/store';
import { volumeToDb } from '@/lib/audioEngine';
import { audioEngine } from '@/lib/audioEngine';
import { ChevronDown, ChevronUp, Volume2, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import MeterMask from '@/components/MeterMask';
import OutputMenu from '@/components/OutputMenu';
import TimecodeMixerChannel from '@/components/TimecodeMixerChannel';

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
  const faderPct = track.volume * 66.67;
  const isClipping = track.clipIndicator;
  const volDb = volumeToDb(track.volume);
  const volDbLabel = volDb === -Infinity ? '-inf' : `${volDb > 0.05 ? '+' : ''}${volDb.toFixed(1)}`;

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
      <span className="text-2xs text-logic-text-dim truncate w-full text-center" title={track.name}>
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
        <div
          className="relative w-5 h-[120px] bg-logic-bg-deep rounded-sm border border-logic-border-dark"
          onDoubleClick={(e) => { e.stopPropagation(); setVolume(track.id, 0.8); }}
          title="Duplo clique = 0 dB"
        >
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.volume}
            onChange={(e) => { e.stopPropagation(); setVolume(track.id, parseFloat(e.target.value)); }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          />
          <div className="absolute left-0 right-0 h-px bg-logic-border-light pointer-events-none" style={{ bottom: 'calc(53.33% - 0.5px)' }} />
          <div
            className="absolute left-0 right-0 h-1.5 bg-logic-text rounded-sm pointer-events-none border border-logic-border-dark"
            style={{ bottom: `calc(${faderPct}% - 3px)` }}
          />
        </div>
      </div>

      <span className="text-2xs font-mono text-logic-text-muted" title="Ganho do fader">
        {volDbLabel}
      </span>

      {/* Anti-clip */}
      <button
        className={`font-bold px-1 py-0.5 rounded border transition-colors duration-75 ${
          isClipping
            ? 'text-[8px] bg-logic-lcd-red text-black border-logic-lcd-red hover:bg-logic-lcd-amber hover:border-logic-lcd-amber animate-pulse'
            : 'text-[8px] bg-logic-bg-deep text-logic-text-muted border-logic-border-dark opacity-60 cursor-default'
        }`}
        onClick={(e) => { e.stopPropagation(); if (isClipping) applyAntiClip(track.id); }}
        title="Anti-Clip: baixa o fader só o necessário para o pico ficar a -0,2 dB do teto"
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

          <span className="text-2xs text-logic-text-dim">Master</span>

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
            <div
              className="relative w-3 h-[120px] bg-[#1c1c1c] rounded-sm border border-logic-border-dark"
              onDoubleClick={() => { setMasterVolume(0.8); audioEngine.setMasterVolume(0.8); }}
              title="Duplo clique = 0 dB"
            >
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={masterVolume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setMasterVolume(v);
                  audioEngine.setMasterVolume(v);
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize"
                style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
              />
              <div className="absolute left-1/2 -translate-x-1/2 top-1 bottom-1 w-1.5 rounded-full bg-[#3a3a3e] border border-[#2a2a2e] pointer-events-none" />
              <div className="absolute left-0 right-0 h-px bg-logic-border-light pointer-events-none" style={{ bottom: 'calc(53.33% - 0.5px)' }} />
              <div
                className="absolute left-0 right-0 h-1.5 bg-logic-text rounded-sm pointer-events-none border border-logic-border-dark"
                style={{ bottom: `calc(${masterVolume * 66.67}% - 3px)` }}
              />
            </div>
          </div>

          <span className="text-2xs font-mono text-logic-text-muted" title="Ganho do fader">
            {(() => {
              const db = volumeToDb(masterVolume);
              return db === -Infinity ? '-inf' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
            })()}
          </span>

          {/* Anti-clip */}
          <button
            className={`font-bold px-1 py-0.5 rounded border transition-colors duration-75 text-[8px] ${
              masterIsClipping
                ? 'bg-logic-lcd-red text-black border-logic-lcd-red hover:bg-logic-lcd-amber hover:border-logic-lcd-amber animate-pulse'
                : 'bg-logic-bg-deep text-logic-text-muted border-logic-border-dark opacity-60 cursor-default'
            }`}
            onClick={() => { if (masterIsClipping) { applyAntiClipMaster(); audioEngine.setMasterVolume(useStore.getState().masterVolume); } }}
            title="Anti-Clip: baixa o fader master só o necessário para o pico ficar a -0,2 dB do teto"
          >
            ANTI-CLIP
          </button>

          </div>
        </div>
      </div>
    </div>
  );
}
