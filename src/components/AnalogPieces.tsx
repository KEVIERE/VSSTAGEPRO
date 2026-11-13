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

/** Capa do fader da skin padrão: em pé (comprida no sentido do curso), de metal prateado. */
export const VS_CAP_W = 20;
export const VS_CAP_H = 32;

export type VsCapTone = 'cue' | 'band' | 'master' | 'tc';
// risco do meio: escuro nos canais, vermelho no master e laranja no timecode
const VS_CAP_LINE: Record<VsCapTone, string> = { cue: '#17181b', band: '#17181b', master: '#ff3b30', tc: '#ff9a1f' };

// Contorno visto de cima: as pontas abrem nos pés e as laterais fazem a curva para dentro no meio.
const CAP_OUTLINE = 'M2 0.6 H18 Q19.6 0.6 19.6 2.2 Q16.4 15 19.6 28 L19.6 30 Q19.6 31.4 18.2 31.4 H1.8 Q0.4 31.4 0.4 30 L0.4 28 Q3.6 15 0.4 2.2 Q0.4 0.6 2 0.6 Z';
// Tampo em sela, um pouco para dentro do contorno
const CAP_TOP = 'M3 1.6 H17 Q18.2 1.6 18.2 2.8 Q15.4 14.6 18.2 26.6 Q18.2 27.6 17.4 27.6 H2.6 Q1.8 27.6 1.8 26.6 Q4.6 14.6 1.8 2.8 Q1.8 1.6 3 1.6 Z';
// Ponta de baixo vista de frente: a face curva da capa, com o vão entre os pés no meio
const CAP_FACE = 'M1.2 27.6 H18.8 Q19.5 27.6 19.5 28.4 V30.2 Q19.5 31.3 18.4 31.3 H1.6 Q0.5 31.3 0.5 30.2 V28.4 Q0.5 27.6 1.2 27.6 Z';
const CAP_GAP = 'M6.4 31.3 Q10 27.6 13.6 31.3 Z';

/**
 * Capa de fader em sela, de alumínio prateado acetinado: as duas pontas altas brilham, o meio
 * afunda e escurece (onde o dedo apoia), as laterais curvas mostram os pés e o risco escuro
 * atravessa o meio, marcando a posição.
 */
export function VsCap({ tone, className = '', style }: { tone: VsCapTone; className?: string; style?: React.CSSProperties }) {
  const uid = useId().replace(/:/g, '');
  const line = VS_CAP_LINE[tone];
  return (
    <svg viewBox="0 0 20 32" preserveAspectRatio="none" className={`vs-cap ${className}`} style={style} aria-hidden="true">
      <defs>
        {/* pés e laterais: metal na sombra */}
        <linearGradient id={`${uid}-body`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#5d6066" />
          <stop offset="0.18" stopColor="#a4a7ad" />
          <stop offset="0.5" stopColor="#c4c7cc" />
          <stop offset="0.82" stopColor="#9a9da3" />
          <stop offset="1" stopColor="#4f5257" />
        </linearGradient>
        {/* sela côncava com a luz de cima: a rampa de cima (virada para a luz) clara, o fundo
            escuro, a rampa de baixo na sombra e o fio claro na ponta de baixo */}
        <linearGradient id={`${uid}-saddle`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#c9ccd1" />
          <stop offset="0.05" stopColor="#ffffff" />
          <stop offset="0.16" stopColor="#eceef0" />
          <stop offset="0.4" stopColor="#b3b6bc" />
          <stop offset="0.56" stopColor="#8b8f96" />
          <stop offset="0.78" stopColor="#979ba1" />
          <stop offset="0.92" stopColor="#c3c6cb" />
          <stop offset="0.975" stopColor="#f3f4f6" />
          <stop offset="1" stopColor="#a4a7ad" />
        </linearGradient>
        {/* face da ponta de baixo, mais escura (fica de lado para a luz) */}
        <linearGradient id={`${uid}-face`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#9fa2a8" />
          <stop offset="1" stopColor="#6c6f75" />
        </linearGradient>
        {/* laterais do tampo um pouco mais escuras (a sela curva para baixo nas beiradas) */}
        <linearGradient id={`${uid}-edge`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.32" />
          <stop offset="0.2" stopColor="#000" stopOpacity="0" />
          <stop offset="0.8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
        {/* reflexo macio da luz no fundo da sela */}
        <radialGradient id={`${uid}-sheen`} cx="42%" cy="30%" r="45%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* acetinado: grão fino do alumínio */}
        <filter id={`${uid}-satin`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed="7" result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.10 0" result="g" />
          <feComposite in="g" in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
      {/* corpo com os pés */}
      <path d={CAP_OUTLINE} fill={`url(#${uid}-body)`} stroke="#2c2e32" strokeWidth="0.6" />
      {/* face da ponta de baixo e o vão entre os pés */}
      <path d={CAP_FACE} fill={`url(#${uid}-face)`} />
      <path d={CAP_GAP} fill="#141518" />
      {/* tampo em sela */}
      <path d={CAP_TOP} fill={`url(#${uid}-saddle)`} />
      <path d={CAP_TOP} fill={`url(#${uid}-edge)`} />
      <path d={CAP_TOP} fill={`url(#${uid}-sheen)`} />
      <path d={CAP_TOP} fill="#808080" filter={`url(#${uid}-satin)`} />
      {/* fio de luz nas duas pontas altas */}
      <path d="M3.2 2.3 H16.8" stroke="#fff" strokeWidth="0.7" strokeLinecap="round" opacity="0.95" />
      <path d="M2.8 27.2 H17.2" stroke="#fff" strokeWidth="0.55" strokeLinecap="round" opacity="0.75" />
      {/* beirada das pontas: a quina que vira para os pés */}
      <path d="M2.4 1.2 H17.6" stroke="#6a6d73" strokeWidth="0.5" opacity="0.6" />
      {/* risco do meio, cavado no metal */}
      <rect x="3.6" y="13.9" width="12.8" height="1.4" rx="0.3" fill={line} />
      <rect x="3.6" y="15.3" width="12.8" height="0.45" fill="#fff" opacity="0.4" />
    </svg>
  );
}
