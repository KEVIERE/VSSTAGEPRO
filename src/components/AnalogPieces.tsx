// Peças da skin Analógica nas faixas da timeline: o knob de volume (no lugar do fader deitado) e o
// medidor vertical colado na borda direita da faixa.
import { useId } from 'react';
import { useMeterLevel } from '@/lib/meterBus';
import { volumeToDb } from '@/lib/audioEngine';
import { beginHistoryGesture, endHistoryGesture, historyGestureStep } from '@/lib/historyGesture';

const SEG = 21;
const UNITY = 0.8 / 1.5; // 0 dB no curso do knob (o mesmo do fader)

/**
 * Rosto do knob da skin padrão, o mesmo no volume das faixas e no balanço do mixer: anel de LEDs
 * em volta (os apagados ficam visíveis em cinza, para o anel inteiro aparecer e o knob ficar no
 * meio), corpo em preto piano serrilhado, tampa côncava e o ponteiro branco. `value` vai de 0 a 1.
 * Unipolar (volume): acende do começo até o valor, verde até o 0 dB e laranja acima; a marquinha
 * clara fora do anel é o 0 dB (unity acima de 1: sem marca e sem laranja). Bipolar (balanço): acende do centro até o valor, com o LED do meio
 * mais claro.
 */
export function VsKnobFace({ value, bipolar = false, unity = UNITY }: { value: number; bipolar?: boolean; unity?: number }) {
  const uid = useId().replace(/:/g, '');
  const pct = Math.max(0, Math.min(1, value));
  const angle = -135 + pct * 270;
  const mid = (SEG - 1) / 2;
  const pos = pct * (SEG - 1);
  const ring = (i: number) => ((-135 + (i / (SEG - 1)) * 270 - 90) * Math.PI) / 180;
  const ua = ((-135 + unity * 270 - 90) * Math.PI) / 180;
  return (
    <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}-skirt`} cx="50%" cy="38%" r="65%">
          <stop offset="0" stopColor="#4a4a4f" />
          <stop offset="0.6" stopColor="#18181a" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
        <radialGradient id={`${uid}-cap`} cx="44%" cy="34%" r="70%">
          <stop offset="0" stopColor="#3a3a3e" />
          <stop offset="0.55" stopColor="#141415" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
        <linearGradient id={`${uid}-rim`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#c4c4cb" stopOpacity="0.7" />
          <stop offset="1" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {/* anel de LEDs */}
      {Array.from({ length: SEG }, (_, i) => {
        const a = ring(i);
        const center = bipolar && i === mid;
        const on = bipolar
          ? center || (pos >= mid ? i >= mid && i <= pos + 1e-6 : i <= mid && i >= pos - 1e-6)
          : pct > 0 && i <= pos + 1e-6;
        const hot = !bipolar && i / (SEG - 1) > unity + 0.02;
        const color = center ? '#b8ffd6' : hot ? '#ff8a1e' : '#36f08c';
        return (
          <line
            key={i}
            x1={20 + Math.cos(a) * 16.2} y1={20 + Math.sin(a) * 16.2}
            x2={20 + Math.cos(a) * 18.6} y2={20 + Math.sin(a) * 18.6}
            stroke={on ? color : '#38393e'}
            strokeWidth={1.7}
            strokeLinecap="round"
            style={on ? { filter: `drop-shadow(0 0 1.5px ${color})` } : undefined}
          />
        );
      })}
      {/* 0 dB */}
      {!bipolar && unity <= 1 && <circle cx={20 + Math.cos(ua) * 19.6} cy={20 + Math.sin(ua) * 19.6} r="0.9" fill="#f2eee4" />}
      {/* corpo serrilhado */}
      <circle cx="20" cy="20.8" r="13.6" fill="#000" opacity="0.45" />
      <circle cx="20" cy="20" r="13.2" fill={`url(#${uid}-skirt)`} stroke="#0a0b0d" strokeWidth="0.7" />
      <circle cx="20" cy="20" r="12.2" fill="none" stroke="#0d0f12" strokeOpacity="0.8" strokeWidth="1.6" strokeDasharray="0.8 1" />
      <circle cx="20" cy="20" r="13.2" fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="0.6" />
      {/* tampa côncava */}
      <circle cx="20" cy="20" r="9.6" fill={`url(#${uid}-cap)`} stroke="#08090b" strokeWidth="0.6" />
      <ellipse cx="18" cy="15.6" rx="5.6" ry="2.6" fill="#fff" opacity="0.1" />
      {/* ponteiro */}
      <g transform={`rotate(${angle} 20 20)`}>
        <rect x="19.15" y="9.6" width="1.7" height="6.4" rx="0.85" fill="#f2f2f5" style={{ filter: 'drop-shadow(0 0 1.2px rgba(255,255,255,0.8))' }} />
      </g>
    </svg>
  );
}

