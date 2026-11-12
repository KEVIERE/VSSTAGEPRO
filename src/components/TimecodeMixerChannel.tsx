import { Clock, Lock, LockOpen } from 'lucide-react';
import { useStore } from '@/store';
import { volumeToDb } from '@/lib/audioEngine';
import { NO_OUTPUT, TIMECODE_DEFAULT_VOLUME, TIMECODE_TRACK_ID } from '@/lib/timecode';
import { LedMeter } from '@/components/MeterMask';
import OutputMenu from '@/components/OutputMenu';
import { useSkin } from '@/lib/useSkin';
import { GfCap, GfFaderMeter, GfKey, GfScreen } from '@/components/GrafitePieces';
import { GF_CAP_H, GF_FADER_H } from '@/components/MixerPanel';

export default function TimecodeMixerChannel() {
  const track = useStore((s) => s.tracks.find((t) => t.id === TIMECODE_TRACK_ID));
  const setVolume = useStore((s) => s.setVolume);
  const toggleMute = useStore((s) => s.toggleMute);
  const toggleFaderLock = useStore((s) => s.toggleFaderLock);
  const grafite = useSkin() === 'grafite';
  if (!track) return null;

  const locked = !!track.faderLocked;
  // a capa anda em pixels dentro do curso (altura do trilho menos a altura da capa)
  const capPct = Math.max(0, Math.min(1, track.volume / 1.5));
  const db = volumeToDb(track.volume);
  const dbLabel = db === -Infinity ? '-inf' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
  const noOutput = track.outputChannel === NO_OUTPUT;

  if (grafite) {
    // Grafite: tela dourada, LTC no lugar do encoder, teclas TRAVA e MUTE e o fader de linha âmbar
    return (
      <div className="console-strip gf-strip is-tc flex flex-col items-center w-[80px] min-w-[80px] py-1.5 px-[3px] gap-[3px] relative">
        <OutputMenu track={track} />
        <GfScreen number="TC" name="Timecode" value={dbLabel === '-inf' ? '-∞' : dbLabel} color="#ffb53d" />
        <div className="flex items-center justify-center gap-1 h-[28px] text-logic-lcd-amber" title="Sinal de controle para telões e luzes">
          <Clock size={14} />
          <span className="text-[11px] font-bold tracking-wider">LTC</span>
        </div>
        <div className="flex gap-[2px] w-full">
          <GfKey
            label={locked ? 'TRAVADO' : 'LIVRE'}
            tone="clip"
            lit={locked}
            className="flex-1"
            onClick={() => toggleFaderLock(track.id)}
            title={locked ? 'Destravar o fader' : 'Travar o fader'}
          >
            {locked ? <Lock size={8} /> : <LockOpen size={8} />}{locked ? 'TRAVADO' : 'LIVRE'}
          </GfKey>
          <GfKey
            label={track.mute ? 'MUDO' : 'MUTE'}
            tone="mute"
            lit={track.mute}
            pulse={track.mute}
            className="flex-1"
            onClick={() => toggleMute(track.id)}
            title={track.mute ? 'Timecode mudo: clique para voltar a enviar o sinal' : 'Silenciar o timecode'}
          />
        </div>
        <div className="flex items-start gap-[3px] mt-auto">
          {/* o lugar da escala dos outros canais: o fader cai na mesma coluna */}
          <div className="w-[15px]" aria-hidden="true" />
          <div
            className="gf-fader relative w-[24px]"
            style={{ height: GF_FADER_H }}
            onDoubleClick={() => { if (!locked) setVolume(track.id, TIMECODE_DEFAULT_VOLUME); }}
            title={locked ? 'Fader travado. Clique no cadeado para destravar.' : 'Duplo clique = -6 dB'}
          >
            <div className="gf-slot absolute left-1/2 -translate-x-1/2 pointer-events-none" style={{ top: GF_CAP_H / 2 - 3, bottom: GF_CAP_H / 2 - 3 }} />
            <GfCap
              tone="tc"
              className={`absolute left-0 pointer-events-none ${locked ? 'gf-cap-locked' : ''}`}
              style={{ width: '100%', height: GF_CAP_H, bottom: `calc(${capPct} * (100% - ${GF_CAP_H}px))` }}
            />
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={track.volume}
              disabled={locked}
              onChange={(e) => setVolume(track.id, parseFloat(e.target.value))}
              className={`absolute inset-0 w-full h-full opacity-0 ${locked ? 'cursor-not-allowed' : 'cursor-ns-resize'}`}
              style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
              aria-label="Volume do timecode"
            />
          </div>
          <div style={{ marginTop: GF_CAP_H / 2 }}>
            <GfFaderMeter id={track.id} height={GF_FADER_H - GF_CAP_H} off={track.mute || noOutput} />
          </div>
        </div>
      </div>
    );
  }

  // Módulo do timecode: mesmo painel dos outros canais com um tom âmbar por cima,
  // capa do fader âmbar e uma borda âmbar separando da banda.
  return (
    <div className="console-strip flex flex-col items-center w-[80px] min-w-[80px] bg-logic-lcd-amber/[0.07] border-r-2 border-logic-lcd-amber/40 py-1.5 px-1 gap-[3px] relative">
      <OutputMenu track={track} />

      {/* mesma altura do knob de pan dos canais (h-7), para a fita cair na mesma linha */}
      <div className="flex items-center justify-center gap-1 h-7 text-logic-lcd-amber" title="Sinal de controle para telões e luzes">
        <Clock size={14} />
        <span className="font-stage text-[11px] font-bold tracking-wider">LTC</span>
      </div>

      {/* mesma fita dos canais: h-[22px] e alinhada à esquerda como o nome das faixas */}
      <div className="console-tape w-full h-[22px] flex items-center justify-center px-1" title={track.name}>Timecode</div>

      <div className="flex gap-[3px] items-end">
        {/* a escala de dB dos canais ocupa SCALE_W=14 à esquerda: sem ela o fader subiria 14 px */}
        <div className="w-[14px] h-[120px] shrink-0" aria-hidden="true" />
        <div
          className="console-faderbed relative w-6 h-[120px]"
          onDoubleClick={() => { if (!locked) setVolume(track.id, TIMECODE_DEFAULT_VOLUME); }}
          title={locked ? 'Fader travado. Clique no cadeado para destravar.' : 'Duplo clique = -6 dB'}
        >
          <div className="console-slot absolute left-1/2 -translate-x-1/2 top-[9px] bottom-[9px] pointer-events-none" />
          <div className="console-tick is-unity pointer-events-none" style={{ bottom: `${(0.8 / 1.5) * 102 + 9}px` }} />
          <div
            className={`console-cap console-cap--tc absolute left-0 right-0 h-[18px] pointer-events-none ${locked ? 'ring-1 ring-logic-lcd-amber ring-offset-1 ring-offset-black' : ''}`}
            style={{ bottom: `calc(${capPct} * (100% - 18px))` }}
          />
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={track.volume}
            disabled={locked}
            onChange={(e) => setVolume(track.id, parseFloat(e.target.value))}
            className={`absolute inset-0 w-full h-full opacity-0 ${locked ? 'cursor-not-allowed' : 'cursor-ns-resize'}`}
            style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
            aria-label="Volume do timecode"
          />
        </div>
        <LedMeter id={track.id} off={track.mute || noOutput} />
      </div>

      <span className="console-readout text-logic-text-dim">{dbLabel}</span>

      <button
        className={`console-key flex items-center justify-center gap-1 w-full h-[15px] text-[8.5px] leading-none ${locked ? 'text-logic-lcd-amber' : ''}`}
        onClick={() => toggleFaderLock(track.id)}
        aria-pressed={locked}
        title={locked ? 'Destravar o fader' : 'Travar o fader'}
      >
        {locked ? <Lock size={10} /> : <LockOpen size={10} />}
        {locked ? 'TRAVADO' : 'LIVRE'}
      </button>

      <button
        className={`console-key w-full h-[18px] text-[11px] leading-none ${track.mute ? 'is-lit-red animate-pulse' : ''}`}
        onClick={() => toggleMute(track.id)}
        aria-pressed={track.mute}
        title={track.mute ? 'Timecode mudo: clique para voltar a enviar o sinal' : 'Silenciar o timecode'}
      >
        {track.mute ? 'MUDO' : 'MUTE'}
      </button>
    </div>
  );
}
