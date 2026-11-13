// Peças da skin Analógica nas faixas da timeline: o knob de volume (no lugar do fader deitado) e o
// medidor vertical colado na borda direita da faixa.
import { useMeterLevel } from '@/lib/meterBus';
import { volumeToDb } from '@/lib/audioEngine';

const SEG = 21;
const UNITY = 0.8 / 1.5; // 0 dB no curso do knob (o mesmo do fader)

/**
 * Knob de volume: anel de LEDs âmbar acendendo até o volume, corpo de metal serrilhado, tampa
 * côncava e o ponteiro âmbar; a marquinha clara fora do anel é o 0 dB. Arraste para cima ou para
 * baixo (Shift: fino), roda do mouse ajusta, duplo clique volta ao 0 dB. Volume de 0 a 1,5 (0,8 = 0 dB).
 */
export function AnVolumeKnob({ value, onChange, onReset, size = 30, disabled }: {
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
  size?: number;
  disabled?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, value / 1.5));
  const angle = -135 + pct * 270;
  const db = volumeToDb(value);
  const dbLabel = db === -Infinity ? '-∞' : `${db > 0.05 ? '+' : ''}${db.toFixed(1)}`;
  const clamp = (v: number) => Math.max(0, Math.min(1.5, Math.round(v * 1000) / 1000));

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = e.clientY;
    let acc = value;
    const move = (ev: PointerEvent) => {
      acc += ((last - ev.clientY) / 150) * 1.5 * (ev.shiftKey ? 0.1 : 1);
      last = ev.clientY;
      onChange(clamp(acc));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const ring = (i: number) => ((-135 + (i / (SEG - 1)) * 270 - 90) * Math.PI) / 180;
  const ua = ((-135 + UNITY * 270 - 90) * Math.PI) / 180;
  return (
    <div
      className={`an-knob relative shrink-0 select-none ${disabled ? 'opacity-40' : 'cursor-ns-resize'}`}
      style={{ width: size, height: size, touchAction: 'none' }}
      onPointerDown={down}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); if (!disabled) onReset(); }}
      onWheel={(e) => { if (!disabled) { e.stopPropagation(); onChange(clamp(value - Math.sign(e.deltaY) * 0.02)); } }}
      role="slider"
      aria-label="Volume da faixa"
      aria-valuemin={0}
      aria-valuemax={1.5}
      aria-valuenow={value}
      title={`Volume: ${dbLabel} dB. Arraste para cima ou para baixo (Shift: fino). Duplo clique: 0 dB.`}
    >
      <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <defs>
          <radialGradient id="an-knob-skirt" cx="50%" cy="38%" r="65%">
            <stop offset="0" stopColor="#6b727b" />
            <stop offset="0.6" stopColor="#3a3f46" />
            <stop offset="1" stopColor="#16181b" />
          </radialGradient>
          <radialGradient id="an-knob-cap" cx="44%" cy="34%" r="70%">
            <stop offset="0" stopColor="#4c525a" />
            <stop offset="0.55" stopColor="#262a2f" />
            <stop offset="1" stopColor="#14161a" />
          </radialGradient>
          <linearGradient id="an-knob-rim" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#c9ced4" stopOpacity="0.8" />
            <stop offset="1" stopColor="#000" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        {/* anel de LEDs */}
        {Array.from({ length: SEG }, (_, i) => {
          const a = ring(i);
          const on = pct > 0 && i / (SEG - 1) <= pct + 1e-6;
          const hot = i / (SEG - 1) > UNITY + 0.02;
          return (
            <line
              key={i}
              x1={20 + Math.cos(a) * 16.2} y1={20 + Math.sin(a) * 16.2}
              x2={20 + Math.cos(a) * 18.6} y2={20 + Math.sin(a) * 18.6}
              stroke={on ? (hot ? '#ff7a2f' : '#ffab1f') : '#2b2f35'}
              strokeWidth={1.7}
              strokeLinecap="round"
              style={on ? { filter: `drop-shadow(0 0 1.4px ${hot ? '#ff7a2f' : '#ffab1f'})` } : undefined}
            />
          );
        })}
        {/* 0 dB */}
        <circle cx={20 + Math.cos(ua) * 19.6} cy={20 + Math.sin(ua) * 19.6} r="0.9" fill="#f2eee4" />
        {/* corpo serrilhado */}
        <circle cx="20" cy="21" r="13.6" fill="#000" opacity="0.45" />
        <circle cx="20" cy="20" r="13.2" fill="url(#an-knob-skirt)" stroke="#0a0b0d" strokeWidth="0.7" />
        <circle cx="20" cy="20" r="12.2" fill="none" stroke="#0d0f12" strokeOpacity="0.8" strokeWidth="1.6" strokeDasharray="0.8 1" />
        <circle cx="20" cy="20" r="13.2" fill="none" stroke="url(#an-knob-rim)" strokeWidth="0.6" />
        {/* tampa côncava */}
        <circle cx="20" cy="20" r="9.6" fill="url(#an-knob-cap)" stroke="#08090b" strokeWidth="0.6" />
        <ellipse cx="18" cy="15.6" rx="5.6" ry="2.6" fill="#fff" opacity="0.1" />
        {/* ponteiro */}
        <g transform={`rotate(${angle} 20 20)`}>
          <rect x="19.15" y="9.6" width="1.7" height="6.4" rx="0.85" fill="#ffab1f" style={{ filter: 'drop-shadow(0 0 1.2px #ffab1f)' }} />
        </g>
      </svg>
    </div>
  );
}

const METER = 'linear-gradient(to top, #3ee26e 0%, #3ee26e 62%, #ffd83d 78%, #ffd83d 93%, #ff4136 97%, #ff4136 100%)';

/** Medidor vertical colado na borda direita da faixa (escala de -48 a 0 dBFS). */
export function AnEdgeMeter({ id, off, title }: { id: string; off?: boolean; title?: string }) {
  const level = useMeterLevel(id);
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const pct = off || db <= -48 ? 0 : Math.min(1, (db + 48) / 48);
  return (
    <div className="an-edge-meter absolute right-0 top-[3px] bottom-[3px] w-[5px] pointer-events-none" title={title}>
      <div className="absolute inset-0" style={{ background: off ? '#3a3d42' : METER, clipPath: `inset(${(1 - pct) * 100}% 0 0 0)` }} />
      <div className="an-edge-meter-segments absolute inset-0" />
    </div>
  );
}