/**
 * Knob de volume das faixas (o rosto é o VsKnobFace). Arraste para cima ou para
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
    beginHistoryGesture();
    const move = (ev: PointerEvent) => {
      acc += ((last - ev.clientY) / 150) * 1.5 * (ev.shiftKey ? 0.1 : 1);
      last = ev.clientY;
      onChange(clamp(acc));
      historyGestureStep();
    };
    const up = () => {
      endHistoryGesture();
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

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
      <VsKnobFace value={pct} />
    </div>
  );
}

const METER = 'linear-gradient(to top, #3ee26e 0%, #3ee26e 62%, #ffd83d 78%, #ffd83d 93%, #ff4136 97%, #ff4136 100%)';

function EdgeBar({ id, off }: { id: string; off?: boolean }) {
  const level = useMeterLevel(id);
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const pct = off || db <= -48 ? 0 : Math.min(1, (db + 48) / 48);
  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute inset-0" style={{ background: off ? '#3a3d42' : METER, clipPath: `inset(${(1 - pct) * 100}% 0 0 0)` }} />
      <div className="an-edge-meter-segments absolute inset-0" />
    </div>
  );
}

/** Medidor estéreo (L e R) colado na borda direita da faixa (escala de -48 a 0 dBFS). */
export function AnEdgeMeter({ id, off, title, stereo = true }: { id: string; off?: boolean; title?: string; stereo?: boolean }) {
  return (
    <div className="an-edge-meter absolute right-0 top-[3px] bottom-[3px] w-[7px] flex gap-px pointer-events-none" title={title}>
      {stereo ? (
        <>
          <EdgeBar id={`${id}:L`} off={off} />
          <EdgeBar id={`${id}:R`} off={off} />
        </>
      ) : (
        <EdgeBar id={id} off={off} />
      )}
    </div>
  );
}

/** Capa do fader da skin padrão: em pé (mais alta que larga), de metal cromado. */
export const VS_CAP_W = 18;
export const VS_CAP_H = 30;

export type VsCapTone = 'cue' | 'band' | 'master' | 'tc';
// linha do meio: diz a função do canal (branca = guia/click/maestro, grafite = banda,
// vermelha = master, laranja = timecode)
const VS_CAP_LINE: Record<VsCapTone, string> = { cue: '#ffffff', band: '#1c1d20', master: '#ff3b30', tc: '#ff9a1f' };

/**
 * Capa cromada: corpo de metal com reflexos verticais (o cromo espelha a luz em faixas), topo
 * côncavo com frisos, bordas chanfradas e a linha da função no meio, entre dois frisos escuros.
 */
export function VsCap({ tone, className = '', style }: { tone: VsCapTone; className?: string; style?: React.CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const line = VS_CAP_LINE[tone];
  return (
    <svg viewBox="0 0 18 30" preserveAspectRatio="none" className={`vs-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        {/* reflexos do cromo, da esquerda para a direita */}
        <linearGradient id={`${uid}-chrome`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#3c3f44" />
          <stop offset="0.1" stopColor="#a9adb4" />
          <stop offset="0.24" stopColor="#f6f7f9" />
          <stop offset="0.38" stopColor="#c3c6cc" />
          <stop offset="0.52" stopColor="#6d7178" />
          <stop offset="0.66" stopColor="#b9bcc2" />
          <stop offset="0.8" stopColor="#eceef1" />
          <stop offset="0.92" stopColor="#8a8e95" />
          <stop offset="1" stopColor="#33363a" />
        </linearGradient>
        {/* luz de cima, sombra embaixo */}
        <linearGradient id={`${uid}-shade`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.18" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        {/* topo côncavo: o meio afunda e escurece um pouco */}
        <radialGradient id={`${uid}-dish`} cx="50%" cy="50%" r="55%">
          <stop offset="0" stopColor="#000" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.4" y="0.4" width="17.2" height="29.2" rx="2.6" fill={`url(#${uid}-chrome)`} stroke="#141518" strokeWidth="0.8" />
      <rect x="0.4" y="0.4" width="17.2" height="29.2" rx="2.6" fill={`url(#${uid}-shade)`} />
      <ellipse cx="9" cy="15" rx="7.6" ry="12.5" fill={`url(#${uid}-dish)`} />
      {/* chanfro de cima e de baixo */}
      <rect x="1.4" y="1" width="15.2" height="0.8" rx="0.4" fill="#fff" opacity="0.85" />
      <rect x="1.4" y="28.2" width="15.2" height="0.8" rx="0.4" fill="#000" opacity="0.45" />
      {/* frisos de pegada */}
      {[4.2, 6.4, 8.6, 21.4, 23.6, 25.8].map((y) => (
        <g key={y}>
          <rect x="2" y={y} width="14" height="0.7" fill="#000" opacity="0.32" />
          <rect x="2" y={y + 0.7} width="14" height="0.5" fill="#fff" opacity="0.55" />
        </g>
      ))}
      {/* linha da função, entre dois frisos escuros */}
      <rect x="1" y="13.3" width="16" height="3.4" fill="#0c0d0f" opacity="0.85" />
      <rect x="1" y="14.15" width="16" height="1.7" fill={line} />
    </svg>
  );
}
